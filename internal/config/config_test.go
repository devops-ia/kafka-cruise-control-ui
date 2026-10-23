package config

import (
	"bytes"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// hash is a valid bcrypt hash of "pw" (cost 4).
const hash = "$2a$04$Frx5sV9qggXUPe8xE.bT9OfZvc9aptmEGGGSUplrseBED7W4jRpFG"

func env(kv ...string) map[string]string {
	m := map[string]string{"CCUI_AUTH_MODE": "none"}
	for i := 0; i < len(kv); i += 2 {
		m[kv[i]] = kv[i+1]
	}
	return m
}

func twoClusters() map[string]string {
	return env(
		"CCUI_CLUSTERS__0__NAME", "a", "CCUI_CLUSTERS__0__URL", "http://cc-a:9090/kafkacruisecontrol",
		"CCUI_CLUSTERS__1__NAME", "b", "CCUI_CLUSTERS__1__URL", "http://cc-b:9090/kafkacruisecontrol", "CCUI_CLUSTERS__1__GROUP", "prod",
	)
}

func TestTwoClustersInOrder(t *testing.T) {
	c, err := Load(twoClusters())
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Clusters) != 2 || c.Clusters[0].Name != "a" || c.Clusters[1].Name != "b" || c.Clusters[1].Group != "prod" {
		t.Fatalf("got %+v", c.Clusters)
	}
	if c.Clusters[0].Timeout.Seconds() != 60 {
		t.Fatalf("default timeout: %v", c.Clusters[0].Timeout)
	}
}

// localEnv is local mode with one valid admin, ana, in CCUI_LOCAL_USERS__0__*.
func localEnv(kv ...string) map[string]string {
	m := env("CCUI_AUTH_MODE", "local", "CCUI_SESSION_SECRET", strings.Repeat("s", 32), "CCUI_CLUSTERS__0__NAME", "a", "CCUI_CLUSTERS__0__URL", "http://x",
		"CCUI_LOCAL_USERS__0__NAME", "ana", "CCUI_LOCAL_USERS__0__ROLE", "admin", "CCUI_LOCAL_USERS__0__PASSWORD_HASH", hash)
	for i := 0; i < len(kv); i += 2 {
		m[kv[i]] = kv[i+1]
	}
	return m
}

func TestLocalUsers(t *testing.T) {
	f := filepath.Join(t.TempDir(), "h")
	if err := os.WriteFile(f, []byte(hash+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	e := localEnv("CCUI_LOCAL_USERS__1__NAME", "leo", "CCUI_LOCAL_USERS__1__ROLE", "viewer", "CCUI_LOCAL_USERS__1__PASSWORD_HASH_FILE", f,
		"CCUI_LOCAL_ADMIN_USER", "root", "CCUI_LOCAL_ADMIN_PASSWORD_HASH", hash)
	c, err := Load(e)
	if err != nil {
		t.Fatal(err)
	}
	want := []LocalUser{{"ana", hash, "admin"}, {"leo", hash, "viewer"}, {"root", hash, "admin"}}
	if len(c.LocalUsers) != 3 || c.LocalUsers[0] != want[0] || c.LocalUsers[1] != want[1] || c.LocalUsers[2] != want[2] {
		t.Fatalf("got %+v", c.LocalUsers)
	}
	var buf bytes.Buffer
	c.Log(slog.New(slog.NewJSONHandler(&buf, nil)))
	if strings.Contains(buf.String(), hash) {
		t.Fatalf("log leaks a hash: %s", buf.String())
	}
}

func TestInvalid(t *testing.T) {
	base := func(kv ...string) map[string]string {
		m := env("CCUI_CLUSTERS__0__NAME", "a", "CCUI_CLUSTERS__0__URL", "http://x:1/kafkacruisecontrol")
		for i := 0; i < len(kv); i += 2 {
			m[kv[i]] = kv[i+1]
		}
		return m
	}
	cases := []struct {
		name string
		env  map[string]string
		want string
	}{
		{"no clusters", env(), "at least one cluster"},
		{"bad url", base("CCUI_CLUSTERS__0__URL", "ftp://x"), "CCUI_CLUSTERS__0__URL"},
		{"duplicate", base("CCUI_CLUSTERS__1__NAME", "a", "CCUI_CLUSTERS__1__URL", "http://y"), "duplicate"},
		{"gap", base("CCUI_CLUSTERS__2__NAME", "c", "CCUI_CLUSTERS__2__URL", "http://y"), "CCUI_CLUSTERS__1__"},
		{"bad auth type", base("CCUI_CLUSTERS__0__AUTH_TYPE", "kerberos"), "CCUI_CLUSTERS__0__AUTH_TYPE"},
		{"basic needs password", base("CCUI_CLUSTERS__0__AUTH_TYPE", "basic", "CCUI_CLUSTERS__0__AUTH_USER", "u"), "CCUI_CLUSTERS__0__AUTH_PASSWORD"},
		{"bearer needs token", base("CCUI_CLUSTERS__0__AUTH_TYPE", "bearer"), "CCUI_CLUSTERS__0__AUTH_TOKEN"},
		{"sigv4 needs region", base("CCUI_CLUSTERS__0__AUTH_TYPE", "sigv4"), "CCUI_CLUSTERS__0__AUTH_SIGV4_REGION"},
		{"oidc needs fields", base("CCUI_CLUSTERS__0__AUTH_TYPE", "oidc"), "CCUI_CLUSTERS__0__AUTH_OIDC_TOKEN_URL"},
		{"bad forward", base("CCUI_CLUSTERS__0__AUTH_FORWARD_IDENTITY", "x"), "CCUI_CLUSTERS__0__AUTH_FORWARD_IDENTITY"},
		{"bad timeout", base("CCUI_CLUSTERS__0__TIMEOUT", "soon"), "CCUI_CLUSTERS__0__TIMEOUT"},
		{"bad mode", base("CCUI_AUTH_MODE", "ldap"), "CCUI_AUTH_MODE"},
		{"no local users", base("CCUI_AUTH_MODE", "local", "CCUI_SESSION_SECRET", strings.Repeat("s", 32)), "at least one local user"},
		{"user index gap", localEnv("CCUI_LOCAL_USERS__2__NAME", "z", "CCUI_LOCAL_USERS__2__ROLE", "viewer", "CCUI_LOCAL_USERS__2__PASSWORD_HASH", hash), "CCUI_LOCAL_USERS__1__"},
		{"user role missing", localEnv("CCUI_LOCAL_USERS__1__NAME", "z", "CCUI_LOCAL_USERS__1__PASSWORD_HASH", hash), "CCUI_LOCAL_USERS__1__ROLE"},
		{"user role operator", localEnv("CCUI_LOCAL_USERS__1__NAME", "z", "CCUI_LOCAL_USERS__1__ROLE", "operator", "CCUI_LOCAL_USERS__1__PASSWORD_HASH", hash), "CCUI_LOCAL_USERS__1__ROLE"},
		{"user plaintext", localEnv("CCUI_LOCAL_USERS__1__NAME", "z", "CCUI_LOCAL_USERS__1__ROLE", "viewer", "CCUI_LOCAL_USERS__1__PASSWORD_HASH", "hunter2"), "CCUI_LOCAL_USERS__1__PASSWORD_HASH"},
		{"duplicate local users", localEnv("CCUI_LOCAL_USERS__1__NAME", "ana", "CCUI_LOCAL_USERS__1__ROLE", "viewer", "CCUI_LOCAL_USERS__1__PASSWORD_HASH", hash), `duplicate local user name "ana"`},
		{"duplicate with shortcut", localEnv("CCUI_LOCAL_ADMIN_USER", "ana", "CCUI_LOCAL_ADMIN_PASSWORD_HASH", hash), `duplicate local user name "ana"`},
		{"default role operator", base("CCUI_OIDC__0__DEFAULT_ROLE", "operator"), "CCUI_OIDC__0__DEFAULT_ROLE"},
		{"local needs hash", base("CCUI_AUTH_MODE", "local", "CCUI_SESSION_SECRET", strings.Repeat("s", 32)), "CCUI_LOCAL_ADMIN_PASSWORD_HASH"},
		{"plaintext password", base("CCUI_AUTH_MODE", "local", "CCUI_SESSION_SECRET", strings.Repeat("s", 32), "CCUI_LOCAL_ADMIN_PASSWORD_HASH", "hunter2"), "CCUI_LOCAL_ADMIN_PASSWORD_HASH"},
		{"local needs secret", base("CCUI_AUTH_MODE", "local", "CCUI_LOCAL_ADMIN_PASSWORD_HASH", hash), "CCUI_SESSION_SECRET"},
		{"tls half", base("CCUI_TLS_CERT", "/c.pem"), "CCUI_TLS_KEY"},
		{"logo not http", base("CCUI_LOGO_URL", "javascript:alert(1)"), "CCUI_LOGO_URL"},
		{"logo relative", base("CCUI_LOGO_URL", "/logo.png"), "CCUI_LOGO_URL"},
		{"logo host breaks csp", base("CCUI_LOGO_URL", "https://a;script-src"), "CCUI_LOGO_URL"}, // parses: only the host guard rejects it
		{"unknown var", base("CCUI_CLUSTERS__0__AUTH_TPYE", "basic"), "CCUI_CLUSTERS__0__AUTH_TPYE"},
		{"oidc mode needs provider", base("CCUI_AUTH_MODE", "oidc", "CCUI_SESSION_SECRET", strings.Repeat("s", 32), "CCUI_PUBLIC_URL", "https://ui"), "CCUI_OIDC__0__"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Load(tc.env)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("want error containing %q, got %v", tc.want, err)
			}
		})
	}
}

func TestSecretFromFileTrimsNewline(t *testing.T) {
	f := filepath.Join(t.TempDir(), "pw")
	if err := os.WriteFile(f, []byte("s3cret\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	e := env("CCUI_CLUSTERS__0__NAME", "a", "CCUI_CLUSTERS__0__URL", "http://x",
		"CCUI_CLUSTERS__0__AUTH_TYPE", "basic", "CCUI_CLUSTERS__0__AUTH_USER", "u", "CCUI_CLUSTERS__0__AUTH_PASSWORD_FILE", f)
	c, err := Load(e)
	if err != nil {
		t.Fatal(err)
	}
	if c.Clusters[0].Auth.Password != "s3cret" {
		t.Fatalf("password %q", c.Clusters[0].Auth.Password)
	}
}

func TestLogHasNoSecrets(t *testing.T) {
	e := twoClusters()
	e["CCUI_CLUSTERS__0__AUTH_TYPE"] = "basic"
	e["CCUI_CLUSTERS__0__AUTH_USER"] = "svc"
	e["CCUI_CLUSTERS__0__AUTH_PASSWORD"] = "TOPSECRET-pw"
	e["CCUI_CLUSTERS__1__AUTH_TYPE"] = "bearer"
	e["CCUI_CLUSTERS__1__AUTH_TOKEN"] = "TOPSECRET-token"
	c, err := Load(e)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	c.Log(slog.New(slog.NewJSONHandler(&buf, nil)))
	if buf.Len() == 0 || strings.Contains(buf.String(), "TOPSECRET") {
		t.Fatalf("log: %s", buf.String())
	}
}

func TestOIDCModeProvider(t *testing.T) {
	e := env("CCUI_AUTH_MODE", "oidc", "CCUI_SESSION_SECRET", strings.Repeat("s", 32), "CCUI_PUBLIC_URL", "https://ui.example",
		"CCUI_CLUSTERS__0__NAME", "a", "CCUI_CLUSTERS__0__URL", "http://x",
		"CCUI_OIDC__0__NAME", "corp", "CCUI_OIDC__0__ISSUER", "https://idp", "CCUI_OIDC__0__CLIENT_ID", "id", "CCUI_OIDC__0__CLIENT_SECRET", "sec",
		"CCUI_OIDC__0__ADMIN_GROUPS", "ops, admins")
	c, err := Load(e)
	if err != nil {
		t.Fatal(err)
	}
	p := c.OIDC[0]
	if p.GroupsClaim != "groups" || len(p.AdminGroups) != 2 || p.AdminGroups[1] != "admins" || p.RedirectURL != "https://ui.example/api/auth/corp/callback" {
		t.Fatalf("%+v", p)
	}
}
