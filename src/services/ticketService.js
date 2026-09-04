'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
} = require('discord.js');
const client = require('../core/client');
const ticketsModel = require('../database/models/tickets');
const settingsModel = require('../database/models/settings');
const ticketPanels = require('../database/models/ticketPanels');
const logService = require('./logService');
const embeds = require('../utils/embeds');
const config = require('../../config/config');
const logger = require('../utils/logger');
const { discordTimestamp } = require('../utils/time');

/**
 * Ticketsystem mit MEHREREN Panels pro Server und MEHREREN Kategorien pro Panel.
 * Jede Kategorie kann eigene Discord-Kategorie, Support-Rolle, Begrüßung und
 * Kanalnamen haben. Fehlt ein Wert, greift die Server-Standardeinstellung.
 */

/* ---------------- Panel ---------------- */

function parseColor(hex) {
  if (!hex) return null;
  const m = String(hex).match(/^#?([0-9a-fA-F]{6})$/);
  return m ? parseInt(m[1], 16) : null;
}

/** Panel-Farbe -> Server-Embed-Farbe -> Branding. */
function panelColor(panel, settings) {
  return parseColor(panel?.color) ?? parseColor(settings?.embed_color) ?? config.branding.color;
}

/** Log-Kanal für Ticket-Events: Panel-Log > (logService-Fallback). */
function ticketLogOverride(ticket) {
  if (!ticket?.panel_id) return undefined;
  const panel = ticketPanels.getPanel(ticket.panel_id);
  return panel?.log_channel_id || undefined;
}

/**
 * Baut die Panel-Nachricht aus einem Panel + seinen Kategorien.
 * @param {object} panel       ticket_panels-Zeile
 * @param {object[]} categories ticket_categories-Zeilen
 */
function buildPanelMessage(panel, categories) {
  const embed = new EmbedBuilder()
    .setColor(parseColor(panel.color) ?? parseColor(settingsModel.get(panel.guild_id).embed_color) ?? config.branding.color)
    .setTitle(panel.title || config.defaults.ticketPanelTitle)
    .setDescription(panel.description || config.defaults.ticketPanelMessage);

  if (/^https?:\/\//i.test(panel.image_url || '')) embed.setImage(panel.image_url);
  if (/^https?:\/\//i.test(panel.thumbnail_url || '')) embed.setThumbnail(panel.thumbnail_url);

  if (categories.length > 1) {
    embed.addFields(
      categories.slice(0, 25).map((c) => ({
        name: `${c.emoji ? c.emoji + ' ' : ''}${c.label}`,
        value: c.description || '​',
      })),
    );
  }

  const components = [];

  if (!categories.length) {
    // Panel ohne Kategorien -> ein Standard-Button
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket:create')
          .setLabel(panel.button_label || 'Ticket erstellen')
          .setEmoji('🎫')
          .setStyle(ButtonStyle.Primary),
      ),
    );
  } else if (panel.use_select && categories.length > 1) {
    // Auswahlmenü
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`ticket:pick:${panel.id}`)
          .setPlaceholder('Wähle eine Kategorie…')
          .addOptions(
            categories.slice(0, 25).map((c) => ({
              label: c.label.slice(0, 100),
              value: String(c.id),
              description: c.description ? c.description.slice(0, 100) : undefined,
              emoji: c.emoji || undefined,
            })),
          ),
      ),
    );
  } else {
    // Buttons (max. 5 pro Reihe, 5 Reihen)
    let row = new ActionRowBuilder();
    categories.slice(0, 25).forEach((c, i) => {
      if (i > 0 && i % 5 === 0) {
        components.push(row);
        row = new ActionRowBuilder();
      }
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket:open:${c.id}`)
          .setLabel((categories.length === 1 ? panel.button_label || c.label : c.label).slice(0, 80))
          .setEmoji(c.emoji || '🎫')
          .setStyle(ButtonStyle.Primary),
      );
    });
    if (row.components.length) components.push(row);
  }

  return { embeds: [embed], components };
}

/**
 * Postet ein Panel in seinen Kanal oder aktualisiert die bestehende Nachricht.
 * @param {import('discord.js').Guild} guild
 * @param {number} panelId
 * @param {string} [channelId]  neuer Zielkanal (überschreibt panel.channel_id)
 */
async function postOrUpdatePanel(guild, panelId, channelId) {
  const panel = ticketPanels.getPanel(panelId);
  if (!panel || panel.guild_id !== guild.id) throw new Error('Panel nicht gefunden.');

  const targetChannelId = channelId || panel.channel_id;
  if (!targetChannelId) throw new Error('Für dieses Panel wurde kein Kanal ausgewählt.');

  const channel =
    guild.channels.cache.get(targetChannelId) ??
    (await guild.channels.fetch(targetChannelId).catch(() => null));
  if (!channel || !channel.isTextBased()) throw new Error('Panel-Kanal nicht gefunden oder kein Textkanal.');

  const categories = ticketPanels.listCategories(panelId).filter((c) => c.enabled !== 0);
  const payload = buildPanelMessage(panel, categories);

  // Bestehende Nachricht aktualisieren?
  if (panel.channel_id === targetChannelId && panel.message_id) {
    const existing = await channel.messages.fetch(panel.message_id).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      ticketPanels.updatePanel(panelId, { channel_id: targetChannelId });
      return existing;
    }
  }

  const message = await channel.send(payload);
  ticketPanels.updatePanel(panelId, { channel_id: targetChannelId, message_id: message.id });
  return message;
}

/* ---------------- Ticket-Erstellung ---------------- */

function buildManagementRow(ticket) {
  const closed = ticket.status === 'closed';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:claim')
      .setLabel('Übernehmen')
      .setEmoji('📌')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(Boolean(ticket.claimed_by)),
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setLabel('Schließen')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId('ticket:reopen')
      .setLabel('Wieder öffnen')
      .setEmoji('🔓')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!closed),
    new ButtonBuilder()
      .setCustomId('ticket:delete')
      .setLabel('Löschen')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger),
  );
}

/**
 * Baut das Formular-Modal für eine Kategorie (max. 5 Felder – Discord-Limit).
 */
function buildTicketModal(category, questions) {
  const modal = new ModalBuilder()
    .setCustomId(`ticket:form:${category.id}`)
    .setTitle(`Ticket: ${category.label}`.slice(0, 45));

  questions.slice(0, 5).forEach((q) => {
    const input = new TextInputBuilder()
      .setCustomId(`q_${q.id}`)
      .setLabel(q.label.slice(0, 45))
      .setStyle(q.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(Boolean(q.required));
    if (q.placeholder) input.setPlaceholder(q.placeholder.slice(0, 100));
    if (q.min_length) input.setMinLength(Math.min(q.min_length, 1000));
    if (q.max_length) input.setMaxLength(Math.min(Math.max(q.max_length, 1), 4000));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  });

  return modal;
}

function renderWelcome(template, { member, guild, ticketNumber, category }) {
  return (template || config.defaults.ticketWelcome)
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{user.tag}', member.user.tag)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{guild}', guild.name)
    .replaceAll('{category}', category || '')
    .replaceAll('{number}', String(ticketNumber));
}

/**
 * Erstellt ein Ticket für ein Mitglied.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildMember} member
 * @param {object} [opts]
 * @param {number} [opts.categoryId]  ticket_categories.id (bestimmt Discord-Kategorie, Rolle, Text …)
 * @returns {Promise<{ channel: import('discord.js').TextChannel, ticket: object }>}
 */
async function createTicket(guild, member, opts = {}) {
  const settings = settingsModel.get(guild.id);

  if (settings.tickets_enabled === 0) {
    throw new Error('Das Ticket-Modul ist derzeit deaktiviert.');
  }

  const cat = opts.categoryId ? ticketPanels.getCategory(opts.categoryId) : null;
  if (opts.categoryId && (!cat || cat.guild_id !== guild.id)) {
    throw new Error('Diese Ticket-Kategorie existiert nicht mehr.');
  }
  if (cat && cat.enabled === 0) {
    throw new Error('Diese Kategorie ist derzeit deaktiviert.');
  }
  const panel = cat ? ticketPanels.getPanel(cat.panel_id) : null;

  // Werte auflösen: Kategorie überschreibt Server-Standard
  const discordCategoryId = cat?.discord_category_id || settings.ticket_category_id;
  const supportRoleId = cat?.support_role_id || settings.ticket_support_role_id;
  const welcomeTemplate = cat?.welcome_message || settings.ticket_welcome_message;
  const nameFormat = cat?.prefix
    ? `${cat.prefix}-{number}`
    : cat?.name_format || settings.ticket_name_format || 'ticket-{number}';

  if (!discordCategoryId) {
    throw new Error('Für diese Kategorie wurde keine Discord-Kategorie festgelegt (weder in der Kategorie noch als Standard).');
  }

  const discordCategory =
    guild.channels.cache.get(discordCategoryId) ??
    (await guild.channels.fetch(discordCategoryId).catch(() => null));
  if (!discordCategory || discordCategory.type !== ChannelType.GuildCategory) {
    throw new Error('Die hinterlegte Discord-Kategorie existiert nicht mehr.');
  }

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
    throw new Error('Dem Bot fehlt die Berechtigung "Kanäle verwalten".');
  }

  const max = settings.ticket_max_per_user ?? 1;
  if (max > 0) {
    const open = ticketsModel.countOpenByUser(guild.id, member.id);
    if (open >= max) {
      throw new Error(`Du hast bereits ${open} offene(s) Ticket(s). Maximum: ${max}.`);
    }
  }

  const number = settingsModel.incrementTicketCounter(guild.id);
  const name = nameFormat
    .replaceAll('{number}', String(number).padStart(4, '0'))
    .replaceAll('{user}', member.user.username)
    .replaceAll('{category}', cat?.label || 'ticket')
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90);

  const supportPerms = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.AttachFiles,
    PermissionsBitField.Flags.EmbedLinks,
  ];

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: member.id, allow: supportPerms },
    {
      id: me.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageMessages,
      ],
    },
  ];

  if (supportRoleId && guild.roles.cache.has(supportRoleId)) {
    overwrites.push({ id: supportRoleId, allow: supportPerms });
  }

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: discordCategory.id,
    permissionOverwrites: overwrites,
    topic: `Ticket #${number}${cat ? ' • ' + cat.label : ''} • Ersteller: ${member.user.tag} (${member.id})`,
  });

  const ticket = ticketsModel.create({
    guildId: guild.id,
    channelId: channel.id,
    number,
    openerId: member.id,
    panelId: panel?.id ?? null,
    categoryId: cat?.id ?? null,
    categoryLabel: cat?.label ?? null,
  });
  ticketsModel.touch(ticket.id);

  const welcomeEmbed = new EmbedBuilder()
    .setColor(panelColor(panel, settings))
    .setTitle(`🎫 Ticket #${number}${cat ? ` – ${cat.label}` : ''}`)
    .setDescription(renderWelcome(welcomeTemplate, { member, guild, ticketNumber: number, category: cat?.label }))
    .addFields(
      { name: 'Erstellt von', value: `<@${member.id}>`, inline: true },
      { name: 'Erstellt am', value: discordTimestamp(Date.now(), 'F'), inline: true },
      ...(cat ? [{ name: 'Kategorie', value: cat.label, inline: true }] : []),
    )
    .setTimestamp();

  const pings = [`<@${member.id}>`];
  if (settings.ticket_team_ping !== 0) {
    if (supportRoleId) pings.push(`<@&${supportRoleId}>`);
    if (cat?.ping_role_id) pings.push(`<@&${cat.ping_role_id}>`);
  }

  await channel.send({
    content: pings.join(' • '),
    embeds: [welcomeEmbed],
    components: [buildManagementRow(ticket)],
  });

  // Formular-Antworten (falls die Kategorie ein Öffnen-Formular hat)
  if (Array.isArray(opts.answers) && opts.answers.length) {
    const answerEmbed = new EmbedBuilder()
      .setColor(panelColor(panel, settings))
      .setTitle('📝 Angaben aus dem Formular')
      .addFields(
        opts.answers.slice(0, 24).map((a) => ({
          name: String(a.question || 'Frage').slice(0, 256),
          value: (a.answer && a.answer.trim() ? a.answer : '*(keine Angabe)*').slice(0, 1024),
        })),
      );
    await channel.send({ embeds: [answerEmbed] }).catch(() => null);
  }

  await logService.log({
    guildId: guild.id,
    category: 'ticket',
    type: 'ticket_create',
    title: '🎫 Ticket erstellt',
    color: config.branding.success,
    fields: [
      { name: 'Ticket', value: `#${number} (<#${channel.id}>)`, inline: true },
      { name: 'Ersteller', value: `<@${member.id}>`, inline: true },
      ...(cat ? [{ name: 'Kategorie', value: cat.label, inline: true }] : []),
    ],
    actorId: member.id,
    overrideChannelId: ticketLogOverride(ticket),
    meta: { ticketId: ticket.id, channelId: channel.id, categoryId: cat?.id ?? null },
  });

  return { channel, ticket };
}

/* ---------------- Verwaltung ---------------- */

async function updateManagementMessage(channel, ticket) {
  // Erste Bot-Nachricht mit Buttons finden und aktualisieren.
  const messages = await channel.messages.fetch({ limit: 20, after: '0' }).catch(() => null);
  if (!messages) return;
  const botMsg = messages
    .filter((m) => m.author.id === client.user.id && m.components.length > 0)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .first();
  if (botMsg) {
    await botMsg.edit({ components: [buildManagementRow(ticket)] }).catch(() => null);
  }
}

async function claimTicket(channel, member) {
  const ticket = ticketsModel.getByChannel(channel.id);
  if (!ticket) throw new Error('Kein Ticket zu diesem Kanal gefunden.');
  if (ticket.claimed_by) throw new Error(`Bereits übernommen von <@${ticket.claimed_by}>.`);

  const updated = ticketsModel.claim(ticket.id, member.id);
  await updateManagementMessage(channel, updated);

  // Übernommene Tickets ggf. in eine andere Discord-Kategorie verschieben
  const panel = ticket.panel_id ? ticketPanels.getPanel(ticket.panel_id) : null;
  if (panel?.claim_category_id) {
    await channel.setParent(panel.claim_category_id, { lockPermissions: false }).catch(() => null);
  }

  await channel
    .send({ embeds: [embeds.info('📌 Ticket übernommen', `<@${member.id}> kümmert sich um dieses Ticket.`)] })
    .catch(() => null);

  await logService.log({
    guildId: channel.guild.id,
    category: 'ticket',
    type: 'ticket_claim',
    title: '📌 Ticket übernommen',
    fields: [
      { name: 'Ticket', value: `#${ticket.number}`, inline: true },
      { name: 'Übernommen von', value: `<@${member.id}>`, inline: true },
    ],
    actorId: member.id,
    overrideChannelId: ticketLogOverride(ticket),
    meta: { ticketId: ticket.id },
  });
  return updated;
}

async function closeTicket(channel, member) {
  const ticket = ticketsModel.getByChannel(channel.id);
  if (!ticket) throw new Error('Kein Ticket zu diesem Kanal gefunden.');
  if (ticket.status === 'closed') throw new Error('Das Ticket ist bereits geschlossen.');

  const updated = ticketsModel.close(ticket.id, member.id);

  // Ersteller darf nicht mehr schreiben, Kanal bleibt sichtbar.
  await channel.permissionOverwrites
    .edit(ticket.opener_id, { SendMessages: false })
    .catch(() => null);
  await channel.setName(`geschlossen-${String(ticket.number).padStart(4, '0')}`).catch(() => null);

  await updateManagementMessage(channel, updated);
  await channel
    .send({
      embeds: [
        embeds.warning(
          '🔒 Ticket geschlossen',
          `Geschlossen von <@${member.id}>.\nEin Teammitglied kann es wieder öffnen oder endgültig löschen.`,
        ),
      ],
    })
    .catch(() => null);

  await logService.log({
    guildId: channel.guild.id,
    category: 'ticket',
    type: 'ticket_close',
    title: '🔒 Ticket geschlossen',
    color: config.branding.warning,
    fields: [
      { name: 'Ticket', value: `#${ticket.number}`, inline: true },
      { name: 'Ersteller', value: `<@${ticket.opener_id}>`, inline: true },
      { name: 'Geschlossen von', value: `<@${member.id}>`, inline: true },
      ticket.claimed_by ? { name: 'Übernommen von', value: `<@${ticket.claimed_by}>`, inline: true } : null,
      { name: 'Erstellt am', value: discordTimestamp(ticket.created_at, 'F'), inline: true },
    ].filter(Boolean),
    actorId: member.id,
    overrideChannelId: ticketLogOverride(ticket),
    meta: { ticketId: ticket.id },
  });

  await maybeRequestRating(channel, ticket).catch(() => null);
  return updated;
}

async function reopenTicket(channel, member) {
  const ticket = ticketsModel.getByChannel(channel.id);
  if (!ticket) throw new Error('Kein Ticket zu diesem Kanal gefunden.');
  if (ticket.status !== 'closed') throw new Error('Das Ticket ist nicht geschlossen.');

  const updated = ticketsModel.reopen(ticket.id);
  await channel.permissionOverwrites
    .edit(ticket.opener_id, { SendMessages: true, ViewChannel: true })
    .catch(() => null);
  await channel.setName(`ticket-${String(ticket.number).padStart(4, '0')}`).catch(() => null);

  await updateManagementMessage(channel, updated);
  await channel
    .send({ embeds: [embeds.success('🔓 Ticket wieder geöffnet', `Wieder geöffnet von <@${member.id}>.`)] })
    .catch(() => null);

  await logService.log({
    guildId: channel.guild.id,
    category: 'ticket',
    type: 'ticket_reopen',
    title: '🔓 Ticket wieder geöffnet',
    color: config.branding.success,
    fields: [
      { name: 'Ticket', value: `#${ticket.number}`, inline: true },
      { name: 'Geöffnet von', value: `<@${member.id}>`, inline: true },
    ],
    actorId: member.id,
    overrideChannelId: ticketLogOverride(ticket),
    meta: { ticketId: ticket.id },
  });
  return updated;
}

async function deleteTicket(channel, member) {
  const ticket = ticketsModel.getByChannel(channel.id);
  if (!ticket) throw new Error('Kein Ticket zu diesem Kanal gefunden.');

  ticketsModel.markDeleted(ticket.id, member.id);

  await logService.log({
    guildId: channel.guild.id,
    category: 'ticket',
    type: 'ticket_delete',
    title: '🗑️ Ticket gelöscht',
    color: config.branding.danger,
    fields: [
      { name: 'Ticket', value: `#${ticket.number}`, inline: true },
      { name: 'Ersteller', value: `<@${ticket.opener_id}>`, inline: true },
      { name: 'Gelöscht von', value: `<@${member.id}>`, inline: true },
      ticket.claimed_by ? { name: 'Übernommen von', value: `<@${ticket.claimed_by}>`, inline: true } : null,
      { name: 'Erstellt am', value: discordTimestamp(ticket.created_at, 'F'), inline: true },
      ticket.closed_at ? { name: 'Geschlossen am', value: discordTimestamp(ticket.closed_at, 'F'), inline: true } : null,
    ].filter(Boolean),
    actorId: member.id,
    overrideChannelId: ticketLogOverride(ticket),
    meta: { ticketId: ticket.id },
  });

  await channel
    .send({ embeds: [embeds.error('🗑️ Ticket wird gelöscht', 'Dieser Kanal wird in 5 Sekunden entfernt…')] })
    .catch(() => null);

  setTimeout(() => {
    channel.delete('Ticket gelöscht').catch((err) => logger.warn(`[ticket] delete channel: ${err.message}`));
  }, 5000);
}

/* ---------------- Bewertung nach dem Schließen ---------------- */

async function maybeRequestRating(channel, ticket) {
  if (!ticket.panel_id) return;
  const panel = ticketPanels.getPanel(ticket.panel_id);
  if (!panel?.rating_enabled) return;

  const row = new ActionRowBuilder().addComponents(
    [1, 2, 3, 4, 5].map((n) =>
      new ButtonBuilder()
        .setCustomId(`ticket:rate:${ticket.id}:${n}`)
        .setLabel('⭐'.repeat(n))
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  await channel
    .send({
      embeds: [embeds.info('⭐ Wie zufrieden warst du?', 'Bewerte den Support mit 1–5 Sternen.')],
      components: [row],
    })
    .catch(() => null);
}

/**
 * Verarbeitet eine Bewertung (Button "ticket:rate:<ticketId>:<stars>").
 */
async function submitRating(guild, ticketId, stars, member) {
  const ticket = ticketsModel.get(ticketId);
  if (!ticket) throw new Error('Ticket nicht gefunden.');
  const panel = ticket.panel_id ? ticketPanels.getPanel(ticket.panel_id) : null;
  const targetId = panel?.rating_channel_id || panel?.log_channel_id;
  if (targetId) {
    const ch =
      guild.channels.cache.get(targetId) ?? (await guild.channels.fetch(targetId).catch(() => null));
    if (ch?.isTextBased()) {
      await ch
        .send({
          embeds: [
            embeds
              .brand('⭐ Ticket-Bewertung', `${'⭐'.repeat(stars)} (${stars}/5)`)
              .addFields(
                { name: 'Ticket', value: `#${ticket.number}`, inline: true },
                { name: 'Von', value: `<@${member.id}>`, inline: true },
              ),
          ],
        })
        .catch(() => null);
    }
  }
}

/* ---------------- Auto-Close ---------------- */

async function autoCloseSweep() {
  const now = Date.now();
  // Weit genug zurück suchen; Feinprüfung pro Panel darunter.
  const candidates = ticketsModel.listStaleOpen(now - 60 * 60 * 1000);
  for (const ticket of candidates) {
    const panel = ticketPanels.getPanel(ticket.panel_id);
    const hours = panel?.autoclose_hours || 0;
    if (hours <= 0) continue;
    const last = ticket.last_activity_at || ticket.created_at;
    if (now - last < hours * 3600_000) continue;

    const guild = client.guilds.cache.get(ticket.guild_id);
    if (!guild) continue;
    const channel =
      guild.channels.cache.get(ticket.channel_id) ??
      (await guild.channels.fetch(ticket.channel_id).catch(() => null));
    if (!channel) {
      ticketsModel.markDeleted(ticket.id, client.user.id);
      continue;
    }
    const me = guild.members.me;
    await closeTicket(channel, me).catch((err) => logger.warn(`[ticket] autoclose #${ticket.id}: ${err.message}`));
    await channel
      .send({ embeds: [embeds.warning('🔒 Automatisch geschlossen', `Keine Aktivität seit ${hours} Stunden.`)] })
      .catch(() => null);
  }
}

module.exports = {
  buildPanelMessage,
  postOrUpdatePanel,
  createTicket,
  claimTicket,
  closeTicket,
  reopenTicket,
  deleteTicket,
  buildManagementRow,
  buildTicketModal,
  submitRating,
  autoCloseSweep,
};
