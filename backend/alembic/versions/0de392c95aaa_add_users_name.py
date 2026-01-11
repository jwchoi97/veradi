"""add users name

Revision ID: 0de392c95aaa
Revises: a097714175d3
Create Date: 2026-01-10 11:38:50.590603

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0de392c95aaa'
down_revision: Union[str, Sequence[str], None] = 'a097714175d3'
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
