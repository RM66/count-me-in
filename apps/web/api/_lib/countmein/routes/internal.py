"""Internal routes: service-to-service calls between Next.js and Python API."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import Response as StarletteResponse

from ..contracts import models_gen as gen
from ..errors import InvalidInput, OrganizerNotFound
from ..repositories import organizer_repo
from ..validation.decode import decode_internal_organizer_lookup_input
from ..web.deps import (
    ValidatedBody,
    decoded,
    get_db_session,
    require_internal_secret,
)
from ..web.response import json_response

_lookup_dep = decoded(decode_internal_organizer_lookup_input)


async def organizer_by_messenger(
    _authorized: None = Depends(require_internal_secret),
    body: ValidatedBody[gen.InternalOrganizerLookupInput] = Depends(_lookup_dep),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """POST /api/internal/auth/organizer-by-messenger: look up organizer for Auth.js."""
    payload = body.model
    if not payload.organizerId and not (payload.messenger and payload.messengerId):
        raise InvalidInput("Lookup criteria (organizerId or messenger + messengerId) required")

    organizer = None
    if payload.organizerId:
        organizer = await organizer_repo.get_by_id(session, str(payload.organizerId))
    elif payload.messenger and payload.messengerId:
        organizer = await organizer_repo.get_by_messenger(
            session, str(payload.messenger), str(payload.messengerId)
        )

    if organizer is None:
        raise OrganizerNotFound()

    # model_construct, like the db/serializers mappers: the generated
    # UUID field's pattern constraint makes the validating constructor
    # raise TypeError on a coerced UUID.
    record = gen.InternalOrganizerRecord.model_construct(
        id=organizer.id,
        name=organizer.name,
        slug=organizer.slug,
        photoUrl=organizer.photo_url,
    )
    envelope = gen.InternalOrganizerEnvelope.model_construct(organizer=record)
    return json_response(200, envelope)
