"""Organizer input decoders, including the merged-state
decoder the PUT handler runs over current+patch (ADR-016), plus the
Telegram widget payload decoder (an organizer-flow input)."""

from __future__ import annotations

from ...contracts import models_gen as gen
from ...contracts.models import unwrap_root
from ...errors import ValidationFailed
from ..errors import Errors
from ..refine import refine_organizer_merged_state
from ..rules import is_reserved_slug, timezone_rule, url_rule
from .core import _finish, _raw, _validate_model


def decode_register_organizer_input(body: bytes) -> gen.RegisterOrganizerInput:
    m = _raw(body)
    from ..errors import lower_key, trim_key

    trim_key(m, "slug")
    lower_key(m, "slug")
    trim_key(m, "name")
    trim_key(m, "contact")
    out, errs = _validate_model(gen.RegisterOrganizerInput, m, "RegisterOrganizerInput")
    if errs is not None:
        raise ValidationFailed(errs, issues=True)
    if out is None:
        raise RuntimeError("out is None after its error guard")
    e = Errors()
    msg = timezone_rule(str(unwrap_root(out.timezone)))
    if msg:
        e.add("timezone", msg)
    if is_reserved_slug(str(unwrap_root(out.slug))):
        e.add("slug", "this slug is reserved for system use — please choose another")
    return _finish(out, e, issues=True)


def decode_update_organizer_profile_input(body: bytes) -> gen.UpdateOrganizerProfileInput:
    m = _raw(body)
    from ..errors import lower_key, trim_key

    trim_key(m, "slug")
    lower_key(m, "slug")
    for key in ("name", "description", "location", "contact"):
        trim_key(m, key)
    out, errs = _validate_model(gen.UpdateOrganizerProfileInput, m, "UpdateOrganizerProfileInput")
    if errs is not None:
        raise ValidationFailed(errs)
    if out is None:
        raise RuntimeError("out is None after its error guard")
    e = Errors()
    if out.timezone is not None:
        msg = timezone_rule(str(unwrap_root(out.timezone)))
        if msg:
            e.add("timezone", msg)
    if out.slug is not None and is_reserved_slug(str(unwrap_root(out.slug))):
        e.add("slug", "this slug is reserved for system use — please choose another")
    if out.photoUrl is not None:
        msg = url_rule(str(unwrap_root(out.photoUrl)))
        if msg:
            e.add("photoUrl", msg)
    return _finish(out, e)


def decode_update_organizer_language_input(body: bytes) -> gen.UpdateOrganizerLanguageInput:
    m = _raw(body)
    out, errs = _validate_model(gen.UpdateOrganizerLanguageInput, m, "UpdateOrganizerLanguageInput")
    if errs is not None:
        raise ValidationFailed(errs)
    if out is None:
        raise RuntimeError("out is None after its error guard")
    return out


def decode_create_avatar_upload_input(body: bytes) -> gen.CreateAvatarUploadInput:
    m = _raw(body)
    out, errs = _validate_model(gen.CreateAvatarUploadInput, m, "CreateAvatarUploadInput")
    if errs is not None:
        raise ValidationFailed(errs)
    if out is None:
        raise RuntimeError("out is None after its error guard")
    return out


def decode_create_service_photo_upload_input(body: bytes) -> gen.CreateServicePhotoUploadInput:
    m = _raw(body)
    out, errs = _validate_model(
        gen.CreateServicePhotoUploadInput, m, "CreateServicePhotoUploadInput"
    )
    if errs is not None:
        raise ValidationFailed(errs)
    if out is None:
        raise RuntimeError("out is None after its error guard")
    return out


def decode_merged_organizer_input(merged: bytes) -> gen.UpdateOrganizerProfileInput:
    m = _raw(merged)
    from ..errors import lower_key, trim_key

    trim_key(m, "slug")
    lower_key(m, "slug")
    for key in ("name", "description", "location", "contact"):
        trim_key(m, key)
    out, errs = _validate_model(gen.UpdateOrganizerProfileInput, m, "UpdateOrganizerProfileInput")
    if errs is not None:
        raise ValidationFailed(errs)
    if out is None:
        raise RuntimeError("out is None after its error guard")
    e = Errors()
    refine_organizer_merged_state(e, out)
    if out.timezone is not None:
        msg = timezone_rule(str(unwrap_root(out.timezone)))
        if msg:
            e.add("timezone", msg)
    if out.slug is not None and is_reserved_slug(str(unwrap_root(out.slug))):
        e.add("slug", "this slug is reserved for system use — please choose another")
    if out.photoUrl is not None:
        msg = url_rule(str(unwrap_root(out.photoUrl)))
        if msg:
            e.add("photoUrl", msg)
    return _finish(out, e)


def decode_telegram_widget_payload(body: bytes) -> gen.TelegramWidgetPayload:
    m = _raw(body)
    out, errs = _validate_model(gen.TelegramWidgetPayload, m, "TelegramWidgetPayload")
    if errs is not None:
        raise ValidationFailed(errs)
    if out is None:
        raise RuntimeError("out is None after its error guard")
    e = Errors()
    if out.photo_url is not None:
        msg = url_rule(str(unwrap_root(out.photo_url)))
        if msg:
            e.add("photo_url", msg)
    return _finish(out, e)
