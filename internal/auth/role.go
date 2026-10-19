package auth

// Role orders what a user may do: viewer (read the Overview and Load endpoints) or admin (everything).
type Role int

const (
	Viewer Role = iota + 1
	Admin
)

func (r Role) String() string {
	switch r {
	case Viewer:
		return "viewer"
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
	case "admin":
		return Admin
	}
	return 0
}
