# Team Manager PWA – Supabase Client v4

Diese Version setzt auf der erfolgreich ausgeführten Supabase-Migration auf.

## Enthalten
- `index.html` – Oberfläche
- `app.js` – Offline-First-Client mit Supabase Auth und versionsbasierter Synchronisation
- `supabase-config.js` – Project URL + Publishable Key
- `supabase-migration.sql` – die korrigierte, bereits erfolgreiche Migration (`trainer` als Standardrolle)
- `manifest.webmanifest` – PWA-Manifest
- `sw.js` – Service Worker
- `icon-180.png`, `icon-192.png`, `icon-512.png` – iOS/PWA Icons

## Was v4 zusätzlich macht

### Lokaler Speicher pro Benutzer
Lokale Daten, Queue und Konfliktprotokoll werden getrennt nach Supabase-User-ID gespeichert. Nach Abmeldung wird auf einen separaten Gastbereich gewechselt. Dadurch sieht ein zweiter Login auf demselben iPhone nicht die lokalen Daten des vorherigen Benutzers.

### Offline-First Queue
Jede Änderung wird sofort lokal gespeichert. Zusätzlich landet eine Mutation (`upsert` oder Soft-Delete) in einer dauerhaften Queue. Wiederholte Änderungen desselben Datensatzes werden zusammengefasst, wobei die ursprüngliche Server-Basisversion erhalten bleibt.

### Optimistische Konfliktkontrolle
Die App verwendet die serverseitige Spalte `version`. Vor einem Update wird geprüft, ob die Serverversion noch der Version entspricht, auf deren Basis lokal bearbeitet wurde. Das eigentliche UPDATE wird zusätzlich mit `WHERE version = <Basisversion>` abgesichert, sodass auch ein Rennen zwischen Prüfen und Schreiben erkannt wird.

Bei einem Konflikt gilt als sicherer Standard: **Serverstand gewinnt zunächst.** Die lokale Änderung wird nicht weggeworfen, sondern im Konfliktprotokoll gespeichert und kann unter Einstellungen → Konflikte bewusst erneut angewendet werden.

### Reihenfolge abhängiger Datensätze
Beim Schreiben werden Eltern zuerst synchronisiert (`teams`, `players`, `matches`, danach `appearances`/`goals`). Bei Löschungen werden Kinddatensätze zuerst verarbeitet. Das passt zu den Fremdschlüsseln der Datenbank.

### Nutzerkonto
Die App unterstützt E-Mail/Passwort-Anmeldung und Kontoanlage über Supabase Auth. Neue Profile bekommen durch die Datenbankmigration die Rolle `trainer`.

## Vor GitHub Pages
1. `supabase-config.js` mit **Project URL** und **Publishable Key** füllen.
2. Niemals `service_role` oder einen Secret Key in das Repository schreiben.
3. Dateien in das GitHub-Repository hochladen.
4. GitHub Pages aktivieren: Settings → Pages → Deploy from a branch.
5. Die GitHub-Pages-URL in Supabase unter Authentication → URL Configuration als Site URL / Redirect URL eintragen.

## PWA / iPhone
Für iOS ist `icon-180.png` explizit als Apple-Touch-Icon eingebunden. Nach Änderungen an PWA-Dateien kann es nötig sein, eine bereits installierte Home-Screen-App zu löschen und neu über Safari → Teilen → Zum Home-Bildschirm hinzuzufügen.
