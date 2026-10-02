"""Session plumbing for the services tests.

The services layer takes the caller's AsyncSession — the request-scoped
one in production (Depends(get_db_session)); tests own sessions
themselves. One fresh session per call keeps read/write interleavings
honest: each bare-named service call is its own committed unit.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from countmein.db.client import sessionmaker


async def svc[T](fn: Callable[..., Awaitable[T]], *args: Any, **kwargs: Any) -> T:
    """Call one service function on a fresh session."""
    async with sessionmaker()() as session:
        return await fn(session, *args, **kwargs)
