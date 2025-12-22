"""user switch to username role department phone

Revision ID: b417b6106f89
Revises: dd3294a8f43a
Create Date: 2025-12-17 23:47:38.410184

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b417b6106f89'
down_revision: Union[str, Sequence[str], None] = 'dd3294a8f43a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
