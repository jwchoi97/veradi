"""add year to projects

Revision ID: 8936a0613c0c
Revises: c9becbfc27ab
Create Date: 2025-11-22 13:58:59.238932

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8936a0613c0c'
down_revision: Union[str, Sequence[str], None] = 'c9becbfc27ab'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
