'use strict';

const db = require('../db');
const config = require('../../../config/config');

/**
 * Pro-Server-Einstellungen (guild_settings).
 * Jede Guild hat GENAU EINE Zeile. ensure() legt die Standardwerte an.
 */

// Whitelist aller Spalten, die per Dashboard/Command geaendert werden duerfen.
const EDITABLE_FIELDS = [
  'log_channel_id',
  'bot_prefix',
  'ticket_category_id',
  'ticket_support_role_id',
  'ticket_log_channel_id',
  'ticket_name_format',
  'ticket_max_per_user',
  'ticket_welcome_message',
  'ticket_panel_title',
  'ticket_panel_message',
  'ticket_panel_channel_id',
  'ticket_panel_message_id',
  'giveaway_channel_id',
  'giveaway_winner_role_id',
  'giveaway_winner_role_duration_ms',
  'giveaway_log_channel_id',
  'application_enabled',
  'application_channel_id',
  'application_team_role_id',
  'application_log_channel_id',
  'application_panel_title',
  'application_panel_message',
  'application_panel_channel_id',
  'application_panel_message_id',
  // Redesign / erweiterte Einstellungen
  'tickets_enabled',
  'ticket_team_ping',
  'ticket_close_restricted',
  'ticket_on_leave',
  'embed_color',
  'timezone',
  'bot_language',
  'suggestions_enabled',
  'suggestions_channel_id',
  'mod_log_channel_id',
  'security_log_channel_id',
  'automod_enabled',
  'team_role_ids',
  'autorole_ids',
  'autorole_bot_ids',
  // Willkommens-System
  'welcome_enabled',
  'welcome_channel_id',
  'welcome_message',
  'welcome_embed',
  'welcome_color',
  'welcome_ping',
  'welcome_dm_enabled',
  'welcome_dm_message',
  'leave_enabled',
  'leave_channel_id',
  'leave_message',
  // Temp-Voice
  'tempvoice_enabled',
  'tempvoice_hub_channel_id',
  'tempvoice_category_id',
  'tempvoice_name_format',
  'tempvoice_user_limit',
  // Musik
  'music_dj_role_id',
  'music_default_volume',
  // Verwarnungs-Eskalation
  'warn_escalation',
];

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO guild_settings
    (guild_id, ticket_name_format, ticket_max_per_user, ticket_welcome_message,
     ticket_panel_title, ticket_panel_message,
     giveaway_winner_role_duration_ms,
     application_panel_title, application_panel_message,
     created_at, updated_at)
  VALUES
    (@guild_id, @ticket_name_format, @ticket_max_per_user, @ticket_welcome_message,
     @ticket_panel_title, @ticket_panel_message,
     @giveaway_winner_role_duration_ms,
     @application_panel_title, @application_panel_message,
     @now, @now)
`);

const ensureGuildRow = db.prepare(
  'INSERT OR IGNORE INTO guilds (guild_id, updated_at) VALUES (?, ?)',
);

function ensure(guildId) {
  const now = Date.now();
  ensureGuildRow.run(guildId, now);
  insertStmt.run({
    guild_id: guildId,
    ticket_name_format: config.defaults.ticketNameFormat,
    ticket_max_per_user: config.defaults.ticketMaxPerUser,
    ticket_welcome_message: config.defaults.ticketWelcome,
    ticket_panel_title: config.defaults.ticketPanelTitle,
    ticket_panel_message: config.defaults.ticketPanelMessage,
    giveaway_winner_role_duration_ms: config.defaults.giveawayWinnerRoleDurationMs,
    application_panel_title: config.defaults.applicationPanelTitle,
    application_panel_message: config.defaults.applicationPanelMessage,
    now,
  });
  return get(guildId);
}

function get(guildId) {
  return db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId) ?? ensure(guildId);
}

/**
 * Aktualisiert nur erlaubte Felder.
 * @param {string} guildId
 * @param {Record<string, any>} patch
 * @returns {object} die neuen Settings
 */
function update(guildId, patch) {
  ensure(guildId);
  const keys = Object.keys(patch).filter((k) => EDITABLE_FIELDS.includes(k));
  if (keys.length === 0) return get(guildId);

  const setSql = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { guild_id: guildId, updated_at: Date.now() };
  for (const k of keys) {
    let v = patch[k];
    if (v === '' || v === undefined) v = null;
    // Booleans als 0/1 speichern
    if (typeof v === 'boolean') v = v ? 1 : 0;
    params[k] = v;
  }

  db.prepare(
    `UPDATE guild_settings SET ${setSql}, updated_at = @updated_at WHERE guild_id = @guild_id`,
  ).run(params);

  return get(guildId);
}

function incrementTicketCounter(guildId) {
  ensure(guildId);
  db.prepare(
    'UPDATE guild_settings SET ticket_counter = ticket_counter + 1, updated_at = ? WHERE guild_id = ?',
  ).run(Date.now(), guildId);
  return get(guildId).ticket_counter;
}

module.exports = { ensure, get, update, incrementTicketCounter, EDITABLE_FIELDS };
