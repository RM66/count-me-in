# Parity scenarios (Phase 1.4)

One YAML file per scenario; each is an ordered list of steps executed by `scripts/migration/record.py` against the Go API (and later replayed against the Python API by `tests_py/parity/test_replay.py`).

## Step fields

- `request`: `{method, path, headers?, json?, body_raw?}` — `body_raw` wins over `json` (needed for exact-byte QStash bodies).
- `mint`: run before the request — `{guestTicket|signupTicket|session|demoSession|qstashSignature}`.
- `reset`: `true` — truncate DB + reseed demo + flush Redis before this step.
- `note`: free-form documentation.

## Placeholders (resolved by the recorder, normalized in goldens)

- `<guestTicket>` / `<signupTicket>` — single-use tickets minted into Redis (`auth:ticket:{token}`, same payload shape as `pkg/auth/ticket.go`)
- `<session>` — organizer JWT (`X-Organizer-Auth`), owner of the recorder's seeded rows
- `<demoSession>` — JWT for `DEMO_ORGANIZER_ID`
- `<slotId>` / `<serviceId>` / `<bookingId>` — ids captured from earlier responses in the same scenario
- `<manageToken>` — captured from a `createBooking` response
- `<qstashSignature>` — valid HS256 signature over the step's raw body (current signing key)

## Scenario coverage matrix (plan §1.4)

| Scenario file                      | Covers                                                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| healthz.yaml                       | healthz happy path                                                                                                                                                      |
| healthz-rate-limit.yaml            | rate limit 429 (healthz bucket, 30/min)                                                                                                                                 |
| auth-telegram.yaml                 | telegramGuest/telegramSignup happy path + malformed payload + failed HMAC + rate limit 429                                                                              |
| organizers-register.yaml           | registerOrganizer happy path + validation errors (slug rules) + expired/unknown ticket 401 + slug taken 409                                                             |
| organizers-me.yaml                 | getMyProfile anonymous (demo) + signed-in + 404                                                                                                                         |
| organizers-me-write.yaml           | updateMyProfile merge-patch absent/null + wrong content-type 415 + demo refusal 403 + 404                                                                               |
| organizers-language.yaml           | updateMyLanguage happy 204 + invalid body + demo refusal                                                                                                                |
| media-upload.yaml                  | avatar + service-photo upload targets happy path + invalid body + demo refusal + rate limit 429                                                                         |
| services.yaml                      | listServices (demo + session) + createService happy + validation error + demo refusal                                                                                   |
| services-id.yaml                   | getService 200/404 + updateService merge-patch pair rule + 415 + deleteService 409 guard + 200                                                                          |
| slots.yaml                         | listSlots (+upcoming=1) + createSlot happy + validation error + 404 service                                                                                             |
| slots-id.yaml                      | getSlot 200/404 + updateSlot merge-patch + capacity-below-booked 409 + deleteSlot 409 guard + 200                                                                       |
| bookings-create.yaml               | createBooking happy path + validation error + unknown ticket 401 + demo refusal 403 + sold out 409 + duplicate 409 + party too large 400 + rate limit 429               |
| bookings-create-replay.yaml        | replayed guest ticket (single-use) → 401                                                                                                                                |
| bookings-lookup.yaml               | lookupBookings happy + invalid body + unknown ticket                                                                                                                    |
| bookings-cancel.yaml               | cancelBookingByToken happy + unknown token 404 + already cancelled 409 + invalid body + demo refusal                                                                    |
| bookings-cancel-expired-token.yaml | expired manage token refused on cancel                                                                                                                                  |
| bookings-cancel-organizer.yaml     | cancelBookingByOrganizer happy + anonymous 403 + demo session 403 + foreign service 404 + already cancelled 409                                                         |
| jobs-receiver.yaml                 | runJob: missing signature 401 + bad signature 401 + unknown queue 404 + invalid payload 400 + valid signed delivery 200 (outbox claim) + duplicate outboxId (no resend) |
| jobs-bad-signature.yaml            | QStash signature over mismatched body → 401                                                                                                                             |
