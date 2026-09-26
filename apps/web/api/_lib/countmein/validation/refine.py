"""Hand-written refinement tails for the decode_* inputs: everything Zod
expresses via .refine/.superRefine that JSON Schema cannot carry. Called
at the end of the decode functions; the merge-patch update endpoints
run the *_merged_state variants on the merged result (RFC 7386
semantics). Pinned by packages/contracts/vectors/validation/*.

Note on message counts: the refinements read parsed values, while the
Zod refinements read raw input — so an invalid optionsSelectMode value
with options set yields two messages on optionsSelectMode here (rule +
consistency) and one in Zod (rule only). Keys always agree; only vectors
pin them, never message text or per-field counts.
"""

from __future__ import annotations

from typing import Any

from ..contracts import domain
from ..contracts.constants_gen import SLOT_START_IN_PAST_MESSAGE
from .errors import Errors
from .rules import is_acceptable_slot_start


def _root(value: Any) -> Any:
    """Unwrap a RootModel value (options lists, select modes, startsAt),
    recursively — an OptionsList's items are themselves OptionLabel
    RootModels."""
    while hasattr(value, "root"):
        value = value.root
    return value


def refine_service_options(
    e: Errors,
    options: Any,
    mode: Any,
) -> None:
    """Check a concrete options/mode pair: non-empty, unique, and mode
    present exactly when options are. Shared by the create input (where
    the pair is the whole payload) and the merged update state."""
    if options is not None:
        opts = [_root(o) for o in _root(options)]
        if len(opts) == 0:
            e.add("options", "Too small: expected array to have >=1 items")
        seen: set[str] = set()
        for option in opts:
            if option in seen:
                e.add("options", "options must be unique")
                break
            seen.add(option)
    has_options = options is not None and len(_root(options)) > 0
    has_mode = mode is not None and _root(mode) != ""
    if has_options and not has_mode:
        e.add("optionsSelectMode", "optionsSelectMode is required when options are set")
    if not has_options and has_mode:
        e.add("optionsSelectMode", "optionsSelectMode must be omitted when there are no options")


def refine_service_merged_state(e: Errors, state: Any) -> None:
    """Run the options/mode consistency check on the merged update state
    (the handler calls it after the merge-patch). The non-nullable fields
    that RFC 7386 could have removed (patch null on a non-nullable key
    deletes it from the merged object) are checked here too — the schema
    cannot, because in the update schema they are optional."""
    if state.title is None:
        e.add("title", "Required")
    if state.defaultPrice is None:
        e.add("defaultPrice", "Required")
    if state.defaultCapacity is None:
        e.add("defaultCapacity", "Required")
    if state.defaultDurationMinutes is None:
        e.add("defaultDurationMinutes", "Required")
    if state.maxSeatsPerBooking is None:
        e.add("maxSeatsPerBooking", "Required")
    refine_service_options(e, state.options, state.optionsSelectMode)


def refine_organizer_merged_state(e: Errors, state: Any) -> None:
    """Same non-nullable-present checks for the organizer profile update."""
    if state.name is None:
        e.add("name", "Required")
    if state.slug is None:
        e.add("slug", "Required")
    if state.timezone is None:
        e.add("timezone", "Required")


def refine_slot_merged_state(e: Errors, state: Any, starts_at_touched: bool) -> None:
    """Same for the slot update; startsAt is only checked against the
    past when the patch actually touched it (a merged state always
    carries the current value, which may legitimately be past)."""
    if state.startsAt is None:
        e.add("startsAt", "Required")
    if state.durationMinutes is None:
        e.add("durationMinutes", "Required")
    if state.capacity is None:
        e.add("capacity", "Required")
    if starts_at_touched and state.startsAt is not None:
        refine_slot_start(e, state.startsAt)


def refine_slot_start(e: Errors, starts_at: Any) -> None:
    """Reject a start in the past (beyond the tolerance window)."""
    try:
        ft = domain.parse_flex_time(_root(starts_at))
    except ValueError:
        return  # the spec's oneOf already rejected anything unparseable
    if not is_acceptable_slot_start(ft):
        e.add("startsAt", SLOT_START_IN_PAST_MESSAGE)
