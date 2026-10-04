"""booking.created — tell one recipient that a booking exists. One job
per recipient (see contracts/jobs), so this handler always sends exactly
one message and a retry re-sends only to the party that failed. Reached
as a QStash delivery to POST /api/jobs/booking.created; the dispatch
layer (run.py) has already validated the payload."""

from __future__ import annotations

from ..contracts import models_gen as gen
from ..contracts.constants_gen import QUEUE_BOOKING_CREATED
from ._notify import load_chain, notify_guest, notify_organizer
from .env import Env
from .links import manage_booking_url
from .templates import booking_created_for_guest, booking_created_for_organizer


async def handle_booking_created(env: Env, job: gen.BookingCreatedJob, trace_id: str) -> None:
    """Notify one recipient about a fresh booking. PostHog captures from
    the TS handler are not ported (no SDK in the dependency set);
    delivery logging covers the remainder."""
    chain = await load_chain(QUEUE_BOOKING_CREATED, str(job.bookingId), trace_id)
    if chain is None:
        return
    if str(job.recipient) == "organizer":
        await notify_organizer(env, chain, booking_created_for_organizer)
        return
    await notify_guest(
        env,
        chain,
        manage_booking_url(env.app_url, chain.booking.manage_token),
        booking_created_for_guest,
    )
