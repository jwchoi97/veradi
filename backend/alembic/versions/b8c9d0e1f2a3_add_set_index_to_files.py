"""add set_index to files for individual items (1 set = PDF + HWP)

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-03-01

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, Sequence[str], None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "files",
        sa.Column("set_index", sa.Integer(), nullable=True),
    )
    op.create_index(op.f("ix_files_set_index"), "files", ["set_index"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_files_set_index"), table_name="files")
    op.drop_column("files", "set_index")
