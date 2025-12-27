# -*- coding: utf-8 -*-
from dotenv import load_dotenv
load_dotenv()

import os, sys
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

CURRENT_DIR = os.path.dirname(__file__)
BACKEND_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))  # .../src/backend
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# SQLAlchemy metadata (import models so metadata is populated)
from app.mariadb.database import Base
from app.mariadb import models  # noqa: F401

config = context.config

# <- 여기는 반드시 들여쓰기!
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

DATABASE_URL = os.getenv("DATABASE_URL")
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = DATABASE_URL
    if not url:
        raise RuntimeError("DATABASE_URL is not set. Check your .env file.")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section)
    configuration["sqlalchemy.url"] = DATABASE_URL
    if not configuration["sqlalchemy.url"]:
        raise RuntimeError("DATABASE_URL is not set. Check your .env file.")

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
