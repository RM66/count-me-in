"""Typed repositories over the SQLAlchemy 2.0 declarative models.

Each module owns one aggregate and speaks only SQLAlchemy Core/ORM
expressions — no raw text(), no string concatenation, no positional
row[i] unpacking. Repositories take the caller's AsyncSession and
return ORM models; services/ composes them into units of work and maps
models to the detached Row snapshots (db/rows.py). Routes may call a
read-only repository directly on the request's session when no service
wraps it.
"""
