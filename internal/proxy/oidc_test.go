package proxy

import (
	"bytes"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/devops-ia/kafka-cruise-control-ui/internal/config"
)

const clientSecret = "CLIENT-SECRET-VALUE"

func tokenServer(t *testing.T, expiresIn int, fail bool) (*httptest.Server, *atomic.Int32) {
	var n atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		r.ParseForm()
		if r.Form.Get("grant_type") != "client_credentials" {
			t.Errorf("grant_type %q", r.Form.Get("grant_type"))
		}
		if fail {
			http.Error(w, "nope", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"access_token":"tok-%d","token_type":"Bearer","expires_in":%d}`, n.Load(), expiresIn)
	}))
	t.Cleanup(s.Close)
	return s, &n
}

func oidcTransport(t *testing.T, tokenURL string, now func() time.Time) (http.RoundTripper, *http.Request) {
	var seen http.Request
	base := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		seen = *r
		return &http.Response{StatusCode: 200, Body: http.NoBody}, nil
	})
	rt := oidcClientCredentials(base, config.ClusterAuth{TokenURL: tokenURL, ClientID: "id", ClientSecret: clientSecret}, now)
	return rt, &seen
}

func TestOIDCTokenIsCachedAndRenewed(t *testing.T) {
	srv, hits := tokenServer(t, 3600, false)
	clock := time.Now()
	rt, seen := oidcTransport(t, srv.URL, func() time.Time { return clock })
	req := func() { rt.RoundTrip(httptest.NewRequest("GET", "http://cc/state", nil)) }

	req()
	req()
	if hits.Load() != 1 || seen.Header.Get("Authorization") != "Bearer tok-1" {
		t.Fatalf("hits %d, Authorization %q", hits.Load(), seen.Header.Get("Authorization"))
	}
	clock = clock.Add(2 * time.Hour)
	req()
	if hits.Load() != 2 || seen.Header.Get("Authorization") != "Bearer tok-2" {
		t.Fatalf("after expiry: hits %d, Authorization %q", hits.Load(), seen.Header.Get("Authorization"))
	}
}

func TestOIDCTokenEndpointFailureIs502WithoutSecretInLog(t *testing.T) {
	srv, _ := tokenServer(t, 3600, true)
	var logs bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	defer slog.SetDefault(old)

	cc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("CC must not be called") }))
	defer cc.Close()
	f := newFixtureWith(t, config.Cluster{Auth: config.ClusterAuth{Type: "oidc", TokenURL: srv.URL, ClientID: "id", ClientSecret: clientSecret}}, cc.URL)
	resp := do(t, "GET", f.ui.URL+"/api/clusters/a/proxy/state", nil)
	if resp.StatusCode != 502 {
		t.Fatalf("got %d", resp.StatusCode)
	}
	if logs.Len() == 0 || strings.Contains(logs.String(), clientSecret) {
		t.Fatalf("log: %q", logs.String())
	}
}
