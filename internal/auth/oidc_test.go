package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

// fakeIdP is a minimal OIDC provider: discovery, JWKS, authorize (driven by the test) and token endpoint.
type fakeIdP struct {
	*httptest.Server
	key *rsa.PrivateKey

	mu            sync.Mutex
	codes         map[string]authRequest
	groups        []string
	nonceOverride string
}

type authRequest struct{ nonce, challenge string }

func newFakeIdP(t *testing.T) *fakeIdP {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	p := &fakeIdP{key: key, codes: map[string]authRequest{}, groups: []string{"ops"}}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"issuer": p.URL, "authorization_endpoint": p.URL + "/authorize", "token_endpoint": p.URL + "/token",
			"jwks_uri": p.URL + "/keys", "id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("/keys", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"}}})
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		p.mu.Lock()
		req, ok := p.codes[r.Form.Get("code")]
		nonce, groups := req.nonce, p.groups
		if p.nonceOverride != "" {
			nonce = p.nonceOverride
		}
		p.mu.Unlock()
		sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
		if !ok || base64.RawURLEncoding.EncodeToString(sum[:]) != req.challenge {
			http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
			return
		}
		sig, _ := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "k1"))
		raw, _ := jwt.Signed(sig).Claims(jwt.Claims{
			Issuer: p.URL, Subject: "u1", Audience: jwt.Audience{"client-id"},
			Expiry: jwt.NewNumericDate(time.Now().Add(time.Hour)), IssuedAt: jwt.NewNumericDate(time.Now()),
		}).Claims(map[string]any{"nonce": nonce, "preferred_username": "ana", "groups": groups}).Serialize()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"access_token": "at", "token_type": "Bearer", "id_token": raw, "expires_in": 3600})
	})
	p.Server = httptest.NewServer(mux)
	t.Cleanup(p.Close)
	return p
}

// authorize plays the IdP's login page: it records the request and returns the callback URL the browser is sent to.
func (p *fakeIdP) authorize(t *testing.T, location string) string {
	u, err := url.Parse(location)
	if err != nil || !strings.HasPrefix(location, p.URL+"/authorize") {
		t.Fatalf("redirect to %q", location)
	}
	q := u.Query()
	if q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "" || q.Get("state") == "" || q.Get("nonce") == "" || q.Get("response_type") != "code" {
		t.Fatalf("authorize params missing PKCE/state/nonce: %v", q)
	}
	p.mu.Lock()
	p.codes["code-1"] = authRequest{nonce: q.Get("nonce"), challenge: q.Get("code_challenge")}
	p.mu.Unlock()
	cb, _ := url.Parse(q.Get("redirect_uri"))
	cb.RawQuery = url.Values{"code": {"code-1"}, "state": {q.Get("state")}}.Encode()
	return cb.String()
}

func oidcRig(t *testing.T, idp *fakeIdP, extra ...string) *rig {
	kv := append([]string{
		"CCUI_AUTH_MODE", "oidc", "CCUI_PUBLIC_URL", "http://placeholder",
		"CCUI_OIDC__0__NAME", "corp", "CCUI_OIDC__0__ISSUER", idp.URL, "CCUI_OIDC__0__CLIENT_ID", "client-id", "CCUI_OIDC__0__CLIENT_SECRET", "cs",
		"CCUI_OIDC__0__ADMIN_GROUPS", "ops", "CCUI_OIDC__0__OPERATOR_GROUPS", "sre", "CCUI_OIDC__0__VIEWER_GROUPS", "dev",
	}, extra...)
	cfg := mustConfig(t, kv...)
	r := newRig(t, cfg)
	// The redirect URL must point at the test server, which only exists after newRig.
	cfg.OIDC[0].RedirectURL = r.srv.URL + "/api/auth/corp/callback"
	cfg.PublicURL = r.srv.URL
	return r
}

// browse performs login -> IdP -> callback and returns the callback response.
func (r *rig) browse(t *testing.T, idp *fakeIdP) *http.Response {
	t.Helper()
	resp, err := r.client.Get(r.srv.URL + "/api/auth/corp/login")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("login: %d", resp.StatusCode)
	}
	cb := idp.authorize(t, resp.Header.Get("Location"))
	resp, err = r.client.Get(cb)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp
}

func TestOIDCLoginFlow(t *testing.T) {
	idp := newFakeIdP(t)
	r := oidcRig(t, idp)
	resp := r.browse(t, idp)
	if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != "/" {
		t.Fatalf("callback: %d -> %q", resp.StatusCode, resp.Header.Get("Location"))
	}
	if resp, body := r.send(t, "GET", "/api/whoami", ""); resp.StatusCode != 200 || !strings.Contains(body, `"user":"ana"`) || !strings.Contains(body, `"role":"admin"`) {
		t.Fatalf("whoami: %d %s", resp.StatusCode, body)
	}
	if _, body := r.send(t, "GET", "/api/session", ""); !strings.Contains(body, `"providers":["corp"]`) {
		t.Fatalf("session: %s", body)
	}
}

func TestOIDCInvalidState(t *testing.T) {
	idp := newFakeIdP(t)
	r := oidcRig(t, idp)
	resp, _ := r.client.Get(r.srv.URL + "/api/auth/corp/login")
	resp.Body.Close()
	cb := idp.authorize(t, resp.Header.Get("Location"))
	cb = strings.Replace(cb, "state=", "state=tampered", 1)
	resp, _ = r.client.Get(cb)
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("got %d", resp.StatusCode)
	}
	if got, _ := r.send(t, "GET", "/api/whoami", ""); got.StatusCode != 401 {
		t.Fatalf("session created: %d", got.StatusCode)
	}
}

func TestOIDCStateFromAnotherBrowserIsRejected(t *testing.T) {
	idp := newFakeIdP(t)
	r := oidcRig(t, idp)
	resp, _ := r.client.Get(r.srv.URL + "/api/auth/corp/login")
	resp.Body.Close()
	cb := idp.authorize(t, resp.Header.Get("Location"))
	// A different browser (no state cookie) completes the callback, as in a login-CSRF attack.
	resp, _ = http.DefaultClient.Get(cb)
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("got %d", resp.StatusCode)
	}
}

func TestOIDCInvalidNonce(t *testing.T) {
	idp := newFakeIdP(t)
	idp.nonceOverride = "someone-elses-nonce"
	r := oidcRig(t, idp)
	if resp := r.browse(t, idp); resp.StatusCode < 400 {
		t.Fatalf("callback: %d", resp.StatusCode)
	}
	if got, _ := r.send(t, "GET", "/api/whoami", ""); got.StatusCode != 401 {
		t.Fatalf("session created: %d", got.StatusCode)
	}
}

func TestOIDCRoleMapping(t *testing.T) {
	cases := []struct {
		name   string
		groups []string
		extra  []string
		role   string // "" means access denied
	}{
		{"admin wins", []string{"dev", "ops"}, nil, "admin"},
		{"operator", []string{"sre"}, nil, "operator"},
		{"viewer", []string{"dev"}, nil, "viewer"},
		{"no mapped group, no default", []string{"other"}, nil, ""},
		{"no mapped group, default viewer", []string{"other"}, []string{"CCUI_OIDC__0__DEFAULT_ROLE", "viewer"}, "viewer"},
		{"no groups claim at all", nil, nil, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			idp := newFakeIdP(t)
			idp.groups = c.groups
			r := oidcRig(t, idp, c.extra...)
			resp := r.browse(t, idp)
			who, body := r.send(t, "GET", "/api/whoami", "")
			if c.role == "" {
				if resp.StatusCode != 403 || who.StatusCode != 401 {
					t.Fatalf("callback %d, whoami %d", resp.StatusCode, who.StatusCode)
				}
				return
			}
			if !strings.Contains(body, `"role":"`+c.role+`"`) {
				t.Fatalf("callback %d, whoami %d %s", resp.StatusCode, who.StatusCode, body)
			}
		})
	}
}

func TestUnknownProviderIs404(t *testing.T) {
	idp := newFakeIdP(t)
	r := oidcRig(t, idp)
	resp, _ := r.client.Get(r.srv.URL + "/api/auth/nope/login")
	resp.Body.Close()
	if resp.StatusCode != 404 {
		t.Fatalf("got %d", resp.StatusCode)
	}
}
