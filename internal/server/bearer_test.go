package server

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"

	"github.com/devops-ia/kafka-cruise-control-ui/internal/config"
)

// A service account Bearer call goes through Protect and the proxy to Cruise Control,
// and the audit line names the account and role but never holds the token.
func TestBearerDemoteBrokerAudit(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var idp *httptest.Server
	idp = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/keys") {
			json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"}}})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"issuer": idp.URL, "authorization_endpoint": idp.URL + "/authorize",
			"token_endpoint": idp.URL + "/token", "jwks_uri": idp.URL + "/keys", "id_token_signing_alg_values_supported": []string{"RS256"}})
	}))
	t.Cleanup(idp.Close)

	var gotPath string
	cc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.Method + " " + r.URL.Path
		w.Write([]byte(`{}`))
	}))
	t.Cleanup(cc.Close)

	sig, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "k1"))
	if err != nil {
		t.Fatal(err)
	}
	token, err := jwt.Signed(sig).Claims(jwt.Claims{
		Issuer: idp.URL, Subject: "sa1", Audience: jwt.Audience{"ccui-api"},
		Expiry: jwt.NewNumericDate(time.Now().Add(time.Hour)), IssuedAt: jwt.NewNumericDate(time.Now().Add(-time.Minute)),
	}).Claims(map[string]any{"preferred_username": "service-account-ansible", "groups": []string{"ops"}}).Serialize()
	if err != nil {
		t.Fatal(err)
	}

	cfg, err := config.Load(map[string]string{
		"CCUI_AUTH_MODE": "oidc", "CCUI_PUBLIC_URL": "http://ui.test", "CCUI_SESSION_SECRET": strings.Repeat("k", 32),
		"CCUI_OIDC__0__NAME": "corp", "CCUI_OIDC__0__ISSUER": idp.URL, "CCUI_OIDC__0__CLIENT_ID": "ui", "CCUI_OIDC__0__CLIENT_SECRET": "cs",
		"CCUI_OIDC__0__ADMIN_GROUPS": "ops", "CCUI_OIDC__0__API_AUDIENCE": "ccui-api",
		"CCUI_CLUSTERS__0__NAME": "a", "CCUI_CLUSTERS__0__URL": cc.URL + "/kafkacruisecontrol",
	})
	if err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	h, err := New(Deps{Config: cfg, Web: testWeb, Log: slog.New(slog.NewTextHandler(&logs, nil))})
	if err != nil {
		t.Fatal(err)
	}
	ui := httptest.NewServer(h)
	t.Cleanup(ui.Close)

	req, _ := http.NewRequest("POST", ui.URL+"/api/clusters/a/proxy/demote_broker?dryrun=false&brokerid=1", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 || gotPath != "POST /kafkacruisecontrol/demote_broker" {
		t.Fatalf("status %d, upstream saw %q", resp.StatusCode, gotPath)
	}
	out := logs.String()
	for _, want := range []string{`user=service-account-ansible`, `role=admin`, `endpoint=demote_broker`, `dryrun=false`} {
		if !strings.Contains(out, want) {
			t.Errorf("audit log lacks %s: %s", want, out)
		}
	}
	if strings.Contains(out, token) {
		t.Fatalf("log holds the token: %s", out)
	}
}
