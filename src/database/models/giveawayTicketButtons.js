'use strict';

const db = require('../db');

/**
 * Ticket-Buttons in der Giveaway-Gewinner-Nachricht. Ein Server kann mehrere
 * anlegen (z. B. "Preis abholen" + "Frage stellen"), jeder mit eigener
 * Discord-Kategorie, Support-Rolle, Kanalname und Begrüßung.
 */

function list(guildId) {
  return db
    .prepare('SELECT * FROM giveaway_ticket_buttons WHERE guild_id = ? ORDER BY position ASC, id ASC')
    .all(guildId);
}

function get(id) {
  return db.prepare('SELECT * FROM giveaway_ticket_buttons WHERE id = ?').get(id);
}

function count(guildId) {
  return db.prepare('SELECT COUNT(*) AS n FROM giveaway_ticket_buttons WHERE guild_id = ?').get(guildId).n;
}

function create(guildId, data) {
  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM giveaway_ticket_buttons WHERE guild_id = ?')
    .get(guildId).p;
  const info = db
    .prepare(
      `INSERT INTO giveaway_ticket_buttons
        (guild_id, label, emoji, discord_category_id, support_role_id, name_format, welcome_message, show_prize, position, created_at)
       VALUES (@guild_id, @label, @emoji, @discord_category_id, @support_role_id, @name_format, @welcome_message, @show_prize, @position, @created_at)`,
    )
    .run({
      guild_id: guildId,
      label: (data.label || 'Ticket erstellen').slice(0, 80),
      emoji: data.emoji ?? null,
      discord_category_id: data.discordCategoryId ?? null,
      support_role_id: data.supportRoleId ?? null,
      name_format: data.nameFormat ?? null,
      welcome_message: data.welcomeMessage ?? null,
      show_prize: data.showPrize === false ? 0 : 1,
      position: maxPos + 1,
      created_at: Date.now(),
    });
  return get(info.lastInsertRowid);
}

function update(id, patch) {
  const allowed = [
    'label',
    'emoji',
    'discord_category_id',
    'support_role_id',
    'name_format',
    'welcome_message',
    'show_prize',
    'position',
  ];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return get(id);
  const setSql = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { id };
  for (const k of keys) {
    let v = patch[k];
    if (typeof v === 'boolean') v = v ? 1 : 0;
    params[k] = v === '' ? null : v;
  }
  db.prepare(`UPDATE giveaway_ticket_buttons SET ${setSql} WHERE id = @id`).run(params);
  return get(id);
}

function remove(id) {
  db.prepare('DELETE FROM giveaway_ticket_buttons WHERE id = ?').run(id);
}

module.exports = { list, get, count, create, update, remove };
