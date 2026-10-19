package proxy

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/devops-ia/kafka-cruise-control-ui/internal/auth"
	"github.com/devops-ia/kafka-cruise-control-ui/internal/config"
)

// seenAuth sends GET /state through a proxy built with auth and returns what the fake CC received.
func seenAuth(t *testing.T, a config.ClusterAuth, forward string, user auth.User) (hdr http.Header, query url.Values, status int) {
	t.Helper()
	cc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hdr, query = r.Header.Clone(), r.URL.Query()
		w.Write([]byte("{}"))
	}))
	defer cc.Close()
	u, _ := url.Parse(cc.URL + "/kafkacruisecontrol")
	cl := config.Cluster{Name: "a", URL: u, Timeout: 5e9, Auth: a, ForwardIdentity: forward}
	rt, err := NewTransport(cl)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("/api/clusters/{name}/proxy/{endpoint}", New(cl, rt, nil, 1024))
	req := httptest.NewRequest("GET", "/api/clusters/a/proxy/state", nil)
	req.Header.Set("Authorization", "Bearer browser-token")
	req.Header.Set("Cookie", "ccui_session=abc")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req.WithContext(auth.WithUser(req.Context(), user)))
	return hdr, query, rec.Code
}

var viewer = auth.User{Name: "ana", Role: auth.Viewer}

func TestServiceAuthTypes(t *testing.T) {
	cases := []struct {
		name string
		auth config.ClusterAuth
		want string
	}{
		{"none", config.ClusterAuth{Type: "none"}, ""},
		{"basic", config.ClusterAuth{Type: "basic", User: "svc", Password: "pw"}, "Basic c3ZjOnB3"},
		{"bearer", config.ClusterAuth{Type: "bearer", Token: "tok"}, "Bearer tok"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h, _, status := seenAuth(t, c.auth, "", viewer)
			if status != 200 || h.Get("Authorization") != c.want || h.Get("Cookie") != "" {
				t.Fatalf("status %d, Authorization %q, Cookie %q", status, h.Get("Authorization"), h.Get("Cookie"))
			}
		})
	}
}

func TestUnknownAuthTypeFails(t *testing.T) {
	u, _ := url.Parse("http://x")
	if _, err := NewTransport(config.Cluster{URL: u, Auth: config.ClusterAuth{Type: "kerberos"}}); err == nil {
		t.Fatal("expected error")
	}
}

func TestForwardIdentity(t *testing.T) {
	svc := config.ClusterAuth{Type: "basic", User: "svc", Password: "pw"}
	ana := auth.User{Name: "ana", Role: auth.Viewer, Token: "ana-jwt"}

	h, q, _ := seenAuth(t, svc, "doas", ana)
	if q.Get("doAs") != "ana" || h.Get("Authorization") != "Basic c3ZjOnB3" {
		t.Errorf("doas: doAs=%q auth=%q", q.Get("doAs"), h.Get("Authorization"))
	}
	h, q, _ = seenAuth(t, svc, "", ana)
	if q.Has("doAs") || h.Get("Authorization") != "Basic c3ZjOnB3" {
		t.Errorf("default: doAs=%q", q.Get("doAs"))
	}
	h, q, _ = seenAuth(t, svc, "jwt", ana)
	if h.Get("Authorization") != "Bearer ana-jwt" || q.Has("doAs") {
		t.Errorf("jwt: auth=%q", h.Get("Authorization"))
	}
	if _, _, status := seenAuth(t, svc, "jwt", viewer); status != 403 {
		t.Errorf("jwt without token: %d", status)
	}
}
