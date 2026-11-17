"""SQLite-Speicher für Autos, Tankungen, Wartung, Intervalle und km-Stände."""
import datetime as dt
import re
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS cars(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  type TEXT DEFAULT 'auto',
  plate TEXT DEFAULT '',
  fuel TEXT DEFAULT 'Diesel',
  tank_l REAL,
  start_km REAL DEFAULT 0,
  color TEXT DEFAULT '#3b82f6',
  active INTEGER DEFAULT 1,
  note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS refuels(
  id INTEGER PRIMARY KEY,
  car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  odometer REAL NOT NULL,
  liters REAL NOT NULL,
  price_total REAL,
  full INTEGER DEFAULT 1,
  missed INTEGER DEFAULT 0,
  station TEXT DEFAULT '',
  note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS plans(
  id INTEGER PRIMARY KEY,
  car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  interval_km REAL,
  interval_months INTEGER,
  last_km REAL,
  last_date TEXT,
  note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS services(
  id INTEGER PRIMARY KEY,
  car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  odometer REAL,
  kind TEXT DEFAULT 'Wartung',
  title TEXT NOT NULL,
  cost REAL,
  workshop TEXT DEFAULT '',
  note TEXT DEFAULT '',
  plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS readings(
  id INTEGER PRIMARY KEY,
  car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  odometer REAL NOT NULL,
  note TEXT DEFAULT ''
);
"""

TABLES = ("cars", "refuels", "plans", "services", "readings")

FIELDS = {
    "cars": ["name", "slug", "type", "plate", "fuel", "tank_l", "start_km", "color", "active", "note"],
    "refuels": ["car_id", "date", "odometer", "liters", "price_total", "full", "missed", "station", "note"],
    "plans": ["car_id", "title", "interval_km", "interval_months", "last_km", "last_date", "note"],
    "services": ["car_id", "date", "odometer", "kind", "title", "cost", "workshop", "note", "plan_id"],
    "readings": ["car_id", "date", "odometer", "note"],
}
REQUIRED = {
    "cars": ["name"],
    "refuels": ["car_id", "date", "odometer", "liters"],
    "plans": ["car_id", "title"],
    "services": ["car_id", "date", "title"],
    "readings": ["car_id", "date", "odometer"],
}
NUM = {"tank_l", "start_km", "odometer", "liters", "price_total", "cost", "interval_km", "last_km"}
INT = {"car_id", "active", "full", "missed", "plan_id", "interval_months"}
DATES = {"date", "last_date"}
LABELS = {
    "name": "Name", "car_id": "Auto", "date": "Datum", "odometer": "km-Stand", "liters": "Liter",
    "price_total": "Betrag", "title": "Bezeichnung", "cost": "Kosten", "interval_km": "Intervall km",
    "interval_months": "Intervall Monate", "last_km": "zuletzt bei km", "last_date": "zuletzt am",
    "tank_l": "Tankgröße", "start_km": "Start-km", "slug": "Kürzel", "type": "Fahrzeugtyp",
}
TYPES = ("auto", "anhaenger", "wohnwagen")


class NotFound(Exception):
    pass


class ValidationError(Exception):
    pass


def connect(path):
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(cars)")}
    if "type" not in cols:  # Update von 0.1.0
        with conn:
            conn.execute("ALTER TABLE cars ADD COLUMN type TEXT DEFAULT 'auto'")
    return conn


def slugify(name):
    s = str(name).lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s or "auto"


def _label(k):
    return LABELS.get(k, k)


def clean(table, data, partial=False):
    if table not in FIELDS:
        raise ValidationError("Unbekannte Tabelle")
    out = {}
    for k in FIELDS[table]:
        if k not in data:
            continue
        v = data[k]
        if isinstance(v, str):
            v = v.strip()
        if k in NUM:
            if v in ("", None):
                v = None
            else:
                try:
                    v = float(str(v).replace(",", "."))
                except ValueError:
                    raise ValidationError(f"{_label(k)}: keine gültige Zahl")
                if v < 0:
                    raise ValidationError(f"{_label(k)} darf nicht negativ sein")
        elif k in INT:
            if v in ("", None):
                v = None
            else:
                try:
                    v = int(float(v))
                except (TypeError, ValueError):
                    raise ValidationError(f"{_label(k)}: keine gültige Zahl")
        elif k in DATES:
            if v in ("", None):
                v = None
            else:
                try:
                    v = dt.date.fromisoformat(str(v)[:10]).isoformat()
                except ValueError:
                    raise ValidationError(f"{_label(k)}: ungültiges Datum (JJJJ-MM-TT)")
        else:
            v = "" if v is None else str(v)
        out[k] = v
    for k in REQUIRED[table]:
        if (not partial or k in out) and out.get(k) in (None, ""):
            raise ValidationError(f"Pflichtfeld fehlt: {_label(k)}")
    return out


def _unique_slug(conn, wanted, exclude_id=None):
    base = slugify(wanted)
    slug, n = base, 2
    while True:
        row = conn.execute("SELECT id FROM cars WHERE slug=?", (slug,)).fetchone()
        if row is None or row["id"] == exclude_id:
            return slug
        slug = f"{base}_{n}"
        n += 1


def _resolve_car(conn, data):
    """Erlaubt 'car' (Kürzel oder Name) statt car_id – praktisch für rest_command."""
    if data.get("car_id") in (None, "") and data.get("car"):
        key = str(data["car"]).strip()
        row = conn.execute(
            "SELECT id FROM cars WHERE slug=? OR lower(name)=lower(?)", (slugify(key), key)
        ).fetchone()
        if row is None:
            raise ValidationError(f"Fahrzeug „{key}“ nicht gefunden")
        data["car_id"] = row["id"]


def _check(conn, table, row, own_id=None):
    if table == "cars" and row.get("type") not in (None, *TYPES):
        raise ValidationError("Unbekannter Fahrzeugtyp")
    if table != "cars":
        car = conn.execute("SELECT type FROM cars WHERE id=?", (row["car_id"],)).fetchone()
        if car is None:
            raise ValidationError("Fahrzeug nicht gefunden")
        if table == "refuels" and (car["type"] or "auto") != "auto":
            raise ValidationError("Anhänger und Wohnwagen haben kein Tankbuch")
    if table == "plans" and row.get("interval_km") is None and row.get("interval_months") is None:
        raise ValidationError("Bitte ein Intervall in km und/oder Monaten angeben")
    if table == "services" and row.get("plan_id"):
        p = conn.execute("SELECT car_id FROM plans WHERE id=?", (row["plan_id"],)).fetchone()
        if p is None or p["car_id"] != row["car_id"]:
            raise ValidationError("Intervall gehört nicht zu diesem Fahrzeug")
    if table == "refuels" and row.get("liters") == 0:
        raise ValidationError("Liter muss größer als 0 sein")
    if table == "refuels":
        # Tippfehler abfangen: neuere Tankung mit kleinerem km-Stand als eine ältere
        prev = conn.execute(
            "SELECT max(odometer) AS km FROM refuels WHERE car_id=? AND date<=? AND id IS NOT ?",
            (row["car_id"], row["date"], own_id),
        ).fetchone()
        if prev["km"] is not None and row["odometer"] < prev["km"]:
            raise ValidationError(
                f"km-Stand {row['odometer']:,.0f} ist kleiner als bei einer früheren Tankung "
                f"({prev['km']:,.0f} km) – bitte prüfen".replace(",", "."))


def insert(conn, table, data):
    data = dict(data)
    if table != "cars":
        _resolve_car(conn, data)
        if table in ("refuels", "services", "readings") and not data.get("date"):
            data["date"] = dt.date.today().isoformat()
    row = clean(table, data)
    if table == "cars":
        row["slug"] = _unique_slug(conn, row.get("slug") or row["name"])
    _check(conn, table, row)
    cols = list(row)
    q = f"INSERT INTO {table}({','.join(cols)}) VALUES({','.join('?' * len(cols))})"
    with conn:
        cur = conn.execute(q, [row[c] for c in cols])
    return cur.lastrowid


def update(conn, table, rid, data):
    if table not in FIELDS:
        raise ValidationError("Unbekannte Tabelle")
    old = conn.execute(f"SELECT * FROM {table} WHERE id=?", (rid,)).fetchone()
    if old is None:
        raise NotFound(rid)
    data = dict(data)
    data.pop("car", None)
    changes = clean(table, data, partial=True)
    if table == "cars" and "slug" in changes:
        changes["slug"] = _unique_slug(conn, changes["slug"] or changes.get("name") or old["name"], rid)
    merged = {**dict(old), **changes}
    _check(conn, table, merged, rid)
    if not changes:
        return
    sets = ",".join(f"{c}=?" for c in changes)
    with conn:
        conn.execute(f"UPDATE {table} SET {sets} WHERE id=?", [*changes.values(), rid])


def delete(conn, table, rid):
    if table not in FIELDS:
        raise ValidationError("Unbekannte Tabelle")
    with conn:
        cur = conn.execute(f"DELETE FROM {table} WHERE id=?", (rid,))
    if cur.rowcount == 0:
        raise NotFound(rid)


ORDER = {
    "refuels": "date, odometer, id",
    "plans": "title COLLATE NOCASE",
    "services": "date, id",
    "readings": "date, odometer, id",
}


def all_data(conn):
    cars = [dict(r) for r in conn.execute("SELECT * FROM cars ORDER BY active DESC, name COLLATE NOCASE")]
    by_id = {c["id"]: c for c in cars}
    for c in cars:
        for t in ORDER:
            c[t] = []
    for t, order in ORDER.items():
        for r in conn.execute(f"SELECT * FROM {t} ORDER BY {order}"):
            if r["car_id"] in by_id:
                by_id[r["car_id"]][t].append(dict(r))
    return cars


def backup(conn):
    out = {"format": "garage-backup", "version": 1}
    for t in TABLES:
        out[t] = [dict(r) for r in conn.execute(f"SELECT * FROM {t} ORDER BY id")]
    return out


def restore(conn, payload):
    if not isinstance(payload, dict) or payload.get("format") != "garage-backup":
        raise ValidationError("Keine gültige Garage-Sicherung")
    with conn:
        for t in reversed(TABLES):
            conn.execute(f"DELETE FROM {t}")
        for t in TABLES:
            cols = ["id", *FIELDS[t]]
            for r in payload.get(t, []):
                conn.execute(
                    f"INSERT INTO {t}({','.join(cols)}) VALUES({','.join('?' * len(cols))})",
                    [r.get(c) for c in cols],
                )
