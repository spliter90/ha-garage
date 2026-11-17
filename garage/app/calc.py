"""Auswertung: Verbrauch (Voll-zu-Voll), Kosten, Kilometer und Wartungsfälligkeit."""
import datetime as dt
from calendar import monthrange

STATUS_RANK = {"ueberfaellig": 0, "bald": 1, "ok": 2, "unbekannt": 3}


def pdate(s):
    try:
        return dt.date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


def add_months(d, months):
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    return dt.date(y, m, min(d.day, monthrange(y, m)[1]))


def _ppl(r):
    if r.get("price_total") is None or not r.get("liters"):
        return None
    return r["price_total"] / r["liters"]


def segments(refuels):
    """Voll-zu-Voll-Methode: Liter aller Tankungen nach einer Volltankung bis zur
    nächsten Volltankung, geteilt durch die Strecke dazwischen. Teilbetankungen
    werden mitgezählt; „vorherige Tankung fehlt“ startet die Kette neu."""
    rs = sorted(refuels, key=lambda r: (r["odometer"], r["date"], r["id"]))
    out = []
    prev = None
    liters = cost = 0.0
    cost_ok = True
    for r in rs:
        if r.get("missed"):
            prev = None
        if prev is None:
            if r.get("full"):
                prev, liters, cost, cost_ok = r, 0.0, 0.0, True
            continue
        liters += r["liters"]
        if r.get("price_total") is None:
            cost_ok = False
        else:
            cost += r["price_total"]
        if r.get("full"):
            km = r["odometer"] - prev["odometer"]
            if km > 0:
                out.append({
                    "refuel_id": r["id"],
                    "date": r["date"],
                    "odometer": r["odometer"],
                    "km": km,
                    "liters": liters,
                    "l100": liters / km * 100,
                    "cost": cost if cost_ok else None,
                })
            prev, liters, cost, cost_ok = r, 0.0, 0.0, True
    out.sort(key=lambda s: (s["date"], s["odometer"]))
    return out


def _readings(car):
    pts = []
    for r in car["refuels"]:
        pts.append((pdate(r["date"]), r["odometer"]))
    for s in car["services"]:
        if s.get("odometer") is not None:
            pts.append((pdate(s["date"]), s["odometer"]))
    for o in car["readings"]:
        pts.append((pdate(o["date"]), o["odometer"]))
    return sorted((d, km) for d, km in pts if d and km is not None)


def _odo_curve(pts):
    """Monoton steigender km-Verlauf: pro Datum der höchste bis dahin bekannte Stand."""
    curve, best = [], None
    for d, km in pts:
        best = km if best is None else max(best, km)
        if curve and curve[-1][0] == d:
            curve[-1] = (d, best)
        else:
            curve.append((d, best))
    return curve


def _odo_at(curve, day):
    """km-Stand an einem Tag, linear zwischen zwei Ablesungen; None außerhalb des bekannten Bereichs."""
    if not curve or day < curve[0][0] or day > curve[-1][0]:
        return None
    for (d0, k0), (d1, k1) in zip(curve, curve[1:]):
        if d0 <= day <= d1:
            span = (d1 - d0).days
            return k0 if span == 0 else k0 + (k1 - k0) * (day - d0).days / span
    return curve[-1][1]


def _plan_status(plan, services, current_km, km_per_day, today, warn_km, warn_days):
    last_km, last_date = plan.get("last_km"), pdate(plan.get("last_date"))
    for s in services:
        if s.get("plan_id") != plan["id"]:
            continue
        d = pdate(s["date"])
        if d and (last_date is None or d > last_date):
            last_date = d
        if s.get("odometer") is not None and (last_km is None or s["odometer"] > last_km):
            last_km = s["odometer"]

    due_km = rest_km = due_date = rest_days = est_date = None
    if plan.get("interval_km") and last_km is not None:
        due_km = last_km + plan["interval_km"]
        rest_km = due_km - current_km
        if km_per_day:
            est_date = today + dt.timedelta(days=round(rest_km / km_per_day))
    if plan.get("interval_months") and last_date is not None:
        due_date = add_months(last_date, plan["interval_months"])
        rest_days = (due_date - today).days

    if rest_km is None and rest_days is None:
        status = "unbekannt"
    elif (rest_km is not None and rest_km < 0) or (rest_days is not None and rest_days < 0):
        status = "ueberfaellig"
    elif (rest_km is not None and rest_km <= warn_km) or (rest_days is not None and rest_days <= warn_days):
        status = "bald"
    else:
        status = "ok"

    candidates = [d for d in (due_date, est_date) if d]
    effective = min(candidates) if candidates else None
    return {
        "id": plan["id"],
        "title": plan["title"],
        "interval_km": plan.get("interval_km"),
        "interval_months": plan.get("interval_months"),
        "last_km": last_km,
        "last_date": last_date.isoformat() if last_date else None,
        "due_km": due_km,
        "rest_km": rest_km,
        "due_date": due_date.isoformat() if due_date else None,
        "rest_days": rest_days,
        "est_date": est_date.isoformat() if est_date else None,
        "effective_date": effective.isoformat() if effective else None,
        "status": status,
    }


def car_stats(car, warn_km=1000, warn_days=30, today=None):
    today = today or dt.date.today()
    year = today.year
    pts = _readings(car)
    start_km = car.get("start_km") or 0
    current_km = max([km for _, km in pts] + [start_km])

    # km pro Tag aus dem letzten Jahr (für geschätzte Fälligkeit km-basierter Intervalle)
    km_per_day = None
    if pts:
        at_max = [d for d, km in pts if km == current_km]
        latest_d = max(at_max) if at_max else None
        older = [(d, km) for d, km in pts if d <= today - dt.timedelta(days=365)]
        ref = older[-1] if older else pts[0]
        if latest_d:
            days = (latest_d - ref[0]).days
            if days >= 14 and current_km > ref[1]:
                km_per_day = (current_km - ref[1]) / days

    # km in diesem Jahr
    before = [km for d, km in pts if d.year < year]
    in_year = [km for d, km in pts if d.year == year]
    if before:
        base = max(before)
    elif start_km:
        base = start_km
    elif in_year:
        base = min(in_year)
    else:
        base = current_km
    km_year = max(current_km - base, 0)

    segs = segments(car["refuels"])
    seg_km = sum(s["km"] for s in segs)
    seg_l = sum(s["liters"] for s in segs)
    priced = [s for s in segs if s["cost"] is not None]
    priced_km = sum(s["km"] for s in priced)

    refuels_sorted = sorted(car["refuels"], key=lambda r: (r["date"], r["odometer"]))
    last_ppl = None
    for r in reversed(refuels_sorted):
        if _ppl(r) is not None:
            last_ppl = _ppl(r)
            break

    fuel_year = sum(r["price_total"] or 0 for r in car["refuels"] if str(r["date"]).startswith(str(year)))
    service_year = sum(s["cost"] or 0 for s in car["services"] if str(s["date"]).startswith(str(year)))
    fuel_total = sum(r["price_total"] or 0 for r in car["refuels"])
    service_total = sum(s["cost"] or 0 for s in car["services"])

    # letzte 12 Monate
    months = []
    d = dt.date(today.year, today.month, 1)
    for i in range(11, -1, -1):
        m = add_months(d, -i)
        months.append({"month": m.strftime("%Y-%m"), "fuel": 0.0, "service": 0.0, "liters": 0.0})
    idx = {m["month"]: m for m in months}
    curve = _odo_curve(pts)
    for m in months:
        first = pdate(m["month"] + "-01")
        nxt = add_months(first, 1)
        a = _odo_at(curve, max(first, curve[0][0])) if curve else None
        b = _odo_at(curve, min(nxt, curve[-1][0])) if curve else None
        # nur Monate, die (teilweise) im bekannten Bereich liegen
        m["km"] = round(b - a) if a is not None and b is not None and curve[0][0] < nxt and first <= curve[-1][0] else None
    for r in car["refuels"]:
        m = idx.get(str(r["date"])[:7])
        if m:
            m["fuel"] += r["price_total"] or 0
            m["liters"] += r["liters"] or 0
    for s in car["services"]:
        m = idx.get(str(s["date"])[:7])
        if m:
            m["service"] += s["cost"] or 0

    plans = [_plan_status(p, car["services"], current_km, km_per_day, today, warn_km, warn_days)
             for p in car["plans"]]
    plans.sort(key=lambda p: (STATUS_RANK[p["status"]], p["effective_date"] or "9999"))
    due = [p for p in plans if p["status"] in ("ueberfaellig", "bald")]

    first_km = min([km for _, km in pts] + ([start_km] if start_km else [])) if pts else start_km
    driven = current_km - first_km if first_km is not None else 0

    return {
        "current_km": current_km,
        "km_year": km_year,
        "km_per_day": km_per_day,
        "avg_l100": seg_l / seg_km * 100 if seg_km else None,
        "last_l100": segs[-1]["l100"] if segs else None,
        "cost_per_100km": sum(s["cost"] for s in priced) / priced_km * 100 if priced_km else None,
        "last_ppl": last_ppl,
        "fuel_cost_year": fuel_year,
        "service_cost_year": service_year,
        "fuel_cost_total": fuel_total,
        "service_cost_total": service_total,
        "total_cost_per_km": (fuel_total + service_total) / driven if driven > 0 else None,
        "liters_total": sum(r["liters"] for r in car["refuels"]),
        "refuel_count": len(car["refuels"]),
        "last_refuel": refuels_sorted[-1]["date"] if refuels_sorted else None,
        "segments": segs,
        "months": months,
        "plans": plans,
        "due": [p["title"] for p in due],
        "next_plan": plans[0] if plans else None,
    }
