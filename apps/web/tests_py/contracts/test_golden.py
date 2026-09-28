"""Golden wire samples for every record schema (ADR-014/ADR-021).

Each sample is a full wire shape rendered with the compact indented
encoder and compared byte for byte against the committed golden file
(tests_py/contracts/golden/*.json) — a change to field names,
nullability, key order or escaping shows up as a diff. Regenerate with
--update-goldens only together with a deliberate wire change recorded
in ADR-021.

Every sample is also validated against the generated Pydantic model, so
spec ↔ model drift fails here, not in production.
"""

from __future__ import annotations

import json
import json as _json
import sys
from pathlib import Path
from typing import Any

from countmein.contracts import models_gen as gen

GOLDEN_DIR = Path(__file__).resolve().parent / "golden"
UPDATE_GOLDENS = "--update-goldens" in sys.argv

# The wire records (the retired constants registry's record list);
# test_golden_coverage pins the list against the samples.
RECORD_NAMES = [
    "OrganizerProfile",
    "PublicOrganizer",
    "ServiceRecord",
    "TimeSlotRecord",
    "BookingRecord",
    "GuestBooking",
    "ImageUploadTarget",
    "RegisteredOrganizer",
    "Registered",
    "AuthTicketPayload",
    "GuestTicketResponse",
    "AuthTicketResponse",
    "LoginLinkPayload",
    "BookingCreatedJob",
    "BookingCancelledJob",
    "ServiceEnvelope",
    "ServicesEnvelope",
    "SlotEnvelope",
    "SlotsEnvelope",
    "GuestBookingEnvelope",
    "BookingEnvelope",
    "GuestBookingsEnvelope",
    "OrganizerEnvelope",
    "DeletedServiceEnvelope",
    "DeletedSlotEnvelope",
    "ErrorBody",
    "ValidationErrors",
    "InvalidBody",
]

GOLDEN_TIME = "2026-01-02T03:04:05.000Z"


def golden_uuid(n: int) -> str:
    return f"01930000-0000-7000-8000-0000000000{n // 10}{n % 10}"


def sample_organizer_profile() -> dict[str, Any]:
    return {
        "id": golden_uuid(1),
        "slug": "my-studio",
        "name": "Studio",
        "messenger": "telegram",
        "messengerId": "123456789",
        "timezone": "Europe/Belgrade",
        "description": "Morning practice",
        "photoUrl": "https://example.com/avatar.webp",
        "location": "Hall A",
        "contact": "+123456",
        "language": "ru",
        "createdAt": GOLDEN_TIME,
        "isDemo": False,
    }


def sample_public_organizer() -> dict[str, Any]:
    return {
        "id": golden_uuid(1),
        "slug": "my-studio",
        "name": "Studio",
        "timezone": "Europe/Belgrade",
        "description": "Morning practice",
        "photoUrl": "https://example.com/avatar.webp",
        "location": "Hall A",
        "contact": "+123456",
        "isDemo": False,
    }


def sample_service_record() -> dict[str, Any]:
    return {
        "id": "demo-yoga",
        "organizerId": golden_uuid(1),
        "title": "Yoga",
        "description": "Morning flow",
        "photoUrl": "https://example.com/photo.webp",
        "location": "Hall A",
        "contact": "+123456",
        "defaultPrice": "10",
        "defaultCapacity": 5,
        "defaultDurationMinutes": 60,
        "maxSeatsPerBooking": 1,
        "options": ["Beginner", "Intermediate"],
        "optionsSelectMode": "single",
        "createdAt": GOLDEN_TIME,
    }


def sample_time_slot_record() -> dict[str, Any]:
    return {
        "id": golden_uuid(2),
        "serviceId": "demo-yoga",
        "startsAt": GOLDEN_TIME,
        "durationMinutes": 60,
        "capacity": 10,
        "bookedCount": 3,
        "price": "15",
        "createdAt": GOLDEN_TIME,
    }


def sample_booking_record() -> dict[str, Any]:
    return {
        "id": golden_uuid(3),
        "timeSlotId": golden_uuid(2),
        "status": "confirmed",
        "seats": 2,
        "guestName": "Mila Petrović",
        "guestMessenger": "telegram",
        "guestMessengerId": "123456789",
        "guestMessengerLogin": "mila",
        "selectedOptions": ["Beginner"],
        "createdAt": GOLDEN_TIME,
    }


def sample_guest_booking() -> dict[str, Any]:
    return {
        "id": golden_uuid(3),
        "status": "confirmed",
        "seats": 2,
        "guestName": "Mila Petrović",
        "selectedOptions": ["Beginner"],
        "createdAt": GOLDEN_TIME,
        "manageToken": "manage-token-1234567890",
        "canCancel": True,
        "slot": sample_time_slot_record(),
        "service": sample_service_record(),
        "organizer": sample_public_organizer(),
    }


def golden_samples() -> dict[str, Any]:
    service = sample_service_record()
    service_nulls = {
        **service,
        "description": None,
        "photoUrl": None,
        "location": None,
        "contact": None,
        "options": None,
        "optionsSelectMode": None,
    }

    slot = sample_time_slot_record()
    slot_nulls = {**slot, "price": None}

    booking = sample_booking_record()
    booking_nulls = {**booking, "guestMessengerLogin": None, "selectedOptions": None}

    guest = sample_guest_booking()
    guest_nulls = {**guest, "selectedOptions": None}

    organizer = sample_organizer_profile()
    organizer_nulls = {
        **organizer,
        "description": None,
        "photoUrl": None,
        "location": None,
        "contact": None,
    }

    public = sample_public_organizer()
    public_nulls = {
        **public,
        "description": None,
        "photoUrl": None,
        "location": None,
        "contact": None,
    }

    demo_profile = {
        **organizer,
        "id": "01930000-0000-7000-8000-0000000000de",
        "slug": "demo",
        "isDemo": True,
    }

    demo_public = {
        **public,
        "id": "01930000-0000-7000-8000-0000000000de",
        "slug": "demo",
        "isDemo": True,
    }

    max_profile = {**organizer, "name": "я" * 100, "description": "x" * 4000}

    max_service = {
        **service,
        "title": "я" * 100,
        "description": "x" * 2000,
        "defaultPrice": "9" * 50,
        "options": ["o" * 100],
    }

    payload = {
        "messenger": "telegram",
        "messengerId": "123456789",
        "displayName": "Mila Petrović",
        "photoUrl": "https://example.com/avatar.webp",
        "messengerLogin": "mila",
        "purpose": "guest",
    }
    payload_nulls = {
        "messenger": "telegram",
        "messengerId": "123456789",
        "displayName": "Mila Petrović",
        "purpose": "organizer",
    }

    return {
        "OrganizerProfile": organizer,
        "OrganizerProfile.nulls": organizer_nulls,
        "OrganizerProfile.demo": demo_profile,
        "OrganizerProfile.bounds": max_profile,
        "PublicOrganizer": public,
        "PublicOrganizer.nulls": public_nulls,
        "PublicOrganizer.demo": demo_public,
        "ServiceRecord": service,
        "ServiceRecord.nulls": service_nulls,
        "ServiceRecord.bounds": max_service,
        "TimeSlotRecord": slot,
        "TimeSlotRecord.nulls": slot_nulls,
        "BookingRecord": booking,
        "BookingRecord.nulls": booking_nulls,
        "GuestBooking": guest,
        "GuestBooking.nulls": guest_nulls,
        "ImageUploadTarget": {
            "uploadUrl": "https://upload.example.com/put",
            "publicUrl": "https://example.com/avatar.webp",
            "expiresAt": GOLDEN_TIME,
        },
        "RegisteredOrganizer": {"id": golden_uuid(1), "slug": "my-studio"},
        "Registered": {"organizer": {"id": golden_uuid(1), "slug": "my-studio"}},
        "AuthTicketPayload": payload,
        "AuthTicketPayload.nulls": payload_nulls,
        "GuestTicketResponse": {
            "ticket": "whatever-guest-ticket-12345678",
            "messenger": "telegram",
            "messengerId": "123456789",
            "displayName": "Mila Petrović",
        },
        "AuthTicketResponse": {"ticket": "whatever-auth-ticket-12345678", "organizerExists": True},
        "LoginLinkPayload": {"organizerId": golden_uuid(1), "next": "/cabinet"},
        "BookingCreatedJob": {
            "bookingId": golden_uuid(3),
            "recipient": "organizer",
            "outboxId": "00000000-0000-0000-0000-000000000000",
        },
        "BookingCancelledJob": {
            "bookingId": golden_uuid(3),
            "cancelledBy": "guest",
            "outboxId": "00000000-0000-0000-0000-000000000000",
        },
        "ServiceEnvelope": {"service": service},
        "ServicesEnvelope": {"services": [service]},
        "SlotEnvelope": {"slot": slot},
        "SlotsEnvelope": {"slots": [slot]},
        "GuestBookingEnvelope": {"booking": guest},
        "BookingEnvelope": {"booking": booking},
        "GuestBookingsEnvelope": {"bookings": [guest]},
        "OrganizerEnvelope": {"organizer": organizer},
        "OrganizerEnvelope.demo": {"organizer": demo_profile},
        "DeletedServiceEnvelope": {"id": "demo-yoga"},
        "DeletedSlotEnvelope": {"id": golden_uuid(2)},
        "ErrorBody": {
            "error": "Only 4 seats left",
            "code": "seats_left",
            "seatsLeft": 4,
            "maxSeats": 6,
        },
        "ErrorBody.nulls": {"error": "Something went wrong"},
        "ValidationErrors": {
            "formErrors": [],
            "fieldErrors": {"title": ["Required"]},
        },
        "InvalidBody": {
            "error": "Invalid input",
            "details": {
                "formErrors": [],
                "fieldErrors": {"title": ["Required"]},
            },
        },
    }


# The model class behind each sample key — validating the sample against
# the generated model is the spec ↔ code drift check. Envelope variants
# share the base record's model.
def _model_for(key: str) -> type[gen.BaseModel] | None:
    base = key.split(".")[0]
    return {
        "OrganizerProfile": gen.OrganizerProfile,
        "PublicOrganizer": gen.PublicOrganizer,
        "ServiceRecord": gen.ServiceRecord,
        "TimeSlotRecord": gen.TimeSlotRecord,
        "BookingRecord": gen.BookingRecord,
        "GuestBooking": gen.GuestBooking,
        "ImageUploadTarget": gen.ImageUploadTarget,
        "RegisteredOrganizer": gen.RegisteredOrganizer,
        "Registered": gen.Registered,
        "AuthTicketPayload": gen.AuthTicketPayload,
        "GuestTicketResponse": gen.GuestTicketResponse,
        "AuthTicketResponse": gen.AuthTicketResponse,
        "LoginLinkPayload": gen.LoginLinkPayload,
        "BookingCreatedJob": gen.BookingCreatedJob,
        "BookingCancelledJob": gen.BookingCancelledJob,
        "ServiceEnvelope": gen.ServiceEnvelope,
        "ServicesEnvelope": gen.ServicesEnvelope,
        "SlotEnvelope": gen.SlotEnvelope,
        "SlotsEnvelope": gen.SlotsEnvelope,
        "GuestBookingEnvelope": gen.GuestBookingEnvelope,
        "BookingEnvelope": gen.BookingEnvelope,
        "GuestBookingsEnvelope": gen.GuestBookingsEnvelope,
        "OrganizerEnvelope": gen.OrganizerEnvelope,
        "DeletedServiceEnvelope": gen.DeletedServiceEnvelope,
        "DeletedSlotEnvelope": gen.DeletedSlotEnvelope,
        "ErrorBody": gen.ErrorBody,
        "ValidationErrors": gen.ValidationErrors,
        "InvalidBody": gen.InvalidBody,
    }.get(base)


# ── Indented marshal for the golden files ────────────────────────────────────
# stdlib json string encoding: no HTML escaping, UTF-8 text;
# non-ASCII raw, sorts keys (the generated structs were alphabetical),
# two-space indent, ": " after every key, [] / {} for empty containers.


def _marshal_indent(value: Any, out: list[str], depth: int, sort_keys: bool) -> None:
    pad = "  " * depth
    pad_inner = "  " * (depth + 1)
    if isinstance(value, dict):
        if not value:
            out.append("{}")
            return
        out.append("{\n")
        keys = sorted(value.keys()) if sort_keys else list(value.keys())
        for i, key in enumerate(keys):
            out.append(pad_inner)
            out.append(_json.dumps(str(key), ensure_ascii=False))
            out.append(": ")
            _marshal_indent(value[key], out, depth + 1, sort_keys)
            out.append(",\n" if i < len(keys) - 1 else "\n")
        out.append(pad + "}")
    elif isinstance(value, (list, tuple)):
        if not value:
            out.append("[]")
            return
        out.append("[\n")
        for i, item in enumerate(value):
            out.append(pad_inner)
            _marshal_indent(item, out, depth + 1, sort_keys)
            out.append(",\n" if i < len(value) - 1 else "\n")
        out.append(pad + "]")
    elif value is None:
        out.append("null")
    elif isinstance(value, bool):
        out.append("true" if value else "false")
    elif isinstance(value, str):
        out.append(_json.dumps(value, ensure_ascii=False))
    elif isinstance(value, int):
        out.append(str(value))
    else:
        raise TypeError(f"cannot encode {type(value).__name__}")


def marshal_indent_go(value: Any, *, sort_keys: bool = True) -> bytes:
    """Render value the way the retired encoding/json MarshalIndent did,
    plus the trailing newline the golden writer appended. sort_keys=False
    reproduces declaration order for the hand-written payload structs
    (the generated wire structs were alphabetical)."""
    out: list[str] = []
    _marshal_indent(value, out, 0, sort_keys)
    out.append("\n")
    return "".join(out).encode()


# The hand-written Redis payload types marshal in declaration order
# (their struct fields were never generated/alphabetized).
_DECLARATION_ORDER = {"AuthTicketPayload", "AuthTicketPayload.nulls", "LoginLinkPayload"}


def _validate(model: type, sample: dict[str, Any]) -> None:
    """model_validate with the decode path's TypeError fallback: the
    generated UUID models carry a pattern constraint Pydantic cannot
    apply to a coerced UUID, so a TypeError means per-field validation
    (UUID coercion is the check)."""
    try:
        model.model_validate(sample)
    except TypeError:
        from pydantic import TypeAdapter

        for name, field in model.model_fields.items():
            if name not in sample:
                continue
            try:
                TypeAdapter(field.annotation).validate_python(sample[name])
            except TypeError:
                pass  # constraint not applicable to the coerced type


def test_golden():
    samples = golden_samples()
    for key in sorted(samples):
        model = _model_for(key)
        if model is not None:
            _validate(model, samples[key])
        data = marshal_indent_go(samples[key], sort_keys=key not in _DECLARATION_ORDER)
        path = GOLDEN_DIR / f"{key}.json"
        if UPDATE_GOLDENS:
            path.write_bytes(data)
            continue
        want = path.read_bytes()
        assert data == want, (
            f"{key}: golden mismatch — if the wire change is intentional, "
            "update the golden by hand (the goldens are frozen)"
        )


def test_golden_coverage():
    seen: set[str] = set()
    for key in golden_samples():
        # Variants ("OrganizerProfile.demo") pin edge shapes; coverage counts
        # only the base record name.
        if "." in key:
            continue
        assert key not in seen, f"duplicate golden sample {key!r}"
        seen.add(key)
    for name in RECORD_NAMES:
        assert name in seen, f"record {name!r} has no golden sample"
    for base in seen:
        assert base in RECORD_NAMES, f"golden sample {base!r} is not in the record list"


def test_goldens_are_valid_json():
    for path in sorted(GOLDEN_DIR.glob("*.json")):
        json.loads(path.read_text())
