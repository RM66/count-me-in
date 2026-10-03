"""Route registration: every operation from the spec plus /api/healthz.

The path/method set must equal openapi.yaml (pinned by
tests_py/test_route_set.py). Handlers return plain Starlette responses
built through the shared web layer — FastAPI's own validation and
serialization are bypassed so the wire bytes stay exactly what the frozen goldens pin."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import FastAPI


def _route(app: FastAPI, path: str, method: str, handler: Callable[..., Awaitable[Any]]) -> None:
    """One spec route. response_model=None is baked in — handlers return
    fully built Starlette Responses and bypass FastAPI's validation, so
    FastAPI must not infer a model from a TYPE_CHECKING-only return
    annotation it cannot resolve at openapi() time."""
    app.add_api_route(path, handler, methods=[method], response_model=None)


def register_routes(app: FastAPI) -> None:
    from .auth import telegram_guest, telegram_signup
    from .bookings import (
        booking_cancel,
        booking_cancel_by_organizer,
        booking_create,
        booking_lookup,
        booking_manage_lookup,
        bookings_list,
    )
    from .cabinet import cabinet_summary
    from .healthz import register_healthz
    from .internal import organizer_by_messenger
    from .jobs import jobs_receiver
    from .organizers import (
        organizer_avatar,
        organizer_me_get,
        organizer_me_language,
        organizer_me_patch,
        organizer_register,
        organizer_service_photo,
    )
    from .public import (
        get_public_organizer,
        get_public_service,
        get_public_sitemap,
    )
    from .services import (
        service_delete,
        service_get,
        service_patch,
        services_create,
        services_list,
    )
    from .slots import slot_delete, slot_get, slot_patch, slots_create, slots_list

    # /api/healthz is infrastructure, not a contract endpoint — lives
    # here, not in the spec.
    register_healthz(app)

    # Auth (ADR-002, ADR-008)
    _route(app, "/api/auth/telegram-guest", "POST", telegram_guest)
    _route(app, "/api/auth/telegram-signup", "POST", telegram_signup)

    # Public
    _route(app, "/api/public/organizers/{slug}", "GET", get_public_organizer)
    _route(app, "/api/public/services/{id}", "GET", get_public_service)
    _route(app, "/api/public/sitemap", "GET", get_public_sitemap)

    # Organizers
    _route(app, "/api/organizers", "POST", organizer_register)
    _route(app, "/api/organizers/me", "GET", organizer_me_get)
    _route(app, "/api/organizers/me", "PATCH", organizer_me_patch)
    _route(app, "/api/organizers/me/language", "PATCH", organizer_me_language)
    _route(app, "/api/organizers/me/avatar", "POST", organizer_avatar)
    _route(app, "/api/organizers/me/service-photo", "POST", organizer_service_photo)

    # Cabinet
    _route(app, "/api/cabinet/summary", "GET", cabinet_summary)

    # Services
    _route(app, "/api/services", "GET", services_list)
    _route(app, "/api/services", "POST", services_create)
    _route(app, "/api/services/{id}", "GET", service_get)
    _route(app, "/api/services/{id}", "PATCH", service_patch)
    _route(app, "/api/services/{id}", "DELETE", service_delete)

    # Time slots
    _route(app, "/api/slots", "GET", slots_list)
    _route(app, "/api/slots", "POST", slots_create)
    _route(app, "/api/slots/{id}", "GET", slot_get)
    _route(app, "/api/slots/{id}", "PATCH", slot_patch)
    _route(app, "/api/slots/{id}", "DELETE", slot_delete)

    # Bookings (ADR-002)
    _route(app, "/api/bookings", "GET", bookings_list)
    _route(app, "/api/bookings", "POST", booking_create)
    _route(app, "/api/bookings/lookup", "POST", booking_lookup)
    _route(app, "/api/bookings/cancel", "POST", booking_cancel)
    _route(app, "/api/bookings/manage-lookup", "POST", booking_manage_lookup)
    _route(app, "/api/bookings/cancel-by-organizer", "POST", booking_cancel_by_organizer)

    # QStash receiver (ADR-012)
    _route(app, "/api/jobs/{queue}", "POST", jobs_receiver)

    # Internal (Auth.js BFF)
    _route(app, "/api/internal/auth/organizer-by-messenger", "POST", organizer_by_messenger)
