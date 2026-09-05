'use strict';

const db = require('../db');

/**
 * Benachrichtigungs-Konfiguration + Dashboard-Postfach.
 *
 * Ereignistypen (event_key) und ihre Zuordnung zu Log-Kategorie/-Typ:
 *   ticket_new       <- type ticket_create
 *   application_new  <- type application_create
 *   giveaway_ended   <- type giveaway_end / giveaway_winners
 *   security_alert   <- category security (Sammelkanal)
 *   automod          <- type automod_*
 *   antiraid         <- type antiraid_*
 *   antinuke         <- type antinuke_*
 *   backup           <- type backup_* (bot-weit; hier nur für Vollständigkeit)
 */

const EVENT_KEYS = [
  'ticket_new',
  'application_new',
  'giveaway_ended',
  'security_alert',
  'automod',
  'antiraid',
  'antinuke',
  'backup',
];

const EVENT_LABELS = {
  ticket_new: 'Neues Ticket',
  application_new: 'Neue Bewerbung',
  giveaway_ended: 'Giveaway beendet',
  security_alert: 'Sicherheitsalarm',
  automod: 'AutoMod-Aktion',
  antiraid: 'Anti-Raid',
  antinuke: 'Anti-Nuke',
  backup: 'Backup erstellt/wiederhergestellt',
};

/** Ordnet einen logService.log()-Aufruf einem Ereignistyp zu (oder null). */
function keyForLog(category, type) {
  const t = String(type || '');
  if (t === 'ticket_create') return 'ticket_new';
  if (t === 'application_create') return 'application_new';
  if (t === 'giveaway_end' || t === 'giveaway_winners') return 'giveaway_ended';
  if (t.startsWith('automod_')) return 'automod';
  if (t.startsWith('antiraid_')) return 'antiraid';
  if (t.startsWith('antinuke_')) return 'antinuke';
  if (t.startsWith('backup_')) return 'backup';
  if (category === 'security') return 'security_alert';
  return null;
}

/* ---------------- Konfiguration ---------------- */

function getConfig(guildId, eventKey) {
  return db.prepare('SELECT * FROM guild_notifications WHERE guild_id = ? AND event_key = ?').get(guildId, eventKey);
}

function listConfig(guildId) {
  const rows = db.prepare('SELECT * FROM guild_notifications WHERE guild_id = ?').all(guildId);
  const byKey = Object.fromEntries(rows.map((r) => [r.event_key, r]));
  return EVENT_KEYS.map((key) => ({
    event_key: key,
    label: EVENT_LABELS[key],
    to_channel: byKey[key]?.to_channel ?? 0,
    channel_id: byKey[key]?.channel_id ?? null,
    to_dashboard: byKey[key]?.to_dashboard ?? 0,
  }));
}

function setConfig(guildId, eventKey, { toChannel, channelId, toDashboard }) {
  if (!EVENT_KEYS.includes(eventKey)) throw new Error('Unbekannter Ereignistyp.');
  db.prepare(
    `INSERT INTO guild_notifications (guild_id, event_key, to_channel, channel_id, to_dashboard)
     VALUES (@guild_id, @event_key, @to_channel, @channel_id, @to_dashboard)
     ON CONFLICT(guild_id, event_key) DO UPDATE SET
       to_channel = @to_channel, channel_id = @channel_id, to_dashboard = @to_dashboard`,
  ).run({
    guild_id: guildId,
    event_key: eventKey,
    to_channel: toChannel ? 1 : 0,
    channel_id: /^\d{5,25}$/.test(String(channelId || '')) ? String(channelId) : null,
    to_dashboard: toDashboard ? 1 : 0,
  });
  return getConfig(guildId, eventKey);
}

/* ---------------- Postfach ---------------- */

function addToInbox({ guildId, eventKey, title, body }) {
  db.prepare(
    'INSERT INTO notifications (guild_id, event_key, title, body, read, created_at) VALUES (?, ?, ?, ?, 0, ?)',
  ).run(guildId, eventKey ?? null, String(title || '').slice(0, 300), String(body || '').slice(0, 1500), Date.now());
  // Postfach kappen (letzte 200 pro Server).
  db.prepare(
    `DELETE FROM notifications WHERE guild_id = ? AND id NOT IN
       (SELECT id FROM notifications WHERE guild_id = ? ORDER BY id DESC LIMIT 200)`,
  ).run(guildId, guildId);
}

function listInbox(guildId, limit = 50) {
  return db
    .prepare('SELECT * FROM notifications WHERE guild_id = ? ORDER BY id DESC LIMIT ?')
    .all(guildId, Math.min(200, Math.max(1, limit)));
}

function unreadCount(guildId) {
  return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE guild_id = ? AND read = 0').get(guildId).n;
}

function markAllRead(guildId) {
  db.prepare('UPDATE notifications SET read = 1 WHERE guild_id = ? AND read = 0').run(guildId);
}

function markRead(guildId, id) {
  db.prepare('UPDATE notifications SET read = 1 WHERE guild_id = ? AND id = ?').run(guildId, id);
}

module.exports = {
  EVENT_KEYS,
  EVENT_LABELS,
  keyForLog,
  getConfig,
  listConfig,
  setConfig,
  addToInbox,
  listInbox,
  unreadCount,
  markAllRead,
  markRead,
};
