"""Local build assertions (migration plan §6.1).

Usage (from apps/web/, after `bunx vercel build`):
    uv run python scripts/migration/check_bundle.py

Asserts the Vercel build output really contains the Python function:
- .vercel/output/functions/api/index.func exists,
- it contains _lib/countmein/app.py (the FastAPI app the entry
  re-exports),
- its size is under 200 MB (headroom under the 250 MB unzipped limit).

Exits 0 when all three hold, 1 otherwise.
"""

from __future__ import annotations

from pathlib import Path

FUNC = Path(".vercel/output/functions/api/index.func")
APP_FILE = FUNC / "_lib/countmein/app.py"
MAX_MB = 200


def main() -> int:
    if not FUNC.is_dir():
        print(f"check_bundle: {FUNC} not found — run `bunx vercel build` first")
        return 1
    if not APP_FILE.is_file():
        print(f"check_bundle: {APP_FILE} missing from the bundle")
        return 1
    total = sum(f.stat().st_size for f in FUNC.rglob("*") if f.is_file())
    mb = total / (1024 * 1024)
    print(f"check_bundle: {FUNC} = {mb:.1f} MB, app.py present")
    if mb >= MAX_MB:
        print(f"check_bundle: bundle {mb:.1f} MB >= {MAX_MB} MB limit")
        return 1
    print("check_bundle: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
