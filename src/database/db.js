'use strict';

/**
 * SQLite-Verbindung (better-sqlite3, synchron).
 * Exportiert eine einzige, geteilte Datenbank-Instanz, die sowohl vom Bot
 * als auch vom Dashboard (gleicher Prozess) verwendet wird.
 */

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('../../config/config');
const logger = require('../utils/logger');

// Sicherstellen, dass der Ordner fuer die DB existiert.
if (!fs.existsSync(config.database.dir)) {
  fs.mkdirSync(config.database.dir, { recursive: true });
}

const db = new Database(config.database.path);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema anwenden.
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

/**
 * Sehr leichte "Migrationen": fuegt Spalten hinzu, falls sie in einer
 * aelteren DB noch fehlen. So bleibt eine bestehende Datenbank kompatibel.
 */
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    logger.info(`[db] Spalte ${table}.${column} ergänzt`);
  }
}

// Beispiele fuer zukuenftige, rueckwaertskompatible Ergaenzungen:
ensureColumn('guild_settings', 'bot_prefix', "TEXT DEFAULT '!'");
ensureColumn('giveaways', 'description', 'TEXT');
ensureColumn('applications', 'review_note', 'TEXT');

// Multi-Panel-Ticketsystem
ensureColumn('tickets', 'panel_id', 'INTEGER');
ensureColumn('tickets', 'category_id', 'INTEGER');
ensureColumn('tickets', 'category_label', 'TEXT');
ensureColumn('tickets', 'last_activity_at', 'INTEGER');
ensureColumn('ticket_panels', 'button_label', 'TEXT');
ensureColumn('ticket_categories', 'enabled', 'INTEGER DEFAULT 1');
ensureColumn('ticket_categories', 'prefix', 'TEXT');
ensureColumn('ticket_categories', 'max_open', 'INTEGER DEFAULT 0');
ensureColumn('ticket_panels', 'log_channel_id', 'TEXT');
ensureColumn('ticket_panels', 'rating_enabled', 'INTEGER DEFAULT 0');
ensureColumn('ticket_panels', 'rating_channel_id', 'TEXT');
ensureColumn('ticket_panels', 'claim_category_id', 'TEXT');
ensureColumn('ticket_panels', 'autoclose_hours', 'INTEGER DEFAULT 0');

// Dashboard-Erweiterung (Redesign)
ensureColumn('guild_settings', 'tickets_enabled', 'INTEGER DEFAULT 1');
ensureColumn('guild_settings', 'ticket_team_ping', 'INTEGER DEFAULT 1');
ensureColumn('guild_settings', 'ticket_close_restricted', 'INTEGER DEFAULT 0');
ensureColumn('guild_settings', 'ticket_on_leave', "TEXT DEFAULT 'nothing'");
ensureColumn('guild_settings', 'embed_color', 'TEXT');
ensureColumn('guild_settings', 'timezone', "TEXT DEFAULT 'Europe/Berlin'");
ensureColumn('guild_settings', 'bot_language', "TEXT DEFAULT 'de'");
ensureColumn('guild_settings', 'suggestions_enabled', 'INTEGER DEFAULT 0');
ensureColumn('guild_settings', 'suggestions_channel_id', 'TEXT');
ensureColumn('guild_settings', 'mod_log_channel_id', 'TEXT');
ensureColumn('guild_settings', 'team_role_ids', 'TEXT');
ensureColumn('guild_settings', 'autorole_ids', 'TEXT');
ensureColumn('guild_settings', 'autorole_bot_ids', 'TEXT');

// Willkommens-System
ensureColumn('guild_settings', 'welcome_enabled', 'INTEGER DEFAULT 0');
ensureColumn('guild_settings', 'welcome_channel_id', 'TEXT');
ensureColumn('guild_settings', 'welcome_message', 'TEXT');
ensureColumn('guild_settings', 'welcome_embed', 'INTEGER DEFAULT 1');
ensureColumn('guild_settings', 'welcome_color', 'TEXT');
ensureColumn('guild_settings', 'welcome_ping', 'INTEGER DEFAULT 1');
ensureColumn('guild_settings', 'welcome_dm_enabled', 'INTEGER DEFAULT 0');
ensureColumn('guild_settings', 'welcome_dm_message', 'TEXT');
ensureColumn('guild_settings', 'leave_enabled', 'INTEGER DEFAULT 0');
ensureColumn('guild_settings', 'leave_channel_id', 'TEXT');
ensureColumn('guild_settings', 'leave_message', 'TEXT');

// Temp-Voice ("Join to Create")
ensureColumn('guild_settings', 'tempvoice_enabled', 'INTEGER DEFAULT 0');
ensureColumn('guild_settings', 'tempvoice_hub_channel_id', 'TEXT');
ensureColumn('guild_settings', 'tempvoice_category_id', 'TEXT');
ensureColumn('guild_settings', 'tempvoice_name_format', "TEXT DEFAULT '{user} • Voice'");
ensureColumn('guild_settings', 'tempvoice_user_limit', 'INTEGER DEFAULT 0');

// Zähl-Spiel: Info-Panel
ensureColumn('game_counting', 'panel_channel_id', 'TEXT');
ensureColumn('game_counting', 'panel_message_id', 'TEXT');

logger.info(`[db] Datenbank verbunden: ${config.database.path}`);

process.on('exit', () => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
});

module.exports = db;
