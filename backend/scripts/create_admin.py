# scripts/create_admin.py
import os
import sys
from getpass import getpass

from passlib.context import CryptContext

# Adjust imports to match your project structure
from app.mariadb.database import SessionLocal
from app.mariadb.models import User, UserRole, Department

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def main() -> int:
    db = SessionLocal()
    try:
        username = os.getenv("ADMIN_USERNAME") or input("Admin username: ").strip()
        password = os.getenv("ADMIN_PASSWORD") or getpass("Admin password: ")
        department_str = os.getenv("ADMIN_DEPARTMENT") or input(
            "Department (PHYSICS_1/CHEMISTRY_1/BIOLOGY_1/EARTH_1/CHEMISTRY_2/SOCIOCULTURE/MATH): "
        ).strip()
        phone_number = os.getenv("ADMIN_PHONE") or input("Phone number: ").strip()

        try:
            department = Department[department_str]
        except KeyError:
            print(f"Invalid department: {department_str}")
            return 2

        exists = db.query(User).filter(User.username == username).first()
        if exists:
            print("User already exists.")
            return 1

        user = User(
            username=username,
            password_hash=pwd_context.hash(password),
            role=UserRole.ADMIN,
            department=department,
            phone_number=phone_number,
            phone_verified=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        print(f"Created admin user id={user.id}, username={user.username}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
