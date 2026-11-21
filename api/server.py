"""API для SQL-дашборда и SQL-бота (read + write)."""

from __future__ import annotations

import os
import re
import sys
import json
import hmac
import hashlib
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, unquote_plus

import psycopg
from dotenv import load_dotenv
from fastapi import Body, FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from day_read import build_day_payload
from month_read import build_month_payload
from nutrition_read import (
    NUTRITION_EXPORT_PERIODS,
    build_nutrition_day_payload,
    build_nutrition_export_csv,
    export_csv_filename,
    get_product_by_id,
    list_products,
)
from nutrition_write import (
    add_log_entry,
    adopt_catalog_as_custom,
    create_product,
    delete_log_entry,
    delete_product,
    set_day_cheatmeal,
    update_log_entry,
    update_product,
)
from dishes import create_dish, get_dish, update_dish
from catalog_read import get_catalog_product_api, list_catalog_products
from item_meta import get_item_meta, list_favorites, upsert_item_meta
from week_read import build_week_payload
from finance_common import next_reminder as finance_next_reminder
from finance_read import (
    FINANCE_EXPORT_PERIODS,
    build_finance_export_xlsx,
    build_finance_month_payload,
    build_finance_plan_payload,
    build_finance_ytd_payload,
    list_finance_categories,
    list_finance_reminders,
    list_finance_transactions,
)
from finance_write import (
    create_reminder,
    create_transaction,
    delete_reminder,
    delete_transaction,
    save_month_plan,
    update_reminder,
    update_transaction,
)
from diary_read import (
    build_diary_day_payload,
    build_diary_month_payload,
    build_diary_suggest_tokens,
)
from diary_write import delete_diary_day, save_diary_day
from ledger_read import (
    build_apartment_summary,
    build_car_consumables_summary,
    build_car_reminders,
    build_car_service_summary,
    build_car_tech,
    build_ledger_inbox,
    build_mortgage_progress,
    build_mortgage_schedule,
    get_loan_config,
    get_mortgage_config,
    list_ledger_allocations,
    list_ledger_assets,
)
from ledger_write import (
    add_car_mileage_year,
    create_allocations,
    delete_allocation,
    dismiss_inbox_transaction,
    save_car_maintenance,
    save_loan_config,
    save_mortgage_config,
    update_allocation,
    update_car_odometer,
    upsert_asset,
)

load_dotenv()

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "bot"))
sys.path.insert(0, str(REPO_ROOT / "!bot_SQL"))

from data_store import SheetsError  # noqa: E402
from postgres_store import PostgresStore  # noqa: E402

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://life:life@localhost:5432/life_dashboard",
).strip()

MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ALLOWED_TELEGRAM_USERNAME = os.getenv("ALLOWED_TELEGRAM_USERNAME", "tim710").strip().lower()
ALLOWED_TELEGRAM_ID = (os.getenv("ALLOWED_TELEGRAM_ID") or "").strip()
TELEGRAM_AUTH_HEADER = "x-telegram-init-data"
TELEGRAM_AUTH_QUERY = "tgWebAppData"
AUTH_COOKIE = "ld_auth"


def _load_bot_token() -> str:
    token = (os.getenv("TELEGRAM_BOT_TOKEN") or os.getenv("BOT_TOKEN") or "").strip()
    if token:
        return token
    env_sql = REPO_ROOT / "!bot_SQL" / ".env.sql"
    if env_sql.is_file():
        for line in env_sql.read_text(encoding="utf-8").splitlines():
            raw = line.strip()
            if not raw or raw.startswith("#") or "=" not in raw:
                continue
            key, value = raw.split("=", 1)
            if key.strip() == "BOT_TOKEN":
                return value.strip().strip("'").strip('"')
    return ""


TELEGRAM_BOT_TOKEN = _load_bot_token()


def _parse_and_validate_init_data(init_data: str) -> dict[str, Any] | None:
    if not init_data or not TELEGRAM_BOT_TOKEN:
        return None
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    their_hash = pairs.get("hash")
    if not their_hash:
        return None
    data_check = "\n".join(
        f"{k}={v}"
        for k, v in sorted((k, v) for k, v in pairs.items() if k != "hash")
    )
    secret = hmac.new(
        b"WebAppData",
        TELEGRAM_BOT_TOKEN.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    ours = hmac.new(secret, data_check.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(ours, their_hash):
        return None
    user_raw = pairs.get("user")
    if not user_raw:
        return None
    try:
        return json.loads(user_raw)
    except json.JSONDecodeError:
        return None


def _is_allowed_telegram_user(user: dict[str, Any] | None) -> bool:
    if not isinstance(user, dict):
        return False
    username = str(user.get("username") or "").strip().lower()
    user_id = str(user.get("id") or "").strip()
    if ALLOWED_TELEGRAM_ID and user_id:
        return user_id == ALLOWED_TELEGRAM_ID
    return bool(ALLOWED_TELEGRAM_USERNAME and username == ALLOWED_TELEGRAM_USERNAME)


def _extract_init_data(request: Request) -> str:
    header = (request.headers.get(TELEGRAM_AUTH_HEADER) or "").strip()
    if header:
        return header
    qv = (request.query_params.get(TELEGRAM_AUTH_QUERY) or "").strip()
    if qv:
        return unquote_plus(qv)
    return ""


def _requires_auth(path: str) -> bool:
    if path == "/favicon.ico":
        return False
    # Static mini-app shell must be reachable so Telegram WebView can boot JS.
    # Sensitive data remains protected at API endpoints below.
    if path.startswith("/mini-app"):
        return False
    if path.startswith("/docs") or path.startswith("/openapi"):
        return True
    return path.startswith("/")


class TelegramGateMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path or "/"
        if not _requires_auth(path):
            return await call_next(request)
        if request.method == "OPTIONS":
            return await call_next(request)
        if request.cookies.get(AUTH_COOKIE) == "1":
            return await call_next(request)

        init_data = _extract_init_data(request)
        user = _parse_and_validate_init_data(init_data)
        if not _is_allowed_telegram_user(user):
            # Stealth mode: do not reveal existence of endpoints.
            return Response("404", status_code=404, media_type="text/plain")

        response = await call_next(request)
        # Persist auth for static assets requests within this browser session.
        if path.startswith("/mini-app"):
            response.set_cookie(
                AUTH_COOKIE,
                "1",
                httponly=True,
                secure=True,
                samesite="lax",
                path="/",
            )
        return response


class MiniAppNoCacheMiddleware(BaseHTTPMiddleware):
    """Telegram WebView кэширует index.html без ?v= — запрещаем store для shell."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path or "/"
        if not path.startswith("/mini-app"):
            return response
        name = path.rstrip("/").rsplit("/", 1)[-1] or "index.html"
        if name == "mini-app" or name.endswith(".html") or name == "index.html":
            response.headers["Cache-Control"] = "no-store, max-age=0"
            response.headers["Pragma"] = "no-cache"
        elif name.endswith((".js", ".css")):
            response.headers["Cache-Control"] = "no-cache"
        return response


app = FastAPI(title="Life Dashboard SQL API", version="0.1.0")
pg_store = PostgresStore(DATABASE_URL)

# 8080 → 8765: fetch(..., { cache: "no-store" }) шлёт OPTIONS — нужен не только GET
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(TelegramGateMiddleware)
app.add_middleware(MiniAppNoCacheMiddleware)


@contextmanager
def db_conn():
    with psycopg.connect(DATABASE_URL, row_factory=psycopg.rows.dict_row) as conn:
        yield conn


@app.get("/")
@app.get("/index-sql.html")
def dashboard():
    """Дашборд с того же origin, что и /month — без CORS."""
    return FileResponse(REPO_ROOT / "index-sql.html")


MINI_APP_DIR = REPO_ROOT / "mini-app"
if MINI_APP_DIR.is_dir():
    app.mount(
        "/mini-app",
        StaticFiles(directory=MINI_APP_DIR, html=True),
        name="mini-app",
    )


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/month")
def get_month(month: str = Query(..., description="yyyy-MM")):
    raw = month.strip()
    if not MONTH_RE.match(raw):
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "error": "Параметр month: формат yyyy-MM, например 2026-05",
            },
        )
    try:
        with db_conn() as conn:
            payload = build_month_payload(conn, raw)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if payload.get("ok") else 404
    return JSONResponse(status_code=status, content=payload)


@app.get("/week")
def get_week(
    date_param: str = Query(..., alias="date", description="yyyy-MM-dd, якорь недели (пн–вс)"),
    month: str | None = Query(None, description="yyyy-MM, цели месяца (по умолчанию месяц date)"),
):
    raw = date_param.strip()
    if not DATE_RE.match(raw):
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "error": "Параметр date: формат yyyy-MM-dd, например 2026-06-03",
            },
        )
    month_key = (month or raw[:7]).strip()
    if not MONTH_RE.match(month_key):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "Параметр month: формат yyyy-MM"},
        )
    try:
        with db_conn() as conn:
            payload = build_week_payload(conn, raw, month_key)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(exc)})
    status = 200 if payload.get("ok") else 404
    return JSONResponse(status_code=status, content=payload)


@app.get("/day")
def get_day(date_param: str = Query(..., alias="date", description="yyyy-MM-dd")):
    """Данные одного дня для формы Mini App (тумблеры + sport-поля)."""
    raw = date_param.strip()
    if not DATE_RE.match(raw):
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "error": "Параметр date: формат yyyy-MM-dd, например 2026-06-03",
            },
        )
    try:
        with db_conn() as conn:
            payload = build_day_payload(conn, raw)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    return JSONResponse(content=payload)


@app.get("/nutrition/day")
def get_nutrition_day(date_param: str = Query(..., alias="date", description="yyyy-MM-dd")):
    """Питание за день: факт, таргеты, полоски (4 макро; fiber только в totals)."""
    raw = date_param.strip()
    if not DATE_RE.match(raw):
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "error": "Параметр date: формат yyyy-MM-dd",
            },
        )
    try:
        with db_conn() as conn:
            payload = build_nutrition_day_payload(conn, raw)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if payload.get("ok") else 404
    return JSONResponse(status_code=status, content=payload)


@app.put("/nutrition/day/cheatmeal")
async def put_nutrition_day_cheatmeal(payload: dict[str, Any] = Body(default_factory=dict)):
    """Ручной читмил на день: перекрывает таргеты спорта, сам спорт не трогает."""
    raw = str(payload.get("date") or "").strip()
    if not DATE_RE.match(raw):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "Параметр date: формат yyyy-MM-dd"},
        )
    if "enabled" not in payload:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "Укажите enabled: true|false"},
        )
    enabled = bool(payload.get("enabled"))
    try:
        with db_conn() as conn:
            result = set_day_cheatmeal(conn, raw, enabled)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 404
    return JSONResponse(status_code=status, content=result)


@app.get("/nutrition/export.csv")
def get_nutrition_export_csv(
    period: str = Query("7d", description="7d | 30d | all"),
):
    p = period.strip().lower()
    if p not in NUTRITION_EXPORT_PERIODS:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "period: 7d, 30d или all"},
        )
    try:
        with db_conn() as conn:
            csv_text = build_nutrition_export_csv(conn, p)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    filename = export_csv_filename(p)
    return Response(
        content=("\ufeff" + csv_text).encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/nutrition/products")
def get_nutrition_products(
    q: str = Query("", description="Поиск по названию"),
    limit: int = Query(80, ge=1, le=200),
    scope: str = Query("recent", description="recent | mine | dishes"),
):
    try:
        with db_conn() as conn:
            products = list_products(conn, q, limit, scope=scope)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    return {"ok": True, "products": products}


@app.get("/catalog/products")
def get_catalog_products(
    q: str = Query("", description="Поиск по каталогу"),
    limit: int = Query(40, ge=1, le=100),
    source: str | None = Query(None),
):
    try:
        with db_conn() as conn:
            products = list_catalog_products(conn, q, limit, source=source)
            # prefs + meta
            enriched = []
            for p in products:
                full = get_catalog_product_api(conn, int(p["id"]))
                enriched.append(full or p)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    return {"ok": True, "products": enriched}


@app.get("/catalog/product")
def get_catalog_product_route(
    food_id: int = Query(..., alias="foodId", ge=1),
):
    try:
        with db_conn() as conn:
            product = get_catalog_product_api(conn, food_id)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    if not product:
        return JSONResponse(status_code=404, content={"ok": False, "error": "Продукт не найден"})
    return {"ok": True, "product": product}


@app.get("/nutrition/favorites")
def get_nutrition_favorites(limit: int = Query(80, ge=1, le=200)):
    try:
        with db_conn() as conn:
            products = list_favorites(conn, limit)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    return {"ok": True, "products": products}


@app.get("/nutrition/meta")
def get_nutrition_meta(
    food_id: int | None = Query(None, alias="foodId"),
    product_id: int | None = Query(None, alias="productId"),
):
    try:
        with db_conn() as conn:
            meta = get_item_meta(conn, food_id=food_id, product_id=product_id)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    if isinstance(meta, str):
        return JSONResponse(status_code=400, content={"ok": False, "error": meta})
    return {"ok": True, **meta}


@app.put("/nutrition/meta")
async def put_nutrition_meta(payload: dict[str, Any] = Body(default_factory=dict)):
    food_raw = payload.get("foodId", payload.get("food_id"))
    product_raw = payload.get("productId", payload.get("product_id"))
    try:
        food_id = int(food_raw) if food_raw is not None and food_raw != "" else None
    except (TypeError, ValueError):
        food_id = None
    try:
        product_id = int(product_raw) if product_raw is not None and product_raw != "" else None
    except (TypeError, ValueError):
        product_id = None
    favorite = payload.get("favorite", payload.get("isFavorite"))
    if favorite is not None:
        favorite = bool(favorite)
    note = ...
    if "note" in payload:
        note = payload.get("note")
    try:
        with db_conn() as conn:
            result = upsert_item_meta(
                conn,
                food_id=food_id,
                product_id=product_id,
                favorite=favorite,
                note=note,
            )
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.get("/nutrition/product")
def get_nutrition_product(
    product_id: int = Query(..., alias="productId", ge=1),
):
    try:
        with db_conn() as conn:
            product = get_product_by_id(conn, product_id)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    if not product:
        return JSONResponse(status_code=404, content={"ok": False, "error": "Продукт не найден"})
    return {"ok": True, "product": product}


@app.post("/nutrition/products")
async def post_nutrition_product(payload: dict[str, Any] = Body(default_factory=dict)):
    try:
        with db_conn() as conn:
            result = create_product(conn, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.post("/nutrition/products/adopt-catalog")
async def post_adopt_catalog_product(payload: dict[str, Any] = Body(default_factory=dict)):
    """Изменить КБЖУ food → свой products + скрыть food."""
    try:
        with db_conn() as conn:
            result = adopt_catalog_as_custom(conn, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.patch("/nutrition/products/{product_id}")
async def patch_nutrition_product(
    product_id: int,
    payload: dict[str, Any] = Body(default_factory=dict),
):
    try:
        with db_conn() as conn:
            result = update_product(conn, product_id, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    if not result.get("ok"):
        status = 404 if result.get("error") == "Продукт не найден" else 400
        return JSONResponse(status_code=status, content=result)
    return JSONResponse(status_code=200, content=result)


@app.delete("/nutrition/products/{product_id}")
def delete_nutrition_product(product_id: int):
    try:
        with db_conn() as conn:
            result = delete_product(conn, product_id)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    if not result.get("ok"):
        status = 404 if result.get("error") == "Продукт не найден" else 400
        return JSONResponse(status_code=status, content=result)
    return JSONResponse(status_code=200, content=result)


@app.post("/nutrition/dishes")
async def post_nutrition_dish(payload: dict[str, Any] = Body(default_factory=dict)):
    try:
        with db_conn() as conn:
            result = create_dish(conn, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.get("/nutrition/dishes/{product_id}")
async def get_nutrition_dish(product_id: int):
    try:
        with db_conn() as conn:
            result = get_dish(conn, product_id)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 404
    return JSONResponse(status_code=status, content=result)


@app.put("/nutrition/dishes/{product_id}")
async def put_nutrition_dish(
    product_id: int,
    payload: dict[str, Any] = Body(default_factory=dict),
):
    try:
        with db_conn() as conn:
            result = update_dish(conn, product_id, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = (
        200
        if result.get("ok")
        else (404 if result.get("error") == "Блюдо не найдено" else 400)
    )
    return JSONResponse(status_code=status, content=result)


@app.post("/nutrition/log")
async def post_nutrition_log(payload: dict[str, Any] = Body(default_factory=dict)):
    raw_date = str(payload.get("date") or "").strip()
    if not DATE_RE.match(raw_date):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "date: формат yyyy-MM-dd"},
        )
    try:
        with db_conn() as conn:
            result = add_log_entry(conn, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.patch("/nutrition/log/{entry_id}")
async def patch_nutrition_log(
    entry_id: int,
    payload: dict[str, Any] = Body(default_factory=dict),
):
    try:
        with db_conn() as conn:
            result = update_log_entry(conn, entry_id, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 404 if result.get("error") == "Запись не найдена" else (200 if result.get("ok") else 400)
    return JSONResponse(status_code=status, content=result)


@app.delete("/nutrition/log/{entry_id}")
def delete_nutrition_log(entry_id: int):
    try:
        with db_conn() as conn:
            result = delete_log_entry(conn, entry_id)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 404
    return JSONResponse(status_code=status, content=result)


def _parse_iso_date(raw: Any) -> date:
    s = str(raw or "").strip()
    try:
        return date.fromisoformat(s)
    except ValueError as exc:
        raise SheetsError("bad_date") from exc


@app.get("/finance/month")
def get_finance_month(month: str = Query(..., description="yyyy-MM")):
    raw = month.strip()
    if not MONTH_RE.match(raw):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "Параметр month: формат yyyy-MM"},
        )
    try:
        with db_conn() as conn:
            payload = build_finance_month_payload(conn, raw)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    return JSONResponse(content=payload)


@app.get("/finance/ytd")
def get_finance_ytd(
    year: int = Query(..., ge=2000, le=2100),
    through_month: int | None = Query(None, ge=1, le=12, alias="throughMonth"),
):
    try:
        with db_conn() as conn:
            payload = build_finance_ytd_payload(conn, year, through_month)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    return JSONResponse(content=payload)


@app.get("/finance/categories")
def get_finance_categories(
    kind: str | None = Query(None, description="income | expense | carryover"),
):
    if kind and kind not in ("income", "expense", "carryover"):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "kind: income, expense или carryover"},
        )
    try:
        with db_conn() as conn:
            categories = list_finance_categories(conn, kind)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    return {"ok": True, "categories": categories}


@app.get("/finance/transactions")
def get_finance_transactions(
    month: str | None = Query(None, description="yyyy-MM"),
    category_id: int | None = Query(None, alias="categoryId", ge=1),
):
    if month and not MONTH_RE.match(month.strip()):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "month: формат yyyy-MM"},
        )
    try:
        with db_conn() as conn:
            transactions = list_finance_transactions(
                conn,
                month.strip() if month else None,
                category_id,
            )
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    return {"ok": True, "transactions": transactions}


@app.get("/finance/reminders")
def get_finance_reminders():
    try:
        with db_conn() as conn:
            reminders = list_finance_reminders(conn)
            nxt = finance_next_reminder(conn)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    return {"ok": True, "reminders": reminders, "nextReminder": nxt}


@app.get("/finance/plan")
def get_finance_plan(month: str = Query(..., description="yyyy-MM")):
    raw = month.strip()
    if not MONTH_RE.match(raw):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "month: формат yyyy-MM"},
        )
    try:
        with db_conn() as conn:
            payload = build_finance_plan_payload(conn, raw)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    return JSONResponse(content=payload)


@app.get("/finance/export.xlsx")
def get_finance_export_xlsx(
    period: str = Query("year", description="year | period"),
    date_from: str | None = Query(None, alias="from", description="yyyy-MM-dd"),
    date_to: str | None = Query(None, alias="to", description="yyyy-MM-dd"),
):
    p = period.strip().lower()
    if p not in FINANCE_EXPORT_PERIODS:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "period: year или period"},
        )
    try:
        with db_conn() as conn:
            xlsx_bytes, label = build_finance_export_xlsx(conn, p, date_from, date_to)
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(exc)})
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    filename = f"finance-{label}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/finance/transactions")
async def post_finance_transaction(payload: dict[str, Any] = Body(default_factory=dict)):
    try:
        with db_conn() as conn:
            result = create_transaction(conn, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.patch("/finance/transactions/{transaction_id}")
async def patch_finance_transaction(
    transaction_id: int,
    payload: dict[str, Any] = Body(default_factory=dict),
):
    try:
        with db_conn() as conn:
            result = update_transaction(conn, transaction_id, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 404 if result.get("error") == "Транзакция не найдена" else (200 if result.get("ok") else 400)
    return JSONResponse(status_code=status, content=result)


@app.delete("/finance/transactions/{transaction_id}")
def delete_finance_transaction(transaction_id: int):
    try:
        with db_conn() as conn:
            result = delete_transaction(conn, transaction_id)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 404
    return JSONResponse(status_code=status, content=result)


@app.post("/finance/plan")
async def post_finance_plan(payload: dict[str, Any] = Body(default_factory=dict)):
    try:
        with db_conn() as conn:
            result = save_month_plan(conn, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.post("/finance/reminders")
async def post_finance_reminder(payload: dict[str, Any] = Body(default_factory=dict)):
    try:
        with db_conn() as conn:
            result = create_reminder(conn, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.patch("/finance/reminders/{reminder_id}")
async def patch_finance_reminder(
    reminder_id: int,
    payload: dict[str, Any] = Body(default_factory=dict),
):
    try:
        with db_conn() as conn:
            result = update_reminder(conn, reminder_id, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 404 if result.get("error") == "Напоминание не найдено" else (200 if result.get("ok") else 400)
    return JSONResponse(status_code=status, content=result)


@app.delete("/finance/reminders/{reminder_id}")
def delete_finance_reminder(reminder_id: int):
    try:
        with db_conn() as conn:
            result = delete_reminder(conn, reminder_id)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 404
    return JSONResponse(status_code=status, content=result)


@app.get("/ledger/assets")
def get_ledger_assets():
    try:
        with db_conn() as conn:
            assets = list_ledger_assets(conn)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    return {"ok": True, "assets": assets}


@app.post("/ledger/assets")
def post_ledger_asset(payload: dict = Body(...)):
    try:
        with db_conn() as conn:
            result = upsert_asset(conn, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.get("/ledger/inbox")
def get_ledger_inbox(month: str | None = Query(None, description="yyyy-MM")):
    if month and not MONTH_RE.match(month.strip()):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "Параметр month: формат yyyy-MM"},
        )
    try:
        with db_conn() as conn:
            payload = build_ledger_inbox(conn, month=month.strip() if month else None)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    return JSONResponse(content=payload)


@app.post("/ledger/inbox/dismiss")
def post_ledger_inbox_dismiss(payload: dict = Body(...)):
    raw = payload.get("financeTransactionId") or payload.get("finance_transaction_id")
    try:
        txn_id = int(raw)
    except (TypeError, ValueError):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "financeTransactionId обязателен"},
        )
    if txn_id < 1:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "financeTransactionId обязателен"},
        )
    try:
        with db_conn() as conn:
            result = dismiss_inbox_transaction(conn, txn_id)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.get("/ledger/allocations")
def get_ledger_allocations(
    asset_id: int | None = Query(None, alias="assetId", ge=1),
    bucket: str | None = Query(None),
    year: int | None = Query(None, ge=2000, le=2100),
    month: str | None = Query(None, description="yyyy-MM"),
):
    if month and not MONTH_RE.match(month.strip()):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "Параметр month: формат yyyy-MM"},
        )
    try:
        with db_conn() as conn:
            payload = list_ledger_allocations(
                conn,
                asset_id=asset_id,
                bucket=bucket,
                year=year,
                month=month.strip() if month else None,
            )
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    return JSONResponse(content=payload)


@app.post("/ledger/allocations")
def post_ledger_allocations(payload: dict = Body(...)):
    try:
        with db_conn() as conn:
            result = create_allocations(conn, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.patch("/ledger/allocations/{allocation_id}")
def patch_ledger_allocation(allocation_id: int, payload: dict = Body(...)):
    try:
        with db_conn() as conn:
            result = update_allocation(conn, allocation_id, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 404 if result.get("error") == "Распределение не найдено" else (200 if result.get("ok") else 400)
    return JSONResponse(status_code=status, content=result)


@app.delete("/ledger/allocations/{allocation_id}")
def delete_ledger_allocation(allocation_id: int):
    try:
        with db_conn() as conn:
            result = delete_allocation(conn, allocation_id)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 404
    return JSONResponse(status_code=status, content=result)


@app.get("/ledger/apartment/summary")
def get_ledger_apartment_summary(
    asset_id: int = Query(..., alias="assetId", ge=1),
    year: int = Query(..., ge=2000, le=2100),
):
    try:
        with db_conn() as conn:
            payload = build_apartment_summary(conn, asset_id, year)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if payload.get("ok") else 404
    return JSONResponse(status_code=status, content=payload)


@app.get("/ledger/car/service/summary")
def get_ledger_car_service_summary(
    asset_id: int = Query(..., alias="assetId", ge=1),
    year: int = Query(..., ge=2000, le=2100),
):
    try:
        with db_conn() as conn:
            payload = build_car_service_summary(conn, asset_id, year)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if payload.get("ok") else 404
    return JSONResponse(status_code=status, content=payload)


@app.get("/ledger/car/consumables")
def get_ledger_car_consumables(
    asset_id: int = Query(..., alias="assetId", ge=1),
    year: int = Query(..., ge=2000, le=2100),
):
    try:
        with db_conn() as conn:
            payload = build_car_consumables_summary(conn, asset_id, year)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if payload.get("ok") else 404
    return JSONResponse(status_code=status, content=payload)


@app.get("/ledger/car/reminders")
def get_ledger_car_reminders(asset_id: int = Query(..., alias="assetId", ge=1)):
    try:
        with db_conn() as conn:
            payload = build_car_reminders(conn, asset_id)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if payload.get("ok") else 404
    return JSONResponse(status_code=status, content=payload)


@app.get("/ledger/car/tech")
def get_ledger_car_tech(asset_id: int = Query(..., alias="assetId", ge=1)):
    try:
        with db_conn() as conn:
            payload = build_car_tech(conn, asset_id)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if payload.get("ok") else 404
    return JSONResponse(status_code=status, content=payload)


@app.patch("/ledger/car/tech/odometer")
async def patch_ledger_car_odometer(
    asset_id: int = Query(..., alias="assetId", ge=1),
    payload: dict = Body(...),
):
    try:
        with db_conn() as conn:
            result = update_car_odometer(conn, asset_id, payload)
            if result.get("ok"):
                conn.commit()
                result = build_car_tech(conn, asset_id)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.put("/ledger/car/tech/maintenance")
async def put_ledger_car_maintenance(
    asset_id: int = Query(..., alias="assetId", ge=1),
    payload: dict = Body(...),
):
    try:
        with db_conn() as conn:
            result = save_car_maintenance(conn, asset_id, payload)
            if result.get("ok"):
                conn.commit()
                result = build_car_tech(conn, asset_id)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.post("/ledger/car/tech/mileage-years")
async def post_ledger_car_mileage_year(
    asset_id: int = Query(..., alias="assetId", ge=1),
    payload: dict = Body(...),
):
    try:
        with db_conn() as conn:
            result = add_car_mileage_year(conn, asset_id, payload)
            if result.get("ok"):
                conn.commit()
                result = build_car_tech(conn, asset_id)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.get("/ledger/mortgage/progress")
def get_ledger_mortgage_progress(asset_id: int = Query(..., alias="assetId", ge=1)):
    try:
        with db_conn() as conn:
            payload = build_mortgage_progress(conn, asset_id)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if payload.get("ok") else 404
    return JSONResponse(status_code=status, content=payload)


@app.get("/ledger/mortgage/schedule")
def get_ledger_mortgage_schedule(asset_id: int = Query(..., alias="assetId", ge=1)):
    try:
        with db_conn() as conn:
            payload = build_mortgage_schedule(conn, asset_id)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if payload.get("ok") else 404
    return JSONResponse(status_code=status, content=payload)


@app.get("/ledger/mortgage/config")
def get_ledger_mortgage_config(asset_id: int = Query(..., alias="assetId", ge=1)):
    try:
        with db_conn() as conn:
            payload = get_mortgage_config(conn, asset_id)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if payload.get("ok") else 404
    return JSONResponse(status_code=status, content=payload)


@app.put("/ledger/mortgage/config")
def put_ledger_mortgage_config(
    asset_id: int = Query(..., alias="assetId", ge=1),
    payload: dict = Body(...),
):
    try:
        with db_conn() as conn:
            result = save_mortgage_config(conn, asset_id, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.get("/ledger/loan/config")
def get_ledger_loan_config(asset_id: int = Query(..., alias="assetId", ge=1)):
    try:
        with db_conn() as conn:
            payload = get_loan_config(conn, asset_id)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if payload.get("ok") else 404
    return JSONResponse(status_code=status, content=payload)


@app.put("/ledger/loan/config")
def put_ledger_loan_config(
    asset_id: int = Query(..., alias="assetId", ge=1),
    payload: dict = Body(...),
):
    try:
        with db_conn() as conn:
            result = save_loan_config(conn, asset_id, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.get("/diary/month")
def get_diary_month(month: str = Query(..., description="yyyy-MM")):
    raw = month.strip()
    if not MONTH_RE.match(raw):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "Параметр month: формат yyyy-MM"},
        )
    try:
        with db_conn() as conn:
            payload = build_diary_month_payload(conn, raw)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    return JSONResponse(content=payload)


@app.get("/diary/suggest-tokens")
def get_diary_suggest_tokens(
    days: int = Query(40, ge=1, le=120, description="Окно дней для предложки"),
):
    """#теги и [[wiki]] из записей за последние N дней (без отдельного архива)."""
    try:
        with db_conn() as conn:
            payload = build_diary_suggest_tokens(conn, days=days)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    return JSONResponse(content=payload)


@app.get("/diary/day")
def get_diary_day(date_param: str = Query(..., alias="date", description="yyyy-MM-dd")):
    raw = date_param.strip()
    if not DATE_RE.match(raw):
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "error": "Параметр date: формат yyyy-MM-dd",
            },
        )
    try:
        with db_conn() as conn:
            payload = build_diary_day_payload(conn, raw)
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    return JSONResponse(content=payload)


@app.post("/diary/day")
async def post_diary_day(payload: dict[str, Any] = Body(default_factory=dict)):
    try:
        with db_conn() as conn:
            result = save_diary_day(conn, payload)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.delete("/diary/day")
def delete_diary_day_endpoint(
    date_param: str = Query(..., alias="date", description="yyyy-MM-dd"),
):
    raw = date_param.strip()
    if not DATE_RE.match(raw):
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "error": "Параметр date: формат yyyy-MM-dd",
            },
        )
    try:
        with db_conn() as conn:
            result = delete_diary_day(conn, raw)
            if result.get("ok"):
                conn.commit()
    except psycopg.Error as exc:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": f"База недоступна: {exc}"},
        )
    status = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status, content=result)


@app.post("/write")
async def write(payload: dict[str, Any] = Body(default_factory=dict)):
    """
    Совместимо с doPost Apps Script:
    action = prepareDay | writeRoutineBatch | writeSportBatch | writeSportCell.
    """
    action = str(payload.get("action", "")).strip()
    try:
        if action == "prepareDay":
            day = _parse_iso_date(payload.get("date"))
            prepared = await pg_store.prepare_day(day)
            return {
                "ok": True,
                "action": "prepareDay",
                "date": prepared.date_iso,
                "month": prepared.month,
                "row1Based": prepared.row_1based,
            }

        if action == "writeRoutineBatch":
            day = _parse_iso_date(payload.get("date"))
            row_1based = int(payload.get("row1Based"))
            values = list(payload.get("values") or [])
            await pg_store.write_routine_batch(day, values, row_1based)
            return {
                "ok": True,
                "action": "writeRoutineBatch",
                "date": day.isoformat(),
                "row1Based": row_1based,
            }

        if action == "writeSportBatch":
            day = _parse_iso_date(payload.get("date"))
            row_1based = int(payload.get("row1Based"))
            cells = list(payload.get("cells") or [])
            await pg_store.write_sport_batch(day, cells, row_1based)
            return {
                "ok": True,
                "action": "writeSportBatch",
                "date": day.isoformat(),
                "row1Based": row_1based,
                "cellsWritten": len(cells),
            }

        if action == "writeSportCell":
            day = _parse_iso_date(payload.get("date"))
            row_1based = int(payload.get("row1Based"))
            col_1based = int(payload.get("col1Based"))
            value = payload.get("value")
            await pg_store.write_sport_cell(day, col_1based, value, row_1based)
            return {
                "ok": True,
                "action": "writeSportCell",
                "date": day.isoformat(),
                "row1Based": row_1based,
                "col1Based": col_1based,
                "value": value,
            }

        return {"ok": False, "error": f"Unknown action: {action}"}
    except SheetsError as exc:
        return {"ok": False, "error": str(exc)}
    except (TypeError, ValueError):
        return {"ok": False, "error": "table_not_configured"}
