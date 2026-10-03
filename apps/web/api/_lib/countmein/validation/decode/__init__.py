"""Request-body decoders, split per entity: core holds the shared
validation skeleton; booking/service/slot/organizer hold the decode_*
functions. This package is the import surface — DECODERS dispatches the
parity vectors by wire id.
"""

from __future__ import annotations

from .booking import (
    decode_cancel_booking_by_organizer_input,
    decode_cancel_booking_by_token_input,
    decode_create_booking_input,
    decode_lookup_booking_by_token_input,
    decode_lookup_bookings_input,
)
from .organizer import (
    decode_create_avatar_upload_input,
    decode_create_service_photo_upload_input,
    decode_internal_organizer_lookup_input,
    decode_merged_organizer_input,
    decode_register_organizer_input,
    decode_telegram_widget_payload,
    decode_update_organizer_language_input,
    decode_update_organizer_profile_input,
)
from .service import (
    decode_create_service_input,
    decode_merged_service_input,
    decode_update_service_input,
)
from .slot import (
    decode_create_time_slot_input,
    decode_merged_slot_input,
    decode_update_time_slot_input,
)

# Schema dispatch for the parity vectors — a new input works in the
# vectors with no test edit: add its decode_* here under its wire id.
DECODERS = {
    "CreateBookingInput": decode_create_booking_input,
    "CancelBookingByTokenInput": decode_cancel_booking_by_token_input,
    "LookupBookingByTokenInput": decode_lookup_booking_by_token_input,
    "LookupBookingsInput": decode_lookup_bookings_input,
    "CancelBookingByOrganizerInput": decode_cancel_booking_by_organizer_input,
    "CreateServiceInput": decode_create_service_input,
    "UpdateServiceInput": decode_update_service_input,
    "CreateTimeSlotInput": decode_create_time_slot_input,
    "UpdateTimeSlotInput": decode_update_time_slot_input,
    "RegisterOrganizerInput": decode_register_organizer_input,
    "UpdateOrganizerProfileInput": decode_update_organizer_profile_input,
    "UpdateOrganizerLanguageInput": decode_update_organizer_language_input,
    "CreateAvatarUploadInput": decode_create_avatar_upload_input,
    "CreateServicePhotoUploadInput": decode_create_service_photo_upload_input,
    "TelegramWidgetPayload": decode_telegram_widget_payload,
    "InternalOrganizerLookupInput": decode_internal_organizer_lookup_input,
}

__all__ = [
    "DECODERS",
    "decode_cancel_booking_by_organizer_input",
    "decode_cancel_booking_by_token_input",
    "decode_create_avatar_upload_input",
    "decode_create_booking_input",
    "decode_create_service_input",
    "decode_create_service_photo_upload_input",
    "decode_create_time_slot_input",
    "decode_internal_organizer_lookup_input",
    "decode_lookup_booking_by_token_input",
    "decode_lookup_bookings_input",
    "decode_merged_organizer_input",
    "decode_merged_service_input",
    "decode_merged_slot_input",
    "decode_register_organizer_input",
    "decode_telegram_widget_payload",
    "decode_update_organizer_language_input",
    "decode_update_organizer_profile_input",
    "decode_update_service_input",
    "decode_update_time_slot_input",
]
