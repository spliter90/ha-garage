"""Meldet die Kennzahlen jedes Autos als Sensoren an Home Assistant (über den Supervisor)."""
import logging
import os

log = logging.getLogger("garage.ha")

TOKEN = os.environ.get("SUPERVISOR_TOKEN")
BASE = os.environ.get("GARAGE_HA_URL", "http://supervisor/core/api")


def available():
    return bool(TOKEN)


def _num(v, nd):
    if v is None:
        return "unknown"
    return round(v) if nd == 0 else round(v, nd)


def car_entities(car):
    s, st, name = car["slug"], car["stats"], car["name"]
    common = {"auto": name, "fahrzeugtyp": car.get("type") or "auto", "kennzeichen": car.get("plate") or None}
    p = f"garage_{s}"

    def sensor(key, state, label, **attrs):
        return f"sensor.{p}_{key}", state, {**common, "friendly_name": f"{name} {label}", **attrs}

    nxt = st["next_plan"]
    plan_attrs = {
        "status": nxt["status"] if nxt else None,
        "faellig_km": nxt["due_km"] if nxt else None,
        "rest_km": nxt["rest_km"] if nxt else None,
        "faellig_am": nxt["due_date"] if nxt else None,
        "rest_tage": nxt["rest_days"] if nxt else None,
        "voraussichtlich_am": nxt["effective_date"] if nxt else None,
        "intervalle": [
            {k: p_[k] for k in ("title", "status", "due_km", "rest_km", "due_date", "rest_days")}
            for p_ in st["plans"]
        ],
    }
    km_known = st["current_km"] > 0
    items = [
        sensor("kilometerstand", _num(st["current_km"] if km_known else None, 0), "Kilometerstand",
               unit_of_measurement="km", device_class="distance", state_class="total_increasing",
               icon="mdi:counter"),
        sensor("km_jahr", _num(st["km_year"] if km_known else None, 0), "km dieses Jahr",
               unit_of_measurement="km", device_class="distance", state_class="measurement",
               icon="mdi:map-marker-distance"),
        sensor("verbrauch_schnitt", _num(st["avg_l100"], 2), "Verbrauch Ø",
               unit_of_measurement="L/100km", state_class="measurement", icon="mdi:gas-station"),
        sensor("verbrauch_letzter", _num(st["last_l100"], 2), "Verbrauch zuletzt",
               unit_of_measurement="L/100km", state_class="measurement", icon="mdi:gas-station-outline"),
        sensor("kosten_100km", _num(st["cost_per_100km"], 2), "Spritkosten pro 100 km",
               unit_of_measurement="€/100km", state_class="measurement", icon="mdi:cash-multiple"),
        sensor("spritpreis", _num(st["last_ppl"], 3), "Spritpreis zuletzt",
               unit_of_measurement="€/L", state_class="measurement", icon="mdi:currency-eur"),
        sensor("tankkosten_jahr", _num(st["fuel_cost_year"], 2), "Tankkosten dieses Jahr",
               unit_of_measurement="EUR", device_class="monetary", state_class="total",
               icon="mdi:gas-station"),
        sensor("wartungskosten_jahr", _num(st["service_cost_year"], 2), "Wartungskosten dieses Jahr",
               unit_of_measurement="EUR", device_class="monetary", state_class="total",
               icon="mdi:wrench"),
        sensor("letzte_tankung", st["last_refuel"] or "unknown", "letzte Tankung",
               device_class="date", icon="mdi:calendar"),
        sensor("naechste_wartung", nxt["title"] if nxt else "keine", "nächste Wartung",
               icon="mdi:wrench-clock", **plan_attrs),
        (f"binary_sensor.{p}_wartung_faellig", "on" if st["due"] else "off",
         {**common, "friendly_name": f"{name} Wartung fällig", "device_class": "problem",
          "faellig": st["due"], "icon": "mdi:car-wrench"}),
    ]
    if (car.get("type") or "auto") != "auto":
        keep = ("kilometerstand", "wartungskosten_jahr", "naechste_wartung", "wartung_faellig")
        items = [it for it in items if it[0].rsplit(f"{p}_", 1)[1] in keep]
        if not km_known:
            items = [it for it in items if not it[0].endswith("_kilometerstand")]
    return {eid: (state, attrs) for eid, state, attrs in items}


async def publish_all(session, cars, known):
    headers = {"Authorization": f"Bearer {TOKEN}"}
    entities = {}
    for c in cars:
        if c.get("active", 1):
            entities.update(car_entities(c))
    for eid, (state, attrs) in entities.items():
        attrs = {k: v for k, v in attrs.items() if v is not None}
        async with session.post(f"{BASE}/states/{eid}", json={"state": str(state), "attributes": attrs},
                                headers=headers) as r:
            if r.status >= 300:
                log.warning("Sensor %s: HTTP %s %s", eid, r.status, (await r.text())[:200])
    for eid in known - set(entities):
        async with session.delete(f"{BASE}/states/{eid}", headers=headers) as r:
            log.info("Sensor %s entfernt (HTTP %s)", eid, r.status)
    return set(entities)
