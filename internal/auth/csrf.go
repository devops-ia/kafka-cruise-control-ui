package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"net/url"
)

// csrfToken is derived from the session id, so it needs no storage and is useless without that session.
func (m *Manager) csrfToken(sessionID string) string {
	mac := hmac.New(sha256.New, m.key)
	mac.Write([]byte(sessionID))
	return hex.EncodeToString(mac.Sum(nil))
}

// originOK requires an Origin header equal to the server's own origin.
// With CCUI_PUBLIC_URL set that origin is fixed; otherwise it is the request's Host, so a reverse proxy
// must pass Host through (or the operator sets CCUI_PUBLIC_URL).
func (m *Manager) originOK(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	if m.cfg.PublicURL != "" {
		return origin == m.cfg.PublicURL
	}
	u, err := url.Parse(origin)
	return err == nil && u.Host == r.Host
}

func (m *Manager) csrfOK(r *http.Request, sessionID string) bool {
	return subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(m.csrfToken(sessionID))) == 1
}

func isSafe(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
}
