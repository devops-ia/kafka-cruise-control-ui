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

func TestLogoURLSetsIconAndImgSrc(t *testing.T) {
	resp, body := get(t, newServer(t, testConfig(t)).URL+"/")
	if !strings.Contains(body, `href="/logo.svg"`) || !strings.Contains(resp.Header.Get("Content-Security-Policy"), "img-src 'self' data:;") {
		t.Fatalf("default icon or img-src changed: %s\n%s", resp.Header.Get("Content-Security-Policy"), body)
	}
	resp, body = get(t, newServer(t, testConfig(t, "CCUI_LOGO_URL", "https://cdn.example.com/brand/logo.png?v=1&s=2")).URL+"/")
	if !strings.Contains(body, `<link rel="icon" href="https://cdn.example.com/brand/logo.png?v=1&amp;s=2" />`) {
		t.Errorf("icon link not replaced: %s", body)
	}
	if !strings.Contains(resp.Header.Get("Content-Security-Policy"), "img-src 'self' data: https://cdn.example.com;") {
		t.Errorf("img-src lacks the logo origin: %s", resp.Header.Get("Content-Security-Policy"))
	}
}

func TestHSTSOnlyWithTLS(t *testing.T) {
	s := newServer(t, testConfig(t, "CCUI_TLS_CERT", "/c.pem", "CCUI_TLS_KEY", "/k.pem"))
	resp, _ := get(t, s.URL+"/")
	if !strings.Contains(resp.Header.Get("Strict-Transport-Security"), "max-age=") {
		t.Fatalf("HSTS = %q", resp.Header.Get("Strict-Transport-Security"))
	}
}
