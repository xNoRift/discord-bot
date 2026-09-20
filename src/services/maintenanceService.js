'use strict';

const fs = require('node:fs');
const path = require('node:path');
const db = require('../database/db');
const config = require('../../config/config');
const dashboardUsers = require('../database/models/dashboardUsers');
const logger = require('../utils/logger');

/**
 * Datensicherheit & Datenschutz im Hintergrund:
 *  - tägliches Datenbank-Backup (SQLite Online-Backup, 14 Tage aufbewahrt, nur für den Besitzer lesbar)
 *  - Löschfristen: Aktivitäts-Log und Login-Protokoll (enthält IPs) nach 90 Tagen,
 *    OAuth-Tokens/Server-Cache inaktiver Dashboard-Nutzer nach 30 Tagen
 *  - Migration: noch im Klartext gespeicherte OAuth-Tokens werden verschlüsselt
 */

const DAY = 24 * 60 * 60 * 1000;
const BACKUP_KEEP = 14;
const LOG_RETENTION_DAYS = 90;
const TOKEN_INACTIVE_DAYS = 30;

const backupDir = path.join(config.database.dir, 'backups');

function todayName() {
  return `database-${new Date().toISOString().slice(0, 10)}.sqlite`;
}

async function backupIfNeeded() {
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const target = path.join(backupDir, todayName());
  if (fs.existsSync(target)) return;

  await db.backup(target);
  try { fs.chmodSync(target, 0o600); } catch { /* Windows: ignorieren */ }

  const files = fs.readdirSync(backupDir).filter((f) => /^database-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) {
    fs.unlinkSync(path.join(backupDir, old));
  }
  logger.success(`[maintenance] Backup erstellt: ${path.basename(target)}`);
}

function purgeOldData() {
  const cutoff = Date.now() - LOG_RETENTION_DAYS * DAY;
  const a = db.prepare('DELETE FROM activity_log WHERE created_at < ?').run(cutoff).changes;
  const l = db.prepare('DELETE FROM login_audit WHERE created_at < ?').run(cutoff).changes;
  const t = dashboardUsers.purgeInactive(TOKEN_INACTIVE_DAYS * DAY);
  if (a || l || t) logger.info(`[maintenance] Aufgeräumt: ${a} Aktivitäts-Einträge, ${l} Login-Einträge, ${t} inaktive Token-Sätze`);
}

async function runAll() {
  try {
    const n = dashboardUsers.encryptLegacyTokens();
    if (n) logger.success(`[maintenance] ${n} OAuth-Token-Satz/Sätze verschlüsselt`);
  } catch (err) {
    logger.error('[maintenance] Token-Verschlüsselung fehlgeschlagen:', err.message);
  }
  try { purgeOldData(); } catch (err) { logger.error('[maintenance] Aufräumen fehlgeschlagen:', err.message); }
  try { await backupIfNeeded(); } catch (err) { logger.error('[maintenance] Backup fehlgeschlagen:', err.message); }
}

let timer = null;
function start() {
  setTimeout(() => runAll(), 30_000).unref?.();
  if (timer) clearInterval(timer);
  timer = setInterval(() => runAll(), 6 * 60 * 60 * 1000);
  timer.unref?.();
}

module.exports = { start, runAll };
