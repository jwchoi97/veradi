"""add_review_sessions_per_user

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-02-22

유저별 검토 세션: file_asset_id + user_id 당 하나의 세션.
baked PDF, annotations JSON은 MinIO에서 user_id 기반 경로로 분리 저장.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Create review_sessions (file_asset_id, user_id unique)
    op.create_table(
        "review_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("file_asset_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="in_progress"),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["file_asset_id"], ["files.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("file_asset_id", "user_id", name="uq_review_sessions_file_user"),
    )
    op.create_index("ix_review_sessions_id", "review_sessions", ["id"], unique=False)
    op.create_index("ix_review_sessions_file_asset_id", "review_sessions", ["file_asset_id"], unique=False)
    op.create_index("ix_review_sessions_user_id", "review_sessions", ["user_id"], unique=False)
    op.create_index("ix_review_sessions_status", "review_sessions", ["status"], unique=False)

    # 2. Migrate: create review_sessions from reviews (only those with reviewer_id)
    conn.execute(text("""
        INSERT INTO review_sessions (file_asset_id, user_id, status, started_at, completed_at, created_at, updated_at)
        SELECT file_asset_id, reviewer_id, status, started_at, completed_at, created_at, updated_at
        FROM reviews
        WHERE reviewer_id IS NOT NULL
    """))

    # 3. Add review_session_id to review_comments
    op.add_column("review_comments", sa.Column("review_session_id", sa.Integer(), nullable=True))

    # 4. Migrate comments: set review_session_id from reviews -> review_sessions
    conn.execute(text("""
        UPDATE review_comments rc
        INNER JOIN reviews r ON rc.review_id = r.id
        INNER JOIN review_sessions rs ON rs.file_asset_id = r.file_asset_id AND rs.user_id = r.reviewer_id
        SET rc.review_session_id = rs.id
        WHERE r.reviewer_id IS NOT NULL
    """))

    # 5. Delete orphan comments (review had no reviewer - can't migrate)
    conn.execute(text("""
        DELETE FROM review_comments WHERE review_session_id IS NULL
    """))

    # 6. Make review_session_id NOT NULL
    op.alter_column(
        "review_comments",
        "review_session_id",
        existing_type=sa.Integer(),
        nullable=False,
    )

    # 7. Drop old FK and review_id
    op.drop_constraint("review_comments_ibfk_1", "review_comments", type_="foreignkey")
    op.drop_index("ix_review_comments_review_id", table_name="review_comments")
    op.drop_column("review_comments", "review_id")

    # 8. Add new FK to review_sessions
    op.create_foreign_key(
        "fk_review_comments_session",
        "review_comments",
        "review_sessions",
        ["review_session_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_review_comments_review_session_id", "review_comments", ["review_session_id"], unique=False)

    # 9. Drop reviews table (replaced by review_sessions)
    op.drop_index("ix_reviews_reviewer_id", table_name="reviews")
    op.drop_index("ix_reviews_status", table_name="reviews")
    op.drop_index("ix_reviews_file_asset_id", table_name="reviews")
    op.drop_index("ix_reviews_id", table_name="reviews")
    op.drop_table("reviews")


def downgrade() -> None:
    conn = op.get_bind()

    # 1. Recreate reviews table
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
    op.create_index("ix_reviews_id", "reviews", ["id"], unique=False)
    op.create_index("ix_reviews_file_asset_id", "reviews", ["file_asset_id"], unique=True)
    op.create_index("ix_reviews_status", "reviews", ["status"], unique=False)
    op.create_index("ix_reviews_reviewer_id", "reviews", ["reviewer_id"], unique=False)

    # 2. Migrate: pick one session per file (latest by id) -> reviews
    conn.execute(text("""
        INSERT INTO reviews (file_asset_id, reviewer_id, status, started_at, completed_at, created_at, updated_at)
        SELECT rs.file_asset_id, rs.user_id, rs.status, rs.started_at, rs.completed_at, rs.created_at, rs.updated_at
        FROM review_sessions rs
        INNER JOIN (
            SELECT file_asset_id, MAX(id) AS mid FROM review_sessions GROUP BY file_asset_id
        ) sub ON rs.file_asset_id = sub.file_asset_id AND rs.id = sub.mid
    """))

    # 3. Add review_id to review_comments
    op.add_column("review_comments", sa.Column("review_id", sa.Integer(), nullable=True))

    # 4. Map review_session_id -> review_id
    conn.execute(text("""
        UPDATE review_comments rc
        INNER JOIN review_sessions rs ON rc.review_session_id = rs.id
        INNER JOIN reviews r ON r.file_asset_id = rs.file_asset_id AND r.reviewer_id = rs.user_id
        SET rc.review_id = r.id
    """))

    # 5. Drop FK and review_session_id
    op.drop_constraint("fk_review_comments_session", "review_comments", type_="foreignkey")
    op.drop_index("ix_review_comments_review_session_id", table_name="review_comments")
    op.drop_column("review_comments", "review_session_id")

    # 6. Add FK to reviews
    op.create_foreign_key("review_comments_ibfk_1", "review_comments", "reviews", ["review_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_review_comments_review_id", "review_comments", ["review_id"], unique=False)

    # 7. Drop review_sessions
    op.drop_index("ix_review_sessions_status", table_name="review_sessions")
    op.drop_index("ix_review_sessions_user_id", table_name="review_sessions")
    op.drop_index("ix_review_sessions_file_asset_id", table_name="review_sessions")
    op.drop_index("ix_review_sessions_id", table_name="review_sessions")
    op.drop_table("review_sessions")
