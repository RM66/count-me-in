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

### Phase 4: API Surface Expansion for SSR Reads (Vertical Slices)

**Objective:** Add the necessary read and lookup endpoints to FastAPI so Next.js App Router can SSR all pages and Auth.js can authenticate via HTTP instead of direct SQL. To prevent stalls and maintain a green CI state, Phase 4 is executed in strictly isolated vertical slices (4.0 through 4.6). Each slice delivers wire schemas, OpenAPI updates, generated models, FastAPI handlers, Vercel rewrites, and full parity verification.

#### Invariants & Contract Resolutions for Phase 4:
1. **`ApiAuth = 'internal'`**: Support a dedicated `internal` auth mode for service-to-service calls between Next.js server actions / Auth.js and Python API. Authenticated via `x-internal-secret` header verified in constant time (`hmac.compare_digest`) against a key derived from `AUTH_SECRET` via HKDF-SHA256 (`CountMeIn Internal Service Key v1`).
2. **`manageToken` in Request Body (`POST /api/bookings/manage-lookup`)**: Preserves the core invariant from `AGENTS.md` (manageToken never appears in URL paths, query parameters, or Referer headers). Validated via SHA-256 hash `manage_token_hash` against `manage_token_expires_at` grace window.
3. **No Nullable Top-Level Wire Envelopes**: Avoid `{ ... } | null` at root. Missing entities return HTTP 404 with standard `ErrorBody`.
4. **Strict Response Statuses**: Every route declares status 500 (`INTERNAL`), rate-limited routes declare 429 (`TOO_MANY`), and protected routes declare standard error envelopes (401/403/404).

---

#### Slice 4.0: Contract & API Infrastructure Setup
- **`packages/contracts/src/routes.ts`**:
  - Add `'internal'` to `ApiAuth` union type.
- **`packages/contracts/src/openapi.ts`**:
  - Map `auth === 'internal'` to `security: [{ internalSecret: [] }]`.
  - Add `internalSecret` to `components.securitySchemes`: API key in header `x-internal-secret`.
- **`apps/web/api/_lib/countmein/auth/internal.py`**:
  - Implement HKDF derivation of internal signing key from `AUTH_SECRET`.
  - Constant-time verification helper `verify_internal_secret(secret: str) -> bool`.
- **`apps/web/api/_lib/countmein/web/deps.py`**:
  - Add dependency `require_internal_secret(request: Request) -> None` raising 401 on invalid/missing secret.
- **Verification:**
  ```sh
  bun run test:web
  ```

---

#### Slice 4.1: Public Organizer Profile & Catalog (`GET /api/public/organizers/{slug}`)
- **Purpose:** Supplies data for `/{orgSlug}` public page and OG image (`generateMetadata`, `OrganizerPage`).
- **Wire Contract (`@repo/contracts`):**
  - Schema: `publicOrganizerViewEnvelope = z.object({ organizer: publicOrganizer, services: z.array(serviceRecord), slots: z.array(timeSlotRecord) })`.
  - Registered in `wire.ts`: `{ id: 'PublicOrganizerViewEnvelope' }`.
  - Golden Sample: Add `PublicOrganizerViewEnvelope` to `RECORD_NAMES` in `tests_py/contracts/test_golden.py` and commit golden JSON fixture.
  - Route in `routes.ts`:
    - `operationId: 'getPublicOrganizer'`
    - `method: 'get'`, `path: '/api/public/organizers/{slug}'`
    - `auth: 'public'`
    - `params: [{ name: 'slug', in: 'path', required: true, schema: slugShape }]`
    - `rateLimit: { limit: 60, windowSeconds: 60, per: 'ip' }`
    - `responses`: 200 (`publicOrganizerViewEnvelope`), 404 (`errorBody`), 429 (`TOO_MANY`), 500 (`INTERNAL`).
- **Python Implementation:**
  - Route module: `apps/web/api/_lib/countmein/routes/public.py` -> `get_public_organizer`.
  - Queries `organizer_repo.get_by_slug`, `service_repo.list_by_organizer`, `slot_repo.list_upcoming_by_services`.
  - Register in `routes/__init__.py`.
  - Add rewrite in `apps/web/vercel.json`: `{"source": "/api/public/:path*", "destination": "/api/index?_path=/api/public/:path*"}`.
- **Verification:**
  ```sh
  bun run generate:py
  cd apps/web && uv run pytest tests_py/test_route_set.py tests_py/test_vercel_json.py tests_py/contracts/test_golden.py
  bun run test:web
  ```

---

#### Slice 4.2: Public Service Details (`GET /api/public/services/{id}`)
- **Purpose:** Supplies data for `/{orgSlug}/{serviceId}` public booking page (`ServicePage`, `resolveService`, `generateMetadata`).
- **Wire Contract (`@repo/contracts`):**
  - Schema: `publicServiceViewEnvelope = z.object({ service: serviceRecord, organizer: publicOrganizer, slots: z.array(timeSlotRecord) })`.
  - Registered in `wire.ts`: `{ id: 'PublicServiceViewEnvelope' }`.
  - Golden Sample: Add `PublicServiceViewEnvelope` to `RECORD_NAMES` in `tests_py/contracts/test_golden.py` and commit golden JSON fixture.
  - Route in `routes.ts`:
    - `operationId: 'getPublicService'`
    - `method: 'get'`, `path: '/api/public/services/{id}'`
    - `auth: 'public'`
    - `params: [{ name: 'id', in: 'path', required: true, schema: serviceId }]`
    - `rateLimit: { limit: 60, windowSeconds: 60, per: 'ip' }`
    - `responses`: 200 (`publicServiceViewEnvelope`), 404 (`errorBody`), 429 (`TOO_MANY`), 500 (`INTERNAL`).
- **Python Implementation:**
  - Route handler in `routes/public.py` -> `get_public_service`.
  - Joins `Service` -> `Organizer`, fetches upcoming slots with `slot_repo.list_upcoming_by_services`.
  - Register in `routes/__init__.py`.
- **Verification:**
  ```sh
  bun run generate:py
  cd apps/web && uv run pytest tests_py/test_route_set.py tests_py/contracts/test_golden.py
  bun run test:web
  ```

---

#### Slice 4.3: Public Sitemap Catalog (`GET /api/public/sitemap`)
- **Purpose:** Supplies data for Next.js App Router dynamic sitemap (`app/sitemap.ts`).
- **Wire Contract (`@repo/contracts`):**
  - Schemas:
    - `sitemapOrganizerEntry = z.object({ slug: slugShape })`
    - `sitemapServiceEntry = z.object({ orgSlug: slugShape, serviceId: serviceId })`
    - `publicSitemapEnvelope = z.object({ organizers: z.array(sitemapOrganizerEntry), services: z.array(sitemapServiceEntry) })`
  - Registered in `wire.ts`: `SitemapOrganizerEntry`, `SitemapServiceEntry`, `PublicSitemapEnvelope`.
  - Golden Sample: Add `PublicSitemapEnvelope` to `RECORD_NAMES` in `tests_py/contracts/test_golden.py` and commit golden JSON fixture.
  - Route in `routes.ts`:
    - `operationId: 'getPublicSitemap'`
    - `method: 'get'`, `path: '/api/public/sitemap'`
    - `auth: 'public'`
    - `rateLimit: { limit: 10, windowSeconds: 60, per: 'ip' }`
    - `responses`: 200 (`publicSitemapEnvelope`), 429 (`TOO_MANY`), 500 (`INTERNAL`).
- **Python Implementation:**
  - Route handler in `routes/public.py` -> `get_public_sitemap`.
  - Uses `organizer_repo.list_public_slugs` and service join.
  - Register in `routes/__init__.py`.
- **Verification:**
  ```sh
  bun run generate:py
  cd apps/web && uv run pytest tests_py/test_route_set.py tests_py/contracts/test_golden.py
  bun run test:web
  ```

---

#### Slice 4.4: Guest Booking Manage Lookup (`POST /api/bookings/manage-lookup`)
- **Purpose:** Allows guests to load their booking management page (`/booking/{manageToken}`) without leaking credentials in URL paths.
- **Wire Contract (`@repo/contracts`):**
  - Input Schema: `lookupBookingByTokenInput = z.object({ manageToken })`.
  - Registered in `wire.ts`: `{ id: 'LookupBookingByTokenInput' }`.
  - Validation Vector: `packages/contracts/vectors/validation/LookupBookingByTokenInput.json`.
  - Response Schema: Reuses existing `guestBookingEnvelope = z.object({ booking: guestBooking })` (already registered and golden-tested).
  - Route in `routes.ts`:
    - `operationId: 'getBookingByManageToken'`
    - `method: 'post'`, `path: '/api/bookings/manage-lookup'`
    - `auth: 'manageToken'`
    - `request: lookupBookingByTokenInput`
    - `rateLimit: { limit: 10, windowSeconds: 60, per: 'ip' }`
    - `responses`: 200 (`guestBookingEnvelope`), 400 (`invalidBody`), 404 (`errorBody`), 429 (`TOO_MANY`), 500 (`INTERNAL`).
- **Python Implementation:**
  - Route handler in `routes/bookings.py` -> `booking_manage_lookup`.
  - Hashes token via `hash_manage_token`, queries `booking_repo.get_chain_by_manage_token_hash`.
  - Enforces `manage_token_expires_at` check (returns 404 if expired).
  - Register in `routes/__init__.py`.
- **Verification:**
  ```sh
  bun run generate:py
  cd apps/web && uv run pytest tests_py/test_route_set.py
  bun run test:web
  ```

---

#### Slice 4.5: Cabinet Reads (`GET /api/bookings` & `GET /api/cabinet/summary`)
- **Purpose:** Supplies data for `/cabinet`, `/cabinet/bookings`, `/cabinet/services`, and `/cabinet/analytics`.
- **Wire Contract (`@repo/contracts`):**
  - Schemas:
    - `bookingsEnvelope = z.object({ bookings: z.array(bookingRecord) })` (for paginated bookings list).
    - `serviceCountsRecord = z.object({ serviceId: serviceId, upcomingSlotsCount: z.number().int(), confirmedBookingsCount: z.number().int() })`
    - `analyticsTrendDay = z.object({ day: z.string(), bookings: z.number().int(), seats: z.number().int() })`
    - `analyticsServiceCount = z.object({ service: z.string(), bookings: z.number().int() })`
    - `analyticsSummaryRecord = z.object({ totalBookings: z.number().int(), prevTotalBookings: z.number().int(), seatsSold: z.number().int(), prevSeatsSold: z.number().int(), windowBookings: z.number().int(), cancelledInWindow: z.number().int(), trend: z.array(analyticsTrendDay), byService: z.array(analyticsServiceCount) })`
    - `cabinetSummaryEnvelope = z.object({ serviceCounts: z.array(serviceCountsRecord), analytics: analyticsSummaryRecord })`
  - Registered in `wire.ts`: `BookingsEnvelope`, `ServiceCountsRecord`, `AnalyticsTrendDay`, `AnalyticsServiceCount`, `AnalyticsSummaryRecord`, `CabinetSummaryEnvelope`.
  - Golden Samples: Add `BookingsEnvelope` and `CabinetSummaryEnvelope` to `RECORD_NAMES` in `tests_py/contracts/test_golden.py` and commit golden JSON fixtures.
  - Routes in `routes.ts`:
    - `listBookings`:
      - `method: 'get'`, `path: '/api/bookings'`
      - `auth: 'sessionOrDemoRead'`
      - `params`: `limit` (query int optional default 50), `offset` (query int optional default 0)
      - `responses`: 200 (`bookingsEnvelope`), 500 (`INTERNAL`).
    - `getCabinetSummary`:
      - `method: 'get'`, `path: '/api/cabinet/summary'`
      - `auth: 'sessionOrDemoRead'`
      - `responses`: 200 (`cabinetSummaryEnvelope`), 500 (`INTERNAL`).
- **Python Implementation:**
  - Route handler `routes/bookings.py` -> `bookings_list` using `cabinet_organizer(request)`.
  - Route module `routes/cabinet.py` -> `cabinet_summary` using `cabinet_organizer(request)`.
  - Add rewrite in `apps/web/vercel.json`: `{"source": "/api/cabinet/:path*", "destination": "/api/index?_path=/api/cabinet/:path*"}`.
  - Register in `routes/__init__.py`.
- **Verification:**
  ```sh
  bun run generate:py
  cd apps/web && uv run pytest tests_py/test_route_set.py tests_py/test_vercel_json.py tests_py/contracts/test_golden.py
  bun run test:web
  ```

---

#### Slice 4.6: Internal Auth Lookup (`POST /api/internal/auth/organizer-by-messenger`)
- **Purpose:** Used by Auth.js `telegram-provider.ts` to look up organizers by messenger identity or organizer ID without direct SQL.
- **Wire Contract (`@repo/contracts`):**
  - Input Schema:
    ```typescript
    export const internalOrganizerLookupInput = z.object({
      messenger: messengerEnum.optional(),
      messengerId: z.string().optional(),
      organizerId: uuid.optional(),
    })
    ```
  - Output Schema:
    ```typescript
    export const internalOrganizerRecord = z.object({
      id: uuid,
      name: displayName,
      slug: slugShape,
      photoUrl: z.string().nullable().optional(),
    })
    export const internalOrganizerEnvelope = z.object({
      organizer: internalOrganizerRecord,
    })
    ```
  - Registered in `wire.ts`: `InternalOrganizerLookupInput`, `InternalOrganizerRecord`, `InternalOrganizerEnvelope`.
  - Validation Vector: `packages/contracts/vectors/validation/InternalOrganizerLookupInput.json`.
  - Golden Sample: Add `InternalOrganizerEnvelope` to `RECORD_NAMES` in `tests_py/contracts/test_golden.py` and commit golden JSON fixture.
  - Route in `routes.ts`:
    - `operationId: 'getOrganizerByMessenger'`
    - `method: 'post'`, `path: '/api/internal/auth/organizer-by-messenger'`
    - `auth: 'internal'`
    - `request: internalOrganizerLookupInput`
    - `responses`: 200 (`internalOrganizerEnvelope`), 400 (`invalidBody`), 401 (`errorBody`), 404 (`errorBody`), 500 (`INTERNAL`).
- **Python Implementation:**
  - Route module: `apps/web/api/_lib/countmein/routes/internal.py`.
  - Validates `require_internal_secret(request)`.
  - Resolves via `organizer_repo.get_by_id` or `organizer_repo.get_by_messenger`. Raises 404 if not found.
  - Add rewrite in `apps/web/vercel.json`: `{"source": "/api/internal/:path*", "destination": "/api/index?_path=/api/internal/:path*"}`.
  - Register in `routes/__init__.py`.
- **Verification:**
  ```sh
  bun run generate:py
  cd apps/web && uv run pytest tests_py/test_route_set.py tests_py/test_vercel_json.py tests_py/contracts/test_golden.py
  bun run test:web
  ```

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
| **4.0** | Contract & API infra setup (`ApiAuth='internal'`, guard) | `packages/contracts/src/*`, `api/_lib/countmein/auth/*` | `bun run test:web` |
| **4.1** | Slice: Public Organizer View (`GET /api/public/organizers/{slug}`) | `packages/contracts/src/*`, `routes/public.py`, `vercel.json` | `bun run generate:py && cd apps/web && uv run pytest tests_py/test_route_set.py` |
| **4.2** | Slice: Public Service View (`GET /api/public/services/{id}`) | `packages/contracts/src/*`, `routes/public.py` | `bun run generate:py && cd apps/web && uv run pytest tests_py/test_route_set.py` |
| **4.3** | Slice: Public Sitemap (`GET /api/public/sitemap`) | `packages/contracts/src/*`, `routes/public.py` | `bun run generate:py && cd apps/web && uv run pytest tests_py/test_route_set.py` |
| **4.4** | Slice: Guest Booking Lookup (`POST /api/bookings/manage-lookup`) | `packages/contracts/src/*`, `routes/bookings.py` | `bun run generate:py && cd apps/web && uv run pytest tests_py/test_route_set.py` |
| **4.5** | Slice: Cabinet Bookings & Summary (`GET /api/bookings`, `summary`) | `packages/contracts/src/*`, `routes/bookings.py`, `routes/cabinet.py` | `bun run generate:py && cd apps/web && uv run pytest tests_py/test_route_set.py` |
| **4.6** | Slice: Internal Auth Lookup (`POST /api/internal/auth/...`) | `packages/contracts/src/*`, `routes/internal.py` | `bun run generate:py && cd apps/web && uv run pytest tests_py/test_route_set.py` |
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
