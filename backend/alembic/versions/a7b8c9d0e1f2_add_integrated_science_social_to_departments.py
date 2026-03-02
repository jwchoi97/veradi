"""add INTEGRATED_SCIENCE and INTEGRATED_SOCIAL to department enums

Revision ID: a7b8c9d0e1f2
Revises: c3d4e5f6a7b8
Create Date: 2026-03-01

Ensures users.department and user_departments.department support
INTEGRATED_SCIENCE and INTEGRATED_SOCIAL so signup/affiliation work
the same as other departments.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine.reflection import Inspector
from sqlalchemy import inspect

revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, Sequence[str], None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Must match backend app.mariadb.models.Department (9 values, no ADMIN)
DEPS_9 = (
    "PHYSICS_1",
    "CHEMISTRY_1",
    "CHEMISTRY_2",
    "BIOLOGY_1",
    "EARTH_1",
    "SOCIOCULTURE",
    "MATH",
    "INTEGRATED_SCIENCE",
    "INTEGRATED_SOCIAL",
)

ENUM_SQL_9 = "ENUM(" + ",".join(f"'{d}'" for d in DEPS_9) + ")"


def _has_table(insp: Inspector, table_name: str) -> bool:
    return table_name in insp.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    # 1) users.department: ensure 9-value enum (add INTEGRATED_SCIENCE, INTEGRATED_SOCIAL if missing)
    op.execute(f"ALTER TABLE users MODIFY department {ENUM_SQL_9} NOT NULL")

    # 2) user_departments: create if missing, or alter department enum to 9 values
    if not _has_table(insp, "user_departments"):
        op.create_table(
            "user_departments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("department", sa.Enum(*DEPS_9), nullable=False),
            sa.UniqueConstraint("user_id", "department", name="uq_user_departments_user_id_department"),
        )
        op.create_index("ix_user_departments_user_id", "user_departments", ["user_id"])
        op.create_index("ix_user_departments_department", "user_departments", ["department"])
    else:
        op.execute(f"ALTER TABLE user_departments MODIFY department {ENUM_SQL_9} NOT NULL")


def downgrade() -> None:
    # Optional: revert user_departments.department to 8-value enum (drops INTEGRATED_*)
    # Skipping to avoid data loss; run manually if needed.
    pass
