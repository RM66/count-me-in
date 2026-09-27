# Performance record (Phase 6 smoke)

The plan's §6.2 called for a cold-start and warm p50 record from the preview
deploy. The production/preview Vercel measurements were not preserved at
cutover time; the numbers below are the local equivalents, measured on
2026-09-27 (macOS, uvicorn, local Postgres 17 + Redis 7 via docker compose) so
the record is honest about what was actually measured. To re-capture the
serverless figures on a future deploy: time the first request to a fresh
deployment's `/api/healthz` (cold start) and take the p50 of ~20 warm
repeats of the same endpoint, then replace this note with those numbers.

| Metric                         | Value (local uvicorn) | Plan budget |
| ------------------------------ | --------------------- | ----------- |
| First request after process up | ~0.16 s               | < 3 s cold  |
| Warm `GET /api/healthz` p50/20 | ~5.1 ms               | < 10 s max  |

Cold-start mitigations (ADR-021): single fat function, lazy engine/Redis/boto3
singletons, `includeFiles: api/_lib/**`, and `tests_py/test_cold_imports.py`
asserting the app import pulls in neither `boto3` nor `qstash`.
