// Package auth identifies the people using the UI: local admin, OIDC login, in-memory sessions and roles.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/devops-ia/kafka-cruise-control-ui/internal/config"
	"github.com/devops-ia/kafka-cruise-control-ui/internal/passwd"
)

const cookieName = "ccui_session"

type session struct {
	user              User
	created, lastSeen time.Time
}

type Manager struct {
	cfg *config.Config
	log *slog.Logger
	now func() time.Time
	key []byte // signs CSRF tokens

	mu       sync.Mutex
	sessions map[string]*session
	oidc     oidcState
	limiter  *limiter
}

func NewManager(cfg *config.Config, log *slog.Logger) *Manager {
	key := []byte(cfg.SessionKey)
	if len(key) == 0 { // mode none has no configured key; a per-process one is enough for CSRF tokens
		key = []byte(randomID())
	}
	return &Manager{cfg: cfg, log: log, now: time.Now, key: key, sessions: map[string]*session{},
		limiter: newLimiter(cfg.LoginMaxAttempts, cfg.LoginWindow),
		oidc:    oidcState{clients: map[string]*oidcClient{}, flows: map[string]flow{}}}
}

func randomID() string {
	b := make([]byte, 32) // 256 bits
	if _, err := rand.Read(b); err != nil {
		panic(err) // the system CSPRNG failing is not recoverable
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func (m *Manager) create(u User) string {
	id, now := randomID(), m.now()
	m.mu.Lock()
	defer m.mu.Unlock()
	for k, s := range m.sessions { // sweep on write keeps the map bounded without a goroutine
		if m.expired(s, now) {
			delete(m.sessions, k)
		}
	}
	m.sessions[id] = &session{user: u, created: now, lastSeen: now}
	return id
}

func (m *Manager) expired(s *session, now time.Time) bool {
	return now.Sub(s.lastSeen) > m.cfg.IdleTimeout || now.Sub(s.created) > m.cfg.MaxAge
}

// current returns the session id and user behind the request cookie.
func (m *Manager) current(r *http.Request) (string, User, bool) {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return "", User{}, false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[c.Value]
	if !ok {
		return "", User{}, false
	}
	now := m.now()
	if m.expired(s, now) {
		delete(m.sessions, c.Value)
		return "", User{}, false
	}
	s.lastSeen = now
	return c.Value, s.user, true
}

func (m *Manager) setCookie(w http.ResponseWriter, id string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: id, Path: "/", MaxAge: maxAge,
		HttpOnly: true, Secure: !m.cfg.CookieInsecure, SameSite: http.SameSiteLaxMode,
	})
}

// start creates the session and sets the cookie.
func (m *Manager) start(w http.ResponseWriter, u User) {
	m.setCookie(w, m.create(u), int(m.cfg.MaxAge.Seconds()))
}

func (m *Manager) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/session", m.sessionInfo)
	mux.HandleFunc("POST /api/login", m.login)
	m.routesOIDC(mux)
	mux.Handle("POST /api/logout", m.Protect(http.HandlerFunc(m.logout)))
}

// Protect answers 401 without a valid session. In mode none every caller is an admin.
func (m *Manager) Protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, u, ok := "none", User{Name: "anonymous", Role: Admin}, true
		if m.cfg.AuthMode != "none" {
			id, u, ok = m.current(r)
		}
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
			return
		}
		if !isSafe(r.Method) && (!m.originOK(r) || !m.csrfOK(r, id)) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "missing or invalid CSRF token or Origin"})
			return
		}
		next.ServeHTTP(w, r.WithContext(WithUser(r.Context(), u)))
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

type sessionBody struct {
	Authenticated bool     `json:"authenticated"`
	Mode          string   `json:"mode"`
	User          string   `json:"user,omitempty"`
	Role          string   `json:"role,omitempty"`
	CSRFToken     string   `json:"csrfToken,omitempty"`
	Providers     []string `json:"providers,omitempty"`
}

// sessionInfo is public: the SPA calls it first to learn whether to show the login page.
func (m *Manager) sessionInfo(w http.ResponseWriter, r *http.Request) {
	b := sessionBody{Mode: m.cfg.AuthMode}
	for _, p := range m.cfg.OIDC {
		b.Providers = append(b.Providers, p.Name)
	}
	if m.cfg.AuthMode == "none" {
		b.Authenticated, b.User, b.Role = true, "anonymous", Admin.String()
		b.CSRFToken = m.csrfToken("none")
	} else if id, u, ok := m.current(r); ok {
		b.Authenticated, b.User, b.Role = true, u.Name, u.Role.String()
		b.CSRFToken = m.csrfToken(id)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, b)
}

func (m *Manager) login(w http.ResponseWriter, r *http.Request) {
	if m.cfg.AuthMode != "local" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	// There is no session yet, so no CSRF token; the Origin check is what stops cross-site logins.
	if !m.originOK(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "invalid Origin"})
		return
	}
	var in struct{ Username, Password string }
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	now := m.now()
	ipKey, userKey := "ip:"+clientIP(r, m.cfg.TrustXFF), "user:"+strings.ToLower(in.Username)
	for _, k := range []string{ipKey, userKey} {
		if wait, blocked := m.limiter.blocked(k, now); blocked {
			w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many failed attempts, try again later"})
			return
		}
	}
	// Every name is compared and a hash is always checked so the answer and the timing do not reveal which part failed.
	hash := m.cfg.LocalUsers[0].Hash
	var found *config.LocalUser
	for i := range m.cfg.LocalUsers {
		if u := &m.cfg.LocalUsers[i]; subtle.ConstantTimeCompare([]byte(in.Username), []byte(u.Name)) == 1 {
			found, hash = u, u.Hash
		}
	}
	passOK := passwd.CheckPassword(hash, in.Password)
	if found == nil || !passOK {
		m.limiter.fail(ipKey, now)
		m.limiter.fail(userKey, now)
		m.log.Warn("login failed", "ip", clientIP(r, m.cfg.TrustXFF)) // not the username: people paste passwords there
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}
	m.limiter.reset(userKey)
	role := ParseRole(found.Role)
	m.start(w, User{Name: found.Name, Role: role})
	writeJSON(w, http.StatusOK, map[string]string{"user": found.Name, "role": role.String()})
}

func (m *Manager) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		m.mu.Lock()
		delete(m.sessions, c.Value)
		m.mu.Unlock()
	}
	m.setCookie(w, "", -1)
	writeJSON(w, http.StatusOK, map[string]string{"status": "logged out"})
}
