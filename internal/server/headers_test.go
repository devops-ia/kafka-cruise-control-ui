package server

import (
	"regexp"
	"strings"
	"testing"
)

func TestSecurityHeadersAndNonce(t *testing.T) {
	s := newServer(t, testConfig(t))
	resp, body := get(t, s.URL+"/")
	h := resp.Header
	csp := h.Get("Content-Security-Policy")
	for _, want := range []string{"frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'", "default-src 'self'"} {
		if !strings.Contains(csp, want) {
			t.Errorf("CSP lacks %q: %s", want, csp)
		}
	}
	if strings.Contains(csp, "unsafe-inline") || strings.Contains(csp, "unsafe-eval") {
		t.Errorf("CSP allows inline code: %s", csp)
	}
	for k, v := range map[string]string{
		"X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
	} {
		if h.Get(k) != v {
			t.Errorf("%s = %q", k, h.Get(k))
		}
	}
	if h.Get("Permissions-Policy") == "" {
		t.Error("Permissions-Policy missing")
	}
	if h.Get("Strict-Transport-Security") != "" {
		t.Error("HSTS must not be sent without TLS")
	}

	cspNonce := regexp.MustCompile(`script-src[^;]*'nonce-([A-Za-z0-9_-]+)'`).FindStringSubmatch(csp)
	htmlNonce := regexp.MustCompile(`<script nonce="([^"]+)"`).FindStringSubmatch(body)
	if cspNonce == nil || htmlNonce == nil || cspNonce[1] != htmlNonce[1] {
		t.Fatalf("nonce mismatch: csp %v html %v\n%s", cspNonce, htmlNonce, body)
	}
	_, body2 := get(t, s.URL+"/")
	if n2 := regexp.MustCompile(`nonce="([^"]+)"`).FindStringSubmatch(body2); n2[1] == htmlNonce[1] {
		t.Error("nonce must change on every response")
	}
}

func TestHeadersAlsoOnAPIAndErrors(t *testing.T) {
	s := newServer(t, testConfig(t))
	for _, p := range []string{"/api/clusters", "/api/nope", "/healthz"} {
		resp, _ := get(t, s.URL+p)
		if resp.Header.Get("X-Content-Type-Options") != "nosniff" || resp.Header.Get("Content-Security-Policy") == "" {
			t.Errorf("%s lacks security headers", p)
		}
	}
}

func TestHSTSOnlyWithTLS(t *testing.T) {
	s := newServer(t, testConfig(t, "CCUI_TLS_CERT", "/c.pem", "CCUI_TLS_KEY", "/k.pem"))
	resp, _ := get(t, s.URL+"/")
	if !strings.Contains(resp.Header.Get("Strict-Transport-Security"), "max-age=") {
		t.Fatalf("HSTS = %q", resp.Header.Get("Strict-Transport-Security"))
	}
}
