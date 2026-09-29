"""Initial schema (Drizzle baseline).

Consolidates packages/db/drizzle/*.sql (0000-0015) into one revision:
enums, five tables, checks, indexes and FKs. Neutralized history:
RLS enable/disable (0004/0008) and the pg-boss drop (0005) change no
final state, so they leave no trace here. The stray `organizers.locale`
column on the dev database is not part of the Drizzle schema and is
deliberately absent — fresh databases never had it.

Cutover note: databases created via Drizzle (`bun run db:migrate`)
already have this schema — do NOT upgrade them, stamp instead:
    cd apps/web && uv run alembic stamp 0001
`alembic upgrade head` is for fresh databases only (CI, per-worker
test databases, Docker).

Revision ID: 0001
Revises: None
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("CREATE TYPE booking_status AS ENUM ('confirmed', 'cancelled')")
    op.execute("CREATE TYPE messenger_kind AS ENUM ('telegram')")
    op.execute("CREATE TYPE options_select_mode AS ENUM ('single', 'multi')")
    op.execute("CREATE TYPE outbox_status AS ENUM ('pending', 'sent', 'failed', 'skipped')")

    booking_status = postgresql.ENUM(
        "confirmed", "cancelled", name="booking_status", create_type=False
    )
    messenger_kind = postgresql.ENUM("telegram", name="messenger_kind", create_type=False)
    options_mode = postgresql.ENUM("single", "multi", name="options_select_mode", create_type=False)
    outbox_status = postgresql.ENUM(
        "pending", "sent", "failed", "skipped", name="outbox_status", create_type=False
    )

    op.create_table(
        "organizers",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("messenger", messenger_kind, nullable=False),
        sa.Column("messenger_id", sa.Text(), nullable=False),
        sa.Column("timezone", sa.Text(), nullable=False),
        sa.Column("language", sa.Text(), server_default=sa.text("'en'"), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("photo_url", sa.Text(), nullable=True),
        sa.Column("location", sa.Text(), nullable=True),
        sa.Column("contact", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("char_length(slug) <= 40", name="organizers_slug_length_check"),
        sa.CheckConstraint("char_length(name) <= 100", name="organizers_name_length_check"),
        sa.CheckConstraint(
            "char_length(description) <= 4000", name="organizers_description_length_check"
        ),
        sa.CheckConstraint("char_length(location) <= 300", name="organizers_location_length_check"),
        sa.CheckConstraint("char_length(contact) <= 300", name="organizers_contact_length_check"),
        sa.CheckConstraint("char_length(timezone) <= 64", name="organizers_timezone_length_check"),
        sa.CheckConstraint("char_length(language) <= 8", name="organizers_language_length_check"),
    )
    op.create_index("organizers_slug_key", "organizers", ["slug"], unique=True)
    op.create_index(
        "organizers_messenger_id_key", "organizers", ["messenger", "messenger_id"], unique=True
    )

    op.create_table(
        "services",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("organizer_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("photo_url", sa.Text(), nullable=True),
        sa.Column("location", sa.Text(), nullable=True),
        sa.Column("contact", sa.Text(), nullable=True),
        sa.Column("default_price", sa.Text(), nullable=False),
        sa.Column("default_capacity", sa.Integer(), nullable=False),
        sa.Column("default_duration_minutes", sa.Integer(), nullable=False),
        sa.Column(
            "max_seats_per_booking", sa.Integer(), server_default=sa.text("1"), nullable=False
        ),
        sa.Column("options", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("options_select_mode", options_mode, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["organizer_id"],
            ["organizers.id"],
            name="services_organizer_id_organizers_id_fk",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("default_capacity > 0", name="services_default_capacity_check"),
        sa.CheckConstraint("default_duration_minutes > 0", name="services_default_duration_check"),
        sa.CheckConstraint(
            "max_seats_per_booking >= 1", name="services_max_seats_per_booking_check"
        ),
        sa.CheckConstraint("char_length(title) <= 100", name="services_title_length_check"),
        sa.CheckConstraint(
            "char_length(description) <= 2000", name="services_description_length_check"
        ),
        sa.CheckConstraint(
            "char_length(default_price) <= 50", name="services_default_price_length_check"
        ),
        sa.CheckConstraint("char_length(location) <= 300", name="services_location_length_check"),
        sa.CheckConstraint("char_length(contact) <= 300", name="services_contact_length_check"),
        sa.CheckConstraint(
            "(options IS NULL OR array_length(options, 1) IS NULL) "
            "OR options_select_mode IS NOT NULL",
            name="services_options_select_mode_check",
        ),
    )
    op.create_index("services_organizer_id_idx", "services", ["organizer_id"])

    op.create_table(
        "time_slots",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("service_id", sa.Text(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column("booked_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("price", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["service_id"],
            ["services.id"],
            name="time_slots_service_id_services_id_fk",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("duration_minutes > 0", name="time_slots_duration_check"),
        sa.CheckConstraint("capacity >= 1", name="time_slots_capacity_check"),
        sa.CheckConstraint(
            "booked_count >= 0 and booked_count <= capacity",
            name="time_slots_booked_count_check",
        ),
        sa.CheckConstraint("char_length(price) <= 50", name="time_slots_price_length_check"),
    )
    op.create_index("time_slots_service_id_idx", "time_slots", ["service_id"])
    op.create_index("time_slots_starts_at_idx", "time_slots", ["starts_at"])
    op.create_index(
        "time_slots_service_id_starts_at_idx", "time_slots", ["service_id", "starts_at"]
    )

    op.create_table(
        "bookings",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("time_slot_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("status", booking_status, nullable=False),
        sa.Column("seats", sa.Integer(), nullable=False),
        sa.Column("guest_name", sa.Text(), nullable=False),
        sa.Column("guest_messenger", messenger_kind, nullable=False),
        sa.Column("guest_messenger_id", sa.Text(), nullable=False),
        sa.Column("guest_messenger_login", sa.Text(), nullable=True),
        sa.Column("guest_locale", sa.Text(), server_default=sa.text("'en'"), nullable=False),
        sa.Column("manage_token", sa.Text(), nullable=False),
        sa.Column("manage_token_hash", sa.Text(), nullable=False),
        sa.Column("selected_options", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("manage_token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["time_slot_id"],
            ["time_slots.id"],
            name="bookings_time_slot_id_time_slots_id_fk",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("seats >= 1", name="bookings_seats_check"),
        sa.CheckConstraint(
            "char_length(guest_name) <= 100", name="bookings_guest_name_length_check"
        ),
        sa.CheckConstraint(
            "char_length(guest_messenger_id) <= 100",
            name="bookings_guest_messenger_id_length_check",
        ),
        sa.CheckConstraint(
            "char_length(manage_token) <= 128",
            name="bookings_manage_token_length_check",
        ),
    )
    op.create_index("bookings_time_slot_id_idx", "bookings", ["time_slot_id"])
    op.create_index(
        "bookings_time_slot_id_created_at_idx", "bookings", ["time_slot_id", "created_at"]
    )
    op.create_index("bookings_created_at_idx", "bookings", ["created_at"])
    op.create_index(
        "bookings_guest_messenger_idx", "bookings", ["guest_messenger", "guest_messenger_id"]
    )
    op.create_index("bookings_manage_token_key", "bookings", ["manage_token"], unique=True)
    op.create_index(
        "bookings_manage_token_hash_key", "bookings", ["manage_token_hash"], unique=True
    )
    op.create_index(
        "bookings_one_active_per_guest_per_slot",
        "bookings",
        ["time_slot_id", "guest_messenger", "guest_messenger_id"],
        unique=True,
        postgresql_where=sa.text("status = 'confirmed'"),
    )

    op.create_table(
        "notification_outbox",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("queue", sa.Text(), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column(
            "status",
            outbox_status,
            server_default=sa.text("'pending'::outbox_status"),
            nullable=False,
        ),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("trace_id", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("attempts >= 0", name="notification_outbox_attempts_check"),
    )
    op.create_index(
        "notification_outbox_status_idx", "notification_outbox", ["status", "created_at"]
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("notification_outbox")
    op.drop_table("bookings")
    op.drop_table("time_slots")
    op.drop_table("services")
    op.drop_table("organizers")
    op.execute("DROP TYPE outbox_status")
    op.execute("DROP TYPE options_select_mode")
    op.execute("DROP TYPE messenger_kind")
    op.execute("DROP TYPE booking_status")
