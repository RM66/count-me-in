"""Typed repositories over the SQLAlchemy 2.0 declarative models.

Each module owns one aggregate and speaks only SQLAlchemy Core/ORM
expressions (select/update/insert/delete) — no raw text(), no string
concatenation, no positional row[i] unpacking. The db/ layer keeps its
public API (Row dataclasses, outbox envelopes) and delegates here;
callers never touch these modules directly except through db/.
"""
