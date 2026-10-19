package proxy

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2/clientcredentials"

	"github.com/devops-ia/kafka-cruise-control-ui/internal/config"
)

// oidcClientCredentials sends a Bearer token obtained with the client credentials grant.
// The token is cached until shortly before it expires; the fetch is serialised so concurrent requests share one call.
func oidcClientCredentials(base http.RoundTripper, a config.ClusterAuth, now func() time.Time) http.RoundTripper {
	cc := clientcredentials.Config{ClientID: a.ClientID, ClientSecret: a.ClientSecret, TokenURL: a.TokenURL}
	if a.OIDCScopes != "" {
		cc.Scopes = strings.Fields(strings.ReplaceAll(a.OIDCScopes, ",", " "))
	}
	var (
		mu     sync.Mutex
		token  string
		expiry time.Time
	)
	return withAuthorization(base, func(r *http.Request) (string, error) {
		mu.Lock()
		defer mu.Unlock()
		if token == "" || !now().Before(expiry.Add(-30*time.Second)) {
			t, err := cc.Token(r.Context())
			if err != nil {
				return "", err
			}
			token = t.AccessToken
			expiry = now().Add(time.Hour) // provider did not say how long the token lives
			if !t.Expiry.IsZero() {
				expiry = now().Add(time.Until(t.Expiry))
			}
		}
		return "Bearer " + token, nil
	})
}
