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

// Bewerber-Chat: ein Ticket, das mit einer Bewerbung verknüpft ist
ensureColumn('tickets', 'application_id', 'INTEGER');
ensureColumn('application_types', 'chat_category_id', 'TEXT');
ensureColumn('application_types', 'auto_chat', 'INTEGER DEFAULT 0');
ensureColumn('guild_settings', 'application_chat_category_id', 'TEXT');

// Bewerbungen im Appy-Aufbau: Einstellungen als JSON, Antwort-Methode, Fragetypen, Einreichungs-Details
ensureColumn('application_types', 'cfg', 'TEXT');
ensureColumn('application_types', 'method', "TEXT DEFAULT 'dm'"); // historisch – es gibt nur noch Direktnachricht
ensureColumn('application_questions', 'options', 'TEXT');
ensureColumn('application_questions', 'description', 'TEXT');
ensureColumn('applications', 'thread_id', 'TEXT');
ensureColumn('applications', 'duration_ms', 'INTEGER');
ensureColumn('applications', 'source', 'TEXT');

// Das „Discord-Fenster“ (max. 5 Fragen) gibt es nicht mehr – alle Bewerbungen laufen per Direktnachricht
db.prepare("UPDATE application_types SET method = 'dm' WHERE method IS NOT 'dm'").run();

// Einmalig: alte „Annahme-Rolle“ -> Rollen-Liste, altes Einzel-Panel -> Panel-Eintrag
try {
  db.prepare(
    "UPDATE application_types SET cfg = json_object('acceptedRoleIds', accept_role_id) WHERE cfg IS NULL AND accept_role_id IS NOT NULL AND accept_role_id != ''",
  ).run();
  const legacy = db
    .prepare(
      "SELECT guild_id, application_panel_channel_id AS ch, application_panel_message_id AS msg, application_panel_title AS t, application_panel_message AS m FROM guild_settings WHERE application_panel_message_id IS NOT NULL AND application_panel_message_id != ''",
    )
    .all();
  for (const g of legacy) {
    if (!db.prepare('SELECT 1 FROM application_panels WHERE guild_id = ?').get(g.guild_id)) {
      const typeIds = db
        .prepare('SELECT id FROM application_types WHERE guild_id = ? AND enabled = 1 ORDER BY position, id')
        .all(g.guild_id)
        .map((r) => r.id);
      db.prepare(
        'INSERT INTO application_panels (guild_id, name, channel_id, message_id, type_ids, panel_type, cfg, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(g.guild_id, 'Bewerbungs-Panel', g.ch, g.msg, JSON.stringify(typeIds), 'buttons', JSON.stringify({ title: g.t || '', description: g.m || '' }), Date.now());
    }
    db.prepare('UPDATE guild_settings SET application_panel_message_id = NULL, application_panel_channel_id = NULL WHERE guild_id = ?').run(g.guild_id);
  }
} catch (err) {
  logger.warn(`[db] Bewerbungs-Migration: ${err.message}`);
}

// Multi-Panel-Ticketsystem
ensureColumn('tickets', 'panel_id', 'INTEGER');
ensureColumn('tickets', 'category_id', 'INTEGER');
ensureColumn('tickets', 'category_label', 'TEXT');
ensureColumn('tickets', 'last_activity_at', 'INTEGER');
ensureColumn('tickets', 'is_modmail', 'INTEGER DEFAULT 0');
ensureColumn('tickets', 'dm_channel_id', 'TEXT');

// ModMail (Bot-Support per DM) – bot-weit in bot_config
ensureColumn('bot_config', 'modmail_enabled', 'INTEGER DEFAULT 0');
ensureColumn('bot_config', 'modmail_guild_id', 'TEXT');
ensureColumn('bot_config', 'modmail_category_id', 'TEXT');
ensureColumn('bot_config', 'modmail_support_role_id', 'TEXT');
ensureColumn('bot_config', 'modmail_log_channel_id', 'TEXT');
ensureColumn('ticket_panels', 'button_label', 'TEXT');
ensureColumn('ticket_categories', 'enabled', 'INTEGER DEFAULT 1');
ensureColumn('ticket_categories', 'prefix', 'TEXT');
ensureColumn('ticket_categories', 'max_open', 'INTEGER DEFAULT 0');
ensureColumn('ticket_panels', 'log_channel_id', 'TEXT');
ensureColumn('ticket_panels', 'rating_enabled', 'INTEGER DEFAULT 0');
ensureColumn('ticket_panels', 'rating_channel_id', 'TEXT');
ensureColumn('ticket_panels', 'claim_category_id', 'TEXT');
ensureColumn('ticket_panels', 'autoclose_hours', 'INTEGER DEFAULT 0');
ensureColumn('ticket_panels', 'image_url', 'TEXT');
ensureColumn('ticket_panels', 'thumbnail_url', 'TEXT');
// Ticket-Kanalname: Standard von Nummer auf Benutzername umgestellt
try {
  db.exec("UPDATE guild_settings SET ticket_name_format = 'ticket-{user}' WHERE ticket_name_format = 'ticket-{number}' OR ticket_name_format IS NULL");
} catch { /* ignore */ }

ensureColumn('ticket_panels', 'panel_layout', "TEXT DEFAULT 'buttons'");
// Einmal-Migration: altes use_select-Flag -> panel_layout (stabil, weil der Editor beide Spalten synchron hält)
try {
  db.exec("UPDATE ticket_panels SET panel_layout = 'select' WHERE use_select = 1 AND (panel_layout IS NULL OR panel_layout = 'buttons')");
} catch { /* ignore */ }

// Dashboard-Erweiterung (Redesign)
ensureColumn('guild_settings', 'tickets_enabled', 'INTEGER DEFAULT 1');
ensureColumn('guild_settings', 'music_enabled', 'INTEGER DEFAULT 1');
ensureColumn('guild_settings', 'giveaways_enabled', 'INTEGER DEFAULT 1');
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
ensureColumn('guild_settings', 'tempvoice_bitrate', 'INTEGER DEFAULT 64');

// Ticket-System: erweiterte Einstellungen (JSON) und Formular-Felder
ensureColumn('ticket_panels', 'cfg', 'TEXT');
ensureColumn('ticket_categories', 'cfg', 'TEXT');
ensureColumn('ticket_category_questions', 'form', "TEXT DEFAULT 'open'");
ensureColumn('ticket_category_questions', 'options', 'TEXT');
ensureColumn('ticket_category_questions', 'description', 'TEXT');
ensureColumn('tickets', 'alerted_at', 'INTEGER');
ensureColumn('tickets', 'team_alerted_at', 'INTEGER');
ensureColumn('tickets', 'close_request_by', 'TEXT');
ensureColumn('tickets', 'close_request_at', 'INTEGER');
ensureColumn('tickets', 'close_answers', 'TEXT');
ensureColumn('guild_settings', 'tempvoice_interface_channel_id', 'TEXT');
ensureColumn('guild_settings', 'tempvoice_interface_message_id', 'TEXT');
ensureColumn('temp_voice_channels', 'panel_message_id', 'TEXT');

// Zähl-Spiel: Info-Panel
ensureColumn('game_counting', 'panel_channel_id', 'TEXT');
ensureColumn('game_counting', 'panel_message_id', 'TEXT');

// Musik
ensureColumn('guild_settings', 'music_dj_role_id', 'TEXT');
ensureColumn('guild_settings', 'music_default_volume', 'INTEGER DEFAULT 100');

// Giveaways: Ticket-Button bei Gewinn
ensureColumn('guild_settings', 'giveaway_ticket_button', 'INTEGER DEFAULT 0');
ensureColumn('guild_settings', 'giveaway_ticket_category_id', 'TEXT');
ensureColumn('guild_settings', 'giveaway_ticket_support_role_id', 'TEXT');
ensureColumn('guild_settings', 'giveaway_ticket_name_format', 'TEXT');
ensureColumn('guild_settings', 'giveaway_ticket_welcome_message', 'TEXT');

// Einmal-Migration: alte einzelne Giveaway-Ticket-Konfiguration (Spalten oben) -> erster Eintrag in giveaway_ticket_buttons
try {
  db.exec(`
    INSERT INTO giveaway_ticket_buttons (guild_id, label, discord_category_id, support_role_id, name_format, welcome_message, show_prize, position, created_at)
    SELECT guild_id, 'Ticket erstellen', giveaway_ticket_category_id, giveaway_ticket_support_role_id, giveaway_ticket_name_format, giveaway_ticket_welcome_message, 1, 0, ${Date.now()}
    FROM guild_settings
    WHERE (giveaway_ticket_category_id IS NOT NULL OR giveaway_ticket_support_role_id IS NOT NULL OR giveaway_ticket_name_format IS NOT NULL OR giveaway_ticket_welcome_message IS NOT NULL)
      AND guild_id NOT IN (SELECT guild_id FROM giveaway_ticket_buttons)
  `);
} catch { /* ignore */ }

logger.info(`[db] Datenbank verbunden: ${config.database.path}`);

process.on('exit', () => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
});

module.exports = db;
