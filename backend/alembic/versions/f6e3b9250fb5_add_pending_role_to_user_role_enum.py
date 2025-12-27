"""add pending role to user role enum

Revision ID: f6e3b9250fb5
Revises: c2ce016d5b4f
Create Date: 2025-12-27 15:14:03.222457

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f6e3b9250fb5'
down_revision: Union[str, Sequence[str], None] = 'c2ce016d5b4f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
