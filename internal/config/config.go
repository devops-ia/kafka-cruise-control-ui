// Package config reads and validates the CCUI_* environment variables.
//
// Variable names are read through the helpers g, gs, cl, cls, oi and ois so that
// README_test.go can compare them with the README table.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/devops-ia/kafka-cruise-control-ui/internal/passwd"
)

type Cluster struct {
	Name, Group string
	URL         *url.URL
	Timeout     time.Duration
	Auth        ClusterAuth
	// ForwardIdentity is "", "jwt" or "doas".
	ForwardIdentity string
}

type ClusterAuth struct {
	Type                     string // none, basic, bearer, sigv4, oidc
	User, Password, Token    string
	Region, Service          string
	TokenURL, ClientID       string
	ClientSecret, OIDCScopes string
}

type OIDCProvider struct {
	Name, Issuer, ClientID, ClientSecret, RedirectURL string
	Scopes                                            []string
	GroupsClaim                                       string
	AdminGroups, ViewerGroups                         []string
	DefaultRole                                       string // "" denies users without a mapped group
}

// LocalUser is a user of CCUI_AUTH_MODE=local. Role is "viewer" or "admin".
type LocalUser struct{ Name, Hash, Role string }

type Config struct {
	AuthMode            string // none, local, oidc
	Listen              string
	TLSCert, TLSKey     string
	PublicURL           string
	LogoURL             string // app icon and favicon; "" keeps the built-in one
	SessionKey          string
	LocalUsers          []LocalUser
	CookieInsecure      bool
	TrustXFF            bool
	IdleTimeout, MaxAge time.Duration
	LoginMaxAttempts    int
	LoginWindow         time.Duration
	MaxBodyBytes        int64
	Clusters            []Cluster
	OIDC                []OIDCProvider
}

func (c *Config) TLSEnabled() bool { return c.TLSCert != "" }

var (
	indexed  = regexp.MustCompile(`^CCUI_(CLUSTERS|OIDC|LOCAL_USERS)__(\d+)__([A-Z0-9_]+)$`)
	nameRe   = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
	provName = regexp.MustCompile(`^[a-z0-9-]+$`)
)

type loader struct {
	env  map[string]string
	used map[string]bool
	errs []error
}

func (l *loader) fail(name, format string, a ...any) {
	l.errs = append(l.errs, fmt.Errorf("%s: %s", name, fmt.Sprintf(format, a...)))
}

func (l *loader) get(name string) string {
	l.used[name] = true
	return l.env[name]
}

// secret reads NAME or, if set, the file named by NAME_FILE (trailing newlines trimmed).
func (l *loader) secret(name string) string {
	if f := l.get(name + "_FILE"); f != "" {
		b, err := os.ReadFile(f)
		if err != nil {
			l.fail(name+"_FILE", "cannot read file")
			return ""
		}
		return strings.TrimRight(string(b), "\r\n")
	}
	return l.get(name)
}

func (l *loader) g(name string) string  { return l.get(name) }
func (l *loader) gs(name string) string { return l.secret(name) }

func (l *loader) dur(name, val string, def time.Duration) time.Duration {
	if val == "" {
		return def
	}
	d, err := time.ParseDuration(val)
	if err != nil || d <= 0 {
		l.fail(name, "must be a positive duration such as 30s, got %q", val)
		return def
	}
	return d
}

func (l *loader) intVar(name, val string, def int) int {
	if val == "" {
		return def
	}
	v, err := strconv.Atoi(val)
	if err != nil || v <= 0 {
		l.fail(name, "must be a positive integer, got %q", val)
		return def
	}
	return v
}

func split(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func orDefault(v, d string) string {
	if v == "" {
		return d
	}
	return v
}

// indices returns how many consecutive indexes exist for kind, failing on gaps.
func (l *loader) indices(kind string) int {
	seen := map[int]bool{}
	max := -1
	for k := range l.env {
		if m := indexed.FindStringSubmatch(k); m != nil && m[1] == kind {
			n, _ := strconv.Atoi(m[2])
			seen[n] = true
			if n > max {
				max = n
			}
		}
	}
	for i := 0; i <= max; i++ {
		if !seen[i] {
			l.fail(fmt.Sprintf("CCUI_%s__%d__", kind, i), "index %d is missing, indexes must be consecutive from 0", i)
			return 0
		}
	}
	return max + 1
}

// Load builds the configuration from env (usually the process environment as a map).
func Load(env map[string]string) (*Config, error) {
	l := &loader{env: env, used: map[string]bool{}}
	c := &Config{}

	c.AuthMode = orDefault(l.g("CCUI_AUTH_MODE"), "local")
	if c.AuthMode != "none" && c.AuthMode != "local" && c.AuthMode != "oidc" {
		l.fail("CCUI_AUTH_MODE", "must be none, local or oidc, got %q", c.AuthMode)
	}
	c.Listen = orDefault(l.g("CCUI_LISTEN"), ":8080")
	c.TLSCert, c.TLSKey = l.g("CCUI_TLS_CERT"), l.g("CCUI_TLS_KEY")
	if (c.TLSCert == "") != (c.TLSKey == "") {
		l.fail("CCUI_TLS_KEY", "CCUI_TLS_CERT and CCUI_TLS_KEY must be set together")
	}
	c.PublicURL = strings.TrimRight(l.g("CCUI_PUBLIC_URL"), "/")
	if c.PublicURL != "" {
		if u, err := url.Parse(c.PublicURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			l.fail("CCUI_PUBLIC_URL", "must be an http(s) URL")
		}
	}
	c.LogoURL = l.g("CCUI_LOGO_URL")
	if c.LogoURL != "" {
		// Its origin goes into the CSP, so a host that could break out of img-src is refused.
		if u, err := url.Parse(c.LogoURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || strings.ContainsAny(u.Host, " ;,'\"") {
			l.fail("CCUI_LOGO_URL", "must be an http(s) URL")
		}
	}
	c.SessionKey = l.gs("CCUI_SESSION_SECRET")
	c.CookieInsecure = l.g("CCUI_COOKIE_INSECURE") == "true"
	c.TrustXFF = l.g("CCUI_TRUST_XFF") == "true"
	c.IdleTimeout = l.dur("CCUI_SESSION_IDLE_TIMEOUT", l.g("CCUI_SESSION_IDLE_TIMEOUT"), 30*time.Minute)
	c.MaxAge = l.dur("CCUI_SESSION_MAX_AGE", l.g("CCUI_SESSION_MAX_AGE"), 12*time.Hour)
	c.LoginWindow = l.dur("CCUI_LOGIN_WINDOW", l.g("CCUI_LOGIN_WINDOW"), 15*time.Minute)
	c.LoginMaxAttempts = l.intVar("CCUI_LOGIN_MAX_ATTEMPTS", l.g("CCUI_LOGIN_MAX_ATTEMPTS"), 5)
	c.MaxBodyBytes = int64(l.intVar("CCUI_MAX_BODY_BYTES", l.g("CCUI_MAX_BODY_BYTES"), 1<<20))

	if c.AuthMode != "none" && len(c.SessionKey) < 32 {
		l.fail("CCUI_SESSION_SECRET", "required with CCUI_AUTH_MODE=%s, at least 32 characters (or CCUI_SESSION_SECRET_FILE)", c.AuthMode)
	}
	c.LocalUsers = l.localUsers(c.AuthMode == "local")

	n := l.indices("CLUSTERS")
	if n == 0 {
		l.errs = append(l.errs, errors.New("at least one cluster is required: set CCUI_CLUSTERS__0__NAME and CCUI_CLUSTERS__0__URL"))
	}
	names := map[string]bool{}
	for i := 0; i < n; i++ {
		cl := l.cluster(i)
		if names[cl.Name] {
			l.fail(fmt.Sprintf("CCUI_CLUSTERS__%d__NAME", i), "duplicate cluster name %q", cl.Name)
		}
		names[cl.Name] = true
		c.Clusters = append(c.Clusters, cl)
	}

	m := l.indices("OIDC")
	if c.AuthMode == "oidc" && m == 0 {
		l.fail("CCUI_OIDC__0__", "CCUI_AUTH_MODE=oidc needs at least one provider (CCUI_OIDC__0__NAME, ISSUER, CLIENT_ID, CLIENT_SECRET)")
	}
	pn := map[string]bool{}
	for i := 0; i < m; i++ {
		p := l.provider(i, c.PublicURL)
		if pn[p.Name] {
			l.fail(fmt.Sprintf("CCUI_OIDC__%d__NAME", i), "duplicate provider name %q", p.Name)
		}
		pn[p.Name] = true
		c.OIDC = append(c.OIDC, p)
	}
	if c.AuthMode == "oidc" && c.PublicURL == "" {
		l.fail("CCUI_PUBLIC_URL", "required with CCUI_AUTH_MODE=oidc")
	}

	var unknown []string
	for k := range env {
		if strings.HasPrefix(k, "CCUI_") && !l.used[k] {
			unknown = append(unknown, k)
		}
	}
	sort.Strings(unknown)
	for _, k := range unknown {
		l.fail(k, "unknown variable")
	}
	if len(l.errs) > 0 {
		return nil, errors.Join(l.errs...)
	}
	return c, nil
}

// localUsers reads CCUI_LOCAL_USERS__<n>__* plus the CCUI_LOCAL_ADMIN_* shortcut. Hashes are checked only in local mode.
func (l *loader) localUsers(required bool) []LocalUser {
	var users []LocalUser
	names := map[string]bool{}
	add := func(nameVar, hashVar, name, hash, role string) {
		if names[name] {
			l.fail(nameVar, "duplicate local user name %q", name)
		}
		names[name] = true
		if required {
			if hash == "" {
				l.fail(hashVar, "required with CCUI_AUTH_MODE=local")
			} else if err := passwd.ValidateHash(hash); err != nil {
				l.fail(hashVar, "%v", err)
			}
		}
		users = append(users, LocalUser{name, hash, role})
	}
	n := l.indices("LOCAL_USERS")
	for i := 0; i < n; i++ {
		p := fmt.Sprintf("CCUI_LOCAL_USERS__%d__", i)
		lu := func(f string) string { return l.get(p + f) }
		lus := func(f string) string { return l.secret(p + f) }
		name, hash, role := lu("NAME"), lus("PASSWORD_HASH"), lu("ROLE")
		if name == "" {
			l.fail(p+"NAME", "required")
		}
		if role != "viewer" && role != "admin" {
			l.fail(p+"ROLE", "must be viewer or admin, got %q", role)
		}
		add(p+"NAME", p+"PASSWORD_HASH", name, hash, role)
	}
	hash := l.gs("CCUI_LOCAL_ADMIN_PASSWORD_HASH")
	if user := l.g("CCUI_LOCAL_ADMIN_USER"); hash != "" || user != "" {
		add("CCUI_LOCAL_ADMIN_USER", "CCUI_LOCAL_ADMIN_PASSWORD_HASH", orDefault(user, "admin"), hash, "admin")
	}
	if required && len(users) == 0 {
		l.fail("CCUI_LOCAL_USERS__0__NAME", "CCUI_AUTH_MODE=local needs at least one local user (CCUI_LOCAL_USERS__<n>__* or CCUI_LOCAL_ADMIN_PASSWORD_HASH)")
	}
	return users
}

func (l *loader) cluster(i int) Cluster {
	p := fmt.Sprintf("CCUI_CLUSTERS__%d__", i)
	cl := func(f string) string { return l.get(p + f) }
	cls := func(f string) string { return l.secret(p + f) }
	c := Cluster{Name: cl("NAME"), Group: cl("GROUP")}
	if !nameRe.MatchString(c.Name) {
		l.fail(p+"NAME", "required, only letters, digits, '.', '_' and '-' are allowed")
	}
	rawURL := cl("URL")
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		l.fail(p+"URL", "must be an http(s) URL, got %q", rawURL)
	} else {
		u.Path = strings.TrimRight(u.Path, "/")
		c.URL = u
	}
	c.Timeout = l.dur(p+"TIMEOUT", cl("TIMEOUT"), 60*time.Second)
	a := &c.Auth
	a.Type = orDefault(cl("AUTH_TYPE"), "none")
	a.User, a.Password, a.Token = cl("AUTH_USER"), cls("AUTH_PASSWORD"), cls("AUTH_TOKEN")
	a.Region, a.Service = cl("AUTH_SIGV4_REGION"), orDefault(cl("AUTH_SIGV4_SERVICE"), "execute-api")
	a.TokenURL, a.ClientID = cl("AUTH_OIDC_TOKEN_URL"), cl("AUTH_OIDC_CLIENT_ID")
	a.ClientSecret, a.OIDCScopes = cls("AUTH_OIDC_CLIENT_SECRET"), cl("AUTH_OIDC_SCOPE")
	need := func(v, name string) {
		if v == "" {
			l.fail(p+name, "required with AUTH_TYPE=%s", a.Type)
		}
	}
	switch a.Type {
	case "none":
	case "basic":
		need(a.User, "AUTH_USER")
		need(a.Password, "AUTH_PASSWORD")
	case "bearer":
		need(a.Token, "AUTH_TOKEN")
	case "sigv4":
		need(a.Region, "AUTH_SIGV4_REGION")
	case "oidc":
		need(a.TokenURL, "AUTH_OIDC_TOKEN_URL")
		need(a.ClientID, "AUTH_OIDC_CLIENT_ID")
		need(a.ClientSecret, "AUTH_OIDC_CLIENT_SECRET")
	default:
		l.fail(p+"AUTH_TYPE", "must be none, basic, bearer, sigv4 or oidc, got %q", a.Type)
	}
	c.ForwardIdentity = cl("AUTH_FORWARD_IDENTITY")
	if f := c.ForwardIdentity; f != "" && f != "jwt" && f != "doas" {
		l.fail(p+"AUTH_FORWARD_IDENTITY", "must be jwt or doas, got %q", f)
	}
	return c
}

func (l *loader) provider(i int, publicURL string) OIDCProvider {
	p := fmt.Sprintf("CCUI_OIDC__%d__", i)
	oi := func(f string) string { return l.get(p + f) }
	ois := func(f string) string { return l.secret(p + f) }
	o := OIDCProvider{
		Name: oi("NAME"), Issuer: oi("ISSUER"), ClientID: oi("CLIENT_ID"), ClientSecret: ois("CLIENT_SECRET"),
		GroupsClaim: orDefault(oi("GROUPS_CLAIM"), "groups"), DefaultRole: oi("DEFAULT_ROLE"),
		AdminGroups: split(oi("ADMIN_GROUPS")), ViewerGroups: split(oi("VIEWER_GROUPS")),
		Scopes: split(strings.ReplaceAll(orDefault(oi("SCOPES"), "openid profile email"), " ", ",")),
	}
	if !provName.MatchString(o.Name) {
		l.fail(p+"NAME", "required, lowercase letters, digits and '-' only")
	}
	for f, v := range map[string]string{"ISSUER": o.Issuer, "CLIENT_ID": o.ClientID, "CLIENT_SECRET": o.ClientSecret} {
		if v == "" {
			l.fail(p+f, "required")
		}
	}
	if r := o.DefaultRole; r != "" && r != "viewer" && r != "admin" {
		l.fail(p+"DEFAULT_ROLE", "must be viewer or admin")
	}
	o.RedirectURL = oi("REDIRECT_URL")
	if o.RedirectURL == "" && publicURL != "" {
		o.RedirectURL = publicURL + "/api/auth/" + o.Name + "/callback"
	}
	return o
}

// FromEnviron converts os.Environ() style entries to a map.
func FromEnviron(environ []string) map[string]string {
	m := make(map[string]string, len(environ))
	for _, kv := range environ {
		if k, v, ok := strings.Cut(kv, "="); ok {
			m[k] = v
		}
	}
	return m
}

// Log writes the effective configuration without any secret value.
func (c *Config) Log(log *slog.Logger) {
	log.Info("config", "auth_mode", c.AuthMode, "listen", c.Listen, "tls", c.TLSEnabled(), "clusters", len(c.Clusters), "oidc_providers", len(c.OIDC))
	for _, cl := range c.Clusters {
		log.Info("cluster", "name", cl.Name, "group", cl.Group, "auth_type", cl.Auth.Type, "forward_identity", cl.ForwardIdentity)
	}
	if c.AuthMode == "none" {
		log.Warn("CCUI_AUTH_MODE=none: the UI is not protected and every visitor is admin")
	}
}
