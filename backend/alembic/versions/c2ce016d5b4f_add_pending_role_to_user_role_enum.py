"""add pending role to user role enum

Revision ID: c2ce016d5b4f
Revises: d468b80fd175
Create Date: 2025-12-27 14:47:49.194317

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2ce016d5b4f'
down_revision: Union[str, Sequence[str], None] = 'd468b80fd175'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# def upgrade() -> None:
#     """Upgrade schema."""
#     pass


# def downgrade() -> None:
#     """Downgrade schema."""
#     pass

def upgrade():
    op.execute(
        "ALTER TABLE users "
        "MODIFY role ENUM('ADMIN','LEAD','MEMBER','PENDING') NOT NULL"
    )

def downgrade():
    op.execute(
        "ALTER TABLE users "
        "MODIFY role ENUM('ADMIN','MEMBER','PENDING') NOT NULL"
    )