"""Public routes: visitor-facing catalog reads."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import Depends
from starlette.requests import Request
from starlette.responses import Response as StarletteResponse

from ..contracts import models_gen as gen
from ..db.client import sessionmaker
from ..db.rows import (
    from_model_organizer,
    from_model_service,
    from_model_slot,
    to_public_organizer,
    to_service_record,
    to_time_slot_record,
)
from ..errors import OrganizerNotFound, ServiceNotFound
from ..repositories import organizer_repo, service_repo, slot_repo
from ..web.deps import ip_rate_limit
from ..web.response import json_response


async def get_public_organizer(
    request: Request,
    slug: str,
    _limited: None = Depends(ip_rate_limit("rl:public-org:", 60, 60.0)),
) -> StarletteResponse:
    """GET /api/public/organizers/{slug}: public organizer profile, services,
    and upcoming slots."""
    async with sessionmaker()() as session:
        organizer = await organizer_repo.get_by_slug(session, slug)
        if organizer is None:
            raise OrganizerNotFound()

        services = await service_repo.list_by_organizer(session, str(organizer.id))
        service_ids = [str(s.id) for s in services]
        slots = (
            await slot_repo.list_upcoming_by_services(session, service_ids, datetime.now(UTC))
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
    request: Request,
    id: str,
    _limited: None = Depends(ip_rate_limit("rl:public-srv:", 60, 60.0)),
) -> StarletteResponse:
    """GET /api/public/services/{id}: public service details, parent organizer,
    and upcoming slots."""
    async with sessionmaker()() as session:
        models = await service_repo.get_service_with_organizer(session, id)
        if models is None:
            raise ServiceNotFound()
        service_model, organizer_model = models

        slots = await slot_repo.list_upcoming_by_services(
            session, [str(service_model.id)], datetime.now(UTC)
        )

        view = gen.PublicServiceViewEnvelope(
            service=to_service_record(from_model_service(service_model)),
            organizer=to_public_organizer(from_model_organizer(organizer_model)),
            slots=[to_time_slot_record(from_model_slot(slot)) for slot in slots],
        )
        return json_response(200, view).to_starlette()


async def get_public_sitemap(
    request: Request,
    _limited: None = Depends(ip_rate_limit("rl:public-sitemap:", 10, 60.0)),
) -> StarletteResponse:
    """GET /api/public/sitemap: all public organizer slugs and service IDs."""
    async with sessionmaker()() as session:
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
