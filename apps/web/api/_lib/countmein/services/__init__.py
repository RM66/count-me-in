"""Application services — the layer between routes/jobs and repositories.

Two rules keep the boundary honest (ADR-023 Phase 2):

- **Session injection.** Every function takes the caller's
  `AsyncSession` and never opens its own. Handlers get the session from
  `Depends(get_db_session)`; worker entry points (jobs, seed, cleanup)
  own one via `db.client.sessionmaker()`. A bare-named function wraps
  its work in `session.begin()` — one call, one committed unit; a `*_tx`
  sibling runs on the caller's open transaction (merge-patch reads and
  writes on one tx).

- **Row boundary.** Services return detached domain snapshots
  (db/rows.py) — never generated wire DTOs. Routes project Rows to
  records via db/serializers.py; jobs consume Rows for their non-wire
  fields (chat id, manage token, timezone).
"""
