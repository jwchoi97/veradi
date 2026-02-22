"""Quick script to check review-related DB schema."""
from dotenv import load_dotenv
load_dotenv()

from app.mariadb.database import engine
from sqlalchemy import text

with engine.connect() as c:
    r = c.execute(text("SHOW TABLES LIKE 'review%'"))
    tables = [row[0] for row in r.fetchall()]
    print("Tables:", tables)
    if "review_comments" in tables:
        r2 = c.execute(text("DESCRIBE review_comments"))
        cols = [row[0] for row in r2.fetchall()]
        print("review_comments cols:", cols)
