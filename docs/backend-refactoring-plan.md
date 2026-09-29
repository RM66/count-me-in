# Implementation Plan: Python-First Full-Stack Architecture Refactoring

## 1. Overview & Architecture Target

### 1.1 Goal
Transform the CountMeIn codebase into a showcase **Python Full-Stack** project suitable for senior/lead engineering review:
- **FastAPI Core Service (Python 3.12):** Single owner of the PostgreSQL database, declarative SQLAlchemy 2.0 async ORM models, Alembic migrations, and core business invariants. Eliminates raw SQL string manipulation, manual index tuple unpacking (`row[0] ... row[47]`), and duplicated schema ownership.
- **Next.js Frontend & BFF (TypeScript / React 19):** Pure UI, App Router SSR/SSG with native Next.js Data Cache, and Auth.js v5 BFF Token Handler. Next.js has **ZERO direct PostgreSQL access** — all data is fetched over HTTP from the Python API.
- **Dual-Runtime Support:** Retains 100% compatibility with Vercel Serverless (via `NullPool` and single-function ASGI dispatch) while providing standard containerization (`Dockerfile` and `docker-compose.yml`) ready for long-running deployments on AWS (ECS / App Runner).

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Next.js Frontend / BFF                          │
│                                                                        │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │ App Router Server     │  │ Auth.js (v5)    │  │ Client UI        │  │
│  │ Components (SSR/ISR)  │  │ Session Cookies │  │ (React 19 /      │  │
│  │ Data Cache / Tags     │  │ (BFF Pattern)   │  │  TanStack Query) │  │
│  └──────────┬────────────┘  └────────┬────────┘  └────────┬─────────┘  │
└─────────────┼────────────────────────┼────────────────────┼────────────┘
              │                        │                    │
              │ HTTP (Cache-tagged)    │ Internal HTTP /    │ HTTP
              │                        │ X-Organizer-Auth   │ (Browser)
              ▼                        ▼                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         FastAPI Core Service                           │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Routers (Public, Organizer Cabinet, Guest Bookings, Internal)    │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Services Layer (Business Invariants, Transactions, Outbox, Demo) │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Repositories (Async SQLAlchemy 2.0 Core / ORM Expressions)       │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ SQLAlchemy 2.0 Declarative Models & Alembic Migrations           │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
└─────────────────────────────────────┼──────────────────────────────────┘
                                      ▼
                           ┌─────────────────────┐
                           │     PostgreSQL      │
                           └─────────────────────┘
```

---

## 2. Invariants & Guardrails (DO NOT BREAK)

Any code modification must strictly respect the following core project invariants (enforced by `tests_py/test_invariants.py` and existing parity tests):
1. **Atomic Seat Reserve:** Seats move ONLY through a single atomic conditional update:
   `UPDATE time_slots SET booked_count = booked_count + :seats WHERE id = :slot_id AND booked_count + :seats <= capacity RETURNING ...`. Never read `booked_count`, verify in Python, and write back.
2. **Demo Account Read-Only Guard:** The demo organizer (`DEMO_ORGANIZER_ID = "00000000-0000-0000-0000-000000000001"`) must be rejected on every write endpoint with 403 `DemoReadOnly`. Notifications must never be sent for it.
3. **Consumed Guest Identity:** Guest identity is a single-use auth ticket stored in Redis, consumed atomically upon booking creation (`require_guest_identity`).
4. **Credential Hashing (`manageToken`):** Every lookup and cancel operation for guest bookings must check the SHA-256 hash (`manage_token_hash`), not the raw token. Tokens expire at `starts_at + 24h` grace period.
5. **Media Ownership Check:** Photo URLs in services or organizers must be verified against the organizer's prefix (`is_own_media_url`) before saving.
6. **Deletion 409 Conflict:** Deleting a slot or service with existing booking rows (confirmed or cancelled) must return HTTP 409 Conflict.
7. **Outbox Idempotency:** Notification outbox rows are inserted within the booking/cancel database transaction and published after commit. Consumer jobs claim processing in Redis via `SET NX`.
8. **Byte-Level Parity for Existing Routes:** All currently existing endpoints in `apps/web/openapi.yaml` must retain exact response status codes, error envelopes, and payload schemas.

---

## 3. Phase Breakdown

### Phase 1: Alembic Setup & Migration Baseline

**Objective:** Transfer database schema ownership from `packages/db` (Drizzle) to Python using Alembic.

#### 1.1 Add Alembic Dependency
In `apps/web/pyproject.toml`, add `alembic>=1.13.0` to `dependencies`. Run `uv lock` and update `requirements.txt`.

#### 1.2 Initialize Alembic Environment
Create directory `apps/web/alembic/` and `apps/web/alembic.ini`.
- Configure `alembic/env.py` to:
  - Read `POSTGRES_URL` from the environment (handling `postgres://` to `postgresql+psycopg://` conversion).
  - Use `async_engine_from_config` or the existing `countmein.db.client.engine()`.
  - Connect to `countmein.models.base.Base.metadata`.
  - Handle custom Postgres enums (`options_select_mode`, `booking_status`, `messenger_kind`, `outbox_status`).

#### 1.3 Create Baseline Migration (`0001_initial_schema.py`)
Translate the existing Drizzle migrations (`packages/db/drizzle/*.sql`) into a clean initial Alembic revision:
- **Enums:**
  - `options_select_mode` (`single`, `multi`)
  - `booking_status` (`confirmed`, `cancelled`)
  - `messenger_kind` (`telegram`)
  - `outbox_status` (`pending`, `sent`, `failed`, `skipped`)
- **Tables:**
  - `organizers` (id UUID PK, slug text UNIQUE, name text, messenger messenger_kind, messenger_id text, timezone text, language text, description text, photo_url text, location text, contact text, created_at timestamptz)
  - `services` (id UUID PK, organizer_id UUID FK -> organizers.id RESTRICT, title text, description text, photo_url text, location text, contact text, default_price text, default_capacity int, default_duration_minutes int, max_seats_per_booking int, options text[], options_select_mode options_select_mode, created_at timestamptz)
  - `time_slots` (id UUID PK, service_id UUID FK -> services.id RESTRICT, starts_at timestamptz, duration_minutes int, capacity int, booked_count int, price text, created_at timestamptz)
  - `bookings` (id UUID PK, time_slot_id UUID FK -> time_slots.id RESTRICT, status booking_status, seats int, guest_name text, guest_messenger messenger_kind, guest_messenger_id text, guest_messenger_login text, guest_locale text, manage_token text, manage_token_hash text UNIQUE, selected_options text[], created_at timestamptz, manage_token_expires_at timestamptz)
  - `notification_outbox` (id UUID PK, queue text, payload jsonb, status outbox_status, attempts int, next_attempt_at timestamptz, last_error text, trace_id text, created_at timestamptz)
- **Indexes & Checks:**
  - Unique index on `bookings(time_slot_id, guest_messenger, guest_messenger_id)` where `status = 'confirmed'`.
  - Check constraints for text lengths, `capacity >= 1`, `booked_count >= 0`.

#### 1.4 Update Test Fixtures
In `apps/web/tests_py/conftest.py`:
- Update `_migrate(url: str)` to run `alembic.command.upgrade(alembic_cfg, "head")` instead of manually iterating over `packages/db/drizzle/*.sql`.

---

### Phase 2: SQLAlchemy 2.0 Declarative Models

**Objective:** Create modern, strictly typed SQLAlchemy 2.0 models using `Mapped[...]` and `mapped_column(...)`.

#### 2.1 Directory Structure
Create `apps/web/api/_lib/countmein/models/`:
- `__init__.py`: Export all models and `Base`.
- `base.py`: `DeclarativeBase` subclass.
- `organizer.py`: `Organizer` model.
- `service.py`: `Service` model.
- `time_slot.py`: `TimeSlot` model.
- `booking.py`: `Booking` model.
- `outbox.py`: `OutboxMessage` model.

#### 2.2 Model Specifications
- Use `UUID` (as Python `str` or `uuid.UUID`) mapped to Postgres UUID.
- Explicit relationships:
  - `Organizer.services`: `relationship("Service", back_populates="organizer", lazy="raise")`
  - `Service.organizer`: `relationship("Organizer", back_populates="services", lazy="raise")`
  - `Service.time_slots`: `relationship("TimeSlot", back_populates="service", lazy="raise")`
  - `TimeSlot.service`: `relationship("Service", back_populates="time_slots", lazy="raise")`
  - `TimeSlot.bookings`: `relationship("Booking", back_populates="time_slot", lazy="raise")`
  - `Booking.time_slot`: `relationship("TimeSlot", back_populates="bookings", lazy="raise")`
  *(Note: `lazy="raise"` prevents silent async `MissingGreenlet` errors; relationships must be explicitly joined or loaded with `selectinload`)*.

---

### Phase 3: Repositories & Elimination of Tuple Unpacking

**Objective:** Replace raw SQL text, tuple index unpacking (`row[0] ... row[47]`), and string concatenation with typed SQLAlchemy 2.0 Core/ORM queries.

#### 3.1 Repository Modules
Create `apps/web/api/_lib/countmein/repositories/`:
- `organizer_repo.py`:
  - `get_by_id(session: AsyncSession, organizer_id: str) -> Organizer | None`
  - `get_by_slug(session: AsyncSession, slug: str) -> Organizer | None`
  - `get_by_messenger(session: AsyncSession, messenger: str, messenger_id: str) -> Organizer | None`
  - `list_public_slugs(session: AsyncSession) -> list[str]`
- `service_repo.py`:
  - `list_by_organizer(session: AsyncSession, organizer_id: str) -> list[Service]`
  - `get_owned_service(session: AsyncSession, organizer_id: str, service_id: str) -> Service | None`
  - `create_service(session: AsyncSession, service: Service) -> Service`
  - `update_service_merge_patch(session: AsyncSession, organizer_id: str, service_id: str, touched_values: dict[str, Any]) -> Service | None`
    *(Use SQLAlchemy Core `update(Service).where(...).values(**touched_values).returning(Service)` instead of string concatenation)*.
  - `count_bookings_for_service(session: AsyncSession, service_id: str) -> int`
  - `delete_owned_service(session: AsyncSession, organizer_id: str, service_id: str) -> bool`
- `slot_repo.py`:
  - `list_by_service(session: AsyncSession, service_id: str) -> list[TimeSlot]`
  - `list_upcoming_by_services(session: AsyncSession, service_ids: list[str], from_time: datetime) -> list[TimeSlot]`
  - `get_slot_with_parents(session: AsyncSession, slot_id: str) -> tuple[TimeSlot, Service, Organizer] | None`
  - `create_slot(session: AsyncSession, slot: TimeSlot) -> TimeSlot`
  - `update_slot_merge_patch(session: AsyncSession, slot_id: str, touched_values: dict[str, Any]) -> TimeSlot | None`
  - `delete_slot(session: AsyncSession, slot_id: str) -> bool`
- `booking_repo.py`:
  - **Atomic Reserve:**
    ```python
    stmt = (
        update(TimeSlot)
        .where(
            TimeSlot.id == slot_id,
            TimeSlot.booked_count + seats <= TimeSlot.capacity,
        )
        .values(booked_count=TimeSlot.booked_count + seats)
        .returning(TimeSlot)
    )
    result = await session.execute(stmt)
    claimed_slot = result.scalar_one_or_none()
    ```
  - **Cancel & Release Capacity:**
    ```python
    # Set status = 'cancelled' and decrement booked_count by seats in one transaction
    ```
  - `get_by_manage_token_hash(session: AsyncSession, token_hash: str) -> BookingChain | None`
  - `list_by_organizer(session: AsyncSession, organizer_id: str) -> list[Booking]`
  - `get_analytics_summary(session: AsyncSession, organizer_id: str) -> AnalyticsSummary`
- `outbox_repo.py`:
  - `enqueue_outbox(session: AsyncSession, rows: list[OutboxRow]) -> None`

#### 3.2 Refactor `rows.py` and `booking_writes.py`
- Replace tuple positional indexing (`row[0] ... row[47]`) by mapping directly from SQLAlchemy model instances or `result.mappings()`.
- Ensure `test_seat_reserve_is_single_conditional_update` in `tests_py/test_invariants.py` passes by keeping the SQL update predicate in `booking_repo.py` or `booking_writes.py`.

---

### Phase 4: API Surface Expansion for SSR Reads

**Objective:** Add the necessary read endpoints to FastAPI so Next.js App Router can SSR all pages via HTTP instead of direct SQL.

#### 4.1 Define Routes in `@repo/contracts`
In `packages/contracts/src/routes.ts` and `packages/contracts/src/wire.ts`:
1. `GET /api/public/organizers/{slug}` (`getPublicOrganizerBySlug`):
   - Auth: `public`
   - Returns: Public organizer profile, list of active services, and upcoming time slots.
2. `GET /api/public/services/{id}` (`getPublicService`):
   - Auth: `public`
   - Returns: Public service details with upcoming slots.
3. `GET /api/public/sitemap` (`getPublicSitemap`):
   - Auth: `public`
   - Returns: List of all public organizer slugs and service IDs for XML sitemap generation.
4. `GET /api/bookings/{manageToken}` (`getGuestBookingByManageToken`):
   - Auth: `public` (validated by `manageToken` path parameter)
   - Returns: `GuestBooking` with `canCancel` boolean.
5. `GET /api/cabinet/summary` (`getCabinetSummary`):
   - Auth: `sessionOrDemoRead`
   - Returns: Aggregated counts, upcoming slots, recent bookings, and services for `/cabinet`.
6. `POST /api/internal/auth/organizer-by-messenger`:
   - Auth: Internal Secret Header (`X-Internal-Secret` matching `INTERNAL_SERVICE_SECRET` derived from `AUTH_SECRET`).
   - Request: `{ messenger: "telegram", messengerId: string }`
   - Returns: `{ id: string, name: string, slug: string } | null`
   - Used by Auth.js `telegram-provider.ts` to verify existing accounts.

#### 4.2 Codegen Execution
Run:
```sh
bun run generate:py
```
This updates `apps/web/openapi.yaml`, `constants_gen.py`, and `models_gen.py`.

#### 4.3 Implement Route Handlers
In `apps/web/api/_lib/countmein/routes/`:
- Create `public.py` (handling `/api/public/*`).
- Create `internal.py` (handling `/api/internal/*`).
- Update `bookings.py` with `GET /api/bookings/{manageToken}`.
- Update `organizers.py` with `GET /api/cabinet/summary`.
- Ensure all new routes are registered in `apps/web/api/_lib/countmein/routes/__init__.py`.
- Update `apps/web/vercel.json` rewrites to forward `/api/public/:path*` and `/api/internal/:path*` to `api/index.py`.
- Verify `tests_py/test_route_set.py` and `tests_py/test_vercel_json.py` pass.

---

### Phase 5: Next.js Frontend Refactoring (BFF & SSR)

**Objective:** Remove all direct PostgreSQL access (`@repo/db`) from `apps/web/src/`.

#### 5.1 Create Server-Side API Client
Create `apps/web/src/server/api-client.ts`:
- Uses standard Next.js `fetch` with `next: { tags: [...] }` and `cache` control.
- Injects `X-Organizer-Auth` header automatically when called within an authenticated session context.
- Implements typed methods:
  - `getPublicOrganizer(slug: string)`
  - `getPublicService(id: string)`
  - `getPublicSitemap()`
  - `getGuestBooking(manageToken: string)`
  - `getCabinetSummary(authHeader?: string)`
  - `getOrganizerByMessenger(messenger: string, messengerId: string)`

#### 5.2 Refactor Next.js Pages & Server Components
Replace imports from `@/server/db/*` with `@/server/api-client`:
1. `apps/web/src/app/(guest)/[orgSlug]/page.tsx`
2. `apps/web/src/app/(guest)/[orgSlug]/[serviceId]/page.tsx`
3. `apps/web/src/app/(guest)/booking/[manageToken]/page.tsx`
4. `apps/web/src/app/cabinet/page.tsx`
5. `apps/web/src/app/cabinet/bookings/page.tsx`
6. `apps/web/src/app/cabinet/slots/page.tsx`
7. `apps/web/src/app/cabinet/services/page.tsx` & `[id]/page.tsx`
8. `apps/web/src/app/cabinet/calendar/page.tsx`
9. `apps/web/src/app/cabinet/analytics/page.tsx`
10. `apps/web/src/app/sitemap.ts`
11. `apps/web/src/app/(guest)/[orgSlug]/opengraph-image.tsx` & `[serviceId]/opengraph-image.tsx`

#### 5.3 Refactor Auth.js Provider
In `apps/web/src/server/auth/telegram-provider.ts`:
- Remove `import { db, organizers } from '@repo/db'`.
- Replace `db.query.organizers.findFirst` with `apiClient.internal.getOrganizerByMessenger('telegram', telegramUser.id)`.

#### 5.4 Remove `@repo/db` from Next.js
- Delete directory `apps/web/src/server/db/`.
- Remove `"@repo/db": "workspace:*"` from `apps/web/package.json`.
- Remove `@repo/db` alias from `apps/web/vitest.config.ts` and `apps/web/next.config.js`.
- Archive/delete `packages/db`.

---

### Phase 6: Containerization & Dual-Runtime Database Pooling

**Objective:** Enable zero-config local development and AWS ECS deployment while preserving Vercel Serverless functionality.

#### 6.1 Configurable Engine Pooling
In `apps/web/api/_lib/countmein/db/client.py`:
```python
is_vercel = os.getenv("VERCEL", "0") == "1"

if is_vercel:
    # Serverless mode: no connection leaks across frozen instances
    pool = NullPool
    connect_args = {"prepare_threshold": None, "connect_timeout": 5}
else:
    # Long-running container mode (AWS ECS / Docker)
    pool = AsyncAdaptedQueuePool
    connect_args = {"prepare_threshold": 5, "connect_timeout": 10}
```

#### 6.2 Dockerfile for Python API
Create `apps/web/Dockerfile`:
- Multi-stage build using `python:3.12-slim`.
- Installs dependencies using `uv`.
- Runs `uvicorn countmein.app:app --host 0.0.0.0 --port 3001` with a non-root user.

#### 6.3 Root `docker-compose.yml`
Create `docker-compose.yml` in project root:
- `postgres`: PostgreSQL 17 with healthcheck.
- `redis`: Redis 7 alpine with healthcheck.
- `api`: Builds `apps/web/Dockerfile`, runs migrations on startup (`alembic upgrade head`).
- `web`: Next.js web application connected to `api`.

---

## 4. Step-by-Step Execution Plan

Follow these exact steps in sequence to ensure CI remains green throughout:

| Step | Action | Files Touched | Verification Command |
| :--- | :--- | :--- | :--- |
| **1.1** | Add `alembic` to Python dependencies | `apps/web/pyproject.toml`, `requirements.txt` | `uv lock && bun run lint:py` |
| **1.2** | Configure Alembic & create `0001_initial_schema.py` | `apps/web/alembic/`, `apps/web/alembic.ini` | `uv run alembic check` |
| **1.3** | Create SQLAlchemy 2.0 declarative models | `apps/web/api/_lib/countmein/models/*` | `uv run mypy api/_lib` |
| **1.4** | Implement repositories & eliminate tuple unpacking | `apps/web/api/_lib/countmein/repositories/*`, `db/rows.py` | `cd apps/web && uv run pytest tests_py/db` |
| **2.1** | Define new SSR read endpoints in contracts | `packages/contracts/src/routes.ts`, `wire.ts` | `bun run generate:py` |
| **2.2** | Implement FastAPI routes for SSR reads | `apps/web/api/_lib/countmein/routes/*`, `vercel.json` | `uv run pytest tests_py/test_route_set.py` |
| **2.3** | Verify parity golden tests & invariant tests | `tests_py/parity/*`, `tests_py/test_invariants.py` | `cd apps/web && bun run test:py` |
| **3.1** | Implement Next.js server API client | `apps/web/src/server/api-client.ts` | `bun run check-types` |
| **3.2** | Migrate `telegram-provider.ts` to API client | `apps/web/src/server/auth/telegram-provider.ts` | `bun run test:web` |
| **3.3** | Migrate Next.js App Router pages to API client | `apps/web/src/app/**/page.tsx`, `sitemap.ts` | `bun run check-types && bun run test:web` |
| **3.4** | Remove `apps/web/src/server/db/` & `@repo/db` | `apps/web/src/server/db/`, `packages/db/` | `bun run check-types && bun run build` |
| **4.1** | Add `Dockerfile` and `docker-compose.yml` | `apps/web/Dockerfile`, `docker-compose.yml` | `docker compose config` |
| **4.2** | Final full-suite verification | All packages | Full CI pipeline (see Section 5) |

---

## 5. Definition of Done & Verification Checklist

Before considering the refactoring complete, every single one of the following commands must execute cleanly with zero errors:

1. **TypeScript Type Checking:**
   ```sh
   bun run check-types
   ```
   *(Must pass with 0 errors across `@repo/contracts`, `@repo/translations`, and `web`)*.

2. **Frontend Unit & Component Tests:**
   ```sh
   bun run test:web
   ```
   *(All 340+ vitest tests pass)*.

3. **Frontend Linting:**
   ```sh
   bun run lint
   ```
   *(ESLint passes with 0 warnings)*.

4. **Python Linting & Formatting:**
   ```sh
   cd apps/web && uv run ruff check . && uv run ruff format --check .
   ```

5. **Python Strict Type Checking:**
   ```sh
   cd apps/web && uv run mypy
   ```
   *(mypy --strict passes with 0 errors in all source files)*.

6. **Python Full Pytest Suite:**
   ```sh
   cd apps/web && uv run pytest -n auto
   ```
   *(All unit, parity replay, golden coverage, and invariant tests pass)*.

7. **Next.js Production Build:**
   ```sh
   bun run build
   ```
   *(Production build succeeds, generating all static and dynamic route types)*.
