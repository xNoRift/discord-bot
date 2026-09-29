'use strict';

const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const settingsModel = require('../database/models/settings');
const ticketPanels = require('../database/models/ticketPanels');
const transcriptsModel = require('../database/models/ticketTranscripts');
const config = require('../../config/config');
const logger = require('../utils/logger');
const { L } = require('../utils/i18n');

/**
 * Ticket-Transkripte:
 *  - `snapshot` speichert den Verlauf eines Tickets in der Datenbank (beim Schließen und Löschen),
 *    damit er im Dashboard als Chat-Verlauf lesbar bleibt – auch nachdem der Kanal gelöscht ist.
 *  - `send` schickt zusätzlich eine Textdatei + Link zum Dashboard in den Log-Kanal (wenn am Panel aktiviert).
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

/** Link zur Transkript-Seite im Dashboard. */
function viewUrl(ticket) {
  return `${config.dashboard.url}/dashboard/${ticket.guild_id}/tickets/${ticket.id}/transcript`;
}

/** Baut den Transkript-Text aus den Nachrichten. */
function buildText(ticket, messages) {
  const lines = [
    ticket.application_id
      ? L('Transkript – Bewerber-Chat (Bewerbung #{id})', 'Transcript – applicant chat (application #{id})', { id: ticket.application_id })
      : `${L('Transkript', 'Transcript')} – Ticket #${ticket.number}${ticket.category_label ? ` (${ticket.category_label})` : ''}`,
    `${L('Ersteller-ID', 'Creator ID')}: ${ticket.opener_id}`,
    `${L('Erstellt', 'Created')}: ${stamp(ticket.created_at)} UTC`,
    '='.repeat(60),
    '',
  ];
  for (const m of messages) {
    const who = `${m.author?.username ?? L('Unbekannt', 'Unknown')}${m.author?.bot ? ' [BOT]' : ''} (${m.author?.id ?? '?'})`;
    lines.push(`[${stamp(m.createdTimestamp)}] ${who}`);
    if (m.content) lines.push(`  ${m.content.replace(/\n/g, '\n  ')}`);
    for (const e of m.embeds ?? []) {
      const bits = [e.title, e.description, ...(e.fields ?? []).map((f) => `${f.name}: ${f.value}`)].filter(Boolean);
      if (bits.length) lines.push(`  [Embed] ${bits.join(' | ').replace(/\n/g, ' ')}`);
    }
    for (const a of m.attachments?.values?.() ?? []) lines.push(`  [${L('Anhang', 'Attachment')}] ${a.name}: ${a.url}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Wandelt die Discord-Nachrichten in ein kompaktes, speicherbares Format um. */
function buildData(channel, ticket, messages) {
  const guild = channel.guild;
  const users = {};
  const roles = {};
  const channels = {};
  const addUser = (u, member) => {
    if (!u || (users[u.id] && (!member || users[u.id].m))) return;
    users[u.id] = {
      n: member?.displayName || u.globalName || u.username,
      u: u.username,
      av: (member ?? u).displayAvatarURL?.({ size: 64, extension: 'png' }) || null,
      bot: Boolean(u.bot),
      c: member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null,
      ...(member ? { m: 1 } : {}),
    };
  };

  const out = messages.map((m) => {
    addUser(m.author, m.member);
    for (const u of m.mentions?.users?.values?.() ?? []) addUser(u, m.mentions.members?.get(u.id));
    for (const r of m.mentions?.roles?.values?.() ?? []) roles[r.id] = { n: r.name, c: r.hexColor !== '#000000' ? r.hexColor : null };
    for (const c of m.mentions?.channels?.values?.() ?? []) channels[c.id] = c.name;
    const msg = { id: m.id, a: m.author?.id ?? null, ts: m.createdTimestamp };
    if (m.editedTimestamp) msg.ed = m.editedTimestamp;
    if (m.content) msg.c = m.content;
    if (m.reference?.messageId) msg.ref = m.reference.messageId;
    if (m.system) msg.sys = true;
    const em = (m.embeds ?? [])
      .map((e) => ({
        t: e.title || null,
        d: e.description || null,
        u: e.url || null,
        col: e.hexColor || null,
        au: e.author?.name || null,
        f: (e.fields ?? []).map((f) => ({ n: f.name, v: f.value, i: Boolean(f.inline) })),
        img: e.image?.url || null,
        th: e.thumbnail?.url || null,
        ft: e.footer?.text || null,
      }))
      .filter((e) => e.t || e.d || e.au || e.f.length || e.img || e.ft);
    if (em.length) msg.em = em;
    const at = [...(m.attachments?.values?.() ?? [])].map((a) => ({ n: a.name, u: a.url, s: a.size, ct: a.contentType || null }));
    if (at.length) msg.at = at;
    const st = [...(m.stickers?.values?.() ?? [])].map((s) => s.name);
    if (st.length) msg.st = st;
    const btn = (m.components ?? [])
      .flatMap((row) => row.components ?? [])
      .map((c) => c.label || c.placeholder)
      .filter(Boolean);
    if (btn.length) msg.btn = btn;
    return msg;
  });

  // Personen aus den Ticket-Daten, die im Verlauf nicht selbst geschrieben haben
  for (const id of [ticket.opener_id, ticket.claimed_by, ticket.closed_by]) {
    if (id && !users[id]) {
      const member = guild.members.cache.get(id);
      if (member) addUser(member.user, member);
    }
  }

  return {
    v: 1,
    meta: {
      number: ticket.number,
      category: ticket.category_label || null,
      applicationId: ticket.application_id || null,
      modmail: Boolean(ticket.is_modmail),
      channelName: channel.name,
      openerId: ticket.opener_id,
      claimedBy: ticket.claimed_by || null,
      closedBy: ticket.closed_by || null,
      createdAt: ticket.created_at,
      closedAt: ticket.closed_at || null,
      savedAt: Date.now(),
      truncated: messages.length >= MAX_MESSAGES,
    },
    users,
    roles,
    channels,
    messages: out,
  };
}

/**
 * Speichert den aktuellen Verlauf des Ticket-Kanals in der Datenbank.
 * Gibt die geladenen Nachrichten zurück (damit `send` sie wiederverwenden kann) – oder null bei Fehler.
 */
async function snapshot(channel, ticket) {
  try {
    const messages = await fetchAll(channel);
    transcriptsModel.save(ticket.id, channel.guild.id, buildData(channel, ticket, messages));
    return messages;
  } catch (err) {
    logger.warn(`[transcript] Verlauf #${ticket.number} nicht gespeichert: ${err.message}`);
    return null;
  }
}

const CDN_RE = /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\//i;

/** Signierte Discord-Anhang-Links laufen ab (Parameter `ex` = Ablauf als Hex-Unixzeit). */
function isExpired(url) {
  if (!CDN_RE.test(url)) return false;
  try {
    const ex = new URL(url).searchParams.get('ex');
    return !ex || parseInt(ex, 16) * 1000 < Date.now() + 5 * 60_000;
  } catch {
    return false;
  }
}

/**
 * Frischt abgelaufene Anhang-Links eines gespeicherten Verlaufs über die Discord-API auf
 * und speichert das Ergebnis. Fehler werden ignoriert (dann bleiben die alten Links).
 */
async function refreshAttachmentUrls(ticketId, guildId, data) {
  const client = require('../core/client');
  const refs = [];
  for (const m of data.messages ?? []) {
    for (const a of m.at ?? []) if (isExpired(a.u)) refs.push([a, 'u']);
    for (const e of m.em ?? []) {
      if (e.img && isExpired(e.img)) refs.push([e, 'img']);
      if (e.th && isExpired(e.th)) refs.push([e, 'th']);
    }
  }
  if (!refs.length) return data;
  let changed = false;
  for (let i = 0; i < refs.length; i += 50) {
    const chunk = refs.slice(i, i + 50);
    try {
      const res = await client.rest.post('/attachments/refresh-urls', { body: { attachment_urls: chunk.map(([o, k]) => o[k]) } });
      const map = new Map((res?.refreshed_urls ?? []).map((r) => [r.original, r.refreshed]));
      for (const [o, k] of chunk) {
        const fresh = map.get(o[k]);
        if (fresh) { o[k] = fresh; changed = true; }
      }
    } catch (err) {
      logger.warn(`[transcript] Anhang-Links nicht aufgefrischt: ${err.message}`);
      break;
    }
  }
  if (changed) transcriptsModel.save(ticketId, guildId, data);
  return data;
}

/** Link-Button „Verlauf ansehen" (nur wenn das Dashboard per http(s) erreichbar ist). */
function viewButtonRow(ticket) {
  if (!/^https?:\/\//i.test(config.dashboard.url)) return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(L('Verlauf ansehen', 'View transcript')).setEmoji('📄').setURL(viewUrl(ticket)),
    ),
  ];
}

/**
 * Erstellt das Transkript und sendet es. Gibt die gesendete Nachricht zurück (oder null).
 * @param {import('discord.js').TextChannel} channel
 * @param {object} ticket  tickets-Zeile
 * @param {import('discord.js').Message[]} [messages]  bereits geladene Nachrichten (aus `snapshot`)
 */
async function send(channel, ticket, messages) {
  const guild = channel.guild;
  const panel = ticket.panel_id ? ticketPanels.getPanel(ticket.panel_id) : null;
  const settings = settingsModel.get(guild.id);
  const targetId = ticket.application_id
    ? settings.application_log_channel_id || settings.log_channel_id
    : panel?.log_channel_id || settings.ticket_log_channel_id;
  if (!targetId) return null;
  const target = guild.channels.cache.get(targetId) ?? (await guild.channels.fetch(targetId).catch(() => null));
  if (!target || !target.isTextBased()) return null;
  const me = guild.members.me;
  if (me && !target.permissionsFor(me)?.has(PermissionFlagsBits.AttachFiles)) {
    logger.warn(`[transcript] Dem Bot fehlt "Dateien anhängen" in ${targetId}.`);
    return null;
  }

  if (!messages) messages = await fetchAll(channel);
  const text = buildText(ticket, messages);
  const file = new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `transkript-${String(ticket.number).padStart(4, '0')}.txt` });
  const embed = new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle(ticket.application_id ? `📄 Transkript – Bewerber-Chat #${ticket.application_id}` : `📄 Transkript – Ticket #${ticket.number}`)
    .addFields(
      { name: L('Ersteller', 'Creator'), value: `<@${ticket.opener_id}>`, inline: true },
      { name: L('Nachrichten', 'Messages'), value: String(messages.length), inline: true },
      ...(ticket.category_label ? [{ name: L('Kategorie', 'Category'), value: ticket.category_label, inline: true }] : []),
    )
    .setTimestamp();
  return target.send({ embeds: [embed], files: [file], components: viewButtonRow(ticket) });
}

module.exports = { send, snapshot, buildText, viewUrl, refreshAttachmentUrls };
