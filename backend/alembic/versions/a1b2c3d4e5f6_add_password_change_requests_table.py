"""add password_change_requests table

Revision ID: a1b2c3d4e5f6
Revises: 1ef707cf8d19
Create Date: 2025-02-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '1ef707cf8d19'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('password_change_requests',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('new_password_hash', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('requested_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('approved_by_user_id', sa.Integer(), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['approved_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_password_change_requests_id'), 'password_change_requests', ['id'], unique=False)
    op.create_index(op.f('ix_password_change_requests_user_id'), 'password_change_requests', ['user_id'], unique=False)
    op.create_index(op.f('ix_password_change_requests_status'), 'password_change_requests', ['status'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_password_change_requests_status'), table_name='password_change_requests')
    op.drop_index(op.f('ix_password_change_requests_user_id'), table_name='password_change_requests')
    op.drop_index(op.f('ix_password_change_requests_id'), table_name='password_change_requests')
    op.drop_table('password_change_requests')
