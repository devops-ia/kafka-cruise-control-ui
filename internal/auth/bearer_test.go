package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

// access is a service account access token as Keycloak issues it from client_credentials.
type access struct {
	iss, aud, azp, user string
	groups              []string
	exp                 time.Duration // relative to now
	signer              *rsa.PrivateKey
}

func (p *fakeIdP) access(t *testing.T, a access) string {
	t.Helper()
	if a.iss == "" {
		a.iss = p.URL
	}
	if a.aud == "" {
		a.aud = "ccui-api"
	}
	if a.user == "" {
		a.user = "service-account-ansible"
	}
	if a.exp == 0 {
		a.exp = time.Hour
	}
	if a.signer == nil {
		a.signer = p.key
	}
	sig, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: a.signer}, (&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "k1"))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := jwt.Signed(sig).Claims(jwt.Claims{
		Issuer: a.iss, Subject: "sa1", Audience: jwt.Audience{a.aud},
		Expiry: jwt.NewNumericDate(time.Now().Add(a.exp)), IssuedAt: jwt.NewNumericDate(time.Now().Add(-time.Minute)),
	}).Claims(map[string]any{"preferred_username": a.user, "azp": a.azp, "groups": a.groups}).Serialize()
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func bearerRig(t *testing.T, extra ...string) (*rig, *fakeIdP) {
	idp := newFakeIdP(t)
	return oidcRig(t, idp, append([]string{"CCUI_OIDC__0__API_AUDIENCE", "ccui-api"}, extra...)...), idp
}

// call sends one request with the given Authorization value and no cookie, Origin or CSRF token.
func (r *rig) call(t *testing.T, method, authz string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(method, r.srv.URL+"/api/whoami", nil)
	if authz != "" {
		req.Header.Set("Authorization", authz)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func TestBearerValidTokenNeedsNoSession(t *testing.T) {
	r, idp := bearerRig(t)
	code, body := r.call(t, "GET", "Bearer "+idp.access(t, access{groups: []string{"ops"}}))
	if code != 200 || !strings.Contains(body, `"user":"service-account-ansible"`) || !strings.Contains(body, `"role":"admin"`) {
		t.Fatalf("%d %s", code, body)
	}
	if len(r.m.sessions) != 0 {
		t.Fatal("a session was created")
	}
}

func TestBearerIgnoredWithoutAudience(t *testing.T) {
	idp := newFakeIdP(t)
	r := oidcRig(t, idp) // no API_AUDIENCE
	if code, _ := r.call(t, "GET", "Bearer "+idp.access(t, access{groups: []string{"ops"}})); code != 401 {
		t.Fatalf("got %d", code)
	}
}

func TestBearerIgnoredOutsideOIDCMode(t *testing.T) {
	r := newRig(t, mustConfig(t))
	if code, _ := r.call(t, "GET", "Bearer anything"); code != 401 {
		t.Fatalf("got %d", code)
	}
}

func TestBearerRejected(t *testing.T) {
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	cases := map[string]access{
		"other audience": {aud: "account", groups: []string{"ops"}},
		"expired":        {exp: -time.Hour, groups: []string{"ops"}},
		"bad signature":  {signer: other, groups: []string{"ops"}},
		"other issuer":   {iss: "http://evil.example", groups: []string{"ops"}},
	}
	for name, a := range cases {
		t.Run(name, func(t *testing.T) {
			r, idp := bearerRig(t)
			tok := idp.access(t, a)
			var buf strings.Builder
			r.m.log = slog.New(slog.NewTextHandler(&buf, nil))
			if code, _ := r.call(t, "GET", "Bearer "+tok); code != 401 {
				t.Fatalf("got %d", code)
			}
			if len(r.m.sessions) != 0 {
				t.Fatal("a session was created")
			}
			if strings.Contains(buf.String(), tok) {
				t.Fatalf("log holds the token: %s", buf.String())
			}
		})
	}
}

func TestBearerGarbageIs401(t *testing.T) {
	r, _ := bearerRig(t)
	for _, h := range []string{"Bearer ", "Bearer not-a-jwt"} {
		if code, _ := r.call(t, "GET", h); code != 401 {
			t.Errorf("%q: %d", h, code)
		}
	}
}

func TestOtherSchemeFallsBackToSession(t *testing.T) {
	r, idp := bearerRig(t)
	r.browse(t, idp)
	req, _ := http.NewRequest("GET", r.srv.URL+"/api/whoami", nil)
	req.Header.Set("Authorization", "Basic Zm9vOmJhcg==")
	resp, err := r.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("got %d", resp.StatusCode)
	}
}

func TestInvalidBearerDoesNotFallBackToSession(t *testing.T) {
	r, idp := bearerRig(t)
	r.browse(t, idp)
	req, _ := http.NewRequest("GET", r.srv.URL+"/api/whoami", nil)
	req.Header.Set("Authorization", "Bearer "+idp.access(t, access{aud: "account"}))
	resp, err := r.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("got %d", resp.StatusCode)
	}
}

func TestBearerRoles(t *testing.T) {
	cases := []struct {
		name   string
		groups []string
		extra  []string
		want   int
		role   string
	}{
		{"admin", []string{"ops"}, nil, 200, "admin"},
		{"viewer", []string{"dev"}, nil, 200, "viewer"},
		{"no group, no default", []string{"other"}, nil, 403, ""},
		{"no group, default viewer", nil, []string{"CCUI_OIDC__0__DEFAULT_ROLE", "viewer"}, 200, "viewer"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r, idp := bearerRig(t, c.extra...)
			code, body := r.call(t, "GET", "Bearer "+idp.access(t, access{groups: c.groups}))
			if code != c.want || !strings.Contains(body, `"role":"`+c.role+`"`) && c.role != "" {
				t.Fatalf("%d %s", code, body)
			}
		})
	}
}

func TestBearerAcceptsAnyClientOfTheIssuer(t *testing.T) {
	r, idp := bearerRig(t)
	for _, azp := range []string{"ansible", "terraform"} {
		if code, _ := r.call(t, "GET", "Bearer "+idp.access(t, access{azp: azp, groups: []string{"ops"}})); code != 200 {
			t.Errorf("azp %s: %d", azp, code)
		}
	}
}

func TestBearerSecondProviderAuthenticates(t *testing.T) {
	idp1, idp2 := newFakeIdP(t), newFakeIdP(t)
	cfg := mustConfig(t, "CCUI_AUTH_MODE", "oidc", "CCUI_PUBLIC_URL", "http://placeholder",
		"CCUI_OIDC__0__NAME", "one", "CCUI_OIDC__0__ISSUER", idp1.URL, "CCUI_OIDC__0__CLIENT_ID", "c1", "CCUI_OIDC__0__CLIENT_SECRET", "s",
		"CCUI_OIDC__0__ADMIN_GROUPS", "ops",
		"CCUI_OIDC__1__NAME", "two", "CCUI_OIDC__1__ISSUER", idp2.URL, "CCUI_OIDC__1__CLIENT_ID", "c2", "CCUI_OIDC__1__CLIENT_SECRET", "s",
		"CCUI_OIDC__1__VIEWER_GROUPS", "dev", "CCUI_OIDC__1__API_AUDIENCE", "ccui-api")
	r := newRig(t, cfg)
	code, body := r.call(t, "GET", "Bearer "+idp2.access(t, access{groups: []string{"dev"}}))
	if code != 200 || !strings.Contains(body, `"role":"viewer"`) {
		t.Fatalf("%d %s", code, body)
	}
	if code, _ := r.call(t, "GET", "Bearer "+idp1.access(t, access{groups: []string{"ops"}})); code != 401 {
		t.Fatalf("provider without audience accepted a token: %d", code)
	}
}

func TestBearerNameOfLocalUserIsRefusedAndAudited(t *testing.T) {
	r, idp := bearerRig(t, "CCUI_LOCAL_USERS__0__NAME", "ana", "CCUI_LOCAL_USERS__0__ROLE", "viewer", "CCUI_LOCAL_USERS__0__PASSWORD_HASH", pwHash)
	var buf strings.Builder
	r.m.log = slog.New(slog.NewTextHandler(&buf, nil))
	if code, _ := r.call(t, "GET", "Bearer "+idp.access(t, access{user: "ana", groups: []string{"ops"}})); code != 403 {
		t.Fatalf("got %d", code)
	}
	if !strings.Contains(buf.String(), "audit") || !strings.Contains(buf.String(), "user=ana") {
		t.Fatalf("no audit line: %s", buf.String())
	}
}

func TestBearerSkipsCSRFButCookieDoesNot(t *testing.T) {
	r, idp := bearerRig(t)
	if code, _ := r.call(t, "POST", "Bearer "+idp.access(t, access{groups: []string{"ops"}})); code != 200 {
		t.Fatalf("bearer POST: %d", code)
	}
	r.browse(t, idp)
	req, _ := http.NewRequest("POST", r.srv.URL+"/api/whoami", nil) // cookie, no CSRF token, no Origin
	resp, err := r.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatalf("cookie POST: %d", resp.StatusCode)
	}
}
