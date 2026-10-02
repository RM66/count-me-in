# Generated from packages/contracts wire.ts via scripts/generate-rules.ts
# (ADR-024 C2). The validation metadata the OpenAPI document cannot carry —
# declared once at register() and mirrored by the Zod builders. Regenerate
# with: bun run generate:rules
#
# Per input schema:
#   transforms:     {property: ['trim' | 'lowercase', ...]} — applied to the
#                   raw JSON object before schema validation
#   fieldRules:     {property: ['ianaTimezone' | 'slugNotReserved' | 'httpUrl'
#                   | 'startsAtNotPast', ...]} — post-validation rules on
#                   non-null values
#   refinements:    ['optionsPair', ...] — object-level cross-field rules
#   mergedRequired: [property, ...] — update schemas only: keys the merged
#                   state must keep non-null (RFC 7386 null erases them)

from __future__ import annotations

from typing import Any

RULES: dict[str, dict[str, Any]] = {
    "CreateBookingInput": {
        "transforms": {"guestName":["trim"],"selectedOptions":["trim"]},
    },
    "CreateServiceInput": {
        "transforms": {"title":["trim"],"description":["trim"],"location":["trim"],"contact":["trim"],"defaultPrice":["trim"],"options":["trim"]},
        "fieldRules": {"photoUrl":["httpUrl"]},
        "refinements": ["optionsPair"],
    },
    "UpdateServiceInput": {
        "transforms": {"title":["trim"],"description":["trim"],"location":["trim"],"contact":["trim"],"defaultPrice":["trim"],"options":["trim"]},
        "fieldRules": {"photoUrl":["httpUrl"]},
        "refinements": ["optionsPair"],
        "mergedRequired": ["title","defaultPrice","defaultCapacity","defaultDurationMinutes","maxSeatsPerBooking"],
    },
    "CreateTimeSlotInput": {
        "transforms": {"price":["trim"]},
        "fieldRules": {"startsAt":["startsAtNotPast"]},
    },
    "UpdateTimeSlotInput": {
        "transforms": {"price":["trim"]},
        "fieldRules": {"startsAt":["startsAtNotPast"]},
        "mergedRequired": ["startsAt","durationMinutes","capacity"],
    },
    "RegisterOrganizerInput": {
        "transforms": {"slug":["trim","lowercase"],"name":["trim"],"contact":["trim"]},
        "fieldRules": {"timezone":["ianaTimezone"],"slug":["slugNotReserved"]},
    },
    "UpdateOrganizerProfileInput": {
        "transforms": {"slug":["trim","lowercase"],"name":["trim"],"description":["trim"],"location":["trim"],"contact":["trim"]},
        "fieldRules": {"timezone":["ianaTimezone"],"slug":["slugNotReserved"],"photoUrl":["httpUrl"]},
        "mergedRequired": ["name","slug","timezone"],
    },
    "TelegramWidgetPayload": {
        "fieldRules": {"photo_url":["httpUrl"]},
    },
}
