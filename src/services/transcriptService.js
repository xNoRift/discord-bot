'use strict';

const { AttachmentBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const settingsModel = require('../database/models/settings');
const ticketPanels = require('../database/models/ticketPanels');
const config = require('../../config/config');
const logger = require('../utils/logger');

/**
 * Ticket-Transkripte: hält den Verlauf eines Tickets als Textdatei fest und schickt ihn in den
 * Log-Kanal des Panels (sonst in den serverweiten Ticket-Log-Kanal).
 *
 * Hinweis: Nachrichteninhalte anderer Nutzer sind für Bots nur mit dem privilegierten
 * „Message Content"-Intent lesbar. Ohne ihn enthält das Transkript Absender, Zeiten, Anhänge
 * und Bot-Embeds, aber keine Texte der Mitglieder.
 */

const MAX_MESSAGES = 1500;

async function fetchAll(channel) {
  const all = [];
  let before;
  while (all.length < MAX_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function stamp(ts) {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

/** Baut den Transkript-Text aus den Nachrichten. */
function buildText(ticket, messages) {
  const lines = [
    `Transkript – Ticket #${ticket.number}${ticket.category_label ? ` (${ticket.category_label})` : ''}`,
    `Ersteller-ID: ${ticket.opener_id}`,
    `Erstellt: ${stamp(ticket.created_at)} UTC`,
    '='.repeat(60),
    '',
  ];
  for (const m of messages) {
    const who = `${m.author?.username ?? 'Unbekannt'}${m.author?.bot ? ' [BOT]' : ''} (${m.author?.id ?? '?'})`;
    lines.push(`[${stamp(m.createdTimestamp)}] ${who}`);
    if (m.content) lines.push(`  ${m.content.replace(/\n/g, '\n  ')}`);
    for (const e of m.embeds ?? []) {
      const bits = [e.title, e.description, ...(e.fields ?? []).map((f) => `${f.name}: ${f.value}`)].filter(Boolean);
      if (bits.length) lines.push(`  [Embed] ${bits.join(' | ').replace(/\n/g, ' ')}`);
    }
    for (const a of m.attachments?.values?.() ?? []) lines.push(`  [Anhang] ${a.name}: ${a.url}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Erstellt das Transkript und sendet es. Gibt die gesendete Nachricht zurück (oder null).
 * @param {import('discord.js').TextChannel} channel
 * @param {object} ticket  tickets-Zeile
 */
async function send(channel, ticket) {
  const guild = channel.guild;
  const panel = ticket.panel_id ? ticketPanels.getPanel(ticket.panel_id) : null;
  const settings = settingsModel.get(guild.id);
  const targetId = panel?.log_channel_id || settings.ticket_log_channel_id;
  if (!targetId) return null;
  const target = guild.channels.cache.get(targetId) ?? (await guild.channels.fetch(targetId).catch(() => null));
  if (!target || !target.isTextBased()) return null;
  const me = guild.members.me;
  if (me && !target.permissionsFor(me)?.has(PermissionFlagsBits.AttachFiles)) {
    logger.warn(`[transcript] Dem Bot fehlt "Dateien anhängen" in ${targetId}.`);
    return null;
  }

  const messages = await fetchAll(channel);
  const text = buildText(ticket, messages);
  const file = new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `transkript-${String(ticket.number).padStart(4, '0')}.txt` });
  const embed = new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle(`📄 Transkript – Ticket #${ticket.number}`)
    .addFields(
      { name: 'Ersteller', value: `<@${ticket.opener_id}>`, inline: true },
      { name: 'Nachrichten', value: String(messages.length), inline: true },
      ...(ticket.category_label ? [{ name: 'Kategorie', value: ticket.category_label, inline: true }] : []),
    )
    .setTimestamp();
  return target.send({ embeds: [embed], files: [file] });
}

module.exports = { send, buildText };
