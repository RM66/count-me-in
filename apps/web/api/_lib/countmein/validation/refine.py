"""The rule-vocabulary implementations (ADR-024 C2): everything Zod
expresses via .refine/.superRefine that JSON Schema cannot carry. Which
schema gets which rule is generated metadata (rules_gen.py); these are
the portable primitives each name maps to. Pinned by
packages/contracts/vectors/validation/*.

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


def refine_service_options(
    e: Errors,
    options: Any,
    mode: Any,
) -> None:
    """Check a concrete options/mode pair: non-empty, unique, and mode
    present exactly when options are. Shared by the create input (where
    the pair is the whole payload) and the merged update state.

    Runs even when spec validation failed (the service schemas declare
    the refinement) — so `options` may be raw unvalidated JSON; every
    read is guarded by isinstance (a non-list `options` is the spec
    error's to report, not a TypeError's)."""
    if isinstance(options, list):
        if len(options) == 0:
            e.add("options", "Too small: expected array to have >=1 items")
        seen: set[str] = set()
        for option in options:
            if not isinstance(option, str):
                break  # non-string items are the spec error's to report
            if option in seen:
                e.add("options", "options must be unique")
                break
            seen.add(option)
    has_options = isinstance(options, list) and len(options) > 0
    has_mode = mode is not None and mode != ""
    if has_options and not has_mode:
        e.add("optionsSelectMode", "optionsSelectMode is required when options are set")
    if not has_options and has_mode:
        e.add("optionsSelectMode", "optionsSelectMode must be omitted when there are no options")


def refine_slot_start(e: Errors, starts_at: Any) -> None:
    """Reject a start in the past (beyond the tolerance window)."""
    try:
        ft = domain.parse_flex_time(starts_at)
    except ValueError:
        return  # the spec's oneOf already rejected anything unparseable
    if not is_acceptable_slot_start(ft):
        e.add("startsAt", SLOT_START_IN_PAST_MESSAGE)
