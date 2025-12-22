"""add ADMIN to department enum

Revision ID: d62015e80af0
Revises: b417b6106f89
Create Date: 2025-12-18 00:01:19.992761

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd62015e80af0'
down_revision: Union[str, Sequence[str], None] = 'b417b6106f89'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
