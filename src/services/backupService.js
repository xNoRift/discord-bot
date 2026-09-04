'use strict';

const fs = require('node:fs');
const path = require('node:path');
const db = require('../database/db');
const config = require('../../config/config');
const logger = require('../utils/logger');

/**
 * Sichert die SQLite-Datenbank per better-sqlite3 .backup() (sicheres
 * Hot-Backup, funktioniert auch bei laufendem WAL-Modus, kein Stop nötig).
 * Bewusst OHNE Wiederherstellen-Funktion – siehe Plan (Phase 0/1 Schritt 3):
 * ein Restore überschreibt die Live-Datenbank und braucht einen eigenen,
 * bewusst separaten und abgesicherten Schritt.
 */

const BACKUP_DIR = path.join(config.rootDir, 'backups');
const KEEP = 14;

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

module.exports = { create, list, prune, resolvePath, dailySweep, BACKUP_DIR };
