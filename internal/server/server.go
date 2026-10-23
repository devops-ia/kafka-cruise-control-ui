// Package server wires routes, middleware, the SPA and the per-cluster proxies.
package server

import (
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/devops-ia/kafka-cruise-control-ui/internal/auth"
	"github.com/devops-ia/kafka-cruise-control-ui/internal/config"
	"github.com/devops-ia/kafka-cruise-control-ui/internal/proxy"
)

type Deps struct {
	Config *config.Config
	Web    fs.FS
	Log    *slog.Logger
}

type clusterInfo struct {
	Name  string `json:"name"`
	Group string `json:"group,omitempty"`
}

func New(d Deps) (http.Handler, error) {
	cfg := d.Config
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", ok)
	mux.HandleFunc("GET /readyz", ok)

	infos := make([]clusterInfo, len(cfg.Clusters))
	proxies := map[string]*proxy.Proxy{}
	for i, cl := range cfg.Clusters {
		infos[i] = clusterInfo{cl.Name, cl.Group}
		rt, err := proxy.NewTransport(cl)
		if err != nil {
			return nil, err
		}
		proxies[cl.Name] = proxy.New(cl, rt, d.Log, cfg.MaxBodyBytes)
	}
	api := http.NewServeMux()
	api.HandleFunc("GET /api/clusters", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, infos) })
	api.HandleFunc("/api/clusters/{name}/proxy/{endpoint}", func(w http.ResponseWriter, r *http.Request) {
		p, found := proxies[r.PathValue("name")]
		if !found {
			proxy.WriteError(w, http.StatusNotFound, "unknown cluster")
			return
		}
		p.ServeHTTP(w, r)
	})
	api.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { proxy.WriteError(w, http.StatusNotFound, "not found") })
	am := auth.NewManager(cfg, d.Log)
	am.Routes(mux)
	mux.Handle("/api/", am.Protect(api))
	mux.Handle("/", spa(d.Web, cfg.LogoURL))

	logoOrigin := ""
	if u, err := url.Parse(cfg.LogoURL); err == nil && u.Host != "" {
		logoOrigin = u.Scheme + "://" + u.Host
	}
	return secureHeaders(cfg.TLSEnabled(), logoOrigin, rejectDotDot(mux)), nil
}

func ok(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte("ok\n"))
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// rejectDotDot answers 404 before ServeMux can redirect a cleaned path.
func rejectDotDot(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, seg := range strings.Split(r.URL.Path, "/") {
			if seg == ".." {
				proxy.WriteError(w, http.StatusNotFound, "not found")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
