"""Route registration: every operation from the spec plus /api/healthz.

The path/method set must equal openapi.yaml (pinned by
tests_py/test_route_set.py). Handlers return plain Starlette responses
built through the shared web layer — FastAPI's own validation and
serialization are bypassed so the wire bytes stay exactly what the frozen goldens pin."""

from __future__ import annotations

from fastapi import FastAPI


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

    # /api/healthz is infrastructure, not a contract endpoint, so it
    # lives here instead of the spec.
    register_healthz(app)

    # response_model=None on every route: the handlers return a fully
    # built Starlette Response and deliberately bypass FastAPI's
    # validation layer, so FastAPI must not infer a response model from
    # the return annotation (a TYPE_CHECKING-only import that cannot be
    # resolved at openapi() time).

    # Auth (ADR-002, ADR-008)
    app.add_api_route(
        "/api/auth/telegram-guest", telegram_guest, methods=["POST"], response_model=None
    )
    app.add_api_route(
        "/api/auth/telegram-signup", telegram_signup, methods=["POST"], response_model=None
    )

    # Public
    app.add_api_route(
        "/api/public/organizers/{slug}",
        get_public_organizer,
        methods=["GET"],
        response_model=None,
    )
    app.add_api_route(
        "/api/public/services/{id}",
        get_public_service,
        methods=["GET"],
        response_model=None,
    )
    app.add_api_route(
        "/api/public/sitemap",
        get_public_sitemap,
        methods=["GET"],
        response_model=None,
    )

    # Organizers
    app.add_api_route("/api/organizers", organizer_register, methods=["POST"], response_model=None)
    app.add_api_route("/api/organizers/me", organizer_me_get, methods=["GET"], response_model=None)
    app.add_api_route(
        "/api/organizers/me", organizer_me_patch, methods=["PATCH"], response_model=None
    )
    app.add_api_route(
        "/api/organizers/me/language", organizer_me_language, methods=["PATCH"], response_model=None
    )
    app.add_api_route(
        "/api/organizers/me/avatar", organizer_avatar, methods=["POST"], response_model=None
    )
    app.add_api_route(
        "/api/organizers/me/service-photo",
        organizer_service_photo,
        methods=["POST"],
        response_model=None,
    )

    # Cabinet
    app.add_api_route("/api/cabinet/summary", cabinet_summary, methods=["GET"], response_model=None)

    # Services
    app.add_api_route("/api/services", services_list, methods=["GET"], response_model=None)
    app.add_api_route("/api/services", services_create, methods=["POST"], response_model=None)
    app.add_api_route("/api/services/{id}", service_get, methods=["GET"], response_model=None)
    app.add_api_route("/api/services/{id}", service_patch, methods=["PATCH"], response_model=None)
    app.add_api_route("/api/services/{id}", service_delete, methods=["DELETE"], response_model=None)

    # Time slots
    app.add_api_route("/api/slots", slots_list, methods=["GET"], response_model=None)
    app.add_api_route("/api/slots", slots_create, methods=["POST"], response_model=None)
    app.add_api_route("/api/slots/{id}", slot_get, methods=["GET"], response_model=None)
    app.add_api_route("/api/slots/{id}", slot_patch, methods=["PATCH"], response_model=None)
    app.add_api_route("/api/slots/{id}", slot_delete, methods=["DELETE"], response_model=None)

    # Bookings (ADR-002)
    app.add_api_route("/api/bookings", bookings_list, methods=["GET"], response_model=None)
    app.add_api_route("/api/bookings", booking_create, methods=["POST"], response_model=None)
    app.add_api_route("/api/bookings/lookup", booking_lookup, methods=["POST"], response_model=None)
    app.add_api_route("/api/bookings/cancel", booking_cancel, methods=["POST"], response_model=None)
    app.add_api_route(
        "/api/bookings/manage-lookup", booking_manage_lookup, methods=["POST"], response_model=None
    )
    app.add_api_route(
        "/api/bookings/cancel-by-organizer",
        booking_cancel_by_organizer,
        methods=["POST"],
        response_model=None,
    )

    # QStash receiver (ADR-012)
    app.add_api_route("/api/jobs/{queue}", jobs_receiver, methods=["POST"], response_model=None)

    # Internal (Auth.js BFF)
    app.add_api_route(
        "/api/internal/auth/organizer-by-messenger",
        organizer_by_messenger,
        methods=["POST"],
        response_model=None,
    )
