from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.check import router as check_router

load_dotenv()

app = FastAPI(
    title="StopSlovo",
    version="1.0.0",
    description="Сервис автоматической оценки рекламных текстов на иностранные слова и англицизмы.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(check_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
