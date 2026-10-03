"""Hand-written Redis payload types (ADR-016). These never travel over
HTTP — they are cached in Redis behind auth tickets and login links — so
the OpenAPI document only lists them under x-internal. Ordinary
application code, like the rest of this package's hand-written surface.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class AuthTicketPayload:
    """The identity cached in Redis behind an auth ticket (ADR-008). The
    Python writer (auth/ticket.py) and the TS reader
    (server/auth/ticket.ts) share the shape; parity is pinned by the
    golden sample AuthTicketPayload.json."""

    messenger: str
    messenger_id: str
    display_name: str
    photo_url: str | None = None
    messenger_login: str | None = None
    # Purpose binds the ticket to one flow: "guest" tickets redeem only
    # in booking endpoints, "organizer" only in registration.
    # Parity: `purpose` in packages/contracts/src/auth.ts.
    purpose: str = "guest"

    def to_json(self) -> dict[str, Any]:
        out: dict = {  # type: ignore[type-arg]
            "messenger": self.messenger,
            "messengerId": self.messenger_id,
            "displayName": self.display_name,
            "purpose": self.purpose,
        }
        if self.photo_url is not None:
            out["photoUrl"] = self.photo_url
        if self.messenger_login is not None:
            out["messengerLogin"] = self.messenger_login
        return out

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> AuthTicketPayload:
        return cls(
            messenger=data["messenger"],
            messenger_id=data["messengerId"],
            display_name=data["displayName"],
            photo_url=data.get("photoUrl"),
            messenger_login=data.get("messengerLogin"),
            purpose=data.get("purpose", "guest"),
        )


@dataclass
class LoginLinkPayload:
    """What a one-time login link resolves to once consumed. `next` is
    stored with the token (not in the URL) so the redirect target cannot
    be rewritten by whoever holds the link."""

    organizer_id: str
    next: str

    def to_json(self) -> dict[str, Any]:
        return {"organizerId": self.organizer_id, "next": self.next}

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> LoginLinkPayload:
        return cls(organizer_id=data["organizerId"], next=data["next"])
