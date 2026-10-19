package proxy

import (
	"fmt"
	"net/http"
	"time"

	"github.com/devops-ia/kafka-cruise-control-ui/internal/auth"
	"github.com/devops-ia/kafka-cruise-control-ui/internal/config"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// withHeader sets Authorization on a copy of the request (RoundTrippers must not mutate their input).
func withAuthorization(base http.RoundTripper, value func(*http.Request) (string, error)) http.RoundTripper {
	return roundTripFunc(func(r *http.Request) (*http.Response, error) {
		v, err := value(r)
		if err != nil {
			return nil, err
		}
		r = r.Clone(r.Context())
		r.Header.Set("Authorization", v)
		return base.RoundTrip(r)
	})
}

// NewTransport returns the RoundTripper that talks to one cluster, with its service authentication applied.
func NewTransport(cl config.Cluster) (http.RoundTripper, error) {
	base := http.DefaultTransport.(*http.Transport).Clone()
	if cl.ForwardIdentity == "jwt" {
		// The user's own token replaces the service credentials.
		return withAuthorization(base, func(r *http.Request) (string, error) {
			u, _ := auth.UserFrom(r.Context())
			if u.Token == "" {
				return "", fmt.Errorf("no identity token to forward")
			}
			return "Bearer " + u.Token, nil
		}), nil
	}
	a := cl.Auth
	switch a.Type {
	case "none", "":
		return base, nil
	case "basic":
		return roundTripFunc(func(r *http.Request) (*http.Response, error) {
			r = r.Clone(r.Context())
			r.SetBasicAuth(a.User, a.Password)
			return base.RoundTrip(r)
		}), nil
	case "bearer":
		return withAuthorization(base, func(*http.Request) (string, error) { return "Bearer " + a.Token, nil }), nil
	case "oidc":
		return oidcClientCredentials(base, a, time.Now), nil
	case "sigv4":
		if a.Region == "" {
			return nil, fmt.Errorf("CCUI_CLUSTERS__*__AUTH_SIGV4_REGION is required for AUTH_TYPE=sigv4 (cluster %q)", cl.Name)
		}
		creds, err := awsCredentials(a.Region)
		if err != nil {
			return nil, err
		}
		return sigV4(base, a.Region, a.Service, creds, time.Now), nil
	}
	return nil, fmt.Errorf("unsupported AUTH_TYPE %q for cluster %q", a.Type, cl.Name)
}
