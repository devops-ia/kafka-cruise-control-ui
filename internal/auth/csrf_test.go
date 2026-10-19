package auth

import (
	"net/http"
	"testing"
)

func (r *rig) rawPost(t *testing.T, path string, hdr map[string]string) int {
	t.Helper()
	req, _ := http.NewRequest("POST", r.srv.URL+path, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := r.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

func TestCSRF(t *testing.T) {
	for _, mode := range []string{"local", "none"} {
		t.Run(mode, func(t *testing.T) {
			r := newRig(t, mustConfig(t, "CCUI_AUTH_MODE", mode))
			if mode == "local" {
				r.login(t, "admin", "pw")
			}
			token := r.csrf(t)
			if token == "" {
				t.Fatal("no csrf token")
			}
			cases := []struct {
				name string
				hdr  map[string]string
				want int
			}{
				{"no token", map[string]string{"Origin": r.srv.URL}, 403},
				{"wrong token", map[string]string{"Origin": r.srv.URL, "X-CSRF-Token": "0000"}, 403},
				{"foreign origin", map[string]string{"Origin": "https://evil.example", "X-CSRF-Token": token}, 403},
				{"no origin", map[string]string{"X-CSRF-Token": token}, 403},
				{"valid", map[string]string{"Origin": r.srv.URL, "X-CSRF-Token": token}, 200},
			}
			for _, c := range cases {
				if got := r.rawPost(t, "/api/logout", c.hdr); got != c.want {
					t.Errorf("%s: %d, want %d", c.name, got, c.want)
				}
			}
		})
	}
}

func TestTokenIsBoundToSession(t *testing.T) {
	a := newRig(t, mustConfig(t))
	a.login(t, "admin", "pw")
	b := newRig(t, mustConfig(t))
	b.m.key = a.m.key // same key, different session ids
	b.login(t, "admin", "pw")
	if a.csrf(t) == b.csrf(t) {
		t.Fatal("two sessions share a CSRF token")
	}
}

func TestLoginChecksOrigin(t *testing.T) {
	r := newRig(t, mustConfig(t))
	if got := r.rawPost(t, "/api/login", map[string]string{"Origin": "https://evil.example"}); got != 403 {
		t.Fatalf("got %d", got)
	}
}

func TestPublicURLDefinesTheOrigin(t *testing.T) {
	r := newRig(t, mustConfig(t, "CCUI_PUBLIC_URL", "https://ui.example.com"))
	if got := r.rawPost(t, "/api/login", map[string]string{"Origin": "https://ui.example.com"}); got == 403 {
		t.Fatal("public origin rejected")
	}
	if got := r.rawPost(t, "/api/login", map[string]string{"Origin": r.srv.URL}); got != 403 {
		t.Fatalf("host header must not decide when PUBLIC_URL is set: %d", got)
	}
}
