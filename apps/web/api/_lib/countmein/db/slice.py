"""Shared slice adapters for Postgres params and generated wire types."""


def nullable_slice(s: list[str] | None) -> list[str] | None:
    """Keep None distinct from empty for array params: None becomes NULL,
    an empty list becomes '{}'."""
    return s
