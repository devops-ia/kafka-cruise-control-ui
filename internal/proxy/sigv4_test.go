package proxy

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"

	"github.com/devops-ia/kafka-cruise-control-ui/internal/config"
)

// Fixed vector from the AWS Signature Version 4 test suite ("get-vanilla"):
// the SDK signer, wired the way the proxy wires it, must reproduce the documented signature.
func TestSigV4FixedVector(t *testing.T) {
	var got *http.Request
	base := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		got = r
		return &http.Response{StatusCode: 200, Body: http.NoBody}, nil
	})
	creds := credentials.NewStaticCredentialsProvider("AKIDEXAMPLE", "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "")
	now := func() time.Time { return time.Date(2015, 8, 30, 12, 36, 0, 0, time.UTC) }
	rt := sigV4(base, "us-east-1", "service", creds, now)

	req := httptest.NewRequest("GET", "http://example.amazonaws.com/", nil)
	if _, err := rt.RoundTrip(req); err != nil {
		t.Fatal(err)
	}
	const want = "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
	if got.Header.Get("Authorization") != want || got.Header.Get("X-Amz-Date") != "20150830T123600Z" {
		t.Fatalf("Authorization %q, X-Amz-Date %q", got.Header.Get("Authorization"), got.Header.Get("X-Amz-Date"))
	}
	if req.Header.Get("Authorization") != "" {
		t.Fatal("the caller's request was mutated")
	}
}

func TestSigV4SignsBodyHash(t *testing.T) {
	var got *http.Request
	base := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		got = r
		return &http.Response{StatusCode: 200, Body: http.NoBody}, nil
	})
	creds := credentials.NewStaticCredentialsProvider("AKID", "key", "")
	rt := sigV4(base, "eu-west-1", "execute-api", creds, time.Now)
	req := httptest.NewRequest("POST", "http://x/y", strings.NewReader("abc"))
	if _, err := rt.RoundTrip(req); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(got.Header.Get("Authorization"), "AWS4-HMAC-SHA256 ") {
		t.Fatalf("not signed: %v", got.Header)
	}
	b := make([]byte, 8)
	n, _ := got.Body.Read(b)
	if string(b[:n]) != "abc" {
		t.Fatalf("body lost after hashing: %q", b[:n])
	}
}

func TestSigV4NeedsRegion(t *testing.T) {
	_, err := NewTransport(config.Cluster{Name: "a", Auth: config.ClusterAuth{Type: "sigv4"}})
	if err == nil || !strings.Contains(err.Error(), "AUTH_SIGV4_REGION") {
		t.Fatalf("got %v", err)
	}
}

var _ aws.CredentialsProvider = credentials.StaticCredentialsProvider{}
