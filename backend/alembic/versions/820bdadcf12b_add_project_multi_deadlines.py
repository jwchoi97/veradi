"""add project multi deadlines

Revision ID: 820bdadcf12b
Revises: e09d17dbe48b
Create Date: 2026-01-10 11:05:49.575398

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '820bdadcf12b'
down_revision: Union[str, Sequence[str], None] = 'e09d17dbe48b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("name", sa.String(length=50), nullable=True))

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE users
            SET name = username
            WHERE name IS NULL OR TRIM(name) = ''
            """
        )
    )


def downgrade() -> None:
    op.drop_column("users", "name")