"""add FileAsset table and project.files relation

Revision ID: c9becbfc27ab
Revises: d27376d3895e
Create Date: 2025-11-08 12:51:31.398846

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9becbfc27ab'
down_revision: Union[str, Sequence[str], None] = 'd27376d3895e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
