#!/usr/bin/env python3
"""Garage – Tankbuch und Wartungsplaner als Home-Assistant-Add-on."""
import asyncio
import csv
import datetime as dt
import hmac
import io
import json
import logging
import os
import sqlite3

import aiohttp
from aiohttp import web

import calc
import db as store
import ha

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("garage")

DATA_DIR = os.environ.get("GARAGE_DATA_DIR", "/data")
DEV = os.environ.get("GARAGE_DEV") == "1"
PORT = int(os.environ.get("GARAGE_PORT", "8099"))
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
INGRESS_IP = "172.30.32.2"


def load_options():
    opts = {"warn_km": 1000, "warn_tage": 30, "publish_interval": 120, "api_token": ""}
    try:
        with open(os.path.join(DATA_DIR, "options.json"), encoding="utf-8") as f:
            opts.update(json.load(f))
    except FileNotFoundError:
        pass
    return opts


@web.middleware
async def errors(request, handler):
    try:
        return await handler(request)
    except store.ValidationError as e:
        return web.json_response({"error": str(e)}, status=400)
    except sqlite3.IntegrityError as e:
        return web.json_response({"error": f"Datenbankfehler: {e}"}, status=400)
    except store.NotFound:
        return web.json_response({"error": "Eintrag nicht gefunden"}, status=404)
    except json.JSONDecodeError:
        return web.json_response({"error": "Ungültiges JSON"}, status=400)


@web.middleware
async def auth(request, handler):
    if DEV or request.remote == INGRESS_IP:
        return await handler(request)
    token = request.app["options"].get("api_token") or ""
    if token and request.path.startswith("/api/"):
        given = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        given = given or request.headers.get("X-Garage-Token", "")
        if given and hmac.compare_digest(given, token):
            return await handler(request)
    return web.json_response(
        {"error": "Zugriff nur über Home Assistant oder mit API-Token"}, status=401)


def build_cars(app):
    opts = app["options"]
    cars = store.all_data(app["db"])
    today = dt.date.today()
    for c in cars:
        c["stats"] = calc.car_stats(c, opts["warn_km"], opts["warn_tage"], today)
    return cars


async def index(request):
    return web.FileResponse(os.path.join(STATIC_DIR, "index.html"),
                            headers={"Cache-Control": "no-cache"})


async def get_data(request):
    o = request.app["options"]
    return web.json_response({
        "cars": build_cars(request.app),
        "options": {"warn_km": o["warn_km"], "warn_tage": o["warn_tage"]},
        "sensors": ha.available(),
    })


def _table(request):
    t = request.match_info["table"]
    if t not in store.TABLES:
        raise web.HTTPNotFound()
    return t


async def create(request):
    rid = store.insert(request.app["db"], _table(request), await request.json())
    request.app["changed"].set()
    return web.json_response({"ok": True, "id": rid}, status=201)


async def update(request):
    store.update(request.app["db"], _table(request), int(request.match_info["id"]), await request.json())
    request.app["changed"].set()
    return web.json_response({"ok": True})


async def remove(request):
    store.delete(request.app["db"], _table(request), int(request.match_info["id"]))
    request.app["changed"].set()
    return web.json_response({"ok": True})


def _de(v):
    if isinstance(v, float):
        return f"{v:.3f}".rstrip("0").rstrip(".").replace(".", ",")
    return "" if v is None else v


CSV_COLS = {
    "refuels": [("date", "Datum"), ("odometer", "km-Stand"), ("liters", "Liter"), ("price_total", "Betrag €"),
                ("full", "Voll"), ("missed", "Vorherige fehlt"), ("station", "Tankstelle"), ("note", "Notiz")],
    "services": [("date", "Datum"), ("odometer", "km-Stand"), ("kind", "Art"), ("title", "Bezeichnung"),
                 ("cost", "Kosten €"), ("workshop", "Werkstatt"), ("note", "Notiz")],
    "readings": [("date", "Datum"), ("odometer", "km-Stand"), ("note", "Notiz")],
}


async def export_csv(request):
    t = request.match_info["table"]
    if t not in CSV_COLS:
        raise web.HTTPNotFound()
    car_id = int(request.match_info["car"])
    car = next((c for c in store.all_data(request.app["db"]) if c["id"] == car_id), None)
    if car is None:
        raise store.NotFound(car_id)
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow([label for _, label in CSV_COLS[t]])
    for r in car[t]:
        w.writerow([_de(r.get(k)) for k, _ in CSV_COLS[t]])
    name = f"{car['slug']}_{t}_{dt.date.today().isoformat()}.csv"
    return web.Response(body=("﻿" + buf.getvalue()).encode("utf-8"),
                        headers={"Content-Type": "text/csv; charset=utf-8",
                                 "Content-Disposition": f'attachment; filename="{name}"'})


async def get_backup(request):
    name = f"garage_backup_{dt.date.today().isoformat()}.json"
    return web.Response(text=json.dumps(store.backup(request.app["db"]), ensure_ascii=False, indent=1),
                        content_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="{name}"'})


async def post_restore(request):
    store.restore(request.app["db"], await request.json())
    request.app["changed"].set()
    return web.json_response({"ok": True})


async def publisher(app):
    if not ha.available():
        log.info("Kein SUPERVISOR_TOKEN – Sensoren werden nicht gemeldet (Entwicklungsmodus)")
        return
    interval = app["options"]["publish_interval"]
    known = set()
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as session:
        while True:
            app["changed"].clear()
            try:
                known = await ha.publish_all(session, build_cars(app), known)
            except Exception:  # noqa: BLE001 – HA kann kurz weg sein (Neustart)
                log.exception("Sensoren konnten nicht gemeldet werden")
            try:
                await asyncio.wait_for(app["changed"].wait(), timeout=interval)
            except asyncio.TimeoutError:
                pass


async def on_startup(app):
    app["publisher"] = asyncio.create_task(publisher(app))


async def on_cleanup(app):
    app["publisher"].cancel()
    app["db"].close()


def make_app():
    os.makedirs(DATA_DIR, exist_ok=True)
    app = web.Application(middlewares=[errors, auth], client_max_size=20 * 1024 * 1024)
    app["options"] = load_options()
    app["db"] = store.connect(os.path.join(DATA_DIR, "garage.db"))
    app["changed"] = asyncio.Event()
    app.router.add_get("/", index)
    app.router.add_static("/static/", STATIC_DIR)
    app.router.add_get("/api/data", get_data)
    app.router.add_get("/api/backup", get_backup)
    app.router.add_post("/api/restore", post_restore)
    app.router.add_get("/api/export/{car}/{table}.csv", export_csv)
    app.router.add_post("/api/{table}", create)
    app.router.add_put("/api/{table}/{id:\\d+}", update)
    app.router.add_delete("/api/{table}/{id:\\d+}", remove)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


if __name__ == "__main__":
    log.info("Garage startet auf Port %s", PORT)
    web.run_app(make_app(), host="0.0.0.0", port=PORT, access_log=None)
