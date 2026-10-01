"""Organizer input decoders, including the merged-state
decoder the PUT handler runs over current+patch (ADR-016), plus the
Telegram widget payload decoder (an organizer-flow input)."""

from __future__ import annotations

from typing import Any

from ...contracts import models_gen as gen
from ..errors import Errors
from ..refine import refine_organizer_merged_state
from ..rules import is_reserved_slug, timezone_rule, url_rule
from ..transforms import lower_key, trim_key
from .core import _decode_model, _finish, _raw


def decode_register_organizer_input(body: bytes) -> gen.RegisterOrganizerInput:
    m = _raw(body)
    trim_key(m, "slug")
    lower_key(m, "slug")
    trim_key(m, "name")
    trim_key(m, "contact")
    out = _decode_model(gen.RegisterOrganizerInput, m, "RegisterOrganizerInput")
    e = Errors()
    msg = timezone_rule(str(out.timezone))
    if msg:
        e.add("timezone", msg)
    if is_reserved_slug(str(out.slug)):
        e.add("slug", "this slug is reserved for system use — please choose another")
    return _finish(out, e)


def _decode_organizer_profile(
    m: dict[str, Any], *, merged: bool
) -> gen.UpdateOrganizerProfileInput:
    """The one organizer-profile decoder: the patch decoder and the
    merged-state decoder are the same function — trims, model
    validation, and the shared rules — with the merged variant adding
    the cross-field refinement over the final state."""
    trim_key(m, "slug")
    lower_key(m, "slug")
    for key in ("name", "description", "location", "contact"):
        trim_key(m, key)
    out = _decode_model(gen.UpdateOrganizerProfileInput, m, "UpdateOrganizerProfileInput")
    e = Errors()
    if merged:
        refine_organizer_merged_state(e, out)
    if out.timezone is not None:
        msg = timezone_rule(str(out.timezone))
        if msg:
            e.add("timezone", msg)
    if out.slug is not None and is_reserved_slug(str(out.slug)):
        e.add("slug", "this slug is reserved for system use — please choose another")
    if out.photoUrl is not None:
        msg = url_rule(str(out.photoUrl))
        if msg:
            e.add("photoUrl", msg)
    return _finish(out, e)


def decode_update_organizer_profile_input(body: bytes) -> gen.UpdateOrganizerProfileInput:
    return _decode_organizer_profile(_raw(body), merged=False)


def decode_merged_organizer_input(merged: bytes) -> gen.UpdateOrganizerProfileInput:
    return _decode_organizer_profile(_raw(merged), merged=True)


def decode_update_organizer_language_input(body: bytes) -> gen.UpdateOrganizerLanguageInput:
    return _decode_model(
        gen.UpdateOrganizerLanguageInput, _raw(body), "UpdateOrganizerLanguageInput"
    )


def decode_create_avatar_upload_input(body: bytes) -> gen.CreateAvatarUploadInput:
    return _decode_model(gen.CreateAvatarUploadInput, _raw(body), "CreateAvatarUploadInput")


def decode_create_service_photo_upload_input(body: bytes) -> gen.CreateServicePhotoUploadInput:
    return _decode_model(
        gen.CreateServicePhotoUploadInput, _raw(body), "CreateServicePhotoUploadInput"
    )


def decode_telegram_widget_payload(body: bytes) -> gen.TelegramWidgetPayload:
    out = _decode_model(gen.TelegramWidgetPayload, _raw(body), "TelegramWidgetPayload")
    e = Errors()
    if out.photo_url is not None:
        msg = url_rule(str(out.photo_url))
        if msg:
            e.add("photo_url", msg)
    return _finish(out, e)


def decode_internal_organizer_lookup_input(body: bytes) -> gen.InternalOrganizerLookupInput:
    return _decode_model(
        gen.InternalOrganizerLookupInput, _raw(body), "InternalOrganizerLookupInput"
    )
