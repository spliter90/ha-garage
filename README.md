# Garage – Home-Assistant-Add-on

Tankbuch, Verbrauch, Kilometer und Wartungsplaner für deine Autos, Anhänger und Wohnwagen, direkt in Home Assistant.

- Weboberfläche in der Seitenleiste (Ingress), auch in der Companion-App nutzbar
- Verbrauch nach der Voll-zu-Voll-Methode, Kosten pro 100 km, km pro Jahr
- Wartungsintervalle nach km und/oder Monaten mit Status ok / bald fällig / überfällig
- Reparatur- und Wartungshistorie mit Kosten
- Anhänger und Wohnwagen mit eigenen Vorlagen (HU, Gasprüfung, Dichtigkeit, Reifenalter)
- Sensoren pro Auto für Dashboards, Statistiken und Automationen
- CSV-Export und JSON-Sicherung

## Installation

**Als Repository (empfohlen):** Dieses Repo auf GitHub ablegen (z. B. `spliter90/ha-garage`), dann in Home Assistant unter *Einstellungen → Add-ons → Add-on Store → ⋮ → Repositories* die URL hinzufügen und **Garage** installieren.

**Lokal:** Den Ordner `garage` nach `/addons/garage` kopieren (Samba oder SSH), im Add-on Store *⋮ → Nach Updates suchen*, dann unter *Lokale Add-ons* installieren.

Danach starten, **In Seitenleiste anzeigen** aktivieren und das erste Auto anlegen.

## Updates per ZIP hochladen

Im Repo liegt der Workflow `.github/workflows/zip-entpacken.yml`. Lädst du auf GitHub eine ZIP hoch (*Add file → Upload files*, klappt auch im Handy-Browser), entpackt GitHub sie automatisch, committet den Inhalt und löscht die ZIP wieder. Den Fortschritt siehst du unter *Actions*.

- Hat die ZIP genau einen Oberordner (z. B. `ha-garage/`), wird dessen Inhalt übernommen.
- Liegt die ZIP in einem Unterordner, wird dort entpackt.
- Dateien, die in der ZIP fehlen, bleiben im Repo erhalten (nichts wird gelöscht).
- Der Ordner `.github` wird nie aus einer ZIP übernommen – Workflow-Änderungen bitte direkt bearbeiten.
- Danach in Home Assistant *Add-on Store → ⋮ → Nach Updates suchen*; das Update erscheint, wenn die `version` in `garage/config.yaml` gestiegen ist.

## Beispiele

- `examples/dashboard_autos.yaml` – Dashboard-Ansicht mit Mushroom Cards und Verbrauchsstatistik
- `examples/garage_package.yaml` – Skript „Tankung erfassen“, km-Stand per `rest_command`, Benachrichtigung bei fälliger Wartung

Details zu Berechnung, Sensoren und API: [garage/DOCS.md](garage/DOCS.md)

## Entwickeln

```
cd garage/app
pip install aiohttp
GARAGE_DEV=1 GARAGE_DATA_DIR=/tmp/garage python3 main.py
# → http://localhost:8099
```
