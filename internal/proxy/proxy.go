package proxy

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"

	"github.com/devops-ia/kafka-cruise-control-ui/internal/auth"
	"github.com/devops-ia/kafka-cruise-control-ui/internal/config"
)

// Proxy serves /api/clusters/{name}/proxy/{endpoint} for one cluster. The upstream URL comes only from config.
type Proxy struct {
	cluster config.Cluster
	rp      *httputil.ReverseProxy
	audit   *slog.Logger
	maxBody int64
}

// New builds the proxy for one cluster. rt carries the upstream authentication (see NewTransport).
// audit receives one JSON line per POST; nil disables it.
func New(cl config.Cluster, rt http.RoundTripper, audit *slog.Logger, maxBody int64) *Proxy {
	p := &Proxy{cluster: cl, audit: audit, maxBody: maxBody}
	p.rp = &httputil.ReverseProxy{
		Transport:      rt,
		Rewrite:        p.rewrite,
		ModifyResponse: modifyResponse,
		ErrorHandler:   p.errorHandler,
	}
	return p
}

func (p *Proxy) rewrite(pr *httputil.ProxyRequest) {
	in, out := pr.In, pr.Out
	q := in.URL.Query()
	q.Set("json", "true")
	if u, _ := auth.UserFrom(in.Context()); p.cluster.ForwardIdentity == "doas" {
		q.Set("doAs", u.Name)
	}
	out.URL = &url.URL{
		Scheme:   p.cluster.URL.Scheme,
		Host:     p.cluster.URL.Host,
		Path:     p.cluster.URL.Path + "/" + in.PathValue("endpoint"),
		RawQuery: q.Encode(),
	}
	out.Host = p.cluster.URL.Host
	// Allow-list instead of deny-list: nothing else from the browser reaches CC.
	h := http.Header{}
	for _, k := range []string{"Accept", "User-Task-ID", "Content-Type"} {
		if v := in.Header.Get(k); v != "" {
			h.Set(k, v)
		}
	}
	out.Header = h
}

func modifyResponse(r *http.Response) error {
	r.Header.Del("Set-Cookie")
	r.Header.Del("WWW-Authenticate")
	r.Header.Del("Location") // would leak the internal URL
	if r.StatusCode == http.StatusUnauthorized {
		// A 401 here means the service credentials are wrong; the SPA must not read it as an expired session.
		r.StatusCode, r.Status = http.StatusBadGateway, "502 Bad Gateway"
		r.Body.Close()
		const body = `{"error":"cluster rejected the service credentials"}` + "\n"
		r.Body = io.NopCloser(strings.NewReader(body))
		r.ContentLength = int64(len(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Content-Length", strconv.Itoa(len(body)))
	}
	return nil
}

func (p *Proxy) errorHandler(w http.ResponseWriter, r *http.Request, err error) {
	var tooBig *http.MaxBytesError
	switch {
	case errors.As(err, &tooBig):
		WriteError(w, http.StatusRequestEntityTooLarge, "request body too large")
	case errors.Is(err, context.DeadlineExceeded):
		slog.Warn("upstream timeout", "cluster", p.cluster.Name)
		WriteError(w, http.StatusGatewayTimeout, "cluster did not answer in time")
	default:
		slog.Warn("upstream error", "cluster", p.cluster.Name, "err", err)
		WriteError(w, http.StatusBadGateway, "cluster unavailable")
	}
}

// WriteError sends the JSON error shape used by every /api route.
func WriteError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter } // keeps Flush working

// logSafe keeps a client-supplied value on one log line.
var logSafe = strings.NewReplacer("\n", " ", "\r", " ")

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("endpoint")
	u, _ := auth.UserFrom(r.Context())
	if r.Method == http.MethodPost && p.audit != nil {
		// Denied attempts are logged too. Only query parameters are recorded: headers and cookies never are.
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		w = sw
		defer func() {
			params := map[string]string{}
			for k, v := range r.URL.Query() {
				params[k] = logSafe.Replace(strings.Join(v, ","))
			}
			p.audit.Info("audit", "user", u.Name, "role", u.Role.String(), "cluster", p.cluster.Name, "endpoint", logSafe.Replace(name),
				"dryrun", params["dryrun"], "params", params, "status", sw.status)
		}()
	}
	// The role gate comes before the method check so a viewer gets 403 for any POST; unknown endpoints still answer 404.
	if _, known := Lookup(name); known && (u.Role < MinRole(name) || r.Method == http.MethodPost && u.Role < auth.Admin) {
		WriteError(w, http.StatusForbidden, "your role does not allow this operation")
		return
	}
	_, code, msg := Check(name, r.Method, r.URL.Query())
	if code != 0 {
		WriteError(w, code, msg)
		return
	}
	if p.cluster.ForwardIdentity == "jwt" && u.Token == "" {
		WriteError(w, http.StatusForbidden, "no identity token available to forward; sign in with OIDC")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), p.cluster.Timeout)
	defer cancel()
	r = r.WithContext(ctx)
	r.Body = http.MaxBytesReader(w, r.Body, p.maxBody)
	p.rp.ServeHTTP(w, r)
}
