"""add_target_individual_items_count_to_projects

Revision ID: 77e9c1af8e04
Revises: 1cf12d245c1f
Create Date: 2026-01-17 12:35:46.495191

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '77e9c1af8e04'
down_revision: Union[str, Sequence[str], None] = '1cf12d245c1f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # projects 테이블에 target_individual_items_count 컬럼 추가 (기본값 20)
    op.add_column(
        "projects",
        sa.Column(
            "target_individual_items_count",
            sa.Integer(),
            nullable=False,
            server_default="20"
        )
    )
    
    # 기존 프로젝트에 기본값 20 설정 (NULL인 경우)
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE projects
            SET target_individual_items_count = 20
            WHERE target_individual_items_count IS NULL
            """
        )
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("projects", "target_individual_items_count")
