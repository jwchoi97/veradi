from dotenv import load_dotenv
load_dotenv()

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import projects, files, auth, reviews, pdf
from .mariadb import models
from .mariadb.database import engine

models.Base.metadata.create_all(bind=engine)

def get_cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "")
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    if not origins:
        # 개발용 기본값: Vite dev(5173), localhost/127.0.0.1
        origins = [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    return origins

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(files.router)
app.include_router(auth.router)
app.include_router(reviews.router)
app.include_router(pdf.router)

