"""OutboxMessage model — mirrors `notification_outbox` from 0001 baseline."""

from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from ..db.shared import new_id
from .base import Base, OutboxStatus, enum_values


class OutboxMessage(Base):
    """Transactional outbox row for notification publishing (ADR-012)."""

    __tablename__ = "notification_outbox"

    # default=new_id: Python-side uuidv7 like every other table (the
    # column has no DB default — enqueue_outbox generates the id before
    # insert so the payload can embed it as the consumer idempotency
    # key). ORM-side only, invisible to Alembic DDL comparison.
    id: Mapped[str] = mapped_column(
        postgresql.UUID(as_uuid=False), primary_key=True, default=new_id
    )
    queue: Mapped[str] = mapped_column(sa.Text, nullable=False)
    payload: Mapped[str] = mapped_column(sa.Text, nullable=False)
    status: Mapped[OutboxStatus] = mapped_column(
        sa.Enum(
            OutboxStatus,
            values_callable=enum_values,
            name="outbox_status",
            create_type=False,
            native_enum=True,
        ),
        nullable=False,
        server_default=sa.text("'pending'::outbox_status"),
    )
    attempts: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default=sa.text("0"))
    trace_id: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )
    sent_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        sa.CheckConstraint("attempts >= 0", name="notification_outbox_attempts_check"),
        sa.Index("notification_outbox_status_idx", "status", "created_at"),
    )
