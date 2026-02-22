"""migrate pending to in_progress in review_sessions

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-02-22

대기중(pending) 상태인 review_sessions를 전부 검토필요(in_progress)로 변경
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, Sequence[str], None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("UPDATE review_sessions SET status = 'in_progress' WHERE status = 'pending'"))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("UPDATE review_sessions SET status = 'pending' WHERE status = 'in_progress'"))

