"""unify_subject_and_expand_departments_9

Revision ID: 838fd98d1841
Revises: f6dc92812806
Create Date: 2026-01-11 22:41:01.580077

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '838fd98d1841'
down_revision: Union[str, Sequence[str], None] = 'f6dc92812806'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# 9 departments (subjects)
DEPS = [
    "PHYSICS_1",
    "CHEMISTRY_1",
    "CHEMISTRY_2",
    "BIOLOGY_1",
    "EARTH_1",
    "SOCIOCULTURE",
    "MATH",
    "INTEGRATED_SCIENCE",
    "INTEGRATED_SOCIAL",
]


def _enum_sql() -> str:
    return "ENUM(" + ",".join(f"'{d}'" for d in DEPS) + ")"


def upgrade() -> None:
    enum_sql = _enum_sql()

    # ------------------------------------------------------------
    # 1) USERS.department: remove legacy 'ADMIN' value if exists
    #    - ADMIN 권한은 UserRole.ADMIN으로만 판단
    #    - department는 NOT NULL 유지하려면 아무 과목 하나로 치환 필요
    # ------------------------------------------------------------
    # If there are legacy rows with department='ADMIN', coerce them.
    op.execute("UPDATE users SET department='PHYSICS_1' WHERE department='ADMIN'")

    # Alter users.department ENUM to 9 values (no ADMIN)
    # (MariaDB/MySQL: ENUM은 MODIFY로 전체 재정의)
    op.execute(f"ALTER TABLE users MODIFY department {enum_sql} NOT NULL")

    # ------------------------------------------------------------
    # 2) PROJECTS: unify subject/team split into one enum field
    #    Old possibilities in DB:
    #      - projects.subject: VARCHAR (Korean/English mixed)
    #      - projects.owner_department: ENUM/NULL (old authorization key)
    #
    #    Target:
    #      - projects.subject: ENUM(9) NOT NULL
    #      - drop projects.owner_department
    # ------------------------------------------------------------

    # 2-1) add new column subject_enum (nullable first)
    op.add_column("projects", sa.Column("subject_enum", sa.Enum(*DEPS, name="department_enum_tmp"), nullable=True))

    # 2-2) populate from owner_department if present (best signal)
    # owner_department column may not exist in some DBs; guard with INFORMATION_SCHEMA
    op.execute(
        """
        SET @has_owner := (
          SELECT COUNT(*)
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'projects'
            AND COLUMN_NAME = 'owner_department'
        );
        """
    )
    op.execute(
        """
        SET @sql := IF(@has_owner > 0,
          "UPDATE projects SET subject_enum = owner_department WHERE owner_department IS NOT NULL",
          "SELECT 1"
        );
        """
    )
    op.execute("PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;")

    # 2-3) map from legacy projects.subject (string) into enum
    # NOTE: We handle common variants (Korean labels & enum codes).
    # Only fill where subject_enum is still NULL.
    op.execute(
        """
        UPDATE projects
        SET subject_enum =
          CASE
            -- already codes
            WHEN subject IN ('PHYSICS_1') THEN 'PHYSICS_1'
            WHEN subject IN ('CHEMISTRY_1') THEN 'CHEMISTRY_1'
            WHEN subject IN ('CHEMISTRY_2') THEN 'CHEMISTRY_2'
            WHEN subject IN ('BIOLOGY_1') THEN 'BIOLOGY_1'
            WHEN subject IN ('EARTH_1') THEN 'EARTH_1'
            WHEN subject IN ('SOCIOCULTURE') THEN 'SOCIOCULTURE'
            WHEN subject IN ('MATH') THEN 'MATH'
            WHEN subject IN ('INTEGRATED_SCIENCE') THEN 'INTEGRATED_SCIENCE'
            WHEN subject IN ('INTEGRATED_SOCIAL') THEN 'INTEGRATED_SOCIAL'

            -- Korean common strings
            WHEN subject IN ('물리1', '물리 1', '물리Ⅰ', '물리 I', '물리1팀') THEN 'PHYSICS_1'
            WHEN subject IN ('화학1', '화학 1', '화학Ⅰ', '화학 I', '화학1팀') THEN 'CHEMISTRY_1'
            WHEN subject IN ('화학2', '화학 2', '화학Ⅱ', '화학 II', '화학2팀') THEN 'CHEMISTRY_2'
            WHEN subject IN ('생물1', '생물 1', '생명과학1', '생명과학 1', '생명과학Ⅰ', '생명과학 I', '생물1팀') THEN 'BIOLOGY_1'
            WHEN subject IN ('지구1', '지구 1', '지구과학1', '지구과학 1', '지구과학Ⅰ', '지구과학 I', '지구1팀') THEN 'EARTH_1'
            WHEN subject IN ('사회문화', '사회·문화', '사문', '사회 문화', '사회문화팀') THEN 'SOCIOCULTURE'
            WHEN subject IN ('수학', '수학팀') THEN 'MATH'
            WHEN subject IN ('통합과학', '통과') THEN 'INTEGRATED_SCIENCE'
            WHEN subject IN ('통합사회', '통사') THEN 'INTEGRATED_SOCIAL'

            ELSE NULL
          END
        WHERE subject_enum IS NULL
          AND subject IS NOT NULL
          AND LENGTH(TRIM(subject)) > 0
        """
    )

    # 2-4) if still NULL, force default to keep NOT NULL requirement
    # (필요하면 나중에 수동 정리)
    op.execute("UPDATE projects SET subject_enum='PHYSICS_1' WHERE subject_enum IS NULL")

    # 2-5) drop old columns safely
    # drop owner_department if exists
    op.execute(
        """
        SET @has_owner2 := (
          SELECT COUNT(*)
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'projects'
            AND COLUMN_NAME = 'owner_department'
        );
        """
    )
    op.execute(
        """
        SET @sql2 := IF(@has_owner2 > 0,
          "ALTER TABLE projects DROP COLUMN owner_department",
          "SELECT 1"
        );
        """
    )
    op.execute("PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;")

    # drop legacy subject column (varchar) and rename subject_enum -> subject
    # But subject column may already be Enum in some DBs; guard by checking its type.
    # Strategy:
    # - If there is a column named 'subject', drop it.
    # - Then rename subject_enum -> subject and enforce NOT NULL.
    op.execute(
        """
        SET @has_subject := (
          SELECT COUNT(*)
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'projects'
            AND COLUMN_NAME = 'subject'
        );
        """
    )
    op.execute(
        """
        SET @sql3 := IF(@has_subject > 0,
          "ALTER TABLE projects DROP COLUMN subject",
          "SELECT 1"
        );
        """
    )
    op.execute("PREPARE stmt3 FROM @sql3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;")

    op.execute("ALTER TABLE projects CHANGE subject_enum subject " + enum_sql + " NOT NULL")

    # ------------------------------------------------------------
    # 3) Drop legacy user_departments table if exists (we no longer use multi-departments)
    # ------------------------------------------------------------
    op.execute(
        """
        SET @has_ud := (
          SELECT COUNT(*)
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'user_departments'
        );
        """
    )
    op.execute(
        """
        SET @sql4 := IF(@has_ud > 0,
          "DROP TABLE user_departments",
          "SELECT 1"
        );
        """
    )
    op.execute("PREPARE stmt4 FROM @sql4; EXECUTE stmt4; DEALLOCATE PREPARE stmt4;")


def downgrade() -> None:
    # Downgrade is intentionally destructive/unsafe for production data
    # because we merged/normalized columns and dropped tables.
    raise RuntimeError("Downgrade not supported for this migration.")