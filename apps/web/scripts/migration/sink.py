"""Local recorder sink for outbound calls (Telegram, QStash publish).

Phase 1.4 of the Go→Python migration plan: the Go dev server is started
with env pointing here (QSTASH_URL=http://127.0.0.1:3199, and a Telegram
base override is not possible — see record.py for how Telegram is
handled). Every received call is appended to a JSON list on disk so the
golden transcripts can assert what the API tried to send.

Run:  uv run --project scripts/migration scripts/migration/sink.py <port> <out.json>
"""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


def make_handler(out_path: str) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def _record(self) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b""
            entry = {
                "method": self.command,
                "path": self.path,
                "headers": {
                    k: v
                    for k, v in self.headers.items()
                    if k.lower() not in ("host", "content-length", "authorization")
                },
                "body": body.decode("utf-8", "replace"),
            }
            with open(out_path, "a") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            # QStash publish expects a JSON body with a messageId.
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"messageId":"sink-recorded"}')

        do_POST = _record
        do_PUT = _record
        do_GET = _record

        def log_message(self, *args: object) -> None:  # silence stderr noise
            pass

    return Handler


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3199
    out_path = sys.argv[2] if len(sys.argv) > 2 else "sink-calls.json"
    server = HTTPServer(("127.0.0.1", port), make_handler(out_path))
    print(f"sink listening on 127.0.0.1:{port}, recording to {out_path}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
