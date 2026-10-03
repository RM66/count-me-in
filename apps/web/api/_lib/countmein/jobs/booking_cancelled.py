"""booking.cancelled — tell the *other* party that a booking was
cancelled: the actor already saw the result on screen, so only the
counterparty is notified; the job records who cancelled and the
recipient is derived from it."""

from __future__ import annotations

from .. import logx
from ..auth import issue_login_link
from ..contracts import domain
from ..contracts import models_gen as gen
from ..contracts.constants_gen import QUEUE_BOOKING_CANCELLED
from ..db.client import sessionmaker
from ..services.booking_service import get_booking_chain
from .env import Env
from .links import cabinet_slot_path, login_link_url, organizer_page_url
from .telegram import send_message
from .templates import (
    BookingView,
    booking_cancelled_for_guest,
    booking_cancelled_for_organizer,
    notification_locale,
)


async def handle_booking_cancelled(env: Env, job: gen.BookingCancelledJob, trace_id: str) -> None:
    # Worker context — the handler owns its session.
    async with sessionmaker()() as session:
        chain = await get_booking_chain(session, str(job.bookingId))
    if chain is None:
        fields = {"queue": QUEUE_BOOKING_CANCELLED, "bookingId": str(job.bookingId)}
        if trace_id != "":
            fields["traceId"] = trace_id
        logx.info("booking no longer exists — skipping", fields)
        return
    booking, slot, service, organizer = chain
    view = BookingView(booking=booking, slot=slot, service=service, organizer=organizer)

    if domain.is_demo_organizer_id(organizer.id):
        fields = {"queue": QUEUE_BOOKING_CANCELLED, "bookingId": str(job.bookingId)}
        if trace_id != "":
            fields["traceId"] = trace_id
        logx.info("refusing to notify the demo organizer", fields)
        return

    recipient = domain.cancel_notification_recipient(str(job.cancelledBy))

    if recipient == "organizer":
        token = await issue_login_link(organizer.id, cabinet_slot_path(slot.id))
        locale = notification_locale("organizer", view)
        message = booking_cancelled_for_organizer(view, login_link_url(env.app_url, token), locale)
        await send_message(
            env.telegram_bot_token, organizer.messenger_id, message.text, message.button
        )
        return

    locale = notification_locale("guest", view)
    message = booking_cancelled_for_guest(
        view, organizer_page_url(env.app_url, organizer.slug), locale
    )
    await send_message(
        env.telegram_bot_token, booking.guest_messenger_id, message.text, message.button
    )
