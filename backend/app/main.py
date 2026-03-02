from dotenv import load_dotenv
load_dotenv()

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import projects, files, auth, reviews, pdf, labor
from .mariadb import models
from .mariadb.database import engine

models.Base.metadata.create_all(bind=engine)

def get_cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "")
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    # Always keep local dev origins.
    defaults = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    # Production frontend origins (explicit allow-list in addition to regex).
    prod_defaults = [
        "https://veradi.kr",
        "https://www.veradi.kr",
    ]
    if not origins:
        origins = defaults + prod_defaults
    else:
        merged = origins + defaults + prod_defaults
        # Deduplicate while preserving order.
        seen = set()
        deduped: list[str] = []
        for o in merged:
            if o in seen:
                continue
            seen.add(o)
            deduped.append(o)
        origins = deduped
    return origins


def get_cors_origin_regex() -> str | None:
    """
    Optional regex allow-list for wildcard subdomains.
    Useful in production where frontend domains vary by subdomain.
    """
    raw = (os.getenv("CORS_ORIGIN_REGEX", "") or "").strip()
    if raw:
        return raw
    # Safe default for production domains used by this service.
    return r"^https:\/\/([a-z0-9-]+\.)?veradi\.kr$"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_origin_regex=get_cors_origin_regex(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(files.router)
app.include_router(auth.router)
app.include_router(reviews.router)
app.include_router(pdf.router)
app.include_router(labor.router)

