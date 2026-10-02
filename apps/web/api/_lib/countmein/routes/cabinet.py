"""Cabinet summary and analytics routes."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request
from starlette.responses import Response as StarletteResponse

from ..contracts import models_gen as gen
from ..repositories import booking_repo, service_repo, slot_repo
from ..web.deps import cabinet_organizer, get_db_session
from ..web.response import json_response


async def cabinet_summary(
    request: Request,
    scope: tuple[str, bool] = Depends(cabinet_organizer),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """GET /api/cabinet/summary: aggregated counts and 30-day analytics."""
    organizer_id, _is_demo = scope
    now = datetime.now(UTC)
    window_start = now - timedelta(days=30)
    prev_window_start = window_start - timedelta(days=30)
    trend_start = now - timedelta(days=14)

    services = await service_repo.list_by_organizer(session, organizer_id)
    service_ids = [str(s.id) for s in services]

    # Service-level counts
    upcoming_slot_counts = (
        await slot_repo.count_upcoming_by_services(session, service_ids, now) if service_ids else {}
    )
    confirmed_booking_counts = (
        await booking_repo.count_confirmed_by_services(session, service_ids) if service_ids else {}
    )

    service_counts = [
        gen.ServiceCountsRecord(
            serviceId=s_id,
            upcomingSlotsCount=upcoming_slot_counts.get(s_id, 0),
            confirmedBookingsCount=confirmed_booking_counts.get(s_id, 0),
        )
        for s_id in service_ids
    ]

    # Analytics
    headline = await booking_repo.get_analytics_summary(
        session,
        organizer_id,
        window_start=window_start,
        prev_window_start=prev_window_start,
        trend_start=trend_start,
    )
    by_service = await booking_repo.analytics_by_service(
        session, organizer_id, window_start=window_start
    )
    trend = await booking_repo.analytics_trend(session, organizer_id, trend_start=trend_start)

    analytics = gen.AnalyticsSummaryRecord(
        totalBookings=headline["total_bookings"],
        prevTotalBookings=headline["prev_total_bookings"],
        seatsSold=headline["seats_sold"],
        prevSeatsSold=headline["prev_seats_sold"],
        windowBookings=headline["window_bookings"],
        cancelledInWindow=headline["cancelled_in_window"],
        trend=[
            gen.AnalyticsTrendDay(
                day=day.strftime("%Y-%m-%d"),
                bookings=b_cnt,
                seats=s_cnt,
            )
            for day, b_cnt, s_cnt in trend
        ],
        byService=[
            gen.AnalyticsServiceCount(service=title, bookings=cnt) for title, cnt in by_service
        ],
    )

    envelope = gen.CabinetSummaryEnvelope(
        serviceCounts=service_counts,
        analytics=analytics,
    )
    return json_response(200, envelope).to_starlette()
