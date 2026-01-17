"""add_uploaded_by_user_id_to_files

Revision ID: 1cf12d245c1f
Revises: 838fd98d1841
Create Date: 2026-01-17 12:15:07.895447

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1cf12d245c1f'
down_revision: Union[str, Sequence[str], None] = '838fd98d1841'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # files 테이블에 uploaded_by_user_id 컬럼 추가
    op.add_column(
        "files",
        sa.Column(
            "uploaded_by_user_id",
            sa.Integer(),
            nullable=True,
        )
    )
    
    # ForeignKey 제약 조건 추가
    op.create_foreign_key(
        "fk_files_uploaded_by_user_id",
        "files",
        "users",
        ["uploaded_by_user_id"],
        ["id"],
        ondelete="SET NULL"
    )
    
    # 인덱스 추가
    op.create_index(
        "ix_files_uploaded_by_user_id",
        "files",
        ["uploaded_by_user_id"],
        unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    # 인덱스 삭제
    op.drop_index("ix_files_uploaded_by_user_id", table_name="files")
    
    # ForeignKey 제약 조건 삭제
    op.drop_constraint("fk_files_uploaded_by_user_id", "files", type_="foreignkey")
    
    # 컬럼 삭제
    op.drop_column("files", "uploaded_by_user_id")
