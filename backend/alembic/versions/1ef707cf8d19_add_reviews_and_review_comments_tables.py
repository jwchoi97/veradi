"""add_reviews_and_review_comments_tables

Revision ID: 1ef707cf8d19
Revises: 4db9da2d24a5
Create Date: 2026-01-17 16:19:18.535907

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1ef707cf8d19'
down_revision: Union[str, Sequence[str], None] = '4db9da2d24a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # reviews 테이블 생성
    op.create_table(
        "reviews",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("file_asset_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("reviewer_id", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["file_asset_id"], ["files.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("file_asset_id", name="uq_reviews_file_asset_id"),
    )
    op.create_index(op.f("ix_reviews_id"), "reviews", ["id"], unique=False)
    op.create_index(op.f("ix_reviews_file_asset_id"), "reviews", ["file_asset_id"], unique=True)
    op.create_index(op.f("ix_reviews_status"), "reviews", ["status"], unique=False)
    op.create_index(op.f("ix_reviews_reviewer_id"), "reviews", ["reviewer_id"], unique=False)

    # review_comments 테이블 생성
    op.create_table(
        "review_comments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("review_id", sa.Integer(), nullable=False),
        sa.Column("author_id", sa.Integer(), nullable=True),
        sa.Column("comment_type", sa.String(length=32), nullable=False, server_default="text"),
        sa.Column("text_content", sa.Text(), nullable=True),
        sa.Column("handwriting_image_url", sa.String(length=512), nullable=True),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("x_position", sa.Integer(), nullable=True),
        sa.Column("y_position", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["review_id"], ["reviews.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_review_comments_id"), "review_comments", ["id"], unique=False)
    op.create_index(op.f("ix_review_comments_review_id"), "review_comments", ["review_id"], unique=False)
    op.create_index(op.f("ix_review_comments_author_id"), "review_comments", ["author_id"], unique=False)
    op.create_index(op.f("ix_review_comments_created_at"), "review_comments", ["created_at"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_review_comments_created_at"), table_name="review_comments")
    op.drop_index(op.f("ix_review_comments_author_id"), table_name="review_comments")
    op.drop_index(op.f("ix_review_comments_review_id"), table_name="review_comments")
    op.drop_index(op.f("ix_review_comments_id"), table_name="review_comments")
    op.drop_table("review_comments")
    
    op.drop_index(op.f("ix_reviews_reviewer_id"), table_name="reviews")
    op.drop_index(op.f("ix_reviews_status"), table_name="reviews")
    op.drop_index(op.f("ix_reviews_file_asset_id"), table_name="reviews")
    op.drop_index(op.f("ix_reviews_id"), table_name="reviews")
    op.drop_table("reviews")
