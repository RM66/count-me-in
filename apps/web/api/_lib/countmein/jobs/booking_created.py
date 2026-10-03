"""booking.created — tell one recipient that a booking exists. One job
per recipient (see contracts/jobs), so this handler always sends exactly
one message and a retry re-sends only to the party that failed. Reached
as a QStash delivery to POST /api/jobs/booking.created; the dispatch
layer (run.py) has already validated the payload."""

from __future__ import annotations

from .. import logx
from ..auth import issue_login_link
from ..contracts import domain
from ..contracts import models_gen as gen
from ..contracts.constants_gen import QUEUE_BOOKING_CREATED
from ..db.client import sessionmaker
from ..services.booking_service import get_booking_chain
from .env import Env
from .links import cabinet_slot_path, login_link_url, manage_booking_url
from .telegram import send_message
from .templates import (
    BookingView,
    booking_created_for_guest,
    booking_created_for_organizer,
    notification_locale,
)


async def handle_booking_created(env: Env, job: gen.BookingCreatedJob, trace_id: str) -> None:
    """Notify one recipient about a fresh booking. PostHog captures from
    the TS handler are not ported (no SDK in the dependency set);
    delivery logging covers the remainder."""
    # Worker context, not a request — the handler owns its session.
    async with sessionmaker()() as session:
        chain = await get_booking_chain(session, str(job.bookingId))
    # A fresh read at send time: a job that waited out a retry backoff
    # renders the booking as it is now, not at commit time.
    if chain is None:
        fields = {"queue": QUEUE_BOOKING_CREATED, "bookingId": str(job.bookingId)}
        if trace_id != "":
            fields["traceId"] = trace_id
        logx.info("booking no longer exists — skipping", fields)
        return
    booking, slot, service, organizer = chain
    view = BookingView(booking=booking, slot=slot, service=service, organizer=organizer)

    # Demo bookings never reach a chat (ADR-010).
    if domain.is_demo_organizer_id(organizer.id):
        fields = {"queue": QUEUE_BOOKING_CREATED, "bookingId": str(job.bookingId)}
        if trace_id != "":
            fields["traceId"] = trace_id
        logx.info("refusing to notify the demo organizer", fields)
        return

    if str(job.recipient) == "organizer":
        # Minted per send attempt — a retry mints a fresh token and the
        # abandoned one expires, so a delivered message never carries a
        # button spent by an earlier attempt.
        token = await issue_login_link(organizer.id, cabinet_slot_path(slot.id))
        locale = notification_locale("organizer", view)
        message = booking_created_for_organizer(view, login_link_url(env.app_url, token), locale)
        await send_message(
            env.telegram_bot_token, organizer.messenger_id, message.text, message.button
        )
        return

    locale = notification_locale("guest", view)
    message = booking_created_for_guest(
        view, manage_booking_url(env.app_url, booking.manage_token), locale
    )
    await send_message(
        env.telegram_bot_token, booking.guest_messenger_id, message.text, message.button
    )
