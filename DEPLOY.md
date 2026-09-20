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
# WICHTIG: "npm run deploy" registriert nur für EINEN Server, wenn in der
# .env ein DEV_GUILD_ID gesetzt ist (praktisch beim Entwickeln, aber dann
# sind die Befehle auf allen ANDEREN Servern unsichtbar!).
# Für einen Bot, den andere einladen sollen, IMMER global deployen:
npm run deploy:global
# (kann bis zu 1 Stunde dauern, bis Discord die Befehle überall anzeigt)

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
npm run deploy:global     # nur nötig, wenn Slash-Commands sich geändert haben (GLOBAL, für alle Server)
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

## Bild-Uploads (einmalig, als root)

Bilder für Embeds (Panels, Ticket-Embeds, Willkommen, Neuigkeiten) werden per Drag & Drop im Dashboard hochgeladen und unter
`/uploads/…` öffentlich ausgeliefert (Speicherort: `data/uploads/`). nginx erlaubt standardmäßig nur 1 MB pro Anfrage –
dafür einmalig das Limit erhöhen:

```bash
grep -rn client_max_body_size /etc/nginx/     # falls hier schon ein Wert steht, dort auf 12m ändern
echo 'client_max_body_size 12m;' > /etc/nginx/conf.d/upload-size.conf
nginx -t && systemctl reload nginx
```

## Server absichern (einmalig, als root)

```bash
# Nur die nötigen Ports offen: SSH, HTTP, HTTPS  (Port 3000 NICHT öffnen – nginx leitet weiter)
apt install -y ufw fail2ban unattended-upgrades
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
systemctl enable --now fail2ban        # sperrt IPs nach fehlgeschlagenen SSH-Logins
dpkg-reconfigure -plow unattended-upgrades   # automatische Sicherheits-Updates

# Geheimnisse & Daten nur für den Besitzer lesbar
chmod 600 /root/DiscordBotV1/.env
chmod 700 /root/DiscordBotV1/data
chmod 600 /root/DiscordBotV1/data/*.sqlite* 2>/dev/null
```

In der `.env` setzen: `NODE_ENV=production`, `SECURE_COOKIES=true`, `DASHBOARD_OWNER_ONLY=true`,
`BOT_OWNER_IDS=<deine ID>`, `DATA_ENCRYPTION_KEY=<langer Zufallswert>`.
Automatische Backups landen täglich in `data/backups/` (14 Tage). Zusätzlich gelegentlich
`data/backups/` auf den eigenen PC kopieren (z. B. per WinSCP), damit ein Serverausfall nicht alles mitnimmt.
