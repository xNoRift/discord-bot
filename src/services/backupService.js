'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../database/db');
const config = require('../../config/config');
const logger = require('../utils/logger');

/**
 * Sichert die SQLite-Datenbank per better-sqlite3 .backup() (sicheres
 * Hot-Backup, funktioniert auch bei laufendem WAL-Modus, kein Stop nötig).
 *
 * Wiederherstellen (restore()) ist bewusst zweistufig und beendet den
 * Prozess danach absichtlich (process.exit): die Live-DB-Datei wird auf
 * Festplatte ausgetauscht, aber der offene better-sqlite3-Handle wird NICHT
 * live umgehängt (Risiko für WAL-Korruption) – pm2 startet den Prozess neu
 * und öffnet dann die wiederhergestellte Datei frisch.
 */

const BACKUP_DIR = path.join(config.rootDir, 'backups');
const KEEP = 14;
const RESTORE_TOKEN_TTL_MS = 5 * 60 * 1000;

/** Einmaliges, kurzlebiges Restore-Token (in-memory, kein Cluster-Betrieb). */
let pendingRestore = null;

function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function todayPrefix(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Erstellt eine neue Sicherung. @returns {{name:string,size:number,createdAt:number}} */
async function create() {
  ensureDir();
  const name = `backup-${stamp()}.sqlite`;
  const dest = path.join(BACKUP_DIR, name);
  await db.backup(dest);
  prune();
  const st = fs.statSync(dest);
  return { name, size: st.size, createdAt: st.mtimeMs };
}

/** Liste vorhandener Sicherungen, neueste zuerst. */
function list() {
  ensureDir();
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.sqlite'))
    .map((name) => {
      const st = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, size: st.size, createdAt: st.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Löscht alte Sicherungen, behält nur die neuesten `KEEP`. */
function prune(keep = KEEP) {
  const files = list();
  for (const f of files.slice(keep)) {
    fs.unlink(path.join(BACKUP_DIR, f.name), () => {});
  }
}

/** Absoluter Pfad – nur zum Herunterladen, mit Namens-Validierung gegen Path-Traversal. */
function resolvePath(name) {
  if (!/^backup-[\w.:-]+\.sqlite$/.test(name)) return null;
  const full = path.join(BACKUP_DIR, name);
  return fs.existsSync(full) ? full : null;
}

/** Einmal täglich automatisch sichern (aufgerufen vom 60s-Sweep). */
async function dailySweep() {
  ensureDir();
  const already = list().some((f) => f.name.startsWith(todayPrefix()));
  if (already) return;
  await create();
  logger.info('[backup] tägliche Sicherung erstellt');
}

/**
 * Schritt 1 des Restores: fordert ein kurzlebiges, einmaliges Token an.
 * Ersetzt keine Datei, prüft nur, dass die Sicherung existiert.
 */
function requestRestore(filename) {
  if (!resolvePath(filename)) throw new Error('Sicherung nicht gefunden.');
  const token = crypto.randomBytes(24).toString('hex');
  pendingRestore = { filename, token, expiresAt: Date.now() + RESTORE_TOKEN_TTL_MS };
  return token;
}

/**
 * Schritt 2: prüft das Token, sichert die aktuelle Live-DB (Sicherheitsnetz),
 * tauscht dann die Datei auf Festplatte aus und schließt die Verbindung.
 * Der Aufrufer muss den Prozess danach beenden (process.exit), damit pm2
 * mit der wiederhergestellten Datei frisch neu startet.
 */
async function restore(filename, token) {
  if (
    !pendingRestore ||
    pendingRestore.filename !== filename ||
    pendingRestore.token !== token ||
    !token
  ) {
    throw new Error('Ungültige oder abgelaufene Bestätigung. Bitte erneut anfordern.');
  }
  if (Date.now() > pendingRestore.expiresAt) {
    pendingRestore = null;
    throw new Error('Bestätigung abgelaufen. Bitte erneut anfordern.');
  }
  const source = resolvePath(filename);
  if (!source) throw new Error('Sicherung nicht gefunden.');
  pendingRestore = null; // Einmal-Token

  await create(); // Sicherheits-Snapshot der aktuellen Live-DB, bevor sie überschrieben wird

  const dbPath = config.database.path;
  try {
    db.close();
  } catch {
    /* bereits geschlossen */
  }

  fs.copyFileSync(source, dbPath);
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = dbPath + suffix;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }

  logger.info(`[backup] Wiederhergestellt aus ${filename} – Neustart erforderlich.`);
}

module.exports = { create, list, prune, resolvePath, dailySweep, requestRestore, restore, BACKUP_DIR };
