"""add projects category

Revision ID: 15314ecde023
Revises: 0de392c95aaa
Create Date: 2026-01-10 12:52:21.549723

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '15314ecde023'
down_revision: Union[str, Sequence[str], None] = '0de392c95aaa'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("category", sa.String(length=50), nullable=False, server_default="기타"),
    )
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE projects SET category = '기타'"))


def downgrade() -> None:
    op.drop_column("projects", "category")