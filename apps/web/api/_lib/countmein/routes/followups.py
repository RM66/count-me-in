"""Shared bound and runner for the after-commit background fan-out
(ADR-025): QStash publish and the revalidation hop (carrying the
occupancy event). The platform's 10 s maxDuration covers the whole
invocation — handler plus background work — so the shared deadline
must leave headroom. Each leg keeps its own tighter budget; this only
bounds a leg that forgot to.
"""

import asyncio
from collections.abc import Coroutine
from typing import Any

from .. import logx

# 10 s platform budget minus handler headroom — a pathological request
# still gets ~5 s before the platform would cut the function first.
FOLLOWUPS_DEADLINE_SECONDS = 5.0


async def run_followups(
    legs: list[Coroutine[Any, Any, Any]], *, source: str, trace_id: str = ""
) -> None:
    """Run post-commit legs concurrently — the outbound calls are
    independent. Each leg absorbs its own errors; the timeout bounds
    the wait, and escapes are logged without cancelling siblings."""
    try:
        async with asyncio.timeout(FOLLOWUPS_DEADLINE_SECONDS):
            outcomes = await asyncio.gather(*legs, return_exceptions=True)
    except TimeoutError:
        logx.warn(f"{source} exceeded the shared deadline", {"traceId": trace_id})
        return
    for outcome in outcomes:
        if isinstance(outcome, BaseException):
            logx.error(outcome, {"traceId": trace_id, "source": source})
