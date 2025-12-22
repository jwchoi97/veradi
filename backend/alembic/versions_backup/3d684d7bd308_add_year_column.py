from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '3d684d7bd308'
down_revision: Union[str, Sequence[str], None] = '8936a0613c0c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
# revision = "YOUR_REVISION_ID"
# down_revision = "PREV_REVISION_ID"
# branch_labels = None
# depends_on = None

def upgrade():
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("username", sa.String(length=64), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(length=255), nullable=False),

        sa.Column(
            "role",
            sa.Enum("ADMIN", "LEAD", "MEMBER", name="userrole"),
            nullable=False,
            server_default="MEMBER",
        ),
        sa.Column(
            "department",
            sa.Enum(
                "ADMIN",
                "PHYSICS_1",
                "CHEMISTRY_1",
                "BIOLOGY_1",
                "EARTH_1",
                "CHEMISTRY_2",
                "SOCIOCULTURE",
                "MATH",
                name="department",
            ),
            nullable=False,
        ),

        sa.Column("phone_number", sa.String(length=32), nullable=True),
        sa.Column("phone_verified", sa.Boolean, nullable=False, server_default=sa.text("0")),

        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade():
    op.drop_table("users")
