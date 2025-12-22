"""create users table with username role department phone

Revision ID: 06a0b0a0d635
Revises: d62015e80af0
Create Date: 2025-12-18 00:25:46.959505

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '06a0b0a0d635'
down_revision: Union[str, Sequence[str], None] = 'd62015e80af0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
