// Package passwd validates and checks bcrypt and argon2id password hashes.
package passwd

import (
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

type argonParams struct {
	m, t uint32
	p    uint8
	salt []byte
	key  []byte
}

// parseArgon parses a PHC string: $argon2id$v=19$m=65536,t=3,p=4$<salt>$<key>.
func parseArgon(h string) (argonParams, error) {
	var a argonParams
	parts := strings.Split(h, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return a, errors.New("not an argon2id hash")
	}
	var v int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &v); err != nil || v != argon2.Version {
		return a, errors.New("unsupported argon2 version")
	}
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &a.m, &a.t, &a.p); err != nil || a.m == 0 || a.t == 0 || a.p == 0 {
		return a, errors.New("bad argon2 parameters")
	}
	var err error
	if a.salt, err = base64.RawStdEncoding.DecodeString(parts[4]); err != nil || len(a.salt) == 0 {
		return a, errors.New("bad argon2 salt")
	}
	if a.key, err = base64.RawStdEncoding.DecodeString(parts[5]); err != nil || len(a.key) == 0 {
		return a, errors.New("bad argon2 key")
	}
	return a, nil
}

// ValidateHash accepts only bcrypt and argon2id hashes, never plain text.
func ValidateHash(h string) error {
	if strings.HasPrefix(h, "$argon2id$") {
		_, err := parseArgon(h)
		return err
	}
	if strings.HasPrefix(h, "$2") {
		_, err := bcrypt.Cost([]byte(h))
		return err
	}
	return errors.New("must be a bcrypt or argon2id hash, not plain text")
}

// CheckPassword reports whether pw matches the (already validated) hash.
func CheckPassword(h, pw string) bool {
	if strings.HasPrefix(h, "$argon2id$") {
		a, err := parseArgon(h)
		if err != nil {
			return false
		}
		k := argon2.IDKey([]byte(pw), a.salt, a.t, a.m, a.p, uint32(len(a.key)))
		return subtle.ConstantTimeCompare(k, a.key) == 1
	}
	return bcrypt.CompareHashAndPassword([]byte(h), []byte(pw)) == nil
}
