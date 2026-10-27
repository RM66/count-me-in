"""Shared OIDC id_token/JWKS minting for the telegram-auth tests
(auth/, routes/, parity/). tests_py/ is on sys.path via conftest.
"""

from __future__ import annotations

import base64
import hashlib
import os
import time
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

OIDC_ISSUER = "https://oauth.telegram.org"


def make_rsa_key() -> rsa.RSAPrivateKey:
    """A fresh random RSA key — stable for the process, never persisted."""
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def new_verifier() -> str:
    return b64u(os.urandom(32))


def nonce_for(verifier: str) -> str:
    return b64u(hashlib.sha256(verifier.encode()).digest())


def rsa_jwk(key: Any, kid: str) -> dict[str, Any]:
    """The public half as a JWKS entry — kty/n/e from PyJWT plus the
    sig/alg/kid fields the loader expects."""
    jwk = RSAAlgorithm.to_jwk(key.public_key(), as_dict=True)
    jwk.update({"use": "sig", "alg": "RS256", "kid": kid})
    return jwk


def jwks(key: Any, kid: str, extra_keys: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """A JWKS document with the key under `kid` plus any extra entries
    (broken/mixed-key cases append their own)."""
    return {"keys": [rsa_jwk(key, kid), *(extra_keys or [])]}


def id_token_claims(nonce_value: str, aud: str, /, **over: Any) -> dict[str, Any]:
    """Claims mirroring the live issuer — `id` a digit string, `sub` a
    pairwise value that is NOT the user id, ~30s validity. `aud` is
    positional-only so an `aud` key inside `over` replaces it instead
    of colliding as a duplicate keyword (the aud-list case)."""
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": OIDC_ISSUER,
        "aud": aud,
        "sub": "99998888777766665555",
        "iat": now,
        "exp": now + 30,
        "id": "123456789",
        "name": "Mila Petrović",
        "given_name": "Mila",
        "family_name": "Petrović",
        "preferred_username": "milap",
        "picture": "https://t.me/i/userpic/320/abcdef.jpg",
        "nonce": nonce_value,
    }
    claims.update(over)
    return claims


def sign_id_token(claims: dict[str, Any], key: Any, kid: str, algorithm: str = "RS256") -> str:
    return jwt.encode(claims, key, algorithm=algorithm, headers={"kid": kid})


def mint_id_token_payload(
    user_id: int, name: str, *, aud: str, key: Any, kid: str
) -> dict[str, str]:
    """A fresh RS256 id_token + the verifier whose hash it carries — the
    {idToken, nonceVerifier} body (auth/telegram.py). Fresh iat/exp and a
    fresh nonce per call, so repeats never hit the single-use claim."""
    verifier = new_verifier()
    token = sign_id_token(
        id_token_claims(
            nonce_for(verifier),
            aud,
            sub="test-sub",
            id=str(user_id),
            name=name,
            given_name="",
            family_name="",
            preferred_username="",
            picture="",
        ),
        key,
        kid,
    )
    return {"idToken": token, "nonceVerifier": verifier}
