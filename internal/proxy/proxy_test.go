package proxy

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/devops-ia/kafka-cruise-control-ui/internal/auth"
	"github.com/devops-ia/kafka-cruise-control-ui/internal/config"
)

type fixture struct {
	cc   *httptest.Server
	hits atomic.Int32
	last atomic.Pointer[http.Request]
	ui   *httptest.Server
}

// newFixture starts a fake Cruise Control behind handler and the proxy in front of it, acting as role.
func newFixture(t *testing.T, role auth.Role, timeout time.Duration, h http.HandlerFunc) *fixture {
	t.Helper()
	f := &fixture{}
	f.cc = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.hits.Add(1)
		f.last.Store(r)
		h(w, r)
	}))
	t.Cleanup(f.cc.Close)
	u, _ := url.Parse(f.cc.URL + "/kafkacruisecontrol")
	p := New(config.Cluster{Name: "a", URL: u, Timeout: timeout}, http.DefaultTransport, nil, 1024)
	mux := http.NewServeMux()
	mux.Handle("/api/clusters/{name}/proxy/{endpoint}", p)
	f.ui = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mux.ServeHTTP(w, r.WithContext(auth.WithUser(r.Context(), auth.User{Name: "ana", Role: role})))
	}))
	t.Cleanup(f.ui.Close)
	return f
}

// newFixtureWith runs the proxy for a cluster at ccURL using the real NewTransport (viewer role).
func newFixtureWith(t *testing.T, cl config.Cluster, ccURL string) *fixture {
	t.Helper()
	cl.Name, cl.Timeout = "a", time.Second
	cl.URL, _ = url.Parse(ccURL + "/kafkacruisecontrol")
	rt, err := NewTransport(cl)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("/api/clusters/{name}/proxy/{endpoint}", New(cl, rt, nil, 1024))
	f := &fixture{}
	f.ui = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mux.ServeHTTP(w, r.WithContext(auth.WithUser(r.Context(), auth.User{Name: "ana", Role: auth.Viewer})))
	}))
	t.Cleanup(f.ui.Close)
	return f
}

func ok(w http.ResponseWriter, _ *http.Request) { w.Write([]byte(`{"ok":true}`)) }

func do(t *testing.T, method, url string, hdr map[string]string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(method, url, nil)
	for k, v := range hdr {
		if k == "Host" {
			req.Host = v
		} else {
			req.Header.Set(k, v)
		}
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func TestAllowedEndpointReachesCC(t *testing.T) {
	f := newFixture(t, auth.Viewer, time.Second, ok)
	resp := do(t, "GET", f.ui.URL+"/api/clusters/a/proxy/state?verbose=true", nil)
	r := f.last.Load()
	if resp.StatusCode != 200 || r.Method != "GET" || r.URL.Path != "/kafkacruisecontrol/state" || r.URL.Query().Get("json") != "true" || r.URL.Query().Get("verbose") != "true" {
		t.Fatalf("status %d, CC got %s %s", resp.StatusCode, r.Method, r.URL)
	}
}

func TestRejectedRequestsNeverReachCC(t *testing.T) {
	f := newFixture(t, auth.Admin, time.Second, ok)
	for path, want := range map[string]int{
		"/api/clusters/a/proxy/unknown_endpoint": 404,
		"/api/clusters/a/proxy/load?foo=bar":     400,
		"/api/clusters/a/proxy/state?doAs=root":  400,
	} {
		if got := do(t, "GET", f.ui.URL+path, nil).StatusCode; got != want {
			t.Errorf("GET %s: %d, want %d", path, got, want)
		}
	}
	if got := do(t, "GET", f.ui.URL+"/api/clusters/a/proxy/rebalance?dryrun=true", nil).StatusCode; got != 405 {
		t.Errorf("GET rebalance: %d", got)
	}
	if got := do(t, "POST", f.ui.URL+"/api/clusters/a/proxy/rebalance", nil).StatusCode; got != 400 {
		t.Errorf("POST rebalance without dryrun: %d", got)
	}
	if f.hits.Load() != 0 {
		t.Fatalf("CC received %d requests", f.hits.Load())
	}
}

func TestRoleGate(t *testing.T) {
	for _, c := range []struct {
		role         auth.Role
		method, path string
		want         int
	}{
		{auth.Viewer, "GET", "load", 200},
		{auth.Viewer, "GET", "state", 200},
		{auth.Viewer, "GET", "user_tasks", 403},
		{auth.Viewer, "GET", "proposals", 403},
		{auth.Viewer, "GET", "review_board", 403},
		{auth.Viewer, "POST", "rebalance?dryrun=true", 403},
		{auth.Viewer, "POST", "state", 403},
		{auth.Viewer, "GET", "unknown_endpoint", 404},
		{auth.Admin, "GET", "user_tasks", 200},
		{auth.Admin, "POST", "rebalance?dryrun=false", 200},
		{auth.Admin, "GET", "unknown_endpoint", 404},
	} {
		f := newFixture(t, c.role, time.Second, ok)
		if got := do(t, c.method, f.ui.URL+"/api/clusters/a/proxy/"+c.path, nil).StatusCode; got != c.want {
			t.Errorf("%v %s %s: %d, want %d", c.role, c.method, c.path, got, c.want)
		}
		if (c.want != 200) != (f.hits.Load() == 0) {
			t.Errorf("%v %s %s: CC hits %d", c.role, c.method, c.path, f.hits.Load())
		}
	}
}

func TestUpstreamHostComesFromConfig(t *testing.T) {
	f := newFixture(t, auth.Viewer, time.Second, ok)
	do(t, "GET", f.ui.URL+"/api/clusters/a/proxy/state", map[string]string{"Host": "evil.example", "X-Forwarded-Host": "evil.example"})
	r := f.last.Load()
	if r == nil || r.Host != strings.TrimPrefix(f.cc.URL, "http://") || r.Header.Get("X-Forwarded-Host") != "" {
		t.Fatalf("CC saw host %q, xfh %q", r.Host, r.Header.Get("X-Forwarded-Host"))
	}
}

func TestAsyncTaskIDRoundTrip(t *testing.T) {
	f := newFixture(t, auth.Admin, time.Second, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Task-ID") == "t1" {
			w.Write([]byte(`{"done":true}`))
			return
		}
		w.Header().Set("User-Task-ID", "t1")
		w.WriteHeader(http.StatusAccepted)
	})
	first := do(t, "POST", f.ui.URL+"/api/clusters/a/proxy/rebalance?dryrun=true", nil)
	if first.StatusCode != 202 || first.Header.Get("User-Task-ID") != "t1" {
		t.Fatalf("first: %d %v", first.StatusCode, first.Header)
	}
	second := do(t, "POST", f.ui.URL+"/api/clusters/a/proxy/rebalance?dryrun=true", map[string]string{"User-Task-ID": "t1"})
	if second.StatusCode != 200 {
		t.Fatalf("second: %d", second.StatusCode)
	}
}

func TestUpstreamFailures(t *testing.T) {
	f := newFixture(t, auth.Viewer, 50*time.Millisecond, func(w http.ResponseWriter, r *http.Request) { time.Sleep(500 * time.Millisecond) })
	if got := do(t, "GET", f.ui.URL+"/api/clusters/a/proxy/state", nil).StatusCode; got != 504 {
		t.Errorf("timeout: %d", got)
	}
	f.cc.Close()
	resp := do(t, "GET", f.ui.URL+"/api/clusters/a/proxy/state", nil)
	var b strings.Builder
	buf := make([]byte, 512)
	n, _ := resp.Body.Read(buf)
	b.Write(buf[:n])
	if resp.StatusCode != 502 || strings.Contains(b.String(), "127.0.0.1") || strings.Contains(b.String(), "kafkacruisecontrol") {
		t.Errorf("down: %d %s", resp.StatusCode, b.String())
	}
}

func TestUpstreamHeadersAreFiltered(t *testing.T) {
	f := newFixture(t, auth.Viewer, time.Second, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Set-Cookie", "cc=1")
		w.Header().Set("WWW-Authenticate", "Basic")
		w.Header().Set("Location", "http://internal:9090/")
		w.Write([]byte("{}"))
	})
	resp := do(t, "GET", f.ui.URL+"/api/clusters/a/proxy/state", map[string]string{"Authorization": "Bearer x", "Cookie": "ccui_session=s", "X-Forwarded-For": "6.6.6.6"})
	r := f.last.Load()
	if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" || r.Header.Get("X-Forwarded-For") != "" {
		t.Errorf("CC received browser headers: %v", r.Header)
	}
	if resp.Header.Get("Set-Cookie") != "" || resp.Header.Get("WWW-Authenticate") != "" || resp.Header.Get("Location") != "" {
		t.Errorf("browser received CC headers: %v", resp.Header)
	}
}

func TestUpstream401IsNotASessionExpiry(t *testing.T) {
	f := newFixture(t, auth.Viewer, time.Second, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(401) })
	if got := do(t, "GET", f.ui.URL+"/api/clusters/a/proxy/state", nil).StatusCode; got != 502 {
		t.Errorf("got %d, want 502 so the SPA does not log the user out", got)
	}
}

func TestBodyLimit(t *testing.T) {
	f := newFixture(t, auth.Admin, time.Second, func(w http.ResponseWriter, r *http.Request) {
		if _, err := r.Body.Read(make([]byte, 4096)); err != nil && err.Error() != "EOF" {
			w.WriteHeader(500)
		}
	})
	req, _ := http.NewRequest("POST", f.ui.URL+"/api/clusters/a/proxy/pause_sampling", strings.NewReader(strings.Repeat("x", 4096)))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("got %d", resp.StatusCode)
	}
}

func TestAuditLineForPOST(t *testing.T) {
	var buf bytes.Buffer
	cc := httptest.NewServer(http.HandlerFunc(ok))
	defer cc.Close()
	u, _ := url.Parse(cc.URL + "/kafkacruisecontrol")
	cl := config.Cluster{Name: "a", URL: u, Timeout: time.Second}
	p := New(cl, http.DefaultTransport, slog.New(slog.NewJSONHandler(&buf, nil)), 1024)
	mux := http.NewServeMux()
	mux.Handle("/api/clusters/{name}/proxy/{endpoint}", p)

	call := func(method, path string) {
		req := httptest.NewRequest(method, path, nil)
		req.Header.Set("Authorization", "Bearer SECRET-BROWSER-TOKEN")
		req.Header.Set("Cookie", "ccui_session=SECRET-COOKIE")
		req = req.WithContext(auth.WithUser(req.Context(), auth.User{Name: "ana", Role: auth.Admin, Token: "SECRET-JWT"}))
		mux.ServeHTTP(httptest.NewRecorder(), req)
	}
	call("GET", "/api/clusters/a/proxy/state") // reads are not audited
	if buf.Len() != 0 {
		t.Fatalf("GET audited: %s", buf.String())
	}
	call("POST", "/api/clusters/a/proxy/rebalance?dryrun=false&goals=RackAwareGoal")

	var line map[string]any
	if err := json.Unmarshal(buf.Bytes(), &line); err != nil {
		t.Fatalf("not one JSON line: %q", buf.String())
	}
	if line["user"] != "ana" || line["role"] != "admin" || line["cluster"] != "a" || line["endpoint"] != "rebalance" || line["dryrun"] != "false" || line["status"] != float64(200) {
		t.Fatalf("line: %v", line)
	}
	if strings.Contains(buf.String(), "SECRET") {
		t.Fatalf("audit leaks credentials: %s", buf.String())
	}
}
