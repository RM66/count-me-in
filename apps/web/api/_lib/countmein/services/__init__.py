"""Application services — the layer between routes/jobs and repositories.

Two rules keep the boundary honest (ADR-023 Phase 2):

- **Session injection.** Every function takes the caller's
  `AsyncSession` as its first argument and never opens its own. Request
  handlers get the session from `Depends(get_db_session)`; worker entry
  points (jobs, seed, post-commit cleanup) own one themselves via
  `db.client.sessionmaker()`. A bare-named function wraps its work in
  `session.begin()` — one call is one committed unit; a `*_tx` sibling
  runs on the caller's open transaction (the merge-patch skeleton reads
  and writes on one tx).

- **Row boundary.** Services return detached domain snapshots
  (db/rows.py: OrganizerRow, ServiceRow, TimeSlotRow, BookingRow,
  OutboxRow) — never generated wire DTOs. Routes project Rows to records
  via db/serializers.py; jobs consume the same Rows for their non-wire
  fields (chat id, manage token, timezone).
"""
