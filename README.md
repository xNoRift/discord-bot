# 🤖 Discord Bot V1 – Bot + Web-Dashboard

Ein modularer Discord-Bot mit **Ticketsystem**, **Giveaway-System** (inkl. automatischer
Gewinnerrolle mit 24-Stunden-Ablauf) und **Bewerbungssystem** – komplett steuerbar über ein
modernes **Web-Dashboard** mit **Discord-OAuth2-Login**.

Bot und Dashboard laufen in **einem** Node-Prozess und teilen sich dieselbe SQLite-Datenbank.

---

## Inhalt

- [Funktionen](#funktionen)
- [Technik](#technik)
- [Projektstruktur](#projektstruktur)
- [Installation Schritt für Schritt](#installation-schritt-für-schritt)
- [Konfiguration im Dashboard](#konfiguration-im-dashboard)
- [Testen](#testen)
- [Häufige Fehler](#häufige-fehler)
- [Erweiterung](#erweiterung)

---

## Funktionen

### 🎫 Tickets
- Konfigurierbares Ticket-Panel (Titel/Text/Button) über Dashboard oder `/ticket panel`
- Ticket-Kanal wird automatisch in der eingestellten Kategorie erstellt
- Nur Ersteller + Support-Rolle sehen den Kanal
- Verwaltungs-Buttons: **📌 Übernehmen**, **🔒 Schließen**, **🔓 Wieder öffnen**, **🗑️ Löschen**
- Schließen = Kanal bleibt, Ersteller kann nicht mehr schreiben; Löschen = Kanal weg (mit Sicherheitsabfrage)
- Vollständiges Ticket-Log (wer/wann erstellt, übernommen, geschlossen, gelöscht)
- Limit „max. Tickets pro Benutzer“

### 🎉 Giveaways
- Start über `/giveaway start` **oder** Dashboard
- Einstellbar: Preis, Dauer, Gewinneranzahl, Kanal, benötigte Rolle, Gewinnerrolle + deren Dauer
- Automatische Auslosung bei Ablauf, Ansage im Kanal
- Dashboard: erstellen, bearbeiten, verlängern, sofort beenden, abbrechen, **neu auslosen**, Gewinner-Historie
- **Neustart-sicher:** läuft ein Giveaway noch, wird der Timer nach einem Bot-Neustart wiederhergestellt

### 🏆 Giveaway-Gewinnerrolle (automatisch nach 24 h entfernt)
1. Giveaway endet → Gewinner wird gezogen
2. Gewinner bekommt automatisch die konfigurierte Rolle
3. `granted_at` + `expires_at` werden in der DB gespeichert (`temporary_roles`)
4. Nach Ablauf (Standard 24 h, im Dashboard einstellbar) entfernt der Bot die Rolle
5. Der Nutzer wird per DM informiert
- **Neustart-sicher:** offene Rollen werden beim Start wieder eingeplant; abgelaufene sofort entfernt
- **Mehrfach-Gewinne:** gewinnt jemand erneut, wird der bestehende Eintrag auf die spätere
  Ablaufzeit verlängert – die Rolle wird erst entfernt, wenn kein Eintrag mehr aktiv ist
- Zusätzlicher „Sweep“ alle 60 s als Sicherheitsnetz

### 📋 Bewerbungen
- Bewerbungs-Panel mit Buttons pro Position (Support, Moderator, …)
- Klick öffnet ein Discord-Modal mit **im Dashboard konfigurierbaren Fragen** (max. 5 – Discord-Limit)
- Bewerbung wird gespeichert und in den Bewerbungs-Channel gepostet
- Team-Buttons **✅ Annehmen** / **❌ Ablehnen** (mit optionaler Nachricht an den Bewerber)
- Bei Annahme optional automatische Rollenvergabe
- Bearbeitung auch komplett im Dashboard möglich

### 📊 Dashboard
- Discord-OAuth2-Login
- Es werden nur Server angezeigt, auf denen du **Administrator** oder **Server verwalten** hast
- Startseite mit Bot-Status, Mitgliedern, offenen Tickets/Giveaways/Bewerbungen + Aktivitätsverlauf
- Eigene Seiten für Tickets, Giveaways, Bewerbungen und allgemeine Server-Einstellungen
- Dark-Mode, Sidebar, Karten, responsive (Desktop + Mobile)

### 🔐 Sicherheit
- Sichere Sessions (HttpOnly-Cookie, SQLite-Session-Store)
- CSRF-Schutz für alle schreibenden Anfragen
- Pro-Server-Berechtigungsprüfung bei **jeder** API-Anfrage
- Rate-Limiting (allgemein + strenger für „teure“ Aktionen)
- Helmet + strikte Content-Security-Policy
- Keine Tokens/Secrets im Frontend, `.env` per `.gitignore` ausgeschlossen
- Slash-Commands mit `DefaultMemberPermissions` + zusätzlicher Laufzeitprüfung

---

## Technik

| Bereich      | Verwendung |
|--------------|------------|
| Laufzeit     | Node.js ≥ 18.17 (empfohlen: 20 oder neuer) |
| Bot          | discord.js v14 |
| Datenbank    | SQLite über `better-sqlite3` (synchron, keine Extra-DB nötig) |
| Web          | Express 4 + EJS (serverseitig gerendert) + Vanilla-JS-Frontend |
| Login        | Discord OAuth2 (`identify`, `guilds`) – ohne Zusatz-Library |
| Sessions     | `express-session` + `better-sqlite3-session-store` |

> **Keine privilegierten Gateway-Intents nötig.** Der Bot nutzt nur den `Guilds`-Intent;
> Mitglieder werden bei Bedarf per REST nachgeladen.

---

## Projektstruktur

```
Discord Bot V1/
├── index.js                     # Startet Bot + Dashboard zusammen
├── package.json
├── .env.example                 # Vorlage – zu .env kopieren
├── config/
│   └── config.js                # Zentrale Konfiguration + Validierung
├── src/
│   ├── bot.js                   # Bot-Entrypoint
│   ├── deploy-commands.js       # Slash-Commands registrieren
│   ├── core/client.js           # Geteilte discord.js-Client-Instanz
│   ├── database/
│   │   ├── db.js                # SQLite-Verbindung
│   │   ├── schema.sql           # Tabellen
│   │   └── models/              # Datenzugriff (settings, tickets, giveaways, …)
│   ├── handlers/loaders.js      # Lädt Commands / Events / Komponenten
│   ├── commands/                # /ping /help /ticket /giveaway /application
│   ├── components/
│   │   ├── buttons/             # Ticket-/Giveaway-/Bewerbungs-Buttons
│   │   └── modals/              # Bewerbungs-Modals
│   ├── events/                  # ready, interactionCreate, guildCreate/Delete
│   ├── services/                # Kernlogik (ticket, giveaway, temporaryRole, …)
│   └── utils/                   # embeds, permissions, time, logger
├── dashboard/
│   ├── server.js                # Express-App
│   ├── routes/                  # auth, pages, api
│   ├── middleware/              # auth (Login/CSRF/Guild-Guard), rateLimit
│   ├── services/                # discordOAuth, guildAccess
│   ├── views/                   # EJS-Templates
│   └── public/                  # CSS + Frontend-JS
└── data/                        # SQLite-Dateien (wird automatisch erstellt, git-ignoriert)
```

---

## Installation Schritt für Schritt

### 1. Node.js installieren
Lade **Node.js 20 LTS oder neuer** von <https://nodejs.org> und installiere es.
Prüfen im Terminal / in PowerShell:
```bash
node -v
npm -v
```

### 2. Projekt öffnen
Öffne einen Terminal im Projektordner (`Discord Bot V1`).

### 3. Abhängigkeiten installieren
```bash
npm install
```
> `better-sqlite3` bringt fertige Binärdateien mit. Sollte trotzdem ein Kompilierfehler kommen,
> installiere die „Desktop development with C++“-Tools (Windows) bzw. `build-essential` (Linux).

### 4. Discord-Anwendung erstellen
1. Gehe zu <https://discord.com/developers/applications> → **New Application**.
2. Notiere unter **General Information** die **Application ID** → das ist `CLIENT_ID`.

### 5. Bot erstellen
1. Reiter **Bot** → **Add Bot**.
2. **Reset Token** → Token kopieren → das ist `DISCORD_TOKEN` (**geheim!**).
3. „Public Bot“ kannst du anlassen. **Privileged Intents werden nicht benötigt.**

### 6. OAuth2 konfigurieren
1. Reiter **OAuth2** → **Client Secret** → **Reset Secret** → kopieren → das ist `CLIENT_SECRET`.
2. Bei **Redirects** hinzufügen (exakt so):
   ```
   http://localhost:3000/auth/discord/callback
   ```
   (Für einen echten Server später deine Domain, z. B. `https://dashboard.deinserver.de/auth/discord/callback`.)
3. Speichern.

### 7. Bot auf deinen Server einladen
Ersetze `DEINE_CLIENT_ID` und öffne den Link im Browser:
```
https://discord.com/oauth2/authorize?client_id=DEINE_CLIENT_ID&scope=bot%20applications.commands&permissions=268569680
```
Die Rechte-Zahl `268569680` enthält u. a. *Kanäle verwalten*, *Rollen verwalten*,
*Nachrichten senden*, *Links einbetten*, *Nachrichtenverlauf lesen*, *Nachrichten verwalten*.

> Im Dashboard bekommst du auf der Seite **Meine Server** ebenfalls einen fertigen Einladungs-Button.

**Wichtig – Rollen-Hierarchie:** Ziehe die **Bot-Rolle** in den Server­einstellungen unter
*Rollen* **über** die Giveaway-Gewinnerrolle und die Bewerbungs-Rollen, sonst darf der Bot sie
nicht vergeben/entfernen.

### 8. `.env` erstellen
Kopiere `.env.example` zu `.env` und fülle sie aus:

```bash
# Windows PowerShell
Copy-Item .env.example .env
# macOS / Linux
cp .env.example .env
```

```env
DISCORD_TOKEN=dein_bot_token
CLIENT_ID=deine_application_id
CLIENT_SECRET=dein_client_secret
DEV_GUILD_ID=deine_test_server_id      # optional, für sofortige Slash-Commands
DATABASE_URL=./data/database.sqlite
DASHBOARD_URL=http://localhost:3000
PORT=3000
OAUTH_REDIRECT_URI=http://localhost:3000/auth/discord/callback
SESSION_SECRET=<langer Zufallsstring>
SECURE_COOKIES=false
BOT_OWNER_IDS=deine_discord_user_id    # optional, immer voller Zugriff
NODE_ENV=development
```

`SESSION_SECRET` erzeugen:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`DEV_GUILD_ID` / eigene User-ID bekommst du per Rechtsklick in Discord
(Entwicklermodus unter *Einstellungen → Erweitert* aktivieren).

### 9. Datenbank
Nichts zu tun – die SQLite-Datei und alle Tabellen werden beim ersten Start automatisch angelegt
(Ordner `data/`).

### 10. Slash-Commands registrieren
```bash
npm run deploy
```
- Ist `DEV_GUILD_ID` gesetzt → Commands sind **sofort** auf diesem Server verfügbar.
- Ohne `DEV_GUILD_ID` → globaler Deploy (kann bis zu 1 Stunde dauern).
- Global erzwingen: `npm run deploy:global`

### 11. & 12. Bot + Dashboard starten
```bash
npm start
```
Das startet **beides** zusammen. Danach im Browser öffnen:
```
http://localhost:3000
```
„Mit Discord anmelden“ → Server auswählen → konfigurieren.

Einzeln starten (optional):
```bash
npm run bot         # nur der Bot
npm run dashboard   # Dashboard (startet den Bot intern mit, da Guild-Daten gebraucht werden)
```

---

## Konfiguration im Dashboard

Empfohlene Reihenfolge nach dem ersten Login:

1. **Server-Einstellungen** – Log-Kanäle, Ticket-Kategorie, Support-Rolle, Giveaway-Kanal +
   Gewinnerrolle, Bewerbungs-Kanal + Team-Rolle.
2. **Tickets** – Panel-Text anpassen, dann *Panel senden* in den gewünschten Kanal.
3. **Giveaways** – Standardwerte prüfen, dann *+ Neues Giveaway*.
4. **Bewerbungen** – System aktivieren, Bewerbungsarten + Fragen anlegen, dann *Panel senden*.

Jeder Discord-Server hat seine **eigene** Konfiguration – Einstellungen werden pro `guild_id`
gespeichert und nie zwischen Servern geteilt.

---

## Testen

**Tickets**
1. Panel senden → auf *Ticket erstellen* klicken → Kanal erscheint in der Kategorie.
2. *Übernehmen*, *Schließen*, *Wieder öffnen*, *Löschen* durchklicken.
3. Log-Kanal prüfen – jede Aktion wird protokolliert.

**Giveaway + Gewinnerrolle**
1. Giveaway mit kurzer Dauer starten (z. B. `2m`) und niedriger Rollendauer testen
   (im Dashboard „Dauer der Gewinnerrolle“ z. B. auf `2m` stellen).
2. Mit einem zweiten Account teilnehmen, Ablauf abwarten → Gewinner + Rolle + DM.
3. Bot neu starten (`Strg+C`, dann `npm start`) → nach der Rollendauer wird die Rolle trotzdem
   automatisch entfernt (steht in `temporary_roles`).
4. *Neu auslosen* im Dashboard testen.

**Bewerbungen**
1. Bewerbungsart „Support“ + 2–3 Fragen anlegen, System aktivieren, Panel senden.
2. Auf den Positions-Button klicken → Modal ausfüllen → Bewerbung erscheint im Channel + Dashboard.
3. *Annehmen* → Bewerber bekommt DM (und ggf. die Annahme-Rolle).

**Health-Check:** <http://localhost:3000/health>

---

## Häufige Fehler

| Problem | Lösung |
|---|---|
| `Konfiguration unvollständig` beim Start | Fehlende Werte in `.env` ergänzen (Name wird genannt). |
| Slash-Commands erscheinen nicht | `npm run deploy` mit gesetzter `DEV_GUILD_ID`, oder ~1 h auf globalen Deploy warten. Discord-Client neu starten. |
| Login-Fehler „redirect_uri“ | `OAUTH_REDIRECT_URI` in `.env` **und** im Developer Portal → OAuth2 → Redirects müssen identisch sein. |
| „Die Bot-Rolle steht nicht über der Zielrolle“ | Bot-Rolle in den Servereinstellungen höher ziehen. |
| „Dem Bot fehlt die Berechtigung …“ | Bot mit den Rechten aus Schritt 7 neu einladen oder Rolle anpassen. |
| Ticket-Erstellung schlägt fehl | Ticket-Kategorie im Dashboard setzen; Bot braucht *Kanäle verwalten*. |
| `better-sqlite3` Build-Fehler | C++-Build-Tools installieren (siehe Schritt 3) und `npm install` erneut. |
| Dashboard zeigt keinen Server | Du brauchst *Administrator*/*Server verwalten* auf dem Server **und** der Bot muss dort sein. „Aktualisieren“ klicken. |

---

## Erweiterung

- **Neuer Slash-Command:** Datei in `src/commands/<gruppe>/` anlegen
  (`module.exports = { data: SlashCommandBuilder, execute }`), dann `npm run deploy`.
- **Neuer Button/Select/Modal:** Datei in `src/components/…` mit `{ prefix, execute }`.
  Das Routing erfolgt automatisch über das `customId`-Präfix (`bereich:aktion:parameter`).
- **Neues Event:** Datei in `src/events/` mit `{ name, once?, execute }`.
- **Neue DB-Tabelle/Spalte:** in `src/database/schema.sql` ergänzen; für bestehende DBs
  `ensureColumn(...)` in `src/database/db.js` nutzen.
- **Neue Dashboard-Seite:** Route in `dashboard/routes/pages.js`, View unter `dashboard/views/`,
  passendes JS unter `dashboard/public/js/`.

---

## Produktion (kurz)

- `NODE_ENV=production`, `SECURE_COOKIES=true`, HTTPS davor (Reverse-Proxy).
- `DASHBOARD_URL` / `OAUTH_REDIRECT_URI` auf die echte Domain setzen (auch im Developer Portal).
- Prozess mit `pm2`, `systemd` o. Ä. dauerhaft laufen lassen.
- `data/`-Ordner sichern (enthält die komplette Datenbank).

---

Lizenz: MIT
