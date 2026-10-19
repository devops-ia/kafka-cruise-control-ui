package proxy

import (
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/devops-ia/kafka-cruise-control-ui/internal/auth"
)

func q(s string) url.Values { v, _ := url.ParseQuery(s); return v }

func TestCheck(t *testing.T) {
	cases := []struct {
		name, method, query string
		want                int
		msg                 string
	}{
		{"state", "GET", "", 0, ""},
		{"state", "GET", "substates=EXECUTOR&verbose=true", 0, ""},
		{"unknown_endpoint", "GET", "", http.StatusNotFound, ""},
		{"..", "GET", "", http.StatusNotFound, ""},
		{"rebalance", "GET", "dryrun=true", http.StatusMethodNotAllowed, ""},
		{"state", "POST", "", http.StatusMethodNotAllowed, ""},
		{"rebalance", "POST", "", http.StatusBadRequest, "dryrun"},
		{"rebalance", "POST", "dryrun=maybe", http.StatusBadRequest, "dryrun"},
		{"rebalance", "POST", "dryrun=true", 0, ""},
		{"load", "GET", "foo=bar", http.StatusBadRequest, "foo"},
		{"state", "GET", "doAs=root", http.StatusBadRequest, "doAs"},
		{"state", "GET", "json=false", http.StatusBadRequest, "json"},
		{"pause_sampling", "POST", "reason=x", 0, ""}, // no dryrun param exists for it
	}
	for _, c := range cases {
		_, got, msg := Check(c.name, c.method, q(c.query))
		if got != c.want || !strings.Contains(msg, c.msg) {
			t.Errorf("%s %s?%s: got %d %q, want %d containing %q", c.method, c.name, c.query, got, msg, c.want, c.msg)
		}
	}
}

func TestMinRole(t *testing.T) {
	cases := []struct {
		name, query string
		want        auth.Role
	}{
		{"state", "", auth.Viewer},
		{"rebalance", "dryrun=true", auth.Operator},
		{"rebalance", "dryrun=false", auth.Admin},
		{"topic_configuration", "dryrun=true", auth.Admin},
		{"admin", "", auth.Admin},
		{"review", "", auth.Admin},
		{"stop_proposal_execution", "", auth.Admin},
		{"pause_sampling", "", auth.Admin},
		{"rightsize", "", auth.Operator},
	}
	for _, c := range cases {
		ep, _ := Lookup(c.name)
		if got := MinRole(c.name, ep, q(c.query)); got != c.want {
			t.Errorf("%s?%s: got %v want %v", c.name, c.query, got, c.want)
		}
	}
}

// Compares the table with CC's own endpoint yaml. wip/ is git-ignored, so the check is skipped when it is absent.
func TestTableMatchesCruiseControlYaml(t *testing.T) {
	files, _ := filepath.Glob("../../wip/cruise-control/cruise-control/src/main/resources/yaml/endpoints/*.yaml")
	if len(files) == 0 {
		t.Skip("wip/ not present")
	}
	method := regexp.MustCompile(`^  (get|post):`)
	param := regexp.MustCompile(`^      - name: (\S+)`)
	camel := regexp.MustCompile(`[A-Z]`)
	ignored := map[string]bool{"json": true, "doAs": true, "get_response_schema": true}
	seen := map[string]bool{}
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var op, m string
		var ps []string
		inResp := false
		for _, l := range strings.Split(string(b), "\n") {
			if r := method.FindStringSubmatch(l); r != nil {
				m = strings.ToUpper(r[1])
			}
			if strings.HasPrefix(l, "    operationId:") {
				op = strings.TrimSpace(strings.Split(l, ":")[1])
			}
			if strings.HasPrefix(l, "    responses:") {
				inResp = true
			}
			if r := param.FindStringSubmatch(l); r != nil && !inResp && !ignored[r[1]] {
				ps = append(ps, r[1])
			}
		}
		name := camel.ReplaceAllStringFunc(op, func(s string) string { return "_" + strings.ToLower(s) })
		if op == "partitionload" {
			name = "partition_load"
		}
		seen[name] = true
		ep, ok := Lookup(name)
		if !ok {
			t.Errorf("%s: endpoint missing from table", name)
			continue
		}
		var have []string
		for p := range ep.Params {
			have = append(have, p)
		}
		sort.Strings(have)
		sort.Strings(ps)
		if ep.Method != m || strings.Join(have, ",") != strings.Join(ps, ",") {
			t.Errorf("%s: table %s [%v], yaml %s [%v]", name, ep.Method, have, m, ps)
		}
	}
	for n := range table {
		if !seen[n] {
			t.Errorf("%s: in table but not in CC yaml", n)
		}
	}
}
