package config

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// variablesInCode returns every variable name the loader reads, found through the helper calls in config.go.
func variablesInCode(t *testing.T) (all, secrets map[string]bool) {
	t.Helper()
	src, err := os.ReadFile("config.go")
	if err != nil {
		t.Fatal(err)
	}
	all, secrets = map[string]bool{}, map[string]bool{}
	add := func(re, prefix string, secret bool) {
		for _, m := range regexp.MustCompile(re).FindAllStringSubmatch(string(src), -1) {
			name := prefix + m[1]
			all[name] = true
			if secret {
				secrets[name] = true
			}
		}
	}
	add(`\bg\("(CCUI_[A-Z0-9_]+)"\)`, "", false)
	add(`\bgs\("(CCUI_[A-Z0-9_]+)"\)`, "", true)
	add(`\bcl\("([A-Z0-9_]+)"\)`, "CCUI_CLUSTERS__<n>__", false)
	add(`\bcls\("([A-Z0-9_]+)"\)`, "CCUI_CLUSTERS__<n>__", true)
	add(`\boi\("([A-Z0-9_]+)"\)`, "CCUI_OIDC__<n>__", false)
	add(`\bois\("([A-Z0-9_]+)"\)`, "CCUI_OIDC__<n>__", true)
	if len(all) < 30 {
		t.Fatalf("only %d variables found in config.go; did the helper names change?", len(all))
	}
	return all, secrets
}

func readme(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("../../README.md")
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestEveryVariableIsDocumented(t *testing.T) {
	doc := readme(t)
	all, secrets := variablesInCode(t)
	for name := range all {
		if !strings.Contains(doc, "`"+name+"`") {
			t.Errorf("%s is read by the code but missing from the README table", name)
		}
	}
	if !strings.Contains(doc, "`_FILE`") {
		t.Error("README must explain the _FILE form of secrets")
	}
	for name := range secrets {
		// the README lists each secret's _FILE form in the sentence that follows the tables
		if !strings.Contains(doc, "accepts the `_FILE` form") {
			t.Errorf("%s: README does not say secrets accept _FILE", name)
		}
	}
}

func TestREADMEDoesNotInventVariables(t *testing.T) {
	doc := readme(t)
	all, secrets := variablesInCode(t)
	known := func(n string) bool {
		n = regexp.MustCompile(`__\d+__`).ReplaceAllString(n, "__<n>__")
		if all[n] {
			return true
		}
		return strings.HasSuffix(n, "_FILE") && secrets[strings.TrimSuffix(n, "_FILE")]
	}
	for _, m := range regexp.MustCompile("`(CCUI_[A-Z0-9_<>n]+)`").FindAllStringSubmatch(doc, -1) {
		if !known(m[1]) {
			t.Errorf("README mentions %s, which the code does not read", m[1])
		}
	}
}

// Every ```env block in the README is a complete example and must load.
func TestREADMEExamplesLoad(t *testing.T) {
	blocks := regexp.MustCompile("(?s)```env\n(.*?)```").FindAllStringSubmatch(readme(t), -1)
	if len(blocks) < 2 {
		t.Fatalf("expected the README to contain env examples, found %d", len(blocks))
	}
	for i, b := range blocks {
		env := map[string]string{}
		for _, line := range strings.Split(strings.TrimSpace(b[1]), "\n") {
			k, v, ok := strings.Cut(line, "=")
			if !ok {
				t.Fatalf("example %d: bad line %q", i, line)
			}
			env[k] = v
		}
		if _, err := Load(env); err != nil {
			t.Errorf("example %d does not load: %v", i, err)
		}
	}
}
