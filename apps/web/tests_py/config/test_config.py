"""Fail-fast production config.

Validate is pure: in production every missing variable is a hard error
naming it; outside production validation is skipped (local
docker-compose routinely lacks secrets — the lazy per-module errors
still surface them at first use).
"""

import os

import pytest
from countmein import config

REQUIRED = [
    "AUTH_SECRET",
    "POSTGRES_URL",
    "REDIS_URL",
    "APP_URL",
    "QSTASH_TOKEN",
    "QSTASH_CURRENT_SIGNING_KEY",
    "TELEGRAM_BOT_TOKEN",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_PUBLIC_BASE_URL",
]


def clear_prod_flags(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("VERCEL_ENV", "")


def full_prod_env(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setenv("VERCEL_ENV", "")
    monkeypatch.setenv("AUTH_SECRET", "prod-secret")
    monkeypatch.setenv("POSTGRES_URL", "postgres://prod/db")
    monkeypatch.setenv("REDIS_URL", "rediss://default:prod-rest-token@prod.upstash.io:6379")
    monkeypatch.setenv("APP_URL", "https://countmein.group")
    monkeypatch.setenv("QSTASH_TOKEN", "prod-qstash-token")
    monkeypatch.setenv("QSTASH_CURRENT_SIGNING_KEY", "prod-signing-key")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "prod-bot-token")
    monkeypatch.setenv("R2_ACCOUNT_ID", "prod-account")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "prod-access")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "prod-secret-key")
    monkeypatch.setenv("R2_BUCKET", "prod-bucket")
    monkeypatch.setenv("R2_PUBLIC_BASE_URL", "https://media.countmein.group")
    # Realtime resolves from the Upstash-shaped REDIS_URL above — no
    # dedicated variable needed in production.


def test_validate_skipped_outside_production(monkeypatch):
    clear_prod_flags(monkeypatch)
    monkeypatch.setenv("AUTH_SECRET", "")
    monkeypatch.setenv("POSTGRES_URL", "")
    assert config.validate() is None


def test_validate_production_full(monkeypatch):
    full_prod_env(monkeypatch)
    assert config.validate() is None


@pytest.mark.parametrize("name", REQUIRED)
def test_validate_production_refusals(monkeypatch, name):
    full_prod_env(monkeypatch)
    monkeypatch.setenv(name, "  ")  # whitespace-only counts as missing
    with pytest.raises(config.ConfigError) as exc_info:
        config.validate()
    assert name in str(exc_info.value), f"production without {name} must fail validation"


@pytest.mark.parametrize(
    ("app_url", "want_err"),
    [
        ("https://countmein.group", False),
        ("https://countmein.group/", False),
        ("http://localhost:3000", False),
        ("https://countmein.group/some/path", True),
        ("https://countmein.group?x=1", True),
        ("https://countmein.group#frag", True),
        ("https://user:pass@countmein.group", True),
        ("countmein.group", True),
        ("ftp://countmein.group", True),
        ("https://", True),
    ],
    ids=[
        "host only",
        "trailing slash",
        "http allowed",
        "trailing path",
        "query string",
        "fragment",
        "userinfo",
        "no scheme",
        "wrong scheme",
        "empty host",
    ],
)
def test_validate_app_url_shapes(monkeypatch, app_url, want_err):
    full_prod_env(monkeypatch)
    monkeypatch.setenv("APP_URL", app_url)
    if want_err:
        with pytest.raises(config.ConfigError):
            config.validate()
    else:
        config.validate()  # must not raise


def test_validate_internal_app_url_is_optional_but_checked(monkeypatch):
    full_prod_env(monkeypatch)
    monkeypatch.delenv("INTERNAL_APP_URL", raising=False)
    config.validate()  # unset is fine — the hop falls back to APP_URL
    monkeypatch.setenv("INTERNAL_APP_URL", "http://web:3000")
    config.validate()  # the compose shape validates
    monkeypatch.setenv("INTERNAL_APP_URL", "web:3000/path")
    with pytest.raises(config.ConfigError):
        config.validate()


def test_validate_strict_env_opts_in(monkeypatch):
    # Dev/staging can opt into the production validation with STRICT_ENV=1;
    # without it (and outside production) validation stays skipped.
    monkeypatch.setenv("STRICT_ENV", "")
    clear_prod_flags(monkeypatch)
    monkeypatch.setenv("AUTH_SECRET", "")
    config.validate()  # skipped outside production — must not raise

    monkeypatch.setenv("STRICT_ENV", "1")
    with pytest.raises(config.ConfigError):
        config.validate()
    full_prod_env(monkeypatch)
    config.validate()  # full env under STRICT_ENV — must not raise


def test_validate_next_signing_key_optional(monkeypatch):
    full_prod_env(monkeypatch)
    monkeypatch.setenv("QSTASH_NEXT_SIGNING_KEY", "")
    assert config.validate() is None, "empty QSTASH_NEXT_SIGNING_KEY must validate (rotation only)"


def test_validate_vercel_env_counts_as_production(monkeypatch):
    full_prod_env(monkeypatch)
    monkeypatch.setenv("NODE_ENV", "")
    monkeypatch.setenv("VERCEL_ENV", "production")
    monkeypatch.setenv("APP_URL", "")
    with pytest.raises(config.ConfigError):
        config.validate()


def test_redis_configured(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "  ")
    assert not config.redis_configured()
    monkeypatch.setenv("REDIS_URL", "redis://x")
    assert config.redis_configured()


def test_validate_production_requires_realtime_resolution(monkeypatch):
    """A non-Upstash REDIS_URL with no REDIS_REST_URL override leaves
    realtime unresolvable — production must fail; the override fixes it."""
    full_prod_env(monkeypatch)
    monkeypatch.setenv("REDIS_URL", "redis://prod.internal:6379")
    with pytest.raises(config.ConfigError, match="realtime"):
        config.validate()
    monkeypatch.setenv("REDIS_REST_URL", "https://:rest-tok@rest.prod.internal")
    config.validate()


def test_realtime_credentials(monkeypatch):
    monkeypatch.delenv("REDIS_REST_URL", raising=False)

    # REDIS_REST_URL carries endpoint + token in userinfo — this is also
    # how non-Upstash targets (the compose emulator) are addressed.
    monkeypatch.setenv("REDIS_REST_URL", "http://:dev-token@localhost:8080")
    assert config.realtime_credentials() == ("http://localhost:8080", "dev-token")
    monkeypatch.setenv("REDIS_REST_URL", "http://:dev-token@[::1]:8080")
    assert config.realtime_credentials() == ("http://[::1]:8080", "dev-token")
    monkeypatch.setenv("REDIS_REST_URL", "https://tok@rest.example.com:443")
    assert config.realtime_credentials() == ("https://rest.example.com", "tok")
    # Set-but-malformed or tokenless → off, NOT a fallthrough to REDIS_URL.
    for bad in ("not a url", "http://localhost:8080", "redis://x"):
        monkeypatch.setenv("REDIS_REST_URL", bad)
        monkeypatch.setenv("REDIS_URL", "rediss://default:secret@x.upstash.io:6379")
        assert config.realtime_credentials() is None, bad
    monkeypatch.delenv("REDIS_REST_URL")

    # An Upstash TCP URL derives the REST pair (https + the password).
    assert config.realtime_credentials() == ("https://x.upstash.io", "secret")
    # Non-Upstash or passwordless REDIS_URL → off.
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379")
    assert config.realtime_credentials() is None
    monkeypatch.setenv("REDIS_URL", "redis://:secret@cache.internal:6379")
    assert config.realtime_credentials() is None


def test_env_names_stable():
    # The required list must not drift from the documented set.
    assert set(REQUIRED) == set(config._REQUIRED)
    assert "QSTASH_NEXT_SIGNING_KEY" not in config._REQUIRED
    assert os.environ is not None
