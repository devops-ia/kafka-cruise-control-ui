package auth

// Role orders what a user may do: viewer (GET), operator (also dry-run), admin (everything).
type Role int

const (
	Viewer Role = iota + 1
	Operator
	Admin
)

func (r Role) String() string {
	switch r {
	case Viewer:
		return "viewer"
	case Operator:
		return "operator"
	case Admin:
		return "admin"
	}
	return "none"
}

// ParseRole returns 0 for unknown names.
func ParseRole(s string) Role {
	switch s {
	case "viewer":
		return Viewer
	case "operator":
		return Operator
	case "admin":
		return Admin
	}
	return 0
}
