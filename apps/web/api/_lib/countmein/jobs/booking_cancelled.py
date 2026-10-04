"""booking.cancelled — tell the *other* party that a booking was
cancelled: the actor already saw the result on screen, so only the
counterparty is notified; the job records who cancelled and the
recipient is derived from it."""

from __future__ import annotations

from ..contracts import domain
from ..contracts import models_gen as gen
from ..contracts.constants_gen import QUEUE_BOOKING_CANCELLED
from ._notify import load_chain, notify_guest, notify_organizer
from .env import Env
from .links import organizer_page_url
from .templates import booking_cancelled_for_guest, booking_cancelled_for_organizer


async def handle_booking_cancelled(env: Env, job: gen.BookingCancelledJob, trace_id: str) -> None:
    chain = await load_chain(QUEUE_BOOKING_CANCELLED, str(job.bookingId), trace_id)
    if chain is None:
        return
    recipient = domain.cancel_notification_recipient(str(job.cancelledBy))
    if recipient == "organizer":
        await notify_organizer(env, chain, booking_cancelled_for_organizer)
        return
    await notify_guest(
        env,
        chain,
        organizer_page_url(env.app_url, chain.organizer.slug),
        booking_cancelled_for_guest,
    )
