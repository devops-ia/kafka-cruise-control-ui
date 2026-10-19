package proxy

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
)

// awsCredentials uses the standard AWS resolution chain (env, shared config, IRSA, instance role).
// Nothing is resolved until the first signature, so a missing role shows up as a 502 on use, not at startup.
func awsCredentials(region string) (aws.CredentialsProvider, error) {
	cfg, err := awsconfig.LoadDefaultConfig(context.Background(), awsconfig.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}
	return cfg.Credentials, nil
}

// sigV4 signs every upstream request. The body is buffered to hash it; it is already capped by the body limit.
func sigV4(base http.RoundTripper, region, service string, creds aws.CredentialsProvider, now func() time.Time) http.RoundTripper {
	signer := v4.NewSigner()
	return roundTripFunc(func(r *http.Request) (*http.Response, error) {
		r = r.Clone(r.Context())
		payload := []byte(nil)
		if r.Body != nil && r.Body != http.NoBody {
			var err error
			if payload, err = io.ReadAll(r.Body); err != nil {
				return nil, err
			}
			r.Body = io.NopCloser(bytes.NewReader(payload))
		}
		sum := sha256.Sum256(payload)
		c, err := creds.Retrieve(r.Context())
		if err != nil {
			return nil, fmt.Errorf("AWS credentials: %w", err)
		}
		if err := signer.SignHTTP(r.Context(), c, r, hex.EncodeToString(sum[:]), service, region, now()); err != nil {
			return nil, fmt.Errorf("sign request: %w", err)
		}
		return base.RoundTrip(r)
	})
}
