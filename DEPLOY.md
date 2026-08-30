# Deployment / Updates

## Einmalige Einrichtung auf dem Server (root-Server, Debian/Ubuntu)

```bash
# 1. Node 20 + Build-Tools
apt update && apt install -y curl git build-essential python3
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 2. Projekt klonen
cd /root
git clone <DEIN-REPO-URL> DiscordBotV1
cd DiscordBotV1

# 3. Abhängigkeiten (baut better-sqlite3 für Linux)
npm ci   # oder: npm install

# 4. .env anlegen (kommt NICHT aus dem Repo)
nano .env      # Inhalt siehe .env.example, mit echten Werten
# Wichtig für den Server:
#   DASHBOARD_URL=http://DEINE-SERVER-IP:3000
#   OAUTH_REDIRECT_URI=http://DEINE-SERVER-IP:3000/auth/discord/callback
#   NODE_ENV=production
# Diese Redirect-URL muss identisch im Discord Developer Portal
#   -> OAuth2 -> Redirects eingetragen sein.

# 5. Slash-Commands registrieren (einmalig / nach Command-Änderungen)
npm run deploy

# 6. Dauerhaft laufen lassen
npm install -g pm2
pm2 start index.js --name norift
pm2 save
pm2 startup      # den ausgegebenen Befehl noch ausführen -> Autostart
```

## Ein Update einspielen

```bash
cd /root/DiscordBotV1
git pull
npm ci                    # nur nötig, wenn package.json sich geändert hat (schadet aber nie)
npm run deploy            # nur nötig, wenn Slash-Commands sich geändert haben
pm2 restart norift
pm2 logs norift --lines 20 --nostream
```

## Backup der Datenbank

```bash
# einmalig / per Cronjob
cp /root/DiscordBotV1/data/database.sqlite ~/backup-$(date +%F).sqlite
```

## Regeln

- **`node_modules` und `.env` gehören NICHT ins Repo** (stehen in `.gitignore`).
- `node_modules` wird auf dem Server IMMER mit `npm ci` erzeugt – niemals von Windows hochladen
  (sonst: `invalid ELF header`).
- `data/` liegt nur auf dem Server und wird nie überschrieben.
