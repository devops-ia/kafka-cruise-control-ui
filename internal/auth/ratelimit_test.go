package auth

import (
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

func (r *rig) loginFrom(t *testing.T, ip, user, pw string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest("POST", r.srv.URL+"/api/login", strings.NewReader(`{"username":"`+user+`","password":"`+pw+`"}`))
	req.Header.Set("Origin", r.srv.URL)
	if ip != "" {
		req.Header.Set("X-Forwarded-For", ip)
	}
	resp, err := r.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp
}

func TestLoginLockoutPerIP(t *testing.T) {
	r := newRig(t, mustConfig(t, "CCUI_LOGIN_MAX_ATTEMPTS", "3", "CCUI_LOGIN_WINDOW", "10m"))
	for i := 0; i < 3; i++ {
		if got := r.loginFrom(t, "", "admin", "wrong").StatusCode; got != 401 {
			t.Fatalf("attempt %d: %d", i, got)
		}
	}
	resp := r.loginFrom(t, "", "admin", "pw") // correct password, but locked
	if resp.StatusCode != 429 {
		t.Fatalf("got %d", resp.StatusCode)
	}
	if s, err := strconv.Atoi(resp.Header.Get("Retry-After")); err != nil || s <= 0 || s > 601 {
		t.Fatalf("Retry-After %q", resp.Header.Get("Retry-After"))
	}
	r.now = r.now.Add(11 * time.Minute)
	if got := r.loginFrom(t, "", "admin", "pw").StatusCode; got != 200 {
		t.Fatalf("after the window: %d", got)
	}
}

func TestLoginLockoutPerUserAcrossIPs(t *testing.T) {
	r := newRig(t, mustConfig(t, "CCUI_LOGIN_MAX_ATTEMPTS", "3", "CCUI_TRUST_XFF", "true"))
	for i, ip := range []string{"10.0.0.1", "10.0.0.2", "10.0.0.3"} {
		if got := r.loginFrom(t, ip, "admin", "wrong").StatusCode; got != 401 {
			t.Fatalf("attempt %d: %d", i, got)
		}
	}
	if got := r.loginFrom(t, "10.0.0.4", "admin", "pw").StatusCode; got != 429 {
		t.Fatalf("fresh IP, locked user: %d", got)
	}
	if got := r.loginFrom(t, "10.0.0.4", "someone-else", "x").StatusCode; got != 401 {
		t.Fatalf("other user from fresh IP must not be locked: %d", got)
	}
}

func TestXFFIgnoredUnlessTrusted(t *testing.T) {
	r := newRig(t, mustConfig(t, "CCUI_LOGIN_MAX_ATTEMPTS", "2"))
	for i := 0; i < 2; i++ {
		r.loginFrom(t, "10.0.0."+strconv.Itoa(i), "u"+strconv.Itoa(i), "x")
	}
	if got := r.loginFrom(t, "10.0.0.9", "u9", "x").StatusCode; got != 429 {
		t.Fatalf("spoofed X-Forwarded-For escaped the per-IP limit: %d", got)
	}
}
