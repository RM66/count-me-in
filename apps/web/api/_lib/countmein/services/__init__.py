"""Application services — the write side between routes/jobs and repositories.

Two rules keep the boundary honest:

- **Session injection.** Every function takes the caller's
  `AsyncSession` and never opens its own. Handlers get the session from
  `Depends(get_db_session)`; worker entry points (jobs, seed, cleanup)
  own one via `db.client.sessionmaker()`. A service function wraps its
  unit of work in `session.begin()` — one call, one committed unit;
  merge-patch reads and writes share the caller's open transaction.

- **Model boundary.** Services return ORM-model snapshots (detached —
  expire_on_commit=False + lazy="raise"), never generated wire DTOs.
  Routes project models to records via db/serializers.py; jobs consume
  the same chain for its non-wire fields (chat id, manage token,
  timezone).

Reads with no business rule live in the repositories — routes and jobs
call them directly (public.py, cabinet.py, booking lookups).
"""
