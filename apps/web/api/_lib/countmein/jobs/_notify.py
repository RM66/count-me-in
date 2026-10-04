"""The shared skeleton of the booking notification handlers.

booking.created and booking.cancelled differ only in the recipient
rule, the template pair and the guest URL — the rest (fresh chain read
at send time, the "gone booking" and demo refusals, mint-per-attempt
login links, the recipient's own locale) is one code path, kept here so
the two handlers cannot drift.
"""

from __future__ import annotations

from collections.abc import Callable

from .. import logx
from ..auth import issue_login_link
from ..contracts import domain
from ..db.client import sessionmaker
from ..repositories import booking_repo
from ..repositories.booking_repo import BookingChain
from .env import Env
from .links import cabinet_slot_path, login_link_url
from .telegram import send_message
from .templates import Message, notification_locale

Render = Callable[[BookingChain, str, str], Message]


def _skip(queue: str, booking_id: str, trace_id: str, msg: str) -> None:
    fields: dict[str, str] = {"queue": queue, "bookingId": booking_id}
    if trace_id != "":
        fields["traceId"] = trace_id
    logx.info(msg, fields)


async def load_chain(queue: str, booking_id: str, trace_id: str) -> BookingChain | None:
    """The booking's ownership chain, read fresh at send time — a job
    that waited out a retry backoff renders the booking as it is now,
    not at commit time. None (a silent skip) when the booking is gone —
    a retry arriving after the row was deleted must not fail the
    delivery — or when it hangs off the demo organizer, whose bookings
    never reach a chat (ADR-010)."""
    async with sessionmaker()() as session:
        chain = await booking_repo.get_booking_chain_by_id(session, booking_id)
    if chain is None:
        _skip(queue, booking_id, trace_id, "booking no longer exists — skipping")
        return None
    if domain.is_demo_organizer_id(chain.organizer.id):
        _skip(queue, booking_id, trace_id, "refusing to notify the demo organizer")
        return None
    return chain


async def notify_organizer(env: Env, chain: BookingChain, render: Render) -> None:
    """Send to the organizer's chat. The deep link is minted per send
    attempt — a retry mints a fresh token and the abandoned one
    expires, so a delivered message never carries a button spent by an
    earlier attempt."""
    token = await issue_login_link(chain.organizer.id, cabinet_slot_path(chain.slot.id))
    message = render(
        chain,
        login_link_url(env.app_url, token),
        notification_locale("organizer", chain),
    )
    await send_message(
        env.telegram_bot_token, chain.organizer.messenger_id, message.text, message.button
    )


async def notify_guest(env: Env, chain: BookingChain, url: str, render: Render) -> None:
    """Send to the guest's captured messenger identity."""
    message = render(chain, url, notification_locale("guest", chain))
    await send_message(
        env.telegram_bot_token, chain.booking.guest_messenger_id, message.text, message.button
    )
