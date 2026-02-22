"""Repair review schema: complete the partial migration b2c3d4e5f6a7.
DB has: review_sessions, reviews, review_comments with review_id (no review_session_id).
Target: review_sessions, review_comments with review_session_id, no reviews.
"""
from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import text
from app.mariadb.database import engine

def main():
    with engine.connect() as conn:
        # Check current state
        r = conn.execute(text("DESCRIBE review_comments"))
        cols = [row[0] for row in r.fetchall()]
        if "review_session_id" in cols:
            print("Already migrated: review_session_id exists")
            return

        print("Adding review_session_id...")
        conn.execute(text("ALTER TABLE review_comments ADD COLUMN review_session_id INT NULL"))
        conn.commit()

    with engine.connect() as conn:
        print("Migrating comments to review_session_id...")
        conn.execute(text("""
            UPDATE review_comments rc
            INNER JOIN reviews r ON rc.review_id = r.id
            INNER JOIN review_sessions rs ON rs.file_asset_id = r.file_asset_id AND rs.user_id = r.reviewer_id
            SET rc.review_session_id = rs.id
            WHERE r.reviewer_id IS NOT NULL
        """))
        conn.commit()

    with engine.connect() as conn:
        print("Deleting orphan comments...")
        conn.execute(text("DELETE FROM review_comments WHERE review_session_id IS NULL"))
        conn.commit()

    with engine.connect() as conn:
        print("Making review_session_id NOT NULL...")
        conn.execute(text("""
            ALTER TABLE review_comments
            MODIFY COLUMN review_session_id INT NOT NULL
        """))
        conn.commit()

    with engine.connect() as conn:
        # Get actual FK constraint name (MySQL may use different name)
        r = conn.execute(text("""
            SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'review_comments'
            AND COLUMN_NAME = 'review_id' AND REFERENCED_TABLE_NAME IS NOT NULL
        """))
        row = r.fetchone()
        fk_name = row[0] if row else "review_comments_ibfk_1"
        print(f"Dropping FK {fk_name}...")
        conn.execute(text(f"ALTER TABLE review_comments DROP FOREIGN KEY `{fk_name}`"))
        conn.commit()

    with engine.connect() as conn:
        print("Dropping ix_review_comments_review_id...")
        try:
            conn.execute(text("ALTER TABLE review_comments DROP INDEX ix_review_comments_review_id"))
        except Exception as e:
            if "1091" in str(e) or "check that column/key exists" in str(e).lower():
                pass  # index may not exist
            else:
                raise
        conn.commit()

    with engine.connect() as conn:
        print("Dropping review_id column...")
        conn.execute(text("ALTER TABLE review_comments DROP COLUMN review_id"))
        conn.commit()

    with engine.connect() as conn:
        print("Adding FK to review_sessions...")
        conn.execute(text("""
            ALTER TABLE review_comments
            ADD CONSTRAINT fk_review_comments_session
            FOREIGN KEY (review_session_id) REFERENCES review_sessions(id) ON DELETE CASCADE
        """))
        conn.execute(text("""
            CREATE INDEX ix_review_comments_review_session_id ON review_comments (review_session_id)
        """))
        conn.commit()

    with engine.connect() as conn:
        print("Dropping reviews table...")
        r = conn.execute(text("""
            SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reviews'
            AND REFERENCED_TABLE_NAME IS NOT NULL
        """))
        for row in r.fetchall():
            conn.execute(text(f"ALTER TABLE reviews DROP FOREIGN KEY `{row[0]}`"))
        conn.commit()
        conn.execute(text("DROP TABLE reviews"))
        conn.commit()

    print("Done. Schema repaired.")

if __name__ == "__main__":
    main()
