# JSON wire encoding rules (Phase 1.3)

Byte-compatible responses require reproducing Go's `encoding/json` behavior exactly. Sources: `pkg/httpx/response.go` (`Response.Write`), `pkg/api/server.go` (healthz), golden transcripts.

## Response writing

- `httpx.Response.Write` uses `json.Marshal` (NOT `json.Encoder`) → **no trailing newline**, `Content-Type: application/json`, explicit `Content-Length` set before the status line.
- `handleHealthz` uses `json.NewEncoder(w).Encode(...)` → **trailing `\n`** after the JSON object. The Python port must reproduce this asymmetry.
- Marshal failure → logged, bare 500, no body.
- `Body == nil` → status only, empty body (e.g. 204, 500 from `Internal()`).

## Value encoding (Go `encoding/json` defaults)

| Rule           | Go behavior                                                                                                                     | Python port requirement                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| HTML escaping  | `<`, `>`, `&` escape as `\u003c`, `\u003e`, `\u0026` in strings (Marshal default; `Encoder` same unless `SetEscapeHTML(false)`) | do NOT use `ensure_ascii=False` naively; escape exactly these three                                       |
| Timestamps     | `time.Time` → RFC3339 with nanoseconds trimmed to 3/6/9 digits (RFC3339Nano)                                                    | match the trimmed-nanoseconds form; goldens show the exact shapes                                         |
| `omitempty`    | field absent when zero value                                                                                                    | Pydantic `exclude_none`/custom — per-field, from the generated models                                     |
| no `omitempty` | pointer nil → `null` present                                                                                                    | field present with `null`                                                                                 |
| Key order      | struct field declaration order (NOT alphabetical)                                                                               | emit via explicit field order (Pydantic model field order matches the generated models; do not sort keys) |
| Numbers        | integers plain; floats via shortest representation                                                                              | —                                                                                                         |
| Maps           | keys sorted alphabetically (Go sorts map keys)                                                                                  | sort keys for any `map[string]…` payload (e.g. `fieldErrors`)                                             |

## Known shapes to watch

- Error envelope: `{"error": "<localized>", "code": …}` — `code` is `omitempty` (absent unless set); `seatsLeft`/`maxSeats` extras likewise.
- Validation details: `{"error": …, "details": {"formErrors": […], "fieldErrors": {…}}}` — `fieldErrors` is a map → keys sorted.
- `InvalidIssuesBody`: `{"error": …, "issues": {…}}` — map, sorted keys.
- Healthz: `{"postgres":"ok","redis":"ok"}` — map, sorted keys, trailing `\n`.

Phase 3.1 verification: golden transcripts are the byte-level oracle; the replay test compares parsed JSON plus these encoding rules (key order, escaping, trailing newline) rather than raw bytes, so both layers are pinned.
