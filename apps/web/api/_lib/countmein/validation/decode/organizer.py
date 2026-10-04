"""Organizer input decoders — wire and merged-state variants share the
rules-driven path; the merged variant adds mergedRequired (ADR-024 C2).
The merged decoders all take the patch's touched-key set so
apply_merge_patch can pass them unwrapped."""

from __future__ import annotations

from ...contracts import models_gen as gen
from .core import decode_input, decode_merged


def decode_register_organizer_input(body: bytes) -> gen.RegisterOrganizerInput:
    return decode_input(gen.RegisterOrganizerInput, body)


def decode_update_organizer_profile_input(body: bytes) -> gen.UpdateOrganizerProfileInput:
    return decode_input(gen.UpdateOrganizerProfileInput, body)


def decode_merged_organizer_input(
    merged: bytes, touched: frozenset[str]
) -> gen.UpdateOrganizerProfileInput:
    return decode_merged(gen.UpdateOrganizerProfileInput, merged)


def decode_update_organizer_language_input(body: bytes) -> gen.UpdateOrganizerLanguageInput:
    return decode_input(gen.UpdateOrganizerLanguageInput, body)


def decode_create_avatar_upload_input(body: bytes) -> gen.CreateAvatarUploadInput:
    return decode_input(gen.CreateAvatarUploadInput, body)


def decode_create_service_photo_upload_input(body: bytes) -> gen.CreateServicePhotoUploadInput:
    return decode_input(gen.CreateServicePhotoUploadInput, body)


def decode_telegram_widget_payload(body: bytes) -> gen.TelegramWidgetPayload:
    return decode_input(gen.TelegramWidgetPayload, body)


def decode_internal_organizer_lookup_input(body: bytes) -> gen.InternalOrganizerLookupInput:
    return decode_input(gen.InternalOrganizerLookupInput, body)
