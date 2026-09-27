"""Fail-fast production config.

Validate is pure: in production every missing variable is a hard error
naming it; outside production validation is skipped (local
docker-compose routinely lacks secrets — the lazy per-module errors
still surface them at first use).
"""

import os

import pytest
from _lib.countmein import config

REQUIRED = [
    "AUTH_SECRET",
    "POSTGRES_URL",
    "REDIS_URL",
    "APP_URL",
    "QSTASH_TOKEN",
    "QSTASH_CURRENT_SIGNING_KEY",
    "TELEGRAM_BOT_TOKEN",
]


def clear_prod_flags(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("VERCEL_ENV", "")


def full_prod_env(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setenv("VERCEL_ENV", "")
    monkeypatch.setenv("AUTH_SECRET", "prod-secret")
    monkeypatch.setenv("POSTGRES_URL", "postgres://prod/db")
    monkeypatch.setenv("REDIS_URL", "redis://prod")
    monkeypatch.setenv("APP_URL", "https://countmein.group")
    monkeypatch.setenv("QSTASH_TOKEN", "prod-qstash-token")
    monkeypatch.setenv("QSTASH_CURRENT_SIGNING_KEY", "prod-signing-key")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "prod-bot-token")


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


def test_env_names_stable():
    # The required list must not drift from the documented set.
    assert set(REQUIRED) == set(config._REQUIRED)
    assert "QSTASH_NEXT_SIGNING_KEY" not in config._REQUIRED
    assert os.environ is not None
