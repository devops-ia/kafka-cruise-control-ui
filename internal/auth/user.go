package auth

import "context"

// User is the authenticated caller. Token is the OIDC id_token, kept only to forward the identity to Cruise Control.
type User struct {
	Name  string
	Role  Role
	Token string
}

type ctxKey struct{}

func WithUser(ctx context.Context, u User) context.Context {
	return context.WithValue(ctx, ctxKey{}, u)
}

func UserFrom(ctx context.Context) (User, bool) {
	u, ok := ctx.Value(ctxKey{}).(User)
	return u, ok
}
