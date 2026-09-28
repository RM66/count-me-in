# Python API and Test Suite Improvement Steps

This document outlines structural, naming, and architectural improvements for the Python backend (`apps/web/api/`) and its corresponding test suite (`apps/web/tests_py/`).

---

## 1. Context and Goals

The Python API is a FastAPI application deployed as a single Vercel Serverless Function ("fat lambda") at `apps/web/api/index.py`. The implementation lives under `apps/web/api/_lib/countmein/`, and tests reside in `apps/web/tests_py/`.

Primary goals:
- Achieve complete 1:1 package mirroring between source modules and tests.
- Improve Python packaging ergonomics (eliminating `_lib` in module import paths).
- Separate fast unit tests from heavyweight database/Redis integration tests.
- Standardize naming conventions across database, validation, and route layers.

---

## 2. Step 1: Complete Test Suite Mirroring for Demo Guard

### Problem
`api/_lib/countmein/demo/` contains critical security logic:
- `guard.py`: `is_demo_organizer()`, `is_demo_slug()`, `is_read_only()`, `refuse_demo_write()`.
- `resolve.py`: demo organizer resolution.

Currently, there is no `tests_py/demo/` directory. Demo guards are only tested indirectly via parity scenarios (`demo-booking-refusal.yaml`) and HTTP route integration tests. Isolated unit tests for UUID normalization, empty ID handling, and exception raising are missing.

### Action Steps
1. Create `apps/web/tests_py/demo/test_guard.py`.
2. Add isolated unit tests covering:
   - `is_demo_organizer` with string UUID, raw UUID object, and empty/unrelated strings.
   - `is_demo_slug` with exact matching and casing.
   - `is_read_only` with empty string, demo ID, and valid non-demo IDs.
   - `refuse_demo_write` raising `DemoReadOnly` on demo/empty ID, and no-op on non-demo ID.
3. Update `apps/web/tests_py/test_invariants.py` to assert delegate existence in `tests_py.demo.test_guard`.

---

## 3. Step 2: Consolidate Logging Tests into `tests_py/logx/`

### Problem
Single-file modules such as `config.py`, `queue.py`, and `storage.py` each have a dedicated test directory:
- `tests_py/config/test_config.py`
- `tests_py/queue/test_queue.py`
- `tests_py/storage/test_storage.py`

In contrast, logging tests sit directly in the root of `tests_py/`:
- `tests_py/test_logx.py`
- `tests_py/test_log_redaction.py`

This causes root clutter alongside cross-cutting test files (`test_invariants.py`, `test_route_set.py`, `test_vercel_json.py`, `test_cold_imports.py`).

### Action Steps
1. Create directory `apps/web/tests_py/logx/`.
2. Move `tests_py/test_logx.py` to `tests_py/logx/test_logx.py`.
3. Move `tests_py/test_log_redaction.py` to `tests_py/logx/test_log_redaction.py`.
4. Update references in `tests_py/test_invariants.py` if delegates are targeted by module path.
5. Verify `bun run test:py` and `bun run lint:py`.

---

## 4. Step 3: Fast Unit Test Execution (Unit vs. Integration Separation)

### Problem
`tests_py/` mixes pure unit tests (in-memory validation, token derivation, cryptography, i18n, domain math) and integration tests (requiring live PostgreSQL and Redis).
Running `bun run test:py` executes all tests across workers with database migrations and seeds. For local iteration, developers need a way to run non-IO unit tests instantly without external services.

### Action Steps
1. Define custom markers in `apps/web/pyproject.toml`:
   ```toml
   [tool.pytest.ini_options]
   markers = [
       "integration: tests requiring live Postgres or Redis",
       "unit: standalone in-memory unit tests",
   ]
   ```
2. Annotate tests or configure `tests_py/_env.py` to mark integration tests automatically when using `require_postgres` or `require_redis`.
3. Add targeted npm scripts to `apps/web/package.json`:
   ```json
   "test:py:unit": "uv run pytest -m 'not integration'",
   "test:py:integration": "uv run pytest -m integration -n auto"
   ```

---

## 5. Step 4: Python Import Path Normalization (`_lib.countmein` -> `countmein`)

### Problem
Currently, imports throughout tests and scripts use:
```python
from _lib.countmein.db.organizer import get_organizer
```
Leading underscores in import paths violate Python PEP 8 conventions. While `_lib/` is required on disk so Vercel ignores the folder when discovering serverless endpoints, Python import paths should resolve cleanly as `countmein.*`.

### Action Steps
1. **Configure Search Paths**:
   Update `apps/web/pyproject.toml`:
   ```toml
   [tool.pytest.ini_options]
   pythonpath = ["api/_lib", "api"]

   [tool.mypy]
   mypy_path = "api/_lib:api"
   packages = ["countmein"]
   ```
2. **Update Entrypoint (`apps/web/api/index.py`)**:
   Add `api/_lib` to `sys.path`:
   ```python
   _LIB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_lib")
   if _LIB not in sys.path:
       sys.path.insert(0, _LIB)

   from countmein.app import app
   ```
3. **Update Seed Script Command (`packages/db/package.json`)**:
   ```json
   "db:seed:demo": "cd ../../apps/web && PYTHONPATH=api/_lib uv run --env-file ../../.env python -m countmein.db.seed"
   ```
4. **Update OpenApi Export Script (`apps/web/scripts/export-py-openapi.py`)**:
   Update import from `_lib.countmein.routes` to `countmein.routes`.
5. **Migrate Test Suite Imports**:
   Update all imports across `apps/web/tests_py/` from `_lib.countmein` to `countmein`.
6. **Remove `apps/web/api/_lib/__init__.py`**:
   Once `api/_lib` is in `pythonpath`, `_lib` is no longer treated as a package root.
7. **Verification**:
   Run `bun run check-types`, `bun run lint:py`, `bun run test:py`, and `tests_py/test_cold_imports.py` to ensure import overhead and serverless boundaries remain uncompromised.

---

## 6. Step 5: Entity Naming Alignment (`slot` vs `time_slot` vs `slots`)

### Problem
There is slight naming fragmentation for the slot entity across layers:
- Database: `api/_lib/countmein/db/time_slot.py` (reflects SQL table `time_slots`)
- Validation: `api/_lib/countmein/validation/decode/slot.py` (singular, no prefix)
- Routes: `api/_lib/countmein/routes/slots.py` (plural, REST convention)
- Tests: `tests_py/routes/test_slots.py` vs `tests_py/db/` (no dedicated slot test module; tests are in `test_booking_writes.py`)

In comparison, other entities maintain consistent names:
- Service: `db/service.py`, `validation/decode/service.py`, `routes/services.py`, `test_services.py`
- Organizer: `db/organizer.py`, `validation/decode/organizer.py`, `routes/organizers.py`, `test_organizers.py`

### Action Steps
1. Standardize DB module naming:
   - Option A (Preserve DB alignment): Keep `db/time_slot.py` to match Postgres table `time_slots`, but document the rationale explicitly in the module docstring.
   - Option B (Full consistency): Rename `db/time_slot.py` to `db/slot.py` to mirror `db/service.py` and `db/organizer.py`.
2. Ensure test coverage for standalone slot DB operations:
   - Add `tests_py/db/test_time_slot.py` (or `test_slot.py`) covering direct slot queries, updates, and delete guard validations.

---

## 7. Execution and Verification Checklist

| Step | Action | Verification Command |
| :--- | :--- | :--- |
| 1 | Add `tests_py/demo/test_guard.py` | `uv run pytest tests_py/demo/` |
| 2 | Relocate logging tests to `tests_py/logx/` | `uv run pytest tests_py/logx/` |
| 3 | Configure unit vs integration markers | `uv run pytest -m 'not integration'` |
| 4 | Normalize import paths to `countmein.*` | `bun run lint:py && bun run test:py` |
| 5 | Verify serverless cold start impact | `uv run pytest tests_py/test_cold_imports.py` |
| 6 | Verify OpenAPI route synchronization | `uv run pytest tests_py/test_route_set.py` |
| 7 | Verify Vercel rewrite invariants | `uv run pytest tests_py/test_vercel_json.py` |
