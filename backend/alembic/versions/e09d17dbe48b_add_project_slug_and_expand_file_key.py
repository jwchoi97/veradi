"""add project slug and expand file_key

Revision ID: e09d17dbe48b
Revises: f6e3b9250fb5
Create Date: 2026-01-03 15:01:27.878243

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e09d17dbe48b'
down_revision: Union[str, Sequence[str], None] = 'f6e3b9250fb5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    # 1) projects.slug
    op.add_column("projects", sa.Column("slug", sa.String(length=200), nullable=True))

    # Indexes for slug
    op.create_index("ix_projects_slug", "projects", ["slug"], unique=False)
    op.create_index("ux_projects_slug", "projects", ["slug"], unique=True)

    # 2) files.file_key length: 255 -> 1024
    op.alter_column(
        "files",
        "file_key",
        existing_type=sa.String(length=255),
        type_=sa.String(length=1024),
        existing_nullable=False,
    )


def downgrade():
    # revert files.file_key length
    op.alter_column(
        "files",
        "file_key",
        existing_type=sa.String(length=1024),
        type_=sa.String(length=255),
        existing_nullable=False,
    )

    # drop slug indexes and column
    op.drop_index("ux_projects_slug", table_name="projects")
    op.drop_index("ix_projects_slug", table_name="projects")
    op.drop_column("projects", "slug")