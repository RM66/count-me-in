"""Demo-account error (ADR-010). The error is an ApiError
subclass rendered by the app-level handler; the historical name stays."""

from __future__ import annotations

from ..errors import DemoReadOnly

DemoReadOnlyError = DemoReadOnly
