# CountMeIn Python API — long-running container (Phase 6).
#
# Vercel serverless stays the production web path (single ASGI function
# via api/index.py); this image is the container twin for local
# full-stack dev (docker compose up) and AWS (ECS / App Runner), where
# the process is long-lived and the engine uses a queue pool.
#
# Build context: REPO ROOT (docker compose sets context: .), so COPY
# paths are apps/web-relative. Shared with Dockerfile.web, which needs
# the root for workspace:* resolution.

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# System deps: libpq for psycopg (binary wheels need no build tools,
# but the slim image lacks even ca-certificates for TLS).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv, then the locked runtime deps. uvicorn is a dev-only
# dependency (Vercel serves ASGI itself), so the image adds the locked
# server explicitly — pinned to uv.lock, not floating.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY apps/web/requirements.txt ./
RUN uv pip install --system --no-cache -r requirements.txt "uvicorn[standard]==0.54.0"

FROM base AS runtime

# Non-root user: the app only needs to read its own code and bind
# the HTTP port.
RUN useradd -m -u 10001 appuser
USER appuser

# App code + migrations. api/index.py is the ASGI entry
# (app object `app`); alembic/ + alembic.ini run the startup migrate.
COPY --chown=appuser:appuser apps/web/alembic.ini ./
COPY --chown=appuser:appuser apps/web/alembic ./alembic
COPY --chown=appuser:appuser apps/web/api ./api

EXPOSE 3001

# Health gate for compose / ECS: the liveness probe with dep checks.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3001/api/healthz > /dev/null || exit 1

# Migrate on startup (same revision `db:migrate:py` applies), then serve.
# VERCEL is unset here by construction — the engine opens the container
# queue pool, not the serverless NullPool. Binaries run directly off
# PATH (uv pip --system install): no pyproject in the image, so `uv run`
# (which needs a project) would fail here.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn --app-dir api index:app --host 0.0.0.0 --port 3001"]
