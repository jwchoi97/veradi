"""add user_departments and project owner_department

Revision ID: f6dc92812806
Revises: 15314ecde023
Create Date: 2026-01-11 12:15:08.959101

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = 'f6dc92812806'
down_revision: Union[str, Sequence[str], None] = '15314ecde023'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DEPARTMENT_ENUM_VALUES = (
    "ADMIN",
    "PHYSICS_1",
    "CHEMISTRY_1",
    "BIOLOGY_1",
    "EARTH_1",
    "CHEMISTRY_2",
    "SOCIOCULTURE",
    "MATH",
)


def _has_column(insp, table_name: str, col: str) -> bool:
    return any(c["name"] == col for c in insp.get_columns(table_name))


def _has_table(insp, table_name: str) -> bool:
    return table_name in insp.get_table_names()


def _has_index(insp, table_name: str, index_name: str) -> bool:
    return any(ix["name"] == index_name for ix in insp.get_indexes(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    # 1) projects.owner_department (skip if already exists)
    if not _has_column(insp, "projects", "owner_department"):
        op.add_column(
            "projects",
            sa.Column(
                "owner_department",
                sa.Enum(*DEPARTMENT_ENUM_VALUES),  # MySQL/MariaDB inline ENUM
                nullable=True,
            ),
        )

    # index (skip if exists)
    if not _has_index(insp, "projects", "ix_projects_owner_department"):
        op.create_index("ix_projects_owner_department", "projects", ["owner_department"])

    # 2) user_departments table (skip if exists)
    if not _has_table(insp, "user_departments"):
        op.create_table(
            "user_departments",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("department", sa.Enum(*DEPARTMENT_ENUM_VALUES), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("user_id", "department", name="uq_user_departments_user_department"),
        )

    # indexes for user_departments (skip if exist)
    insp = inspect(op.get_bind())  # refresh inspector after possible table create

    if _has_table(insp, "user_departments"):
        if not _has_index(insp, "user_departments", "ix_user_departments_user_id"):
            op.create_index("ix_user_departments_user_id", "user_departments", ["user_id"])
        if not _has_index(insp, "user_departments", "ix_user_departments_department"):
            op.create_index("ix_user_departments_department", "user_departments", ["department"])

    # 3) backfill: users.department -> user_departments (safe insert ignore duplicates)
    # MariaDB: INSERT IGNORE works to avoid unique constraint collisions
    op.execute(
        """
        INSERT IGNORE INTO user_departments (user_id, department)
        SELECT u.id, u.department
        FROM users u
        WHERE u.department IS NOT NULL
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    # drop user_departments first
    if _has_table(insp, "user_departments"):
        if _has_index(insp, "user_departments", "ix_user_departments_department"):
            op.drop_index("ix_user_departments_department", table_name="user_departments")
        if _has_index(insp, "user_departments", "ix_user_departments_user_id"):
            op.drop_index("ix_user_departments_user_id", table_name="user_departments")
        op.drop_table("user_departments")

    insp = inspect(op.get_bind())

    # projects index + column
    if _has_index(insp, "projects", "ix_projects_owner_department"):
        op.drop_index("ix_projects_owner_department", table_name="projects")

    if _has_column(insp, "projects", "owner_department"):
        op.drop_column("projects", "owner_department")