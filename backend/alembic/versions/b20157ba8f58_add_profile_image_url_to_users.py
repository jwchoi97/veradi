"""add_profile_image_url_to_users

Revision ID: b20157ba8f58
Revises: 77e9c1af8e04
Create Date: 2026-01-17 15:07:00.359851

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b20157ba8f58'
down_revision: Union[str, Sequence[str], None] = '77e9c1af8e04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # users 테이블에 profile_image_url 컬럼 추가
    op.add_column(
        "users",
        sa.Column(
            "profile_image_url",
            sa.String(length=512),
            nullable=True
        )
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "profile_image_url")
