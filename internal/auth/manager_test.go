package auth

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/devops-ia/kafka-cruise-control-ui/internal/config"
)

const pwHash = "$2a$04$Frx5sV9qggXUPe8xE.bT9OfZvc9aptmEGGGSUplrseBED7W4jRpFG" // bcrypt of "pw"

func mustConfig(t *testing.T, kv ...string) *config.Config {
	t.Helper()
	env := map[string]string{
		"CCUI_CLUSTERS__0__NAME": "a", "CCUI_CLUSTERS__0__URL": "http://cc:9090/kafkacruisecontrol",
		"CCUI_AUTH_MODE": "local", "CCUI_LOCAL_ADMIN_PASSWORD_HASH": pwHash, "CCUI_SESSION_SECRET": strings.Repeat("k", 32),
	}
	for i := 0; i < len(kv); i += 2 {
		env[kv[i]] = kv[i+1]
	}
	c, err := config.Load(env)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

type rig struct {
	m      *Manager
	srv    *httptest.Server
	client *http.Client
	now    time.Time
}

// newRig serves the auth routes plus a protected /api/whoami that reports the caller.
func newRig(t *testing.T, cfg *config.Config) *rig {
	t.Helper()
	r := &rig{now: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)}
	r.m = NewManager(cfg, slog.New(slog.NewTextHandler(testWriter{t}, nil)))
	r.m.now = func() time.Time { return r.now }
	mux := http.NewServeMux()
	r.m.Routes(mux)
	mux.Handle("/api/whoami", r.m.Protect(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		u, _ := UserFrom(req.Context())
		json.NewEncoder(w).Encode(map[string]string{"user": u.Name, "role": u.Role.String()})
	})))
	r.srv = httptest.NewServer(mux)
	t.Cleanup(r.srv.Close)
	jar, _ := cookiejar.New(nil)
	r.client = &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return r
}

// send does a request the way the SPA does: same Origin and, for POST, the CSRF token from /api/session.
func (r *rig) send(t *testing.T, method, path, body string) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest(method, r.srv.URL+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if method == "POST" {
		req.Header.Set("Origin", r.srv.URL)
		if path != "/api/login" {
			req.Header.Set("X-CSRF-Token", r.csrf(t))
		}
	}
	resp, err := r.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, string(b)
}

func (r *rig) csrf(t *testing.T) string {
	resp, err := r.client.Get(r.srv.URL + "/api/session")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var s struct {
		CSRFToken string `json:"csrfToken"`
	}
	json.NewDecoder(resp.Body).Decode(&s)
	return s.CSRFToken
}

func (r *rig) login(t *testing.T, user, pw string) *http.Response {
	resp, _ := r.send(t, "POST", "/api/login", `{"username":"`+user+`","password":"`+pw+`"}`)
	return resp
}

func TestLocalModeRequiresSession(t *testing.T) {
	r := newRig(t, mustConfig(t))
	if resp, _ := r.send(t, "GET", "/api/whoami", ""); resp.StatusCode != 401 {
		t.Fatalf("got %d", resp.StatusCode)
	}
}

func TestLocalLogin(t *testing.T) {
	r := newRig(t, mustConfig(t))

	bad1, body1 := r.send(t, "POST", "/api/login", `{"username":"admin","password":"wrong"}`)
	bad2, body2 := r.send(t, "POST", "/api/login", `{"username":"nobody","password":"pw"}`)
	if bad1.StatusCode != 401 || bad2.StatusCode != 401 || body1 != body2 {
		t.Fatalf("wrong credentials must look the same: %d %q / %d %q", bad1.StatusCode, body1, bad2.StatusCode, body2)
	}

	ok := r.login(t, "admin", "pw")
	if ok.StatusCode != 200 {
		t.Fatalf("login: %d", ok.StatusCode)
	}
	if resp, body := r.send(t, "GET", "/api/whoami", ""); resp.StatusCode != 200 || !strings.Contains(body, `"role":"admin"`) {
		t.Fatalf("whoami: %d %s", resp.StatusCode, body)
	}
}

func TestSessionCookieAttributes(t *testing.T) {
	r := newRig(t, mustConfig(t))
	c := r.login(t, "admin", "pw").Header.Get("Set-Cookie")
	for _, want := range []string{"HttpOnly", "Secure", "SameSite=Lax", "Path=/"} {
		if !strings.Contains(c, want) {
			t.Errorf("cookie %q lacks %s", c, want)
		}
	}
	dev := newRig(t, mustConfig(t, "CCUI_COOKIE_INSECURE", "true"))
	if c := dev.login(t, "admin", "pw").Header.Get("Set-Cookie"); strings.Contains(c, "Secure") || !strings.Contains(c, "HttpOnly") {
		t.Errorf("dev cookie %q", c)
	}
}

func TestLogoutInvalidatesServerSide(t *testing.T) {
	r := newRig(t, mustConfig(t))
	r.login(t, "admin", "pw")
	u, _ := http.NewRequest("GET", r.srv.URL, nil)
	saved := r.client.Jar.Cookies(u.URL)

	if resp, _ := r.send(t, "POST", "/api/logout", ""); resp.StatusCode != 200 {
		t.Fatalf("logout: %d", resp.StatusCode)
	}
	req, _ := http.NewRequest("GET", r.srv.URL+"/api/whoami", nil)
	for _, c := range saved {
		req.AddCookie(c)
	}
	resp, _ := http.DefaultClient.Do(req)
	if resp.StatusCode != 401 {
		t.Fatalf("reused cookie: %d", resp.StatusCode)
	}
}

func TestSessionExpires(t *testing.T) {
	r := newRig(t, mustConfig(t, "CCUI_SESSION_IDLE_TIMEOUT", "10m", "CCUI_SESSION_MAX_AGE", "1h"))
	r.login(t, "admin", "pw")
	r.now = r.now.Add(9 * time.Minute)
	if resp, _ := r.send(t, "GET", "/api/whoami", ""); resp.StatusCode != 200 {
		t.Fatalf("active session: %d", resp.StatusCode)
	}
	r.now = r.now.Add(11 * time.Minute)
	if resp, _ := r.send(t, "GET", "/api/whoami", ""); resp.StatusCode != 401 {
		t.Fatalf("idle session: %d", resp.StatusCode)
	}
	r.login(t, "admin", "pw")
	for i := 0; i < 7; i++ { // stays active but passes the absolute limit
		r.now = r.now.Add(9 * time.Minute)
		r.send(t, "GET", "/api/whoami", "")
	}
	if resp, _ := r.send(t, "GET", "/api/whoami", ""); resp.StatusCode != 401 {
		t.Fatalf("absolute expiry: %d", resp.StatusCode)
	}
}

func TestNoneModeIsAdminWithoutLogin(t *testing.T) {
	r := newRig(t, mustConfig(t, "CCUI_AUTH_MODE", "none"))
	if resp, body := r.send(t, "GET", "/api/whoami", ""); resp.StatusCode != 200 || !strings.Contains(body, `"role":"admin"`) {
		t.Fatalf("%d %s", resp.StatusCode, body)
	}
	if resp, _ := r.send(t, "POST", "/api/login", `{}`); resp.StatusCode != 404 {
		t.Fatalf("login in none mode: %d", resp.StatusCode)
	}
}

type testWriter struct{ t *testing.T }

func (w testWriter) Write(p []byte) (int, error) {
	w.t.Log(strings.TrimSpace(string(p)))
	return len(p), nil
}

func TestSeveralLocalUsersKeepTheirRoles(t *testing.T) {
	cfg := mustConfig(t, "CCUI_LOCAL_ADMIN_PASSWORD_HASH", "",
		"CCUI_LOCAL_USERS__0__NAME", "ana", "CCUI_LOCAL_USERS__0__ROLE", "admin", "CCUI_LOCAL_USERS__0__PASSWORD_HASH", pwHash,
		"CCUI_LOCAL_USERS__1__NAME", "leo", "CCUI_LOCAL_USERS__1__ROLE", "viewer", "CCUI_LOCAL_USERS__1__PASSWORD_HASH", pwHash)
	for user, role := range map[string]string{"ana": "admin", "leo": "viewer"} {
		r := newRig(t, cfg)
		if resp := r.login(t, user, "pw"); resp.StatusCode != 200 {
			t.Fatalf("%s login: %d", user, resp.StatusCode)
		}
		if _, body := r.send(t, "GET", "/api/session", ""); !strings.Contains(body, `"role":"`+role+`"`) {
			t.Fatalf("%s session: %s", user, body)
		}
	}
	if resp := newRig(t, cfg).login(t, "admin", "pw"); resp.StatusCode != 401 {
		t.Fatalf("shortcut must be absent: %d", resp.StatusCode)
	}
}
