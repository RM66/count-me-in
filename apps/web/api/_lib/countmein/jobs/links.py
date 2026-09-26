"""Every URL that appears in a notification. Each one encodes a routing
decision from docs/pages.md that should not be re-derived by hand in
each template."""

from __future__ import annotations

from urllib.parse import quote


def cabinet_slot_path(time_slot_id: str) -> str:
    """Cabinet bookings, filtered to one slot. Relative on purpose: this
    is the `next` stored inside a login-link payload, and the redirect
    happens after the session is established."""
    return "/cabinet/bookings?slot=" + quote(time_slot_id, safe="")


def login_link_url(app_url: str, token: str) -> str:
    """The one-time login link that establishes a session and then opens
    `next`."""
    return app_url + "/login/link/" + quote(token, safe="")


def manage_booking_url(app_url: str, manage_token: str) -> str:
    """The guest's booking management page; their manageToken is the
    credential."""
    return app_url + "/booking/" + quote(manage_token, safe="")


def organizer_page_url(app_url: str, slug: str) -> str:
    """The organizer's public page, offered to a cancelled guest as a
    way to rebook."""
    return app_url + "/" + quote(slug, safe="")
