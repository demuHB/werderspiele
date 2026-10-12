# Meine Werder-Spiele

Dashboard für alle Werder-Spiele, die ich im Stadion gesehen habe. Es ist ein privates, nicht-kommerzielles Projekt.

Die Seite ist rein statisch. Sie liest die Excel-Datei `data/werderspiele.xlsx` direkt im Browser und berechnet daraus alle Statistiken. Einen Build-Schritt gibt es nicht.

## Neues Spiel eintragen

1. In `data/werderspiele.xlsx` eine neue Zeile in der **Haupttabelle** anlegen. Für U23-, Allstar- und Abschiedsspiele gibt es den Reiter **U23 + All Stars**.

   | Spalte | Beispiel |
   |---|---|
   | Nr. | `389` |
   | Datum | `26.09.26` |
   | Saison | `2026/2027` |
   | Wettbewerb | `Bundesliga`, `DFB-Pokal`, `Friendly`, … |
   | Sptg. | `5` oder `2. R`, `AF`, `VF`, `HF`, `FIN`, `/` |
   | Spiel | `Werder Bremen - Hamburger SV` (Heim zuerst, mit „ - “) |
   | Stadion | `Weserstadion (Bremen)` |
   | Ergebnis | `2:1 (1:0)`, bei Elfmeterschießen `1:1, 4:3 n. E. (0:1)` |
   | Torschützen | `Füllkrug (2), Stage (FE) - Kane` (erst Heim, dann Gast), `/` = keine Tore |
   | Alter | `34` |

   Markierungen bei Torschützen: `(2)` für die Anzahl, `(ET)` für ein Eigentor (der Spieler steht auf der Seite des Teams, dem das Tor gutgeschrieben wird), `(FE)` für Foulelfmeter und `(HE)` für Handelfmeter.

2. Die Datei hochladen:
   - **Am einfachsten im Dashboard:** Oben rechts auf den **Upload-Pfeil** klicken. Das Dashboard zeigt eine Vorschau (neue Spiele, Datencheck), „Hochladen“ committet die Datei als `data/werderspiele.xlsx`. Der Dateiname der Excel ist dabei egal.
     - **Einmalig** fragt das Dashboard nach einem GitHub-Token. Anlegen unter [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new): „Only select repositories“ → `demuHB/werderspiele`, Permissions → Repository → **Contents: Read and write**. Der Token liegt nur im Browser (localStorage), nie im Repo.
     - **Einmalig** wählst du die Datei aus, z. B. `B:\!Altes C\Dokumente\Alle Werder Spiele Dennis.xlsx`. Chrome und Edge merken sich die Datei, danach reicht ein Klick plus „Zugriff erlauben“. Andere Browser fragen jedes Mal nach der Datei.
   - **Alternativ im Browser auf GitHub:** Im Repo `data/` öffnen, dann **Add file → Upload files**. Die Datei als `werderspiele.xlsx` hineinziehen (gleicher Name) und **Commit changes** klicken.
   - **Am PC mit Git:** Diese Befehle im Repo-Ordner ausführen:
     ```
     git add data/werderspiele.xlsx
     git commit -m "Neues Spiel"
     git push
     ```
3. Nach etwa einer Minute ist die Seite aktuell.
4. Danach den Tab **Datencheck** öffnen. Dort steht, ob Torschützen und Ergebnis zusammenpassen, ob Datum und Saison stimmen und so weiter.

## Neue Logos und Spielerfotos

Neue Gegner oder Torschützen erscheinen zunächst mit Initialen. Logos und Fotos holst du so:

1. Bei einem neuen Verein einen Eintrag in `data/clubs.json` ergänzen: Name wie in der Excel, `id`, Kurzname und englischer Wikipedia-Artikel.
2. Das Skript ausführen. Es braucht Python mit `pip install openpyxl pillow`:
   ```
   python tools/fetch_assets.py
   ```
   Das Skript lädt fehlende Logos nach `assets/logos/` und sucht neue Torschützen auf Wikipedia. Die Fotos speichert es nach `assets/players/`, die Zuordnung landet in `data/players.json`.
3. Falsche Zuordnungen in `data/players.json` von Hand korrigieren und dort `"manual": true` setzen. Dann überschreibt das Skript den Eintrag nicht mehr.
4. Alles committen und pushen.

## Lokal ansehen

```
python -m http.server 8765
```
Danach im Browser `http://localhost:8765` öffnen. Ein Doppelklick auf `index.html` funktioniert nicht, weil der Browser die Excel dann nicht laden darf.

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html`, `css/style.css` | Oberfläche im Werder-Stil, als App installierbar (PWA) |
| `js/parse.js` | liest die Excel-Zeilen ein |
| `js/stats.js` | berechnet die Statistiken |
| `js/validate.js` | Datencheck |
| `js/app.js` | Ansichten und Diagramme (Chart.js) |
| `data/clubs.json` | Vereine (Logo, Kurzname, Farbe) und zusammengefasste Stadionnamen |
| `data/players.json` | Zuordnung der Torschützen zu vollem Namen und Foto |

Logos und Fotos stammen von Wikipedia bzw. Wikimedia Commons.
