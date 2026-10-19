// Package proxy forwards allow-listed requests to Cruise Control clusters.
package proxy

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/devops-ia/kafka-cruise-control-ui/internal/auth"
)

type Endpoint struct {
	Method string
	Params map[string]bool
}

func params(s string) map[string]bool {
	m := map[string]bool{}
	for _, p := range strings.Fields(s) {
		m[p] = true
	}
	return m
}

// RequiresDryRun is true for POST endpoints that compute or execute changes.
func (e Endpoint) RequiresDryRun() bool { return e.Method == http.MethodPost && e.Params["dryrun"] }

func Lookup(name string) (Endpoint, bool) {
	e, ok := table[name]
	return e, ok
}

// Check validates the endpoint, method and query. It returns 0 when the request may go on.
func Check(name, method string, q url.Values) (Endpoint, int, string) {
	ep, ok := Lookup(name)
	if !ok {
		return ep, http.StatusNotFound, "unknown endpoint"
	}
	if method != ep.Method {
		return ep, http.StatusMethodNotAllowed, "method not allowed, use " + ep.Method
	}
	for k := range q {
		if !ep.Params[k] {
			return ep, http.StatusBadRequest, fmt.Sprintf("parameter %q is not accepted for %s", k, name)
		}
	}
	if d := q.Get("dryrun"); q.Has("dryrun") && d != "true" && d != "false" {
		return ep, http.StatusBadRequest, "parameter \"dryrun\" must be true or false"
	}
	if ep.RequiresDryRun() && !q.Has("dryrun") {
		return ep, http.StatusBadRequest, "parameter \"dryrun\" is required (true or false)"
	}
	return ep, 0, ""
}

// MinRole is the lowest role allowed to send this request.
func MinRole(name string, ep Endpoint, q url.Values) auth.Role {
	switch {
	case ep.Method == http.MethodGet:
		return auth.Viewer
	case name == "rightsize":
		return auth.Operator
	case name == "topic_configuration", !ep.Params["dryrun"]:
		return auth.Admin
	case q.Get("dryrun") == "true":
		return auth.Operator
	}
	return auth.Admin
}
