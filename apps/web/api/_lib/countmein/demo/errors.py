"""Demo-account error (ADR-010)."""


class DemoReadOnlyError(Exception):
    """A write was attempted against the read-only demo account."""
