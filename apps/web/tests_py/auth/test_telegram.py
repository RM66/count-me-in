"""The widget HMAC contract, replay
protection, and malformed-payload handling."""

from __future__ import annotations

import hashlib
import hmac
import json
import time

import pytest
from countmein.auth.telegram import (
    TICKET_PURPOSE_GUEST,
    WIDGET_DATA_VALID_AFTER,
    TelegramInvalidError,
    TelegramNotConfiguredError,
    TelegramValidationFailedError,
    validate_telegram_widget,
)

TEST_BOT_TOKEN = "123456789:TEST-BOT-TOKEN-abcdef"


def fresh_auth_date() -> str:
    """A current timestamp — the validator rejects widget payloads older
    than 24h (hasDataExpired in the TS validator), so fixtures must not
    use frozen historical dates."""
    return str(int(time.time()))


def expired_auth_date() -> str:
    return str(int(time.time()) - WIDGET_DATA_VALID_AFTER - 3600)


def future_auth_date() -> str:
    return str(int(time.time()) + 3600)


def sign_widget(bot_token: str, fields: dict[str, str]) -> str:
    """Compute the Telegram widget hash independently of the production
    code path (same algorithm, hand-written here) so the test anchors
    the HMAC contract, not just itself."""
    keys = sorted(k for k in fields if k != "hash")
    dcs = "\n".join(f"{k}={fields[k]}" for k in keys)
    secret = hashlib.sha256(bot_token.encode()).digest()
    return hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()


def widget_body(
    id_: int, first_name: str, last_name: str, username: str, auth_date: str, hash_: str
) -> bytes:
    """Marshal the numeric fields the widget actually sends (id and
    auth_date are JSON numbers) plus the string fields."""
    body: dict = {"id": id_, "first_name": first_name, "auth_date": int(auth_date), "hash": hash_}
    if last_name:
        body["last_name"] = last_name
    if username:
        body["username"] = username
    return json.dumps(body).encode()


def test_valid_widget(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TEST_BOT_TOKEN)
    fields = {
        "auth_date": fresh_auth_date(),
        "first_name": "Mila",
        "id": "123456789",
        "last_name": "Petrović",
        "username": "milap",
    }
    fields["hash"] = sign_widget(TEST_BOT_TOKEN, fields)

    identity = validate_telegram_widget(
        widget_body(123456789, "Mila", "Petrović", "milap", fields["auth_date"], fields["hash"])
    )
    assert identity.messenger == "telegram"
    assert identity.messenger_id == "123456789"
    assert identity.display_name == "Mila Petrović"
    assert identity.messenger_login == "@milap"
    payload = identity.to_ticket_payload(TICKET_PURPOSE_GUEST)
    assert payload.messenger == "telegram"
    assert payload.messenger_id == "123456789"


def test_valid_widget_no_username(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TEST_BOT_TOKEN)
    fields = {"auth_date": fresh_auth_date(), "first_name": "Noah", "id": "42"}
    fields["hash"] = sign_widget(TEST_BOT_TOKEN, fields)

    identity = validate_telegram_widget(
        widget_body(42, "Noah", "", "", fields["auth_date"], fields["hash"])
    )
    assert identity.messenger_login is None, "username absent → no messenger login"
    assert identity.display_name == "Noah"


def test_expired_widget(monkeypatch):
    """Replay protection: a correctly signed but stale payload must be
    refused — otherwise a captured widget body could mint tickets
    forever (hasDataExpired in the TS validator, 24h window)."""
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TEST_BOT_TOKEN)
    fields = {"auth_date": expired_auth_date(), "first_name": "Mila", "id": "123456789"}
    fields["hash"] = sign_widget(TEST_BOT_TOKEN, fields)

    with pytest.raises(TelegramValidationFailedError):
        validate_telegram_widget(
            widget_body(123456789, "Mila", "", "", fields["auth_date"], fields["hash"])
        )


def test_future_widget_rejected(monkeypatch):
    """A future auth_date is a forged claim, not a slow clock: the past
    window is 24h, the future direction only clock skew (5 minutes)."""
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TEST_BOT_TOKEN)
    fields = {"auth_date": future_auth_date(), "first_name": "Mila", "id": "123456789"}
    fields["hash"] = sign_widget(TEST_BOT_TOKEN, fields)

    with pytest.raises(TelegramValidationFailedError):
        validate_telegram_widget(
            widget_body(123456789, "Mila", "", "", fields["auth_date"], fields["hash"])
        )


def test_tampered_widget(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TEST_BOT_TOKEN)
    fields = {"auth_date": fresh_auth_date(), "first_name": "Mila", "id": "123456789"}
    fields["hash"] = sign_widget(TEST_BOT_TOKEN, fields)

    # The hash no longer covers first_name=Mila (payload says Evil).
    with pytest.raises(TelegramValidationFailedError):
        validate_telegram_widget(
            widget_body(123456789, "Evil", "", "", fields["auth_date"], fields["hash"])
        )


def test_wrong_bot_token(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "another:bot")
    fields = {"auth_date": fresh_auth_date(), "first_name": "Mila", "id": "123456789"}
    fields["hash"] = sign_widget(TEST_BOT_TOKEN, fields)

    with pytest.raises(TelegramValidationFailedError):
        validate_telegram_widget(
            widget_body(123456789, "Mila", "", "", fields["auth_date"], fields["hash"])
        )


def test_malformed_widget(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TEST_BOT_TOKEN)
    zeros = "0" * 64
    cases = {
        "empty": b"",
        "not json": b"nope",
        "array": b"[1,2]",
        "missing hash": b'{"id":123456789,"first_name":"Mila","auth_date":1700000000}',
        "short hash": b'{"id":123456789,"first_name":"Mila","auth_date":1700000000,"hash":"abc"}',
        "string id": b'{"id":"123456789","first_name":"Mila","auth_date":1700000000,"hash":"'
        + zeros.encode()
        + b'"}',
        "string date": b'{"id":123456789,"first_name":"Mila","auth_date":"1700000000","hash":"'
        + zeros.encode()
        + b'"}',
        "no first name": b'{"id":123456789,"auth_date":1700000000,"hash":"'
        + zeros.encode()
        + b'"}',
        "bad auth_date": b'{"id":123456789,"first_name":"Mila","auth_date":0,"hash":"'
        + zeros.encode()
        + b'"}',
        "bad photo_url": b'{"id":123456789,"first_name":"Mila","auth_date":1700000000,"photo_url":"not a url","hash":"'
        + zeros.encode()
        + b'"}',
    }
    for _name, body in cases.items():
        with pytest.raises(TelegramInvalidError):
            validate_telegram_widget(body)


def test_not_configured(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "")
    with pytest.raises(TelegramNotConfiguredError):
        validate_telegram_widget(b"{}")


def test_extra_field_participates_in_hmac(monkeypatch):
    """The data-check-string must cover every submitted field except
    hash — extra fields participate in the HMAC even though the schema
    ignores them, exactly like objectToAuthDataMap in the TS validator."""
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TEST_BOT_TOKEN)
    auth_date = fresh_auth_date()

    # Re-signed over all fields including the extra one: passes.
    with_extra = {
        "auth_date": auth_date,
        "first_name": "Mila",
        "id": "123456789",
        "extra": "value",
    }
    with_extra["hash"] = sign_widget(TEST_BOT_TOKEN, with_extra)
    body = json.dumps(
        {
            "id": 123456789,
            "first_name": "Mila",
            "extra": "value",
            "auth_date": int(auth_date),
            "hash": with_extra["hash"],
        }
    ).encode()
    validate_telegram_widget(body)  # must not raise

    # A hash signed over the base fields only must fail once the extra
    # field travels along — the check-string covers every field.
    base = {"auth_date": auth_date, "first_name": "Mila", "id": "123456789"}
    stale_hash = sign_widget(TEST_BOT_TOKEN, base)
    body = json.dumps(
        {
            "id": 123456789,
            "first_name": "Mila",
            "extra": "value",
            "auth_date": int(auth_date),
            "hash": stale_hash,
        }
    ).encode()
    with pytest.raises(TelegramValidationFailedError):
        validate_telegram_widget(body)
