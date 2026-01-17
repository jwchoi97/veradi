"""add_activities_table

Revision ID: 4db9da2d24a5
Revises: b20157ba8f58
Create Date: 2026-01-17 15:51:43.251553

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4db9da2d24a5'
down_revision: Union[str, Sequence[str], None] = 'b20157ba8f58'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "activities",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("activity_type", sa.String(length=32), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("file_asset_id", sa.Integer(), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("file_type", sa.String(length=32), nullable=True),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["file_asset_id"], ["files.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_activities_id"), "activities", ["id"], unique=False)
    op.create_index(op.f("ix_activities_activity_type"), "activities", ["activity_type"], unique=False)
    op.create_index(op.f("ix_activities_project_id"), "activities", ["project_id"], unique=False)
    op.create_index(op.f("ix_activities_file_asset_id"), "activities", ["file_asset_id"], unique=False)
    op.create_index(op.f("ix_activities_user_id"), "activities", ["user_id"], unique=False)
    op.create_index(op.f("ix_activities_created_at"), "activities", ["created_at"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_activities_created_at"), table_name="activities")
    op.drop_index(op.f("ix_activities_user_id"), table_name="activities")
    op.drop_index(op.f("ix_activities_file_asset_id"), table_name="activities")
    op.drop_index(op.f("ix_activities_project_id"), table_name="activities")
    op.drop_index(op.f("ix_activities_activity_type"), table_name="activities")
    op.drop_index(op.f("ix_activities_id"), table_name="activities")
    op.drop_table("activities")
