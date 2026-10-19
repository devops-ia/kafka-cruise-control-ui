package passwd

import (
	"encoding/base64"
	"testing"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

func argonHash(pw string) string {
	salt := []byte("0123456789abcdef")
	k := argon2.IDKey([]byte(pw), salt, 1, 64*1024, 2, 32)
	b := base64.RawStdEncoding
	return "$argon2id$v=19$m=65536,t=1,p=2$" + b.EncodeToString(salt) + "$" + b.EncodeToString(k)
}

func TestPasswordHashes(t *testing.T) {
	bc, _ := bcrypt.GenerateFromPassword([]byte("pw"), bcrypt.MinCost)
	for name, h := range map[string]string{"bcrypt": string(bc), "argon2id": argonHash("pw")} {
		if err := ValidateHash(h); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if !CheckPassword(h, "pw") || CheckPassword(h, "nope") {
			t.Fatalf("%s: wrong verification", name)
		}
	}
	for _, bad := range []string{"", "hunter2", "$argon2id$v=19$m=1$x$y", "$2a$zz"} {
		if ValidateHash(bad) == nil {
			t.Fatalf("%q accepted", bad)
		}
	}
}
