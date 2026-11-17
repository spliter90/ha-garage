'use strict';

const S = { data: null, car: null, tab: 'overview', edit: null, prefill: null };
const TABS = [['overview', 'Übersicht'], ['fuel', 'Tanken'], ['service', 'Wartung'], ['km', 'Kilometer'], ['car', 'Fahrzeug']];
const TYPES = { auto: 'Auto', anhaenger: 'Anhänger', wohnwagen: 'Wohnwagen' };
const KINDS = ['Wartung', 'Inspektion', 'Reparatur', 'HU/AU', 'Prüfung', 'Reifen', 'Sonstiges'];
const FUELS = ['Diesel', 'Super E5', 'Super E10', 'Super Plus', 'LPG', 'CNG'];
const STATUS = { ok: 'ok', bald: 'bald fällig', ueberfaellig: 'überfällig', unbekannt: 'Startwert fehlt' };
// [Titel, Intervall Monate] – Vorlagen; km-Intervalle bitte nach Herstellerangabe eintragen
const QUICK_PLANS = {
  auto: [['Ölwechsel'], ['Inspektion'], ['HU/AU', 24], ['Zahnriemen'], ['Bremsflüssigkeit'],
    ['Luftfilter'], ['Innenraumfilter'], ['Kraftstofffilter'], ['Reifenwechsel', 6]],
  anhaenger: [['HU', 24], ['Reifenalter (Tempo 100)', 72], ['Auflaufbremse einstellen'], ['Radlager prüfen'],
    ['Kupplung / Deichsel schmieren'], ['Beleuchtung & Stecker']],
  wohnwagen: [['HU', 24], ['Gasprüfung G 607', 24], ['Dichtigkeitsprüfung', 12], ['Reifenalter (Tempo 100)', 72],
    ['Auflaufbremse einstellen'], ['Radlager prüfen'], ['Batterie / Mover'], ['Wasseranlage reinigen']],
};
const HINTS = {
  auto: 'Intervalle bitte nach Herstellerangabe eintragen.',
  anhaenger: 'HU: bis 750 kg erstmals nach 36 Monaten, danach alle 24 Monate; 750–3.500 kg alle 24 Monate; über 3.500 kg jährlich. Bei Tempo-100-Zulassung dürfen die Reifen höchstens 6 Jahre alt sein – „zuletzt am“ dann auf das DOT-Datum setzen.',
};
HINTS.wohnwagen = `${HINTS.anhaenger} Dichtigkeitsprüfung nach Vorgabe des Herstellers (Garantie).`;

// ---------- Hilfsfunktionen ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ok = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const num = (v, d = 1) => (ok(v) ? Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
const u = (v, d, unit) => (ok(v) ? `${num(v, d)} ${unit}` : '–');
const eur = (v) => u(v, 2, '€');
const dde = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '–');
const todayISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const car = () => S.data?.cars.find((c) => c.id === S.car);
const vtype = (c) => c?.type || 'auto';
const isMotor = (c) => vtype(c) === 'auto';
const tabsFor = (c) => TABS.filter(([k]) => k !== 'fuel' || isMotor(c));

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show${err ? ' err' : ''}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.className = err ? 'err' : ''; }, err ? 5000 : 2200);
}

async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`);
  return j;
}

async function load() {
  S.data = await api('GET', 'api/data');
  if (S.car !== 'new' && !(S.car === 'all' && S.data.cars.length > 1) && !car()) S.car = S.data.cars[0]?.id ?? null;
  render();
}

// ---------- Formular-Bausteine ----------
function inp(label, name, val, type = 'text', extra = '', cls = '') {
  return `<label class="${cls}">${label}<input name="${name}" type="${type}" value="${esc(val ?? '')}" ${extra}></label>`;
}
function chk(label, name, val) {
  return `<label class="cb"><input type="checkbox" name="${name}" ${val ? 'checked' : ''}>${label}</label>`;
}
function sel(label, name, val, options) {
  const opts = options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(val ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('');
  return `<label>${label}<select name="${name}">${opts}</select></label>`;
}
function findRec(table, id) {
  if (table === 'cars') return S.data.cars.find((c) => c.id === id);
  return car()?.[table].find((r) => r.id === id);
}
function formState(table, defaults) {
  if (S.edit?.table === table) {
    const rec = findRec(table, S.edit.id);
    if (rec) return { rec, id: rec.id };
  }
  if (S.prefill?.table === table) return { rec: { ...defaults, ...S.prefill.values }, id: null };
  return { rec: defaults, id: null };
}
function formActions(table, id, label) {
  const cancel = id || S.prefill?.table === table ? '<button class="btn sec" type="button" data-act="cancel">Abbrechen</button>' : '';
  return `<div class="actions"><button class="btn" type="submit">${id ? 'Änderung speichern' : label}</button>${cancel}</div>`;
}
const formTag = (table, id) => `<form class="f" data-table="${table}" ${id ? `data-id="${id}"` : ''}>`;
const rowBtns = (table, id) => `<button class="ib" data-act="edit" data-table="${table}" data-id="${id}">Bearbeiten</button><button class="ib del" data-act="del" data-table="${table}" data-id="${id}">Löschen</button>`;
const isEditing = (table, id) => (S.edit?.table === table && S.edit.id === id ? 'editing' : '');

// ---------- Diagramme ----------
const CH = { W: 640, H: 220, T: 12, B: 28 };
const niceTop = (max) => { const step = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / step) * step; };
const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleString('de-DE', { month: 'short' }).replace('.', '');
const legend = (items) => `<div class="legend">${items.map(([c, t]) => `<span style="--c:${c}">${t}</span>`).join('')}</div>`;

// points: [{date, v, tip}]
function lineChart(all, o) {
  const pts = all.slice(-(o.max || 40));
  if (pts.length < 2) return `<p class="muted small">${o.empty}</p>`;
  const { W, H, T, B } = CH, L = 48, R = 12;
  const ys = pts.map((p) => p.v);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = Math.max((hi - lo) * 0.15, o.minPad || 0.3);
  lo = Math.max(0, lo - pad); hi += pad;
  const X = (i) => L + (W - L - R) * i / (pts.length - 1);
  const Y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const grid = [lo, (lo + hi) / 2, hi].map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${num(v, o.axisDigits ?? 1)}</text>`).join('');
  const line = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const dots = pts.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="3.5" fill="${o.color}"><title>${p.tip}</title></circle>`).join('');
  const avgLine = ok(o.avg) ? `<line x1="${L}" x2="${W - R}" y1="${Y(o.avg)}" y2="${Y(o.avg)}" stroke="var(--service)" stroke-width="1.5" stroke-dasharray="5 4"/>` : '';
  const xl = [0, pts.length - 1].map((i) => `<text x="${X(i)}" y="${H - 8}" text-anchor="${i ? 'end' : 'start'}">${dde(pts[i].date)}</text>`).join('');
  const leg = [[o.color, o.legend]];
  if (ok(o.avg)) leg.push(['var(--service)', o.avgLabel]);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.aria}">${grid}${avgLine}<polyline points="${line}" fill="none" stroke="${o.color}" stroke-width="2" stroke-linejoin="round"/>${dots}${xl}</svg>${legend(leg)}`;
}

// items: [{label, parts:[number], tip}], o.colors / o.names je Teil
function columnChart(items, o) {
  const totals = items.map((it) => it.parts.reduce((a, v) => a + (v || 0), 0));
  const max = Math.max(...totals, 0);
  if (max <= 0) return `<p class="muted small">${o.empty}</p>`;
  const top = niceTop(max);
  const { W, H, T, B } = CH, L = 72, R = 8;
  const ih = H - T - B, bw = (W - L - R) / items.length;
  const Y = (v) => T + ih * (1 - v / top);
  const grid = [0, top / 2, top].map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${num(v, 0)}${o.unit ? ` ${o.unit}` : ''}</text>`).join('');
  const bars = items.map((it, i) => {
    const x = L + i * bw + bw * 0.18, w = bw * 0.64;
    let base = 0;
    const rects = it.parts.map((v, k) => {
      const h = ih * (v || 0) / top, y = Y(0) - base - h;
      base += h;
      return h > 0 ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${o.colors[k]}" rx="2"><title>${it.tip}</title></rect>` : '';
    }).join('');
    return `<g>${rects}<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${esc(it.label)}</text></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.aria}">${grid}${bars}</svg>${o.names ? legend(o.colors.map((c, k) => [c, o.names[k]])) : ''}`;
}

// rows: [{name, color, parts:[{v, color}], text}] – waagrechte Balken für den Vergleich
function hBars(rows, o) {
  const max = Math.max(...rows.map((r) => r.parts.reduce((a, p) => a + (p.v || 0), 0)), 0);
  if (!rows.length || max <= 0) return `<p class="muted small">${o.empty}</p>`;
  return `<div class="hbars">${rows.map((r) => {
    const segs = r.parts.map((p) => `<span style="width:${(100 * (p.v || 0) / max).toFixed(2)}%;background:${p.color}"></span>`).join('');
    return `<div class="hb"><div class="hb-n"><span class="dot" style="background:${esc(r.color)}"></span>${esc(r.name)}</div>
      <div class="hb-bar">${segs}</div><div class="hb-v">${r.text}</div></div>`;
  }).join('')}</div>${o.names ? legend(o.names) : ''}`;
}

function consumptionChart(st) {
  const one = st.segments.length === 1 ? `Bisher ein Messwert: ${u(st.segments[0].l100, 2, 'l/100 km')}. ` : '';
  return lineChart(st.segments.map((s) => ({ date: s.date, v: s.l100, tip: `${dde(s.date)}: ${num(s.l100, 2)} l/100 km auf ${num(s.km, 0)} km` })), {
    color: 'var(--fuel)', legend: 'l/100 km je Tankintervall', avg: st.avg_l100, avgLabel: `Durchschnitt ${u(st.avg_l100, 2, 'l/100 km')}`,
    aria: 'Verbrauchsverlauf', empty: `${one}Für den Verlauf braucht es mindestens zwei Abschnitte von Volltankung zu Volltankung.`,
  });
}

function priceChart(c) {
  const pts = c.refuels.filter((r) => ok(r.price_total) && r.liters > 0)
    .map((r) => ({ date: r.date, v: r.price_total / r.liters, tip: `${dde(r.date)}: ${num(r.price_total / r.liters, 3)} €/l${r.station ? ` · ${esc(r.station)}` : ''}` }));
  const avg = pts.length ? pts.reduce((a, p) => a + p.v, 0) / pts.length : null;
  return lineChart(pts, {
    color: 'var(--price)', legend: '€ pro Liter je Tankung', avg, avgLabel: `Mittel ${u(avg, 3, '€/l')}`, axisDigits: 2, minPad: 0.03,
    aria: 'Spritpreis-Verlauf', empty: 'Für den Verlauf braucht es mindestens zwei Tankungen mit Betrag.',
  });
}

function costChart(months) {
  return columnChart(months.map((m) => ({ label: monthLabel(m.month), parts: [m.fuel, m.service], tip: `${m.month}: Tanken ${eur(m.fuel)}, Wartung ${eur(m.service)}` })), {
    colors: ['var(--fuel)', 'var(--service)'], names: ['Tanken', 'Wartung &amp; Reparatur'], unit: '€',
    aria: 'Kosten pro Monat', empty: 'In den letzten 12 Monaten noch keine Kosten erfasst.',
  });
}

function kmChart(months) {
  return columnChart(months.map((m) => ({ label: monthLabel(m.month), parts: [m.km], tip: `${m.month}: ${ok(m.km) ? `${num(m.km, 0)} km` : 'keine Daten'}` })), {
    colors: ['var(--km)'], unit: 'km', aria: 'Kilometer pro Monat',
    empty: 'Noch zu wenige km-Stände. Gezählt wird zwischen zwei Ablesungen (Tankungen, Wartungen, km-Stände).',
  });
}

function comparison() {
  const cars = S.data.cars.filter((c) => c.active);
  const y = new Date().getFullYear();
  const autos = cars.filter(isMotor);
  const rows = cars.map((c) => {
    const st = c.stats;
    return `<tr><td><span class="dot" style="background:${esc(c.color)}"></span> ${esc(c.name)}</td><td>${TYPES[vtype(c)]}</td>
      <td class="n">${st.current_km > 0 ? num(st.current_km, 0) : '–'}</td><td class="n">${st.current_km > 0 ? num(st.km_year, 0) : '–'}</td>
      <td class="n">${num(st.avg_l100, 2)}</td><td class="n">${eur(st.cost_per_100km)}</td>
      <td class="n">${eur(st.fuel_cost_year)}</td><td class="n">${eur(st.service_cost_year)}</td>
      <td>${st.due.length ? `<span class="badge b-bald">${esc(st.due.join(', '))}</span>` : '<span class="muted">–</span>'}</td></tr>`;
  }).join('');
  const sumMonths = cars[0] ? cars[0].stats.months.map((m, i) => ({
    month: m.month,
    fuel: cars.reduce((a, c) => a + c.stats.months[i].fuel, 0),
    service: cars.reduce((a, c) => a + c.stats.months[i].service, 0),
  })) : [];
  const costRows = cars.map((c) => ({ name: c.name, color: c.color, text: eur(c.stats.fuel_cost_year + c.stats.service_cost_year),
    parts: [{ v: c.stats.fuel_cost_year, color: 'var(--fuel)' }, { v: c.stats.service_cost_year, color: 'var(--service)' }] }))
    .sort((a, b) => b.parts[0].v + b.parts[1].v - a.parts[0].v - a.parts[1].v);
  const consRows = autos.filter((c) => ok(c.stats.avg_l100)).map((c) => ({ name: c.name, color: c.color, text: u(c.stats.avg_l100, 2, 'l/100 km'), parts: [{ v: c.stats.avg_l100, color: c.color }] }));
  const kmRows = cars.filter((c) => c.stats.current_km > 0).map((c) => ({ name: c.name, color: c.color, text: u(c.stats.km_year, 0, 'km'), parts: [{ v: c.stats.km_year, color: c.color }] }));
  return `<section class="card"><h2>Alle Fahrzeuge</h2><div class="tw"><table><thead><tr><th>Fahrzeug</th><th>Typ</th><th class="n">km-Stand</th><th class="n">km ${y}</th>
      <th class="n">Ø l/100 km</th><th class="n">Sprit / 100 km</th><th class="n">Tanken ${y}</th><th class="n">Wartung ${y}</th><th>Fällig</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    <div class="grid two">
      <section class="card"><h2>Kosten ${y}</h2>${hBars(costRows, { empty: 'Noch keine Kosten in diesem Jahr.', names: [['var(--fuel)', 'Tanken'], ['var(--service)', 'Wartung &amp; Reparatur']] })}</section>
      <section class="card"><h2>Ø Verbrauch</h2>${hBars(consRows, { empty: 'Noch kein Verbrauch berechnet.' })}</section>
      <section class="card"><h2>km ${y}</h2>${hBars(kmRows, { empty: 'Noch keine km-Stände.' })}</section>
      <section class="card"><h2>Kosten pro Monat (alle)</h2>${costChart(sumMonths)}</section>
    </div>`;
}

// ---------- Wartungs-Anzeige ----------
function planDetail(p) {
  const parts = [];
  const iv = [p.interval_km ? `${num(p.interval_km, 0)} km` : '', p.interval_months ? `${p.interval_months} Monate` : ''].filter(Boolean).join(' / ');
  if (iv) parts.push(`alle ${iv}`);
  if (p.status === 'unbekannt') {
    parts.push('letzte Durchführung eintragen (Bearbeiten oder „Erledigt“)');
    return parts.join(' · ');
  }
  if (ok(p.rest_km)) parts.push(p.rest_km < 0 ? `seit ${num(-p.rest_km, 0)} km überfällig` : `bei ${num(p.due_km, 0)} km (noch ${num(p.rest_km, 0)} km)`);
  if (ok(p.rest_days)) parts.push(p.rest_days < 0 ? `seit ${-p.rest_days} Tagen überfällig` : `am ${dde(p.due_date)} (noch ${p.rest_days} Tage)`);
  if (p.est_date && ok(p.rest_km) && p.rest_km >= 0) parts.push(`km-Grenze voraussichtlich ~${dde(p.est_date)}`);
  return parts.join(' · ');
}
function planRow(p, withButtons) {
  const btns = withButtons
    ? `<div style="white-space:nowrap"><button class="ib" data-act="done" data-id="${p.id}">Erledigt</button>${rowBtns('plans', p.id)}</div>` : '';
  return `<div class="plan ${isEditing('plans', p.id)}"><div><div class="t">${esc(p.title)} <span class="badge b-${p.status}">${STATUS[p.status]}</span></div>
    <div class="muted small">${planDetail(p)}</div></div>${btns}</div>`;
}

// ---------- Ansichten ----------
function overview(c) {
  const st = c.stats, y = new Date().getFullYear();
  if (!c.refuels.length && !c.services.length && !c.plans.length && !c.readings.length) {
    const first = isMotor(c) ? '<button class="btn" data-act="tab" data-tab="fuel">Tankung erfassen</button>' : '';
    return `<section class="card empty"><h2>${esc(c.name)} ist angelegt</h2>
      <p class="muted">${isMotor(c) ? 'Erfasse die erste Tankung oder lege Wartungsintervalle an.' : 'Lege Prüf- und Wartungsintervalle an, z. B. HU und Reifenalter.'}</p>
      <p>${first} <button class="btn ${first ? 'sec' : ''}" data-act="tab" data-tab="service">Wartung planen</button></p></section>`;
  }
  if (!isMotor(c)) return trailerOverview(c, st, y);
  const kpis = [
    ['Kilometerstand', u(st.current_km, 0, 'km')],
    ['Ø Verbrauch', u(st.avg_l100, 2, 'l/100 km')],
    ['Verbrauch zuletzt', u(st.last_l100, 2, 'l/100 km')],
    ['Spritkosten / 100 km', eur(st.cost_per_100km)],
    ['Spritpreis zuletzt', u(st.last_ppl, 3, '€/l')],
    [`km ${y}`, u(st.km_year, 0, 'km')],
    [`Tankkosten ${y}`, eur(st.fuel_cost_year)],
    [`Wartung ${y}`, eur(st.service_cost_year)],
  ].map(([l, v]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
  const plans = st.plans.length
    ? st.plans.slice(0, 4).map((p) => planRow(p, false)).join('') + (st.plans.length > 4 ? `<p class="small"><button class="ib" data-act="tab" data-tab="service">Alle ${st.plans.length} Intervalle</button></p>` : '')
    : '<p class="muted small">Noch keine Wartungsintervalle. <button class="ib" data-act="tab" data-tab="service">Jetzt anlegen</button></p>';
  return `<div class="grid kpis" style="margin-bottom:16px">${kpis}</div>
    <div class="grid two">
      <section class="card"><h2>Nächste Wartung</h2>${plans}</section>
      <section class="card"><h2>Gesamt</h2><div class="grid kpis">
        <div class="kpi"><div class="l">Tankungen</div><div class="v">${st.refuel_count}</div></div>
        <div class="kpi"><div class="l">Liter gesamt</div><div class="v">${u(st.liters_total, 0, 'l')}</div></div>
        <div class="kpi"><div class="l">Tankkosten gesamt</div><div class="v">${eur(st.fuel_cost_total)}</div></div>
        <div class="kpi"><div class="l">Wartung gesamt</div><div class="v">${eur(st.service_cost_total)}</div></div>
        <div class="kpi"><div class="l">Kosten pro km (alles)</div><div class="v">${u(st.total_cost_per_km, 3, '€')}</div></div>
        <div class="kpi"><div class="l">Ø pro Tag</div><div class="v">${u(st.km_per_day, 0, 'km')}</div></div>
      </div></section>
    </div>
    <div class="grid two">
      <section class="card"><h2>Verbrauch</h2>${consumptionChart(st)}</section>
      <section class="card"><h2>Spritpreis</h2>${priceChart(c)}</section>
      <section class="card"><h2>Kosten pro Monat</h2>${costChart(st.months)}</section>
      <section class="card"><h2>Kilometer pro Monat</h2>${kmChart(st.months)}</section>
    </div>`;
}

function trailerOverview(c, st, y) {
  const plans = st.plans.length ? st.plans.map((p) => planRow(p, false)).join('')
    : '<p class="muted small">Noch keine Intervalle. <button class="ib" data-act="tab" data-tab="service">Jetzt anlegen</button></p>';
  const kpis = [
    ['Wartung ' + y, eur(st.service_cost_year)],
    ['Wartung gesamt', eur(st.service_cost_total)],
    ['Einträge', String(c.services.length)],
    ['Fällig', st.due.length ? String(st.due.length) : 'nichts'],
  ];
  if (st.current_km > 0) kpis.push(['Kilometerstand', u(st.current_km, 0, 'km')]);
  return `<div class="grid kpis" style="margin-bottom:16px">${kpis.map(([l, v]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')}</div>
    <div class="grid two">
      <section class="card"><h2>Prüfungen &amp; Wartung</h2>${plans}</section>
      <section class="card"><h2>Kosten pro Monat</h2>${costChart(st.months)}</section>
      ${st.current_km > 0 ? `<section class="card"><h2>Kilometer pro Monat</h2>${kmChart(st.months)}</section>` : ''}
    </div>`;
}

function fuelTab(c) {
  const { rec, id } = formState('refuels', { date: todayISO(), full: 1, missed: 0 });
  const segMap = Object.fromEntries(c.stats.segments.map((s) => [s.refuel_id, s]));
  const rows = [...c.refuels].reverse().map((r) => {
    const s = segMap[r.id];
    const ppl = ok(r.price_total) && r.liters ? r.price_total / r.liters : null;
    return `<tr class="${isEditing('refuels', r.id)}"><td>${dde(r.date)}</td><td class="n">${num(r.odometer, 0)}</td>
      <td class="n">${num(r.liters, 2)}</td><td class="n">${eur(r.price_total)}</td><td class="n">${ppl ? num(ppl, 3) : '–'}</td>
      <td>${r.full ? 'voll' : 'teil'}${r.missed ? ' <span title="Vorherige Tankung fehlt">⚠</span>' : ''}</td>
      <td class="n">${s ? num(s.l100, 2) : ''}</td><td class="n">${s ? num(s.km, 0) : ''}</td>
      <td>${esc(r.station)}</td><td>${rowBtns('refuels', r.id)}</td></tr>`;
  }).join('');
  return `<section class="card"><h2>${id ? 'Tankung bearbeiten' : 'Tankung erfassen'}</h2>${formTag('refuels', id)}
      ${inp('Datum', 'date', rec.date, 'date', 'required')}
      ${inp('km-Stand', 'odometer', rec.odometer, 'number', `required step="any" min="0" inputmode="numeric" placeholder="über ${num(c.stats.current_km, 0)}"`)}
      ${inp('Liter', 'liters', rec.liters, 'number', 'required step="0.01" min="0.01" inputmode="decimal"')}
      ${inp('Betrag €', 'price_total', rec.price_total, 'number', 'step="0.01" min="0" inputmode="decimal"')}
      <label>€ pro Liter<input id="ppl" disabled></label>
      ${inp('Tankstelle', 'station', rec.station)}
      ${chk('Vollgetankt', 'full', rec.full)}
      ${chk('Vorherige Tankung fehlt', 'missed', rec.missed)}
      ${inp('Notiz', 'note', rec.note, 'text', '', 'wide')}
      ${formActions('refuels', id, 'Tankung speichern')}
    </form>
    <p class="muted small">Der Verbrauch wird von Volltankung zu Volltankung berechnet, Teilbetankungen dazwischen zählen mit. Fehlt eine Tankung, bei der nächsten „Vorherige Tankung fehlt“ setzen – sonst stimmt der Wert nicht.</p></section>
    <section class="card"><h2>Tankungen <span class="muted small">(${c.refuels.length})</span></h2>
    ${c.refuels.length ? `<div class="tw"><table><thead><tr><th>Datum</th><th class="n">km-Stand</th><th class="n">Liter</th><th class="n">Betrag</th><th class="n">€/l</th><th>Art</th><th class="n">l/100 km</th><th class="n">Strecke</th><th>Tankstelle</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Noch keine Tankungen.</p>'}
    </section>`;
}

function serviceTab(c) {
  const st = c.stats;
  const p = formState('plans', {});
  const s = formState('services', { date: todayISO(), kind: 'Wartung' });
  const quick = QUICK_PLANS[vtype(c)].map(([t, m]) => `<button class="chip" data-act="quickplan" data-title="${esc(t)}" data-months="${m ?? ''}">+ ${esc(t)}</button>`).join('');
  const planOpts = [['', '– keinem Intervall –'], ...c.plans.map((x) => [x.id, x.title])];
  const total = c.services.reduce((a, x) => a + (x.cost || 0), 0);
  const planName = Object.fromEntries(c.plans.map((x) => [x.id, x.title]));
  const rows = [...c.services].reverse().map((x) => `<tr class="${isEditing('services', x.id)}"><td>${dde(x.date)}</td>
      <td class="n">${num(x.odometer, 0)}</td><td>${esc(x.kind)}</td><td>${esc(x.title)}${x.note ? `<div class="muted small">${esc(x.note)}</div>` : ''}</td>
      <td class="n">${eur(x.cost)}</td><td>${esc(x.workshop)}</td><td class="muted small">${esc(planName[x.plan_id] || '')}</td>
      <td>${rowBtns('services', x.id)}</td></tr>`).join('');
  return `<section class="card"><h2>Wartungsintervalle</h2>
      ${st.plans.length ? st.plans.map((x) => planRow(x, true)).join('') : '<p class="muted small">Noch keine Intervalle angelegt.</p>'}
      <h3>${p.id ? 'Intervall bearbeiten' : 'Intervall anlegen'}</h3>
      ${p.id ? '' : `<div class="quick">${quick}</div>`}
      ${formTag('plans', p.id)}
        ${inp('Bezeichnung', 'title', p.rec.title, 'text', 'required')}
        ${inp('alle … km', 'interval_km', p.rec.interval_km, 'number', 'step="any" min="0" inputmode="numeric"')}
        ${inp('alle … Monate', 'interval_months', p.rec.interval_months, 'number', 'step="1" min="0" inputmode="numeric"')}
        ${inp('zuletzt bei km', 'last_km', p.rec.last_km, 'number', 'step="any" min="0" inputmode="numeric"')}
        ${inp('zuletzt am', 'last_date', p.rec.last_date, 'date')}
        ${inp('Notiz', 'note', p.rec.note, 'text', '', 'wide')}
        ${formActions('plans', p.id, 'Intervall speichern')}
      </form>
      <p class="muted small">${HINTS[vtype(c)]} Wird eine Wartung mit Intervall-Zuordnung erfasst, rückt die Fälligkeit automatisch weiter.</p>
    </section>
    <section class="card"><h2>${s.id ? 'Eintrag bearbeiten' : 'Wartung / Reparatur erfassen'}</h2>${formTag('services', s.id)}
        ${inp('Datum', 'date', s.rec.date, 'date', 'required')}
        ${inp('km-Stand', 'odometer', s.rec.odometer, 'number', `step="any" min="0" inputmode="numeric" placeholder="${num(st.current_km, 0)}"`)}
        ${sel('Art', 'kind', s.rec.kind, KINDS.map((k) => [k, k]))}
        ${inp('Bezeichnung', 'title', s.rec.title, 'text', 'required')}
        ${inp('Kosten €', 'cost', s.rec.cost, 'number', 'step="0.01" min="0" inputmode="decimal"')}
        ${inp('Werkstatt / selbst', 'workshop', s.rec.workshop)}
        ${sel('Zählt für Intervall', 'plan_id', s.rec.plan_id, planOpts)}
        ${inp('Notiz (Teile, Teilenummern …)', 'note', s.rec.note, 'text', '', 'wide')}
        ${formActions('services', s.id, 'Eintrag speichern')}
      </form></section>
    <section class="card"><h2>Wartung &amp; Reparaturen <span class="muted small">(${c.services.length} · ${eur(total)})</span></h2>
      ${c.services.length ? `<div class="tw"><table><thead><tr><th>Datum</th><th class="n">km</th><th>Art</th><th>Bezeichnung</th><th class="n">Kosten</th><th>Werkstatt</th><th>Intervall</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Noch keine Einträge.</p>'}
    </section>`;
}

function kmTab(c) {
  const { rec, id } = formState('readings', { date: todayISO() });
  const rows = [...c.readings].reverse().map((r) => `<tr class="${isEditing('readings', r.id)}"><td>${dde(r.date)}</td>
      <td class="n">${num(r.odometer, 0)}</td><td>${esc(r.note)}</td><td>${rowBtns('readings', r.id)}</td></tr>`).join('');
  return `<section class="card"><h2>${id ? 'km-Stand bearbeiten' : 'km-Stand erfassen'}</h2>${formTag('readings', id)}
      ${inp('Datum', 'date', rec.date, 'date', 'required')}
      ${inp('km-Stand', 'odometer', rec.odometer, 'number', `required step="any" min="0" inputmode="numeric" placeholder="${num(c.stats.current_km, 0)}"`)}
      ${inp('Notiz', 'note', rec.note, 'text', '', 'wide')}
      ${formActions('readings', id, 'km-Stand speichern')}
    </form>
    <p class="muted small">${isMotor(c) ? 'km-Stände aus Tankungen und Wartungen werden automatisch berücksichtigt. Hier nur zusätzliche Ablesungen eintragen, z. B. wenn länger nicht getankt wurde.' : 'Optional – nur nötig, wenn du Intervalle nach km führen willst (z. B. Radlager), etwa mit Werten aus dem Fahrtenbuch oder einem Nabenzähler.'}</p></section>
    <section class="card"><h2>Ablesungen</h2>
      ${c.readings.length ? `<div class="tw"><table><thead><tr><th>Datum</th><th class="n">km-Stand</th><th>Notiz</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Keine zusätzlichen Ablesungen.</p>'}
    </section>`;
}

function carForm(c) {
  const rec = c || { type: 'auto', fuel: 'Diesel', color: '#3b82f6', active: 1, start_km: '' };
  const id = c?.id;
  return `${formTag('cars', id).replace('>', ` data-vtype="${esc(rec.type || 'auto')}">`)}
      ${sel('Fahrzeugtyp', 'type', rec.type || 'auto', Object.entries(TYPES))}
      ${inp('Name', 'name', rec.name, 'text', 'required placeholder="z. B. Duster"')}
      ${inp('Kürzel für Sensoren', 'slug', rec.slug, 'text', 'placeholder="automatisch"')}
      ${inp('Kennzeichen', 'plate', rec.plate)}
      ${sel('Kraftstoff', 'fuel', rec.fuel, FUELS.map((f) => [f, f])).replace('<label>', '<label class="motor">')}
      ${inp('Tankgröße (l)', 'tank_l', rec.tank_l, 'number', 'step="any" min="0"', 'motor')}
      ${inp('km-Stand bei Start', 'start_km', rec.start_km, 'number', 'step="any" min="0" inputmode="numeric"', 'motor')}
      ${inp('Farbe', 'color', rec.color, 'color')}
      ${chk('Aktiv (Sensoren melden)', 'active', rec.active)}
      ${inp('Notiz (Motor, Reifengröße, Ölsorte, zul. Gesamtgewicht …)', 'note', rec.note, 'text', '', 'wide')}
      <div class="actions"><button class="btn" type="submit">${id ? 'Änderung speichern' : 'Fahrzeug anlegen'}</button></div>
    </form>`;
}

function carTab(c) {
  const p = `garage_${c.slug}`;
  const all = ['sensor.%_kilometerstand', 'sensor.%_km_jahr', 'sensor.%_verbrauch_schnitt', 'sensor.%_verbrauch_letzter',
    'sensor.%_kosten_100km', 'sensor.%_spritpreis', 'sensor.%_tankkosten_jahr', 'sensor.%_wartungskosten_jahr',
    'sensor.%_letzte_tankung', 'sensor.%_naechste_wartung', 'binary_sensor.%_wartung_faellig'];
  const list = isMotor(c) ? all : ['sensor.%_wartungskosten_jahr', 'sensor.%_naechste_wartung', 'binary_sensor.%_wartung_faellig', 'sensor.%_kilometerstand (nur mit km-Ständen)'];
  const ents = list.map((e) => `<code>${e.replace('%', p)}</code>`).join('');
  return `<section class="card"><h2>${esc(c.name)} bearbeiten</h2>${carForm(c)}
      <p class="muted small">Wird das Kürzel geändert, ändern sich auch die Entitäts-IDs in Home Assistant.</p></section>
    <section class="card"><h2>Sensoren in Home Assistant</h2>
      ${S.data.sensors ? '' : '<p class="muted small">Sensoren werden nur gemeldet, wenn das Add-on in Home Assistant läuft.</p>'}
      <div class="entities">${ents}</div></section>
    <section class="card"><h2>Export</h2><p>
      <a class="btn sec" href="api/export/${c.id}/refuels.csv" download>Tankungen (CSV)</a>
      <a class="btn sec" href="api/export/${c.id}/services.csv" download>Wartung (CSV)</a>
      <a class="btn sec" href="api/export/${c.id}/readings.csv" download>km-Stände (CSV)</a></p></section>
    <section class="card"><h2>Sicherung (alle Autos)</h2>
      <p class="muted small">Die Datenbank ist in jedem Home-Assistant-Backup des Add-ons enthalten. Zusätzlich kannst du hier eine JSON-Sicherung ziehen.</p>
      <p><a class="btn sec" href="api/backup" download>Sicherung herunterladen</a></p>
      <p style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input type="file" id="restoreFile" accept="application/json,.json" style="max-width:280px">
      <button class="btn danger" data-act="restore">Wiederherstellen (ersetzt alles)</button></p></section>
    <section class="card"><h2>Fahrzeug löschen</h2>
      <p class="muted small">Löscht ${esc(c.name)} mit allen Einträgen und Intervallen. Alternativ „Aktiv“ abwählen, dann bleiben die Daten erhalten.</p>
      <button class="btn danger" data-act="del" data-table="cars" data-id="${c.id}">Fahrzeug löschen</button></section>`;
}

function render() {
  const cars = S.data.cars;
  const allChip = cars.length > 1 ? `<button class="chip ${S.car === 'all' ? 'active' : ''}" data-act="car" data-id="all">Vergleich</button>` : '';
  $('#cars').innerHTML = allChip + cars.map((c) => `<button class="chip ${c.id === S.car ? 'active' : ''}" data-act="car" data-id="${c.id}">
      <span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}${isMotor(c) || c.name.toLowerCase().includes(TYPES[vtype(c)].toLowerCase()) ? '' : ` <span class="muted small">${TYPES[vtype(c)]}</span>`}${c.active ? '' : ' <span class="muted">(inaktiv)</span>'}${c.stats.due.length ? ' <span class="badge b-bald">!</span>' : ''}</button>`).join('')
    + `<button class="chip ${S.car === 'new' || !cars.length ? 'active' : ''}" data-act="car" data-id="new">+ Fahrzeug</button>`;
  const c = car();
  if (S.car === 'all') {
    $('#tabs').innerHTML = '';
    $('#main').innerHTML = comparison();
    return;
  }
  if (!c) {
    $('#tabs').innerHTML = '';
    $('#main').innerHTML = `<section class="card"><h2>${cars.length ? 'Neues Fahrzeug' : 'Willkommen – lege dein erstes Fahrzeug an'}</h2>${carForm(null)}
      <p class="muted small">Das Kürzel bestimmt die Sensor-Namen in Home Assistant, z. B. <code>sensor.garage_duster_verbrauch_schnitt</code>.</p></section>`;
    return;
  }
  if (!tabsFor(c).some(([k]) => k === S.tab)) S.tab = 'overview';
  $('#tabs').innerHTML = tabsFor(c).map(([k, t]) => `<button class="tab ${S.tab === k ? 'active' : ''}" data-act="tab" data-tab="${k}">${t}</button>`).join('');
  const views = { overview, fuel: fuelTab, service: serviceTab, km: kmTab, car: carTab };
  $('#main').innerHTML = views[S.tab](c);
  updatePPL();
}

function focusForm(table) {
  const f = document.querySelector(`form[data-table="${table}"]`);
  if (!f) return;
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  f.querySelector('input:not([type=hidden]):not([disabled])')?.focus({ preventScroll: true });
}

function updatePPL() {
  const f = document.querySelector('form[data-table="refuels"]');
  const out = document.getElementById('ppl');
  if (!f || !out) return;
  const l = parseFloat(f.liters.value), p = parseFloat(f.price_total.value);
  out.value = l > 0 && p > 0 ? `${num(p / l, 3)} €/l` : '';
}

function arm(btn, fn) {
  if (btn.classList.contains('armed')) {
    btn.classList.remove('armed');
    fn().catch((e) => toast(e.message, true));
    return;
  }
  const label = btn.textContent;
  btn.classList.add('armed');
  btn.textContent = 'Wirklich?';
  setTimeout(() => { if (btn.isConnected) { btn.classList.remove('armed'); btn.textContent = label; } }, 3000);
}

// ---------- Ereignisse ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act;
  if (a === 'car') {
    S.car = ['new', 'all'].includes(b.dataset.id) ? b.dataset.id : Number(b.dataset.id);
    S.edit = S.prefill = null;
    render();
  } else if (a === 'tab') {
    S.tab = b.dataset.tab; S.edit = S.prefill = null;
    render(); window.scrollTo(0, 0);
  } else if (a === 'edit') {
    S.edit = { table: b.dataset.table, id: Number(b.dataset.id) }; S.prefill = null;
    render(); focusForm(b.dataset.table);
  } else if (a === 'cancel') {
    S.edit = S.prefill = null; render();
  } else if (a === 'quickplan') {
    S.edit = null;
    S.prefill = { table: 'plans', values: { title: b.dataset.title, interval_months: b.dataset.months } };
    render(); focusForm('plans');
  } else if (a === 'done') {
    const c = car(), p = c.stats.plans.find((x) => x.id === Number(b.dataset.id));
    S.edit = null;
    S.prefill = { table: 'services', values: { title: p.title, plan_id: p.id, kind: /^HU/.test(p.title) ? 'HU/AU' : /prüfung/i.test(p.title) ? 'Prüfung' : /^Reifen/.test(p.title) ? 'Reifen' : 'Wartung', odometer: c.stats.current_km || '', date: todayISO() } };
    render(); focusForm('services');
  } else if (a === 'del') {
    arm(b, async () => {
      await api('DELETE', `api/${b.dataset.table}/${b.dataset.id}`);
      if (b.dataset.table === 'cars') { S.car = null; S.tab = 'overview'; }
      S.edit = S.prefill = null;
      toast('Gelöscht');
      await load();
    });
  } else if (a === 'restore') {
    const file = $('#restoreFile')?.files[0];
    if (!file) { toast('Bitte zuerst eine Sicherungsdatei wählen', true); return; }
    arm(b, async () => {
      await api('POST', 'api/restore', JSON.parse(await file.text()));
      S.car = null; S.tab = 'overview';
      toast('Sicherung wiederhergestellt');
      await load();
    });
  }
});

document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (!f.dataset.table) return;
  e.preventDefault();
  const table = f.dataset.table, id = f.dataset.id;
  const body = {};
  for (const el of f.elements) {
    if (!el.name) continue;
    body[el.name] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
  }
  if (table !== 'cars') body.car_id = S.car;
  const btn = f.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const r = await api(id ? 'PUT' : 'POST', id ? `api/${table}/${id}` : `api/${table}`, body);
    S.edit = S.prefill = null;
    if (table === 'cars' && !id) { S.car = r.id; S.tab = 'overview'; }
    toast('Gespeichert');
    await load();
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
  }
});

document.addEventListener('input', (e) => {
  if (e.target.form?.dataset.table === 'refuels') updatePPL();
});
document.addEventListener('change', (e) => {
  if (e.target.name === 'type' && e.target.form?.dataset.table === 'cars') e.target.form.dataset.vtype = e.target.value;
});

load().catch((e) => { $('#main').innerHTML = `<section class="card"><h2>Fehler beim Laden</h2><p>${esc(e.message)}</p></section>`; });
