package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// Auth.js session token decryption (@auth/core@0.41.x wire format;
// tested against @auth/core@0.41.3 / next-auth 5.0.0-beta.32 — the
// format may change on Auth.js upgrades, so if sessions stop
// decoding after one, check @auth/core's jwt module first).
// Auth.js encrypts — not signs — JWT sessions: a compact JWE with
// alg "dir" and content encryption A256CBC-HS512 (default) or A256GCM,
// the key derived per token via HKDF-SHA256 from AUTH_SECRET:
//
//	key = HKDF(ikm=AUTH_SECRET, salt=cookie name,
//	           info="Auth.js Generated Encryption Key (<cookie name>)",
//	           length = 64 (A256CBC-HS512) or 32 (A256GCM))
//
// The plan's "HS256 signature" sketch predates this check: @auth/core
// switched to encrypted sessions, so a signed-JWT parser cannot read
// them. Implemented with stdlib crypto (jose-free).
//
// jose jwtDecrypt semantics mirrored: exp honored with 15s clock
// tolerance (Auth.js emits no nbf); the kid thumbprint is not
// re-derived (trying the derived key against the token is equivalent
// for a single-secret setup).
//
// Integrity (verified against jose@5 golden vectors in jwt_test.go):
//   - A256CBC-HS512: tag = HMAC-SHA512(macKey,
//     AAD || IV || ciphertext || uint64be(bitlen(AAD)))[0:32], where
//     AAD = ASCII(BASE64URL(protected header)) and the CEK splits into
//     32-byte MAC key + 32-byte AES key (RFC 7518 §5.2);
//   - A256GCM: AAD = ASCII(BASE64URL(protected header)).

var ErrSessionToken = errors.New("invalid session token")

const clockTolerance = 15 * time.Second

type sessionClaims struct {
	Sub  string `json:"sub"`
	Slug string `json:"slug"`
	Iat  int64  `json:"iat"`
	Exp  int64  `json:"exp"`
}

func hkdfSHA256(secret, salt, info []byte, length int) []byte {
	// RFC 5869, extract-then-expand with HMAC-SHA256.
	h := hmac.New(sha256.New, salt)
	h.Write(secret)
	prk := h.Sum(nil)

	out := make([]byte, 0, length)
	var t []byte
	for i := byte(1); len(out) < length; i++ {
		h := hmac.New(sha256.New, prk)
		h.Write(append(append(append([]byte{}, t...), info...), i))
		t = h.Sum(nil)
		out = append(out, t...)
	}
	return out[:length]
}

func derivedKey(secret, cookieName string, enc string) []byte {
	info := []byte("Auth.js Generated Encryption Key (" + cookieName + ")")
	length := 64
	if enc == "A256GCM" {
		length = 32
	}
	return hkdfSHA256([]byte(secret), []byte(cookieName), info, length)
}

var b64 = base64.RawURLEncoding

type jweHeader struct {
	Alg string `json:"alg"`
	Enc string `json:"enc"`
	Kid string `json:"kid"`
}

func uint64be(v uint64) []byte {
	out := make([]byte, 8)
	binary.BigEndian.PutUint64(out, v)
	return out
}

// decodeSessionToken decrypts one session token candidate. salt must
// be the name of the cookie the token came from — Auth.js binds the
// derived key to it.
func decodeSessionToken(token, secret, cookieName string) (*sessionClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 5 {
		return nil, ErrSessionToken
	}
	headerJSON, err := b64.DecodeString(parts[0])
	if err != nil {
		return nil, ErrSessionToken
	}
	var header jweHeader
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return nil, ErrSessionToken
	}
	if header.Alg != "dir" {
		return nil, ErrSessionToken
	}
	if header.Enc != "A256CBC-HS512" && header.Enc != "A256GCM" {
		return nil, ErrSessionToken
	}
	key := derivedKey(secret, cookieName, header.Enc)

	iv, err1 := b64.DecodeString(parts[2])
	ct, err2 := b64.DecodeString(parts[3])
	tag, err3 := b64.DecodeString(parts[4])
	if err1 != nil || err2 != nil || err3 != nil {
		return nil, ErrSessionToken
	}

	// AAD = ASCII(BASE64URL(protected header)) — the "encrypted key"
	// segment (empty for dir) is not part of the integrity input.
	aad := []byte(parts[0])

	var plaintext []byte
	switch header.Enc {
	case "A256CBC-HS512":
		if len(iv) != 16 || len(tag) != 32 {
			return nil, ErrSessionToken
		}
		macKey, encKey := key[:32], key[32:]
		mac := hmac.New(sha512.New, macKey)
		mac.Write(aad)
		mac.Write(iv)
		mac.Write(ct)
		mac.Write(uint64be(uint64(len(aad)) * 8)) // bit length of AAD
		if !hmac.Equal(mac.Sum(nil)[:32], tag) {
			return nil, ErrSessionToken
		}
		plaintext, err = aesCBCDecrypt(encKey, iv, ct)
		if err != nil {
			return nil, ErrSessionToken
		}
	case "A256GCM":
		if len(iv) != 12 || len(tag) != 16 {
			return nil, ErrSessionToken
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, ErrSessionToken
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			return nil, ErrSessionToken
		}
		ciphertext := append(append([]byte{}, ct...), tag...)
		plaintext, err = gcm.Open(nil, iv, ciphertext, aad)
		if err != nil {
			return nil, ErrSessionToken
		}
	}

	var claims sessionClaims
	if err := json.Unmarshal(plaintext, &claims); err != nil {
		return nil, ErrSessionToken
	}
	if claims.Exp != 0 && time.Now().Add(-clockTolerance).Unix() > claims.Exp {
		return nil, ErrSessionToken
	}
	return &claims, nil
}

func aesCBCDecrypt(key, iv, ct []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	if len(ct) == 0 || len(ct)%aes.BlockSize != 0 {
		return nil, errors.New("bad ciphertext length")
	}
	plaintext := make([]byte, len(ct))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(plaintext, ct)
	// PKCS#7 padding.
	pad := int(plaintext[len(plaintext)-1])
	if pad == 0 || pad > aes.BlockSize || pad > len(plaintext) {
		return nil, errors.New("bad padding")
	}
	for _, b := range plaintext[len(plaintext)-pad:] {
		if int(b) != pad {
			return nil, errors.New("bad padding")
		}
	}
	return plaintext[:len(plaintext)-pad], nil
}
