# Garage

Tankbuch und Wartungsplaner für beliebig viele Autos, Anhänger und Wohnwagen. Die Oberfläche öffnest du über **Garage** in der Seitenleiste von Home Assistant, auch in der Companion-App.

## Was erfasst wird

- **Tankungen**: Datum, km-Stand, Liter, Betrag, voll/teilweise, Tankstelle
- **Wartung & Reparaturen**: Datum, km-Stand, Art, Bezeichnung, Kosten, Werkstatt, Notiz (z. B. Teilenummern)
- **Wartungsintervalle**: alle X km und/oder Y Monate, mit „zuletzt bei“ als Startwert
- **km-Stände**: zusätzliche Ablesungen, falls länger nicht getankt wurde

## Anhänger und Wohnwagen

Beim Anlegen den **Fahrzeugtyp** wählen. Anhänger und Wohnwagen haben kein Tankbuch; es gibt Wartung, Prüfintervalle, Reparaturen und Kosten. Vorlagen: HU, Gasprüfung G 607 und Dichtigkeitsprüfung (Wohnwagen), Reifenalter für Tempo 100, Auflaufbremse, Radlager u. a.

- **HU-Fristen:** bis 750 kg erstmals nach 36 Monaten, danach alle 24 Monate; 750–3.500 kg alle 24 Monate; über 3.500 kg jährlich.
- **Reifenalter:** Mit Tempo-100-Zulassung dürfen die Reifen höchstens 6 Jahre alt sein. Intervall 72 Monate, „zuletzt am“ auf das DOT-Datum setzen.
- **km-Intervalle** funktionieren nur, wenn du km-Stände einträgst (z. B. aus Fahrtenbuch oder Nabenzähler) – sonst einfach Monate nutzen.

Sensoren für Anhänger/Wohnwagen: `wartungskosten_jahr`, `naechste_wartung`, `wartung_faellig` und – wenn km-Stände vorhanden – `kilometerstand`.

## Wie gerechnet wird

**Verbrauch** – von Volltankung zu Volltankung: alle Liter seit der letzten Volltankung (Teilbetankungen eingeschlossen) geteilt durch die gefahrene Strecke. Hast du eine Tankung nicht erfasst, setze bei der nächsten **„Vorherige Tankung fehlt“**. Dann beginnt die Rechnung dort neu, statt einen zu niedrigen Wert zu liefern.

**Wartung** – Fälligkeit = letzte Durchführung + Intervall. Erfasst du eine Wartung und ordnest sie einem Intervall zu (oder klickst beim Intervall auf **Erledigt**), rückt die Fälligkeit automatisch weiter. Bei km-Intervallen schätzt das Add-on aus deiner Fahrleistung des letzten Jahres, wann die Grenze voraussichtlich erreicht wird.

Status: **ok**, **bald fällig** (innerhalb der Vorwarnung), **überfällig**.

## Sensoren

Pro aktivem Auto (Kürzel z. B. `duster`; Anhänger/Wohnwagen siehe oben):

| Entität | Inhalt |
|---|---|
| `sensor.garage_duster_kilometerstand` | aktueller km-Stand |
| `sensor.garage_duster_km_jahr` | gefahrene km im laufenden Jahr |
| `sensor.garage_duster_verbrauch_schnitt` | Ø Verbrauch l/100 km |
| `sensor.garage_duster_verbrauch_letzter` | Verbrauch des letzten Tankintervalls |
| `sensor.garage_duster_kosten_100km` | Spritkosten pro 100 km |
| `sensor.garage_duster_spritpreis` | zuletzt bezahlter Literpreis |
| `sensor.garage_duster_tankkosten_jahr` | Tankkosten im laufenden Jahr |
| `sensor.garage_duster_wartungskosten_jahr` | Wartungs- und Reparaturkosten im laufenden Jahr |
| `sensor.garage_duster_letzte_tankung` | Datum der letzten Tankung |
| `sensor.garage_duster_naechste_wartung` | nächste fällige Wartung, Attribute: `status`, `rest_km`, `rest_tage`, `faellig_km`, `faellig_am`, `intervalle` |
| `binary_sensor.garage_duster_wartung_faellig` | an, sobald etwas bald fällig oder überfällig ist; Attribut `faellig` |

Die Sensoren werden vom Add-on gemeldet und haben keine eindeutige ID, lassen sich also nicht über die Oberfläche umbenennen. Nach einem Neustart von Home Assistant sind sie spätestens nach dem eingestellten Intervall (Standard 2 Minuten) wieder da. Langzeitstatistiken (z. B. für die Statistik-Karte) werden trotzdem geführt.

## Optionen

| Option | Bedeutung |
|---|---|
| `warn_km` | Ab wie vielen Restkilometern „bald fällig“ gilt (Standard 1000) |
| `warn_tage` | Ab wie vielen Resttagen „bald fällig“ gilt (Standard 30) |
| `publish_interval` | Sekunden zwischen zwei Sensor-Meldungen (Standard 120) |
| `api_token` | Optional: erlaubt Home Assistant (`rest_command`) und anderen Programmen, Einträge anzulegen |

## Aus Home Assistant heraus erfassen

Mit gesetztem `api_token` erreicht Home Assistant das Add-on intern unter `http://local-garage:8099` (bei Installation aus GitHub steht der Hostname auf der Info-Seite des Add-ons). Ein fertiges Paket mit Skript „Tankung erfassen“ und Benachrichtigung bei fälliger Wartung liegt im Repository unter `examples/garage_package.yaml`.

API-Beispiel:

```
POST /api/refuels
Authorization: Bearer <api_token>
{"car": "duster", "odometer": 187300, "liters": 44.2, "price_total": 76.5, "full": 1}
```

Weitere Endpunkte: `POST /api/readings` (km-Stand), `POST /api/services`, `GET /api/data` (alles inkl. Auswertung).

## Sicherung

Die Datenbank liegt in `/data/garage.db` und ist in jedem Home-Assistant-Backup des Add-ons enthalten. Zusätzlich gibt es unter **Auto → Sicherung** einen JSON-Export und CSV-Exporte für Tabellenkalkulationen.
