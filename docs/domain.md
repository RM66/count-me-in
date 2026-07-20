# Domain model

Core entities and invariants for CountMeIn booking. Architecture context: [architecture.md](architecture.md).

There is **no `Calendar` entity**. An organizer owns services directly; timezone lives on the organizer (one working timezone per organizer).

## Entities

```mermaid
erDiagram
  Organizer ||--o{ Service : owns
  Service ||--o{ TimeSlot : has
  TimeSlot ||--o{ Booking : fills

  Organizer {
    string id PK
    string slug UK
    string name
    string phone UK
    string timezone
    string description_md "optional"
    string photoUrl "optional"
    string messenger
    datetime createdAt
  }
  Service {
    string id PK
    string organizerId FK
    string title
    string description "optional"
    string photoUrl "optional"
    string defaultPrice
    int defaultCapacity
    int defaultDurationMinutes
    string_array options "optional"
    enum optionsSelectMode "single|multi"
    datetime createdAt
  }
  TimeSlot {
    string id PK
    string serviceId FK
    datetime startsAt
    int durationMinutes
    datetime endsAt "generated"
    int capacity
    int bookedCount
    string price "optional override"
    datetime createdAt
  }
  Booking {
    string id PK
    string timeSlotId FK
    enum status
    int seats
    string guestName
    string guestPhone
    string messenger
    string manageToken
    string_array selectedOptions "optional"
    datetime createdAt
  }
```

Foreign keys on ER diagrams are the relationship lines (`organizerId`, `serviceId`, `timeSlotId`); they become real columns in Drizzle.

An organizer reaches their bookings **transitively** (`Organizer → Service → TimeSlot → Booking`); there is no direct `Booking.organizerId` column (invariant 5).

### Identifiers and public URLs

| Entity      | PK type                        | Exposed in URL?                         |
| ----------- | ------------------------------ | --------------------------------------- |
| `Organizer` | `uuid` (Auth.js user id)       | No — public page uses `slug`            |
| `Service`   | short `text` id (nanoid/cuid2) | Yes — clean, URL-friendly               |
| `TimeSlot`  | `uuid`                         | No — no public URL                      |
| `Booking`   | `uuid`                         | No — management page uses `manageToken` |

- Organizer as a provider: `https://countmein.group/{orgSlug}`.
- A specific service/event: `https://countmein.group/{orgSlug}/{serviceId}`.
- Booking management: `https://countmein.group/b/{manageToken}`.

`Organizer.id` stays `uuid` for frictionless Auth.js integration and is never shown; the human-friendly organizer address is `slug`. `Service.id` is a short random `text` id so it reads well in the URL (services have no slug). `TimeSlot`/`Booking` ids are internal `uuid`s.

### Organizer

The authenticated account itself (`id` is the sole primary key). Auth.js uses this id as the user subject — **no separate `userId`**.

Public page: `https://countmein.group/{slug}`.

| Field         | Required | Meaning                                                                                           |
| ------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `id`          | yes      | PK; Auth.js user id                                                                               |
| `slug`        | yes      | Public URL segment                                                                                |
| `name`        | yes      | Display name                                                                                      |
| `phone`       | yes      | E.164; login identity (stored `varchar(16)`, canonical E.164; unique — normalize before insert)   |
| `timezone`    | yes      | IANA tz (e.g. `Europe/Belgrade`); all slots interpreted in this zone                              |
| `description` | no       | Markdown (links allowed) for the public page                                                      |
| `photoUrl`    | no       | Avatar / cover image (object storage URL)                                                         |
| `messenger`   | yes      | Channel used for OTP/notifications (e.g. `telegram`); set at sign-up, reused for later OTP/notify |
| `createdAt`   | yes      | Row creation timestamp (UTC)                                                                      |

MVP: one organizer account = one person. Multi-staff is post-MVP.

### Service

Bookable offering owned by an organizer (`organizerId`).

| Field                    | Required           | Meaning                                                                                  |
| ------------------------ | ------------------ | ---------------------------------------------------------------------------------------- |
| `organizerId`            | yes                | FK → Organizer                                                                           |
| `title`                  | yes                | Name                                                                                     |
| `description`            | no                 | Longer text                                                                              |
| `photoUrl`               | no                 | Service image                                                                            |
| `defaultPrice`           | yes                | **Display text** for value + currency (e.g. `1500 UAH`, `от 20€`) — not a payment amount |
| `defaultCapacity`        | yes                | Template for new slots (capacity)                                                        |
| `defaultDurationMinutes` | yes                | Template for new slots (length, minutes); `> 0`                                          |
| `options`                | no                 | Allowed variation labels (e.g. pickup points) as **plain strings** (stored `text[]`)     |
| `optionsSelectMode`      | when `options` set | `single` (pick one) or `multi` (pick several)                                            |
| `createdAt`              | yes                | Row creation timestamp (UTC)                                                             |

`options` are deliberately plain strings (not a separate entity with IDs) to keep the MVP simple. Because `Booking.selectedOptions` stores the chosen **string values** (not references), a booking keeps the exact label it was made with even if the organizer later edits or removes that option from the service. This is an intentional trade-off: no referential integrity, but immutable, self-contained booking records.

### TimeSlot

Concrete occurrence of a service (`serviceId`). Defined by a start instant and a length; the end is derived.

| Field             | Required | Meaning                                                                                                       |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `serviceId`       | yes      | FK → Service                                                                                                  |
| `startsAt`        | yes      | Start instant (`timestamptz`, UTC; displayed in the organizer's timezone)                                     |
| `durationMinutes` | yes      | Length in whole minutes; `> 0`. Seeded from `Service.defaultDurationMinutes` on creation                      |
| `endsAt`          | derived  | **Generated** column = `startsAt + durationMinutes` (stored, for range queries/sorting; not written directly) |
| `capacity`        | yes      | Max seats                                                                                                     |
| `bookedCount`     | yes      | Seats held by `confirmed` bookings                                                                            |
| `price`           | no       | Display-text override for this occurrence; if null, use `Service.defaultPrice`                                |
| `createdAt`       | yes      | Row creation timestamp (UTC)                                                                                  |

The interval convention is half-open `[startsAt, endsAt)`. `durationMinutes` is the source of truth (organizers think “start + length”); `endsAt` exists only as a derived, indexable column.

### Booking

Reservation on a slot (`timeSlotId`) by a guest (no visitor Auth.js account).

| Field             | Required | Meaning                                                                                                                                         |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeSlotId`      | yes      | FK → TimeSlot                                                                                                                                   |
| `seats`           | yes      | `>= 1`                                                                                                                                          |
| `guestName`       | yes      | Display name                                                                                                                                    |
| `guestPhone`      | yes      | E.164; OTP target (stored `varchar(16)`, canonical E.164)                                                                                       |
| `messenger`       | yes      | Channel that delivered the guest OTP (e.g. `telegram`); reused for confirmation/cancel notifications                                            |
| `manageToken`     | yes      | Opaque secret embedded in the messenger deep link to the booking management page; **stored hashed** at rest                                     |
| `selectedOptions` | no       | String values chosen from `Service.options` at booking time (stored by value as `text[]`; `null` when the service has no options — see Service) |
| `status`          | yes      | Lifecycle                                                                                                                                       |
| `createdAt`       | yes      | Row creation timestamp (UTC)                                                                                                                    |

Validation: every `selectedOptions` entry must be in the service’s `options`; count must respect `optionsSelectMode`.

## Booking statuses

| Status      | Meaning                                  |
| ----------- | ---------------------------------------- |
| `confirmed` | Active; counts toward `bookedCount`      |
| `cancelled` | Released; must not count toward capacity |

MVP flow: messenger OTP verifies the phone **before** any booking row exists; then one transaction claims the seats and inserts the `confirmed` booking (see invariant 2). **No `pending` status.**

**Cancel is in MVP.** The guest opens the booking management page (deep link from the messenger, or phone + OTP lookup); the organizer can also cancel from the cabinet. Cancelling sets `cancelled` and decrements `bookedCount` in the same transaction.

## Invariants

1. **Capacity:** for every slot, sum of `seats` over `confirmed` bookings equals `bookedCount`, and `bookedCount <= capacity`.
2. **Atomic reserve:** seats are claimed with a **single conditional statement** — `UPDATE TimeSlot SET bookedCount = bookedCount + :seats WHERE id = :id AND bookedCount + :seats <= capacity RETURNING …` — inside the booking transaction. The `Booking` row is inserted only if that statement affected a row. Never read `bookedCount`, check it in application code, then write it back separately: that reopens the overbooking race under concurrent bookings.
3. **Public access:** visitors read/book only via organizer `slug`; no organizer dashboard APIs.
4. **Slot bounds:** `durationMinutes >= 1` (so `endsAt > startsAt`); `capacity >= 1`; `seats >= 1`.
5. **Ownership:** `Service.organizerId` → organizer; `TimeSlot.serviceId` → service; `Booking.timeSlotId` → slot; organizer sees bookings for their services.
6. **Options:** if service has `options`, booking’s `selectedOptions` must be a valid selection per `optionsSelectMode`; if no `options`, `selectedOptions` is `null`.
7. **Price:** informational display only in MVP — no checkout or payment state.

## Payments

Out of scope for MVP as processing. `defaultPrice` / slot `price` are human-readable labels for the public page and booking UI only.
