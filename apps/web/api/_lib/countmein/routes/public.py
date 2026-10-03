"""Public routes: visitor-facing catalog reads."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import Response as StarletteResponse

from ..contracts import models_gen as gen
from ..db.rows import (
    from_model_organizer,
    from_model_service,
    from_model_slot,
)
from ..db.serializers import (
    to_public_organizer,
    to_service_record,
    to_time_slot_record,
)
from ..errors import OrganizerNotFound, ServiceNotFound
from ..repositories import organizer_repo, service_repo, slot_repo
from ..services.slot_service import SLOT_HORIZON
from ..web.deps import get_db_session, ip_rate_limit
from ..web.response import json_response

# Defensive bounds on the public envelopes: no pagination, so a runaway
# organizer (hundreds of services x thousands of slots) must not turn one
# page render into an unbounded query and a multi-MB payload. The caps
# sit far above any realistic catalog — past them the view truncates,
# not fails.
_PUBLIC_SERVICES_LIMIT = 200
_PUBLIC_SLOTS_LIMIT = 500


async def get_public_organizer(
    slug: str,
    _limited: None = Depends(ip_rate_limit("rl:public-org:", 60, 60.0)),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """GET /api/public/organizers/{slug}: public organizer profile, services,
    and upcoming slots."""
    organizer = await organizer_repo.get_by_slug(session, slug)
    if organizer is None:
        raise OrganizerNotFound()

    services = await service_repo.list_by_organizer(
        session, str(organizer.id), limit=_PUBLIC_SERVICES_LIMIT
    )
    service_ids = [str(s.id) for s in services]
    now = datetime.now(UTC)
    slots = (
        await slot_repo.list_upcoming_by_services(
            session,
            service_ids,
            now,
            until_time=now + SLOT_HORIZON,
            limit=_PUBLIC_SLOTS_LIMIT,
        )
        if service_ids
        else []
    )

    view = gen.PublicOrganizerViewEnvelope(
        organizer=to_public_organizer(from_model_organizer(organizer)),
        services=[to_service_record(from_model_service(s)) for s in services],
        slots=[to_time_slot_record(from_model_slot(slot)) for slot in slots],
    )
    return json_response(200, view).to_starlette()


async def get_public_service(
    id: str,
    _limited: None = Depends(ip_rate_limit("rl:public-srv:", 60, 60.0)),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """GET /api/public/services/{id}: public service details, parent organizer,
    and upcoming slots."""
    models = await service_repo.get_service_with_organizer(session, id)
    if models is None:
        raise ServiceNotFound()
    service_model, organizer_model = models

    now = datetime.now(UTC)
    slots = await slot_repo.list_upcoming_by_services(
        session,
        [str(service_model.id)],
        now,
        until_time=now + SLOT_HORIZON,
        limit=_PUBLIC_SLOTS_LIMIT,
    )

    view = gen.PublicServiceViewEnvelope(
        service=to_service_record(from_model_service(service_model)),
        organizer=to_public_organizer(from_model_organizer(organizer_model)),
        slots=[to_time_slot_record(from_model_slot(slot)) for slot in slots],
    )
    return json_response(200, view).to_starlette()


async def get_public_sitemap(
    _limited: None = Depends(ip_rate_limit("rl:public-sitemap:", 10, 60.0)),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """GET /api/public/sitemap: all public organizer slugs and service IDs."""
    slugs = await organizer_repo.list_public_slugs(session)
    service_paths = await service_repo.list_public_service_paths(session)

    envelope = gen.PublicSitemapEnvelope(
        organizers=[gen.SitemapOrganizerEntry(slug=slug) for slug in slugs],
        services=[
            gen.SitemapServiceEntry(orgSlug=org_slug, serviceId=srv_id)
            for org_slug, srv_id in service_paths
        ],
    )
    return json_response(200, envelope).to_starlette()
