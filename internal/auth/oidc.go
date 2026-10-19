package auth

import (
	"context"
	"crypto/subtle"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/devops-ia/kafka-cruise-control-ui/internal/config"
)

const (
	stateCookie = "ccui_oidc"
	flowTTL     = 10 * time.Minute
)

// flow is a login in progress, kept server-side between the redirect and the callback.
type flow struct {
	provider, nonce, verifier string
	created                   time.Time
}

type oidcClient struct {
	oauth    *oauth2.Config
	verifier *oidc.IDTokenVerifier
}

type oidcState struct {
	mu      sync.Mutex
	clients map[string]*oidcClient
	flows   map[string]flow
}

func (m *Manager) routesOIDC(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/{provider}/login", m.oidcLogin)
	mux.HandleFunc("GET /api/auth/{provider}/callback", m.oidcCallback)
}

func (m *Manager) providerConfig(name string) (config.OIDCProvider, bool) {
	for _, p := range m.cfg.OIDC {
		if p.Name == name {
			return p, true
		}
	}
	return config.OIDCProvider{}, false
}

// client discovers the issuer on first use, so an IdP outage at boot does not stop the UI from starting.
func (m *Manager) client(ctx context.Context, p config.OIDCProvider) (*oidcClient, error) {
	m.oidc.mu.Lock()
	defer m.oidc.mu.Unlock()
	if c, ok := m.oidc.clients[p.Name]; ok {
		return c, nil
	}
	prov, err := oidc.NewProvider(ctx, p.Issuer)
	if err != nil {
		return nil, err
	}
	c := &oidcClient{
		oauth: &oauth2.Config{
			ClientID: p.ClientID, ClientSecret: p.ClientSecret, Endpoint: prov.Endpoint(),
			RedirectURL: p.RedirectURL, Scopes: p.Scopes,
		},
		verifier: prov.Verifier(&oidc.Config{ClientID: p.ClientID}),
	}
	m.oidc.clients[p.Name] = c
	return c, nil
}

func (m *Manager) oidcLogin(w http.ResponseWriter, r *http.Request) {
	p, ok := m.providerConfig(r.PathValue("provider"))
	if !ok || m.cfg.AuthMode != "oidc" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown provider"})
		return
	}
	c, err := m.client(r.Context(), p)
	if err != nil {
		m.log.Warn("oidc discovery failed", "provider", p.Name, "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "identity provider unavailable"})
		return
	}
	f := flow{provider: p.Name, nonce: randomID(), verifier: oauth2.GenerateVerifier(), created: m.now()}
	state := randomID()
	m.oidc.mu.Lock()
	for k, old := range m.oidc.flows {
		if m.now().Sub(old.created) > flowTTL {
			delete(m.oidc.flows, k)
		}
	}
	m.oidc.flows[state] = f
	m.oidc.mu.Unlock()

	// The cookie ties the callback to this browser; without it anyone could finish a login someone else started.
	http.SetCookie(w, &http.Cookie{
		Name: stateCookie, Value: state, Path: "/api/auth/", MaxAge: int(flowTTL.Seconds()),
		HttpOnly: true, Secure: !m.cfg.CookieInsecure, SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, c.oauth.AuthCodeURL(state, oidc.Nonce(f.nonce), oauth2.S256ChallengeOption(f.verifier)), http.StatusFound)
}

func (m *Manager) oidcCallback(w http.ResponseWriter, r *http.Request) {
	p, ok := m.providerConfig(r.PathValue("provider"))
	if !ok || m.cfg.AuthMode != "oidc" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown provider"})
		return
	}
	http.SetCookie(w, &http.Cookie{Name: stateCookie, Value: "", Path: "/api/auth/", MaxAge: -1})

	state := r.URL.Query().Get("state")
	ck, err := r.Cookie(stateCookie)
	m.oidc.mu.Lock()
	f, known := m.oidc.flows[state]
	delete(m.oidc.flows, state) // single use
	m.oidc.mu.Unlock()
	if state == "" || err != nil || subtle.ConstantTimeCompare([]byte(ck.Value), []byte(state)) != 1 ||
		!known || f.provider != p.Name || m.now().Sub(f.created) > flowTTL {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid login state, start again"})
		return
	}
	if e := r.URL.Query().Get("error"); e != "" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "identity provider refused the login"})
		return
	}
	c, err := m.client(r.Context(), p)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "identity provider unavailable"})
		return
	}
	tok, err := c.oauth.Exchange(r.Context(), r.URL.Query().Get("code"), oauth2.VerifierOption(f.verifier))
	if err != nil {
		m.log.Warn("oidc code exchange failed", "provider", p.Name, "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "login failed"})
		return
	}
	raw, _ := tok.Extra("id_token").(string)
	idt, err := c.verifier.Verify(r.Context(), raw)
	if err != nil || subtle.ConstantTimeCompare([]byte(idt.Nonce), []byte(f.nonce)) != 1 {
		m.log.Warn("oidc id_token rejected", "provider", p.Name)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid identity token"})
		return
	}
	var claims map[string]any
	if err := idt.Claims(&claims); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid identity token"})
		return
	}
	role := RoleFromClaims(p, claims)
	name := firstString(claims, "preferred_username", "email", "name", "sub")
	if role == 0 {
		m.log.Warn("oidc user has no mapped role", "provider", p.Name, "user", name)
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "your account has no role in this application"})
		return
	}
	for _, u := range m.cfg.LocalUsers {
		if u.Name == name {
			m.log.Warn("audit", "event", "oidc_login_refused", "reason", "name collides with a local user", "provider", p.Name, "user", name)
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "this user name belongs to a local user"})
			return
		}
	}
	m.start(w, User{Name: name, Role: role, Token: raw})
	http.Redirect(w, r, "/", http.StatusFound)
}

func firstString(claims map[string]any, keys ...string) string {
	for _, k := range keys {
		if s, ok := claims[k].(string); ok && s != "" {
			return s
		}
	}
	return ""
}

// RoleFromClaims maps the provider's groups claim to the highest matching role, else the default role, else 0 (denied).
func RoleFromClaims(p config.OIDCProvider, claims map[string]any) Role {
	var groups []string
	switch v := claims[p.GroupsClaim].(type) {
	case []any:
		for _, g := range v {
			if s, ok := g.(string); ok {
				groups = append(groups, s)
			}
		}
	case string:
		groups = strings.FieldsFunc(v, func(r rune) bool { return r == ',' || r == ' ' })
	}
	has := func(want []string) bool {
		return slices.ContainsFunc(groups, func(g string) bool { return slices.Contains(want, g) })
	}
	switch {
	case has(p.AdminGroups):
		return Admin
	case has(p.ViewerGroups):
		return Viewer
	}
	return ParseRole(p.DefaultRole)
}
