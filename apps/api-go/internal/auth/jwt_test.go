package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// Golden vectors generated with the real stack the app uses:
// @panva/hkdf + jose@5 EncryptJWT (A256CBC-HS512 / A256GCM, alg dir),
// secret "test-golden-secret", salt = cookie name. Anchors the Go
// implementation to the @auth/core wire format.
const (
	goldenSecret = "test-golden-secret"
	goldenCookie = "authjs.session-token"

	goldenCBC = "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..iudo_QaL6fmg5zbortJp7Q.H8ozYaTjq20qnaFPjVVcsU0zQal3_zRJsLlqHpmEhXiCtRrQmgZjYPu7KkoaX7ifs9x0EKTrdS4Lj6E8_tAZO2595NsmxFvdZ7b4uGOcS9E_AnY3Nc4fjSJMDXLC-zmRCpqspOf292ktIo-FofJIRtw-jJso59Q-ZnQEz_Kr0R8.g-hc1m7X6Cij39kFCbc_SmTog78JN3YQnVFzT4WnAUo"
	goldenGCM = "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..Pq4BGx5m19NVNYMn.chWIt7-l_rDcoFOFA3yAntR8CxCoRkSLN3X1NTdxyEBjh5zZHrjIaRJ_a1iww74pflAU53wdHZ9MPfA6pq6cgr5JwHzt3Z7Vic9EEGSSBdW6OkPr-qIucMHHUKxUykZlR3VYqg.QTIsltw7ohxS85k_4OYxKg"
)

func TestHKDFSHA256RFC5869(t *testing.T) {
	// RFC 5869 test case 1 (SHA-256): the cross-implementation anchor
	// for the key derivation Auth.js relies on.
	ikm := make([]byte, 22)
	for i := range ikm {
		ikm[i] = 0x0b
	}
	salt := []byte{0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c}
	info := []byte{0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9}
	want, err := hex.DecodeString("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865")
	if err != nil {
		t.Fatal(err)
	}
	got := hkdfSHA256(ikm, salt, info, 42)
	if !hmac.Equal(got, want) {
		t.Fatalf("HKDF-SHA256 mismatch:\n got %x\nwant %x", got, want)
	}
}

func TestDecodeSessionTokenGoldenCBC(t *testing.T) {
	claims, err := decodeSessionToken(goldenCBC, goldenSecret, goldenCookie)
	if err != nil {
		t.Fatalf("golden CBC token must decode: %v", err)
	}
	if claims.Sub != "01930000-0000-7000-8000-000000000001" || claims.Slug != "golden" {
		t.Fatalf("unexpected claims: %+v", claims)
	}
}

func TestDecodeSessionTokenGoldenGCM(t *testing.T) {
	claims, err := decodeSessionToken(goldenGCM, goldenSecret, goldenCookie)
	if err != nil {
		t.Fatalf("golden GCM token must decode: %v", err)
	}
	if claims.Sub != "01930000-0000-7000-8000-000000000002" || claims.Slug != "golden-gcm" {
		t.Fatalf("unexpected claims: %+v", claims)
	}
}

func TestDecodeSessionTokenWrongSecret(t *testing.T) {
	if _, err := decodeSessionToken(goldenCBC, "another-secret", goldenCookie); err == nil {
		t.Fatal("wrong secret must not decrypt the token")
	}
}

func TestDecodeSessionTokenWrongSalt(t *testing.T) {
	// The key is bound to the cookie name — a token minted for one
	// cookie must not decrypt under another.
	if _, err := decodeSessionToken(goldenCBC, goldenSecret, "__Secure-authjs.session-token"); err == nil {
		t.Fatal("wrong salt must not decrypt the token")
	}
}

func TestDecodeSessionTokenGarbage(t *testing.T) {
	for _, token := range []string{"", "not-a-token", "a.b.c.d.e.f", goldenCBC + "x"} {
		if _, err := decodeSessionToken(token, goldenSecret, goldenCookie); err == nil {
			t.Fatalf("garbage token %q must not decode", token)
		}
	}
}

// Roundtrip: expiry rejection. The token is produced with the same
// primitives jose uses (the golden vectors above anchor correctness).
func TestDecodeSessionTokenExpired(t *testing.T) {
	token, err := encryptSessionToken(goldenSecret, goldenCookie, sessionClaims{
		Sub: "sub", Slug: "slug", Iat: time.Now().Add(-2 * time.Hour).Unix(),
		Exp: time.Now().Add(-time.Hour).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeSessionToken(token, goldenSecret, goldenCookie); err == nil {
		t.Fatal("expired token must be rejected")
	}
}

func TestDecodeSessionTokenRoundtrip(t *testing.T) {
	token, err := encryptSessionToken(goldenSecret, goldenCookie, sessionClaims{
		Sub: "01930000-0000-7000-8000-000000000abc", Slug: "studio",
		Iat: time.Now().Unix(), Exp: time.Now().Add(time.Hour).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	claims, err := decodeSessionToken(token, goldenSecret, goldenCookie)
	if err != nil {
		t.Fatalf("roundtrip must decode: %v", err)
	}
	if claims.Sub != "01930000-0000-7000-8000-000000000abc" || claims.Slug != "studio" {
		t.Fatalf("unexpected claims: %+v", claims)
	}
}

// encryptSessionToken mirrors jose's EncryptJWT with alg dir and
// A256CBC-HS512 (test-only counterpart of decodeSessionToken; the
// golden vectors anchor it against the real implementation).
func encryptSessionToken(secret, cookieName string, claims sessionClaims) (string, error) {
	key := derivedKey(secret, cookieName, "A256CBC-HS512")
	macKey, encKey := key[:32], key[32:]

	header := b64.EncodeToString([]byte(`{"alg":"dir","enc":"A256CBC-HS512"}`))
	plaintext, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	// PKCS#7 pad.
	pad := aes.BlockSize - len(plaintext)%aes.BlockSize
	for i := 0; i < pad; i++ {
		plaintext = append(plaintext, byte(pad))
	}
	iv := make([]byte, 16)
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	ct := make([]byte, len(plaintext))
	block, _ := aes.NewCipher(encKey)
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(ct, plaintext)

	// Same integrity construction as jose: AAD || IV || C || bitlen.
	mac := hmac.New(sha512.New, macKey)
	mac.Write([]byte(header))
	mac.Write(iv)
	mac.Write(ct)
	mac.Write(uint64be(uint64(len(header)) * 8))
	tag := mac.Sum(nil)[:32]

	return strings.Join([]string{
		header, "",
		b64.EncodeToString(iv),
		b64.EncodeToString(ct),
		b64.EncodeToString(tag),
	}, "."), nil
}
