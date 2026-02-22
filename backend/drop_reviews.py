"""Drop reviews table (after repair)."""
from dotenv import load_dotenv
load_dotenv()
from sqlalchemy import text
from app.mariadb.database import engine

with engine.connect() as conn:
    r = conn.execute(text("SHOW TABLES LIKE 'reviews'"))
    if r.fetchone():
        r2 = conn.execute(text("""
            SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reviews'
            AND REFERENCED_TABLE_NAME IS NOT NULL
        """))
        for row in r2.fetchall():
            conn.execute(text(f"ALTER TABLE reviews DROP FOREIGN KEY `{row[0]}`"))
        conn.commit()
        conn.execute(text("DROP TABLE reviews"))
        conn.commit()
        print("Dropped reviews table")
    else:
        print("reviews table already dropped")
