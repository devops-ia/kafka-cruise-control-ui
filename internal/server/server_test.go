package server

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/devops-ia/kafka-cruise-control-ui/internal/config"
)

var testWeb = fstest.MapFS{
	"index.html":    {Data: []byte(`<!doctype html><html><head><script type="module" src="/assets/app.js"></script></head><body></body></html>`)},
	"assets/app.js": {Data: []byte(`console.log(1)`)},
}

func testConfig(t *testing.T, kv ...string) *config.Config {
	t.Helper()
	env := map[string]string{
		"CCUI_AUTH_MODE":         "none",
		"CCUI_CLUSTERS__0__NAME": "a", "CCUI_CLUSTERS__0__URL": "http://cc-a:9090/kafkacruisecontrol",
		"CCUI_CLUSTERS__1__NAME": "b", "CCUI_CLUSTERS__1__URL": "http://cc-b:9090/kafkacruisecontrol", "CCUI_CLUSTERS__1__GROUP": "prod",
		"CCUI_CLUSTERS__1__AUTH_TYPE": "basic", "CCUI_CLUSTERS__1__AUTH_USER": "svc", "CCUI_CLUSTERS__1__AUTH_PASSWORD": "pw-do-not-leak",
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

func newServer(t *testing.T, cfg *config.Config) *httptest.Server {
	t.Helper()
	h, err := New(Deps{Config: cfg, Web: testWeb, Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	s := httptest.NewServer(h)
	t.Cleanup(s.Close)
	return s
}

func get(t *testing.T, url string) (*http.Response, string) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, string(b)
}

func TestHealthEndpoints(t *testing.T) {
	s := newServer(t, testConfig(t))
	for _, p := range []string{"/healthz", "/readyz"} {
		resp, body := get(t, s.URL+p)
		if resp.StatusCode != 200 || strings.Contains(body, "cc-a") {
			t.Errorf("%s: %d %q", p, resp.StatusCode, body)
		}
	}
}

func TestClustersListHidesURLAndAuth(t *testing.T) {
	s := newServer(t, testConfig(t))
	resp, body := get(t, s.URL+"/api/clusters")
	if resp.StatusCode != 200 {
		t.Fatal(resp.StatusCode)
	}
	var got []map[string]any
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0]["name"] != "a" || got[1]["name"] != "b" || got[1]["group"] != "prod" {
		t.Fatalf("got %s", body)
	}
	for _, leak := range []string{"cc-a", "cc-b", "svc", "pw-do-not-leak", "basic", "url"} {
		if strings.Contains(body, leak) {
			t.Errorf("response leaks %q: %s", leak, body)
		}
	}
}

func TestUnknownClusterIs404(t *testing.T) {
	s := newServer(t, testConfig(t))
	if resp, _ := get(t, s.URL+"/api/clusters/zzz/proxy/state"); resp.StatusCode != 404 {
		t.Fatal(resp.StatusCode)
	}
}

func TestDotDotPathIs404(t *testing.T) {
	s := newServer(t, testConfig(t))
	for _, p := range []string{"/api/clusters/a/proxy/..", "/api/clusters/a/proxy/../state", "/api/clusters/a/proxy/%2e%2e/state"} {
		if resp, _ := get(t, s.URL+p); resp.StatusCode != 404 {
			t.Errorf("%s: %d", p, resp.StatusCode)
		}
	}
}

func TestSPA(t *testing.T) {
	s := newServer(t, testConfig(t))
	if resp, body := get(t, s.URL+"/load"); resp.StatusCode != 200 || !strings.Contains(body, "<script") {
		t.Errorf("/load: %d %q", resp.StatusCode, body)
	}
	if resp, body := get(t, s.URL+"/assets/app.js"); resp.StatusCode != 200 || body != "console.log(1)" {
		t.Errorf("asset: %d %q", resp.StatusCode, body)
	}
	if resp, _ := get(t, s.URL+"/assets/missing.js"); resp.StatusCode != 404 {
		t.Errorf("missing asset: %d", resp.StatusCode)
	}
	resp, body := get(t, s.URL+"/api/nope")
	if resp.StatusCode != 404 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "application/json") || strings.Contains(body, "<html") {
		t.Errorf("/api/nope: %d %s %q", resp.StatusCode, resp.Header.Get("Content-Type"), body)
	}
}
