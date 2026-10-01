"""Internal routes: service-to-service calls between Next.js and Python API."""

from __future__ import annotations

from uuid import UUID

from fastapi import Depends
from starlette.requests import Request
from starlette.responses import Response as StarletteResponse

from ..contracts import models_gen as gen
from ..db.client import sessionmaker
from ..errors import InvalidInput, OrganizerNotFound
from ..repositories import organizer_repo
from ..validation.decode import decode_internal_organizer_lookup_input
from ..web.deps import ValidatedBody, decoded, require_internal_secret
from ..web.response import json_response

_lookup_dep = decoded(decode_internal_organizer_lookup_input)


async def organizer_by_messenger(
    request: Request,
    _authorized: None = Depends(require_internal_secret),
    body: ValidatedBody[gen.InternalOrganizerLookupInput] = Depends(_lookup_dep),
) -> StarletteResponse:
    """POST /api/internal/auth/organizer-by-messenger: look up organizer for Auth.js."""
    payload = body.model
    if not payload.organizerId and not (payload.messenger and payload.messengerId):
        raise InvalidInput("Lookup criteria (organizerId or messenger + messengerId) required")

    async with sessionmaker()() as session:
        organizer = None
        if payload.organizerId:
            organizer = await organizer_repo.get_by_id(session, str(payload.organizerId))
        elif payload.messenger and payload.messengerId:
            organizer = await organizer_repo.get_by_messenger(
                session, str(payload.messenger), str(payload.messengerId)
            )

        if organizer is None:
            raise OrganizerNotFound()

        org_id = organizer.id if isinstance(organizer.id, UUID) else UUID(str(organizer.id))
        record = gen.InternalOrganizerRecord(
            id=org_id,
            name=str(organizer.name),
            slug=str(organizer.slug),
            photoUrl=organizer.photo_url,
        )
        return json_response(200, gen.InternalOrganizerEnvelope(organizer=record)).to_starlette()
