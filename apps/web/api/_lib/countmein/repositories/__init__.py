"""Typed repositories over the SQLAlchemy 2.0 declarative models.

Each module owns one aggregate and speaks only SQLAlchemy Core/ORM
expressions — no raw text(), no string concatenation, no positional
row[i] unpacking. Repositories take the caller's AsyncSession and
return ORM models — detached snapshots thanks to expire_on_commit=False
+ lazy="raise". Routes may call a read-only repository directly on the
request's session when no service wraps it; writes with business rules
go through services/.
"""
