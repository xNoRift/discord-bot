'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  MentionableSelectMenuBuilder,
  RadioGroupBuilder,
  CheckboxBuilder,
  LabelBuilder,
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
const optionEmbeds = require('../utils/optionEmbeds');
const priceUtil = require('../utils/price');
const config = require('../../config/config');
const logger = require('../utils/logger');
const i18n = require('../utils/i18n');
const { discordTimestamp } = require('../utils/time');
const { isSupport } = require('../utils/permissions');

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
  if (ticket?.application_id) return settingsModel.get(ticket.guild_id).application_log_channel_id || undefined;
  if (!ticket?.panel_id) return undefined;
  const panel = ticketPanels.getPanel(ticket.panel_id);
  return panel?.log_channel_id || undefined;
}

/** Ticket-Log schreiben; ist „Ticket Aktivitäten loggen“ am Panel aus, bleibt nur der Dashboard-Verlauf. */
function ticketLog(ticket, opts) {
  const panel = ticket?.panel_id ? ticketPanels.getPanel(ticket.panel_id) : null;
  if (panel && ticketPanels.panelCfg(panel).logEnabled === false) {
    return logService.log({ ...opts, suppressDiscord: true });
  }
  return logService.log(opts);
}

/** Ist das Verschieben übernommener Tickets aktiv? (Standard: an, sobald eine Kategorie gesetzt ist) */
function claimCategoryOn(panel) {
  return Boolean(panel?.claim_category_id) && ticketPanels.panelCfg(panel).claimCategoryEnabled !== false;
}

/** Darf dieses Mitglied das Ticket schließen? Liefert eine Fehlermeldung oder null. */
function closePermissionError(member, ticket, settings) {
  const tg = i18n.forGuild(ticket.guild_id);
  const support = isSupport(member, settings, ticket);
  if (settings?.ticket_close_restricted === 1 && !support) return tg('tickets.errors.perm_close_restricted');
  if (!support && member.id !== ticket.opener_id) return tg('tickets.errors.perm_close');
  return null;
}

/** Fragen des Schließen-Formulars der Ticket-Kategorie (leer = direkt schließen). */
function closeFormQuestions(ticket) {
  return ticket?.category_id ? ticketPanels.listQuestions(ticket.category_id, 'close') : [];
}

/** Auslastung je Kategorie als Textzeilen für das Panel-Embed. */
function loadLines(categories) {
  return categories
    .map((c) => {
      const open = ticketsModel.countOpenByCategory(c.id);
      const max = c.max_open > 0 ? String(c.max_open) : '∞';
      return `${c.emoji ? c.emoji + ' ' : ''}**${c.label}** – ${open}/${max}`;
    })
    .join('\n')
    .slice(0, 1024);
}

/**
 * Baut die Panel-Nachricht aus einem Panel + seinen Kategorien.
 * @param {object} panel       ticket_panels-Zeile
 * @param {object[]} categories ticket_categories-Zeilen
 */
function buildPanelMessage(panel, categories) {
  const tg = i18n.forGuild(panel.guild_id);
  const embed = new EmbedBuilder()
    .setColor(parseColor(panel.color) ?? parseColor(settingsModel.get(panel.guild_id).embed_color) ?? config.branding.color)
    .setTitle(panel.title || tg('tickets.panel.default_title'))
    .setDescription(panel.description || tg('tickets.panel.default_message'));

  if (/^https?:\/\//i.test(panel.image_url || '')) embed.setImage(panel.image_url);
  if (/^https?:\/\//i.test(panel.thumbnail_url || '')) embed.setThumbnail(panel.thumbnail_url);

  // Die Kategorie-Beschreibungen stehen im Auswahlmenü bzw. auf den Buttons –
  // nicht mehr zusätzlich als Feldliste im Embed. Optional: Ticketauslastung.
  if (categories.length && ticketPanels.panelCfg(panel).showLoad) {
    embed.addFields({ name: 'Auslastung', value: loadLines(categories) });
  }

  const components = [];

  if (!categories.length) {
    // Panel ohne Kategorien -> ein Standard-Button
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket:create')
          .setLabel(panel.button_label || tg('tickets.panel.default_button'))
          .setEmoji('🎫')
          .setStyle(ButtonStyle.Primary),
      ),
    );
    return { embeds: [embed], components };
  }

  // Layout: 'buttons' | 'select' | 'both'  (Alt-Flag use_select wird noch berücksichtigt)
  const layout = panel.panel_layout || (panel.use_select ? 'select' : 'buttons');
  const wantSelect = layout === 'select' || layout === 'both';
  const wantButtons = layout === 'buttons' || layout === 'both';

  if (wantSelect) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`ticket:pick:${panel.id}`)
          .setPlaceholder(tg('tickets.panel.placeholder'))
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
  }

  if (wantButtons) {
    // Bei "Menü + Buttons" bleibt eine Reihe fürs Menü reserviert -> max. 4 Button-Reihen
    const maxRows = wantSelect ? 4 : 5;
    let row = new ActionRowBuilder();
    categories.slice(0, maxRows * 5).forEach((c, i) => {
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

const loadTimers = new Map();

/** Zeichnet die Panel-Nachricht neu (Ticketauslastung), gebündelt, damit Discord nicht überlastet wird. */
function scheduleLoadRefresh(guild, panelId) {
  clearTimeout(loadTimers.get(panelId));
  loadTimers.set(
    panelId,
    setTimeout(async () => {
      loadTimers.delete(panelId);
      try {
        const panel = ticketPanels.getPanel(panelId);
        if (!panel?.message_id || !panel.channel_id) return;
        const channel = guild.channels.cache.get(panel.channel_id);
        const message = channel ? await channel.messages.fetch(panel.message_id).catch(() => null) : null;
        if (message) await rerenderPanelMessage(message, panelId);
      } catch (err) {
        logger.warn(`[ticket] Auslastung aktualisieren: ${err.message}`);
      }
    }, 5000),
  );
}

/* ---------------- Ticket-Erstellung ---------------- */

function buildManagementRow(ticket) {
  const tg = i18n.forGuild(ticket.guild_id);
  const closed = ticket.status === 'closed';
  const claimed = Boolean(ticket.claimed_by);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(claimed ? 'ticket:unclaim' : 'ticket:claim')
      .setLabel(claimed ? tg('tickets.buttons.unclaim') : tg('tickets.buttons.claim'))
      .setEmoji('📌')
      .setStyle(claimed ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setLabel(tg('tickets.buttons.close'))
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId('ticket:reopen')
      .setLabel(tg('tickets.buttons.reopen'))
      .setEmoji('🔓')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!closed),
    new ButtonBuilder()
      .setCustomId('ticket:delete')
      .setLabel(tg('tickets.buttons.delete'))
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('ticket:closereq')
      .setLabel('Anfrage')
      .setEmoji('📨')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(closed),
  );
}

/**
 * Zeichnet eine bereits gepostete Panel-Nachricht neu.
 * Wird nach einer Auswahl im Dropdown aufgerufen, damit das Menü wieder
 * „Wähle eine Kategorie ..." anzeigt statt der zuletzt gewählten Option.
 */
async function rerenderPanelMessage(message, panelId) {
  if (!message) return;
  const panel = ticketPanels.getPanel(panelId);
  if (!panel) return;
  const categories = ticketPanels.listCategories(panelId).filter((c) => c.enabled !== 0);
  await message.edit(buildPanelMessage(panel, categories)).catch(() => null);
}

/**
 * Baut ein generisches Formular-Modal (max. 5 Felder – Discord-Limit).
 * Wird sowohl fürs Ticket-Öffnen-Formular einer Kategorie als auch für
 * andere Formular-Modals (z. B. Giveaway-Ticket-Buttons) verwendet.
 */
/** Wirksamer Feldtyp: Auswahl/Radio ohne (genug) Optionen fallen auf ein Textfeld zurück, damit Discord das Modal annimmt. */
function questionStyle(q) {
  const n = questionOptions(q).length;
  if (q.style === 'select' && n < 1) return 'short';
  if (q.style === 'radio' && n < 2) return 'short';
  return q.style || 'short';
}

const isTextQuestion = (q) => ['short', 'paragraph'].includes(questionStyle(q));

/** Optionen einer Auswahl/Radio-Frage als { label, value }-Liste (max. 25). */
function questionOptions(q) {
  return (Array.isArray(q.options) ? q.options : [])
    .map((o) => (typeof o === 'string' ? { label: o, value: o } : { label: o.label, value: o.value ?? o.label }))
    .filter((o) => o.label)
    .slice(0, 25)
    .map((o) => ({ label: String(o.label).slice(0, 100), value: String(o.value).slice(0, 100) }));
}

/** Baut ein Modal mit gemischten Feldtypen (Label-Komponenten). */
function buildRichModal(customId, title, questions) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(String(title).slice(0, 45));
  questions.slice(0, 5).forEach((q) => {
    const id = `q_${q.id}`;
    const label = new LabelBuilder().setLabel(String(q.label).slice(0, 45));
    if (q.description) label.setDescription(String(q.description).slice(0, 100));
    const required = Boolean(q.required);
    const placeholder = q.placeholder ? String(q.placeholder).slice(0, 100) : null;

    switch (questionStyle(q)) {
      case 'select': {
        const menu = new StringSelectMenuBuilder().setCustomId(id).setRequired(required).addOptions(questionOptions(q));
        if (placeholder) menu.setPlaceholder(placeholder);
        label.setStringSelectMenuComponent(menu);
        break;
      }
      case 'radio':
        label.setRadioGroupComponent(new RadioGroupBuilder().setCustomId(id).setRequired(required).addOptions(questionOptions(q).slice(0, 10)));
        break;
      case 'checkbox':
        label.setCheckboxComponent(new CheckboxBuilder().setCustomId(id));
        break;
      case 'user': {
        const menu = new UserSelectMenuBuilder().setCustomId(id).setRequired(required);
        if (placeholder) menu.setPlaceholder(placeholder);
        label.setUserSelectMenuComponent(menu);
        break;
      }
      case 'role': {
        const menu = new RoleSelectMenuBuilder().setCustomId(id).setRequired(required);
        if (placeholder) menu.setPlaceholder(placeholder);
        label.setRoleSelectMenuComponent(menu);
        break;
      }
      case 'channel': {
        const menu = new ChannelSelectMenuBuilder().setCustomId(id).setRequired(required);
        if (placeholder) menu.setPlaceholder(placeholder);
        label.setChannelSelectMenuComponent(menu);
        break;
      }
      case 'mentionable': {
        const menu = new MentionableSelectMenuBuilder().setCustomId(id).setRequired(required);
        if (placeholder) menu.setPlaceholder(placeholder);
        label.setMentionableSelectMenuComponent(menu);
        break;
      }
      default: {
        const input = new TextInputBuilder().setCustomId(id).setStyle(questionStyle(q) === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(required);
        if (placeholder) input.setPlaceholder(placeholder);
        if (q.min_length) input.setMinLength(Math.min(q.min_length, 1000));
        if (q.max_length) input.setMaxLength(Math.min(Math.max(q.max_length, 1), 4000));
        label.setTextInputComponent(input);
      }
    }
    modal.addLabelComponents(label);
  });
  return modal;
}

/**
 * Liest die Antworten eines abgeschickten Formular-Modals als [{ question, answer }].
 * `answer` ist immer ein lesbarer Text (Erwähnungen für Nutzer/Rollen/Kanäle).
 */
function readModalAnswers(fields, questions) {
  return questions.slice(0, 5).map((q) => {
    const id = `q_${q.id}`;
    let answer = '';
    let picked = [];
    try {
      switch (questionStyle(q)) {
        case 'select': picked = fields.getStringSelectValues(id); answer = picked.join(', '); break;
        case 'radio': answer = fields.getRadioGroup(id) || ''; picked = answer ? [answer] : []; break;
        case 'checkbox': answer = fields.getCheckbox(id) ? '✅ Ja' : '❌ Nein'; break;
        case 'user': answer = [...(fields.getSelectedUsers(id)?.values() ?? [])].map((u) => `<@${u.id}>`).join(' '); break;
        case 'role': answer = [...(fields.getSelectedRoles(id)?.values() ?? [])].map((r) => `<@&${r.id}>`).join(' '); break;
        case 'channel': answer = [...(fields.getSelectedChannels(id)?.values() ?? [])].map((c) => `<#${c.id}>`).join(' '); break;
        case 'mentionable': {
          const m = fields.getSelectedMentionables(id);
          answer = m ? [...m.users.values()].map((u) => `<@${u.id}>`).concat([...m.roles.values()].map((r) => `<@&${r.id}>`)).join(' ') : '';
          break;
        }
        default: answer = fields.getTextInputValue(id);
      }
    } catch {
      answer = '';
    }
    // Gewählte Optionen mit eigenem Embed (nur Ticket-Formulare haben optionEmbeds)
    const optionPicks = picked.filter((v) => q.optionEmbeds?.[v]).map((v) => ({ map: q.optionEmbeds, option: v }));
    const prices = picked.map((v) => q.optionPrices?.[v]).filter(Boolean);
    return { question: q.label, answer, optionPicks, prices, isQuantity: Boolean(q.is_quantity) };
  });
}

function buildQuestionsModal(customId, title, questions) {
  if (!questions.slice(0, 5).every(isTextQuestion)) return buildRichModal(customId, title, questions);
  const modal = new ModalBuilder().setCustomId(customId).setTitle(String(title).slice(0, 45));

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

/**
 * Baut das Formular-Modal für eine Ticket-Kategorie (max. 5 Felder – Discord-Limit).
 */
function buildTicketModal(category, questions) {
  return buildQuestionsModal(`ticket:form:${category.id}`, `Ticket: ${category.label}`, questions);
}

function fillPlaceholders(text, { member, guild, ticketNumber, category, prize, price }) {
  return String(text || '')
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{user.tag}', member.user.tag)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{guild}', guild.name)
    .replaceAll('{category}', category || '')
    .replaceAll('{prize}', prize || '')
    .replaceAll('{price}', price || '')
    .replaceAll('{number}', String(ticketNumber));
}

function renderWelcome(template, ctx) {
  return fillPlaceholders(template || config.defaults.ticketWelcome, ctx);
}

/** Kanalname aus einer Vorlage – unterstützt {…} und die Platzhalter %CASEID%, %PREFIX%, %USERNAME% … */
function renderChannelName(format, { member, number, cat }) {
  const pad = String(number).padStart(4, '0');
  const nick = member.nickname || member.user.username;
  const display = member.displayName || member.user.username;
  return (
    String(format)
      .replaceAll('{number}', pad)
      .replaceAll('%CASEID%', pad)
      .replaceAll('%PREFIX%', cat?.prefix || 'ticket')
      .replaceAll('{user}', member.user.username)
      .replaceAll('%USERNAME%', member.user.username)
      .replaceAll('%USER_ID%', member.id)
      .replaceAll('%USER_NICK_NAME%', nick)
      .replaceAll('%DISPLAY_NAME%', display)
      .replaceAll('{category}', cat?.label || 'ticket')
      .toLowerCase()
      .replace(/[^a-z0-9\-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90) || `ticket-${pad}`
  );
}

/**
 * Erstellt ein Ticket für ein Mitglied.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildMember} member
 * @param {object} [opts]
 * @param {number} [opts.categoryId]  ticket_categories.id (bestimmt Discord-Kategorie, Rolle, Text …)
 * @param {object} [opts.overrides]   Direkte Werte (z. B. aus Giveaway-Einstellungen), greifen zwischen Kategorie und Server-Standard
 * @param {string} [opts.overrides.discordCategoryId]
 * @param {string} [opts.overrides.supportRoleId]
 * @param {string} [opts.overrides.nameFormat]
 * @param {string} [opts.overrides.welcomeMessage]
 * @param {string} [opts.overrides.prize]  wird als {prize} im Begrüßungstext ersetzt und als Feld angezeigt
 * @returns {Promise<{ channel: import('discord.js').TextChannel, ticket: object }>}
 */
async function createTicket(guild, member, opts = {}) {
  const settings = settingsModel.get(guild.id);
  const tg = i18n.forGuild(guild.id);
  const ov = opts.overrides || {};

  if (settings.tickets_enabled === 0) {
    throw new Error(tg('tickets.errors.module_disabled'));
  }

  const cat = opts.categoryId ? ticketPanels.getCategory(opts.categoryId) : null;
  if (opts.categoryId && (!cat || cat.guild_id !== guild.id)) {
    throw new Error(tg('tickets.errors.category_gone'));
  }
  if (cat && cat.enabled === 0) {
    throw new Error(tg('tickets.errors.category_disabled'));
  }
  const panel = cat ? ticketPanels.getPanel(cat.panel_id) : null;
  const pcfg = ticketPanels.panelCfg(panel);
  const ccfg = ticketPanels.categoryCfg(cat);

  // Werte auflösen: Kategorie > Override (z. B. Giveaway-Einstellungen) > Server-Standard
  const discordCategoryId = cat?.discord_category_id || ov.discordCategoryId || settings.ticket_category_id;
  const supportRoleId = cat?.support_role_id || ov.supportRoleId || settings.ticket_support_role_id;
  const welcomeTemplate = cat?.welcome_message || ov.welcomeMessage || settings.ticket_welcome_message;
  const nameFormat =
    cat?.name_format ||
    pcfg.nameFormat ||
    (cat?.prefix ? `${cat.prefix}-{user}` : ov.nameFormat || settings.ticket_name_format || 'ticket-{user}');

  // Alle zuständigen Rollen: Haupt-Rolle + zusätzliche Rollen der Kategorie
  const roleIds = [
    ...new Set(
      [supportRoleId, ...String(ccfg.supportRoleIds || '').split(',').map((x) => x.trim())].filter(
        (id) => id && guild.roles.cache.has(id),
      ),
    ),
  ];

  if (!discordCategoryId) {
    throw new Error(tg('tickets.errors.no_discord_category'));
  }

  const discordCategory =
    guild.channels.cache.get(discordCategoryId) ??
    (await guild.channels.fetch(discordCategoryId).catch(() => null));
  if (!discordCategory || discordCategory.type !== ChannelType.GuildCategory) {
    throw new Error(tg('tickets.errors.discord_category_gone'));
  }

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
    throw new Error(tg('tickets.errors.bot_missing_manage_channels'));
  }

  const max = settings.ticket_max_per_user ?? 1;
  if (max > 0) {
    const open = ticketsModel.countOpenByUser(guild.id, member.id);
    if (open >= max) {
      throw new Error(tg('tickets.errors.max_open', { open, max }));
    }
  }

  // Auslastung der Kategorie (0 = unbegrenzt)
  if (cat && cat.max_open > 0 && ticketsModel.countOpenByCategory(cat.id) >= cat.max_open) {
    throw new Error('Diese Kategorie ist gerade ausgelastet. Bitte versuche es später erneut.');
  }

  const number = settingsModel.incrementTicketCounter(guild.id);
  const name = renderChannelName(nameFormat, { member, number, cat });

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

  for (const id of roleIds) overwrites.push({ id, allow: supportPerms });

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

  // Eröffnungs-Embed: Kategorie-Überschreibung > Panel-Embed > Standard
  const oe = ccfg.openEmbedOverride ? ccfg.openEmbed : pcfg.openEmbed;
  const answers = Array.isArray(opts.answers) ? opts.answers : [];
  const priced = priceUtil.compute(answers); // Menge × Optionspreis (null = Formular ohne Preise)
  const ctx = { member, guild, ticketNumber: number, category: cat?.label, prize: ov.prize, price: priced?.total };
  const answerText = (a) => (a.answer && a.answer.trim() ? a.answer : tg('common.no_answer'));
  const inEmbed = ccfg.answersInEmbed && answers.length > 0;
  let description = renderWelcome(oe.description || welcomeTemplate, ctx);
  if (inEmbed) {
    // Antworten nummeriert direkt unter die Begrüßung (Beschreibung max. 4096 Zeichen)
    const blocks = answers.slice(0, 24).map((a, i) => `**${i + 1}. ${String(a.question || tg('common.question')).slice(0, 256)}**\n${answerText(a).slice(0, 1024)}`);
    if (priced) blocks.push(`**${blocks.length + 1}. Preis**\n__**${priced.total}**__\n${priced.detail}`);
    description = `${description}\n\n${blocks.join('\n\n')}`;
  }
  const defaultTitle = cat ? tg('tickets.welcome.title_cat', { number, category: cat.label }) : tg('tickets.welcome.title', { number });
  const welcomeEmbed = new EmbedBuilder()
    .setColor(parseColor(oe.color) ?? panelColor(panel, settings))
    .setTitle((oe.title ? fillPlaceholders(oe.title, ctx) : defaultTitle).slice(0, 256))
    .setDescription(description.slice(0, 4096))
    .addFields(
      { name: tg('tickets.welcome.field_opener'), value: `<@${member.id}>`, inline: true },
      { name: tg('tickets.welcome.field_created'), value: discordTimestamp(Date.now(), 'F'), inline: true },
      ...(cat ? [{ name: tg('tickets.welcome.field_category'), value: cat.label, inline: true }] : []),
      ...(ov.prize ? [{ name: 'Preis', value: String(ov.prize).slice(0, 1024), inline: true }] : []),
    )
    .setTimestamp();
  if (/^https:\/\//i.test(oe.imageUrl || '')) welcomeEmbed.setImage(oe.imageUrl);
  if (/^https:\/\//i.test(oe.thumbnailUrl || '')) welcomeEmbed.setThumbnail(oe.thumbnailUrl);
  if (oe.footer) welcomeEmbed.setFooter({ text: fillPlaceholders(oe.footer, ctx).slice(0, 2048) });

  const pings = [`<@${member.id}>`];
  if (settings.ticket_team_ping !== 0) {
    for (const id of roleIds) pings.push(`<@&${id}>`);
    if (cat?.ping_role_id) pings.push(`<@&${cat.ping_role_id}>`);
  }

  await channel.send({
    content: pings.join(' • '),
    embeds: [welcomeEmbed],
    components: [buildManagementRow(ticket)],
  });

  // Formular-Antworten (falls die Kategorie ein Öffnen-Formular hat)
  if (answers.length) {
    if (!inEmbed) {
      const answerEmbed = new EmbedBuilder()
        .setColor(panelColor(panel, settings))
        .setTitle(tg('tickets.form.title'))
        .addFields([
          ...answers.slice(0, 24).map((a) => ({
            name: String(a.question || tg('common.question')).slice(0, 256),
            value: answerText(a).slice(0, 1024),
          })),
          ...(priced ? [{ name: 'Preis', value: `__**${priced.total}**__\n${priced.detail}` }] : []),
        ]);
      await channel.send({ embeds: [answerEmbed] }).catch(() => null);
    }

    // Eigene Embeds der gewählten Optionen (max. 10 Embeds pro Nachricht)
    const optionVars = { user: `<@${member.id}>`, username: member.user.username, guild: guild.name, server: guild.name, category: cat?.label ?? '', number: String(number), price: priced?.total ?? '' };
    const extra = answers
      .flatMap((a) => a.optionPicks ?? [])
      .map((p) => optionEmbeds.build(p.map, p.option, optionVars, panelColor(panel, settings)))
      .filter(Boolean);
    for (let i = 0; i < extra.length; i += 10) await channel.send({ embeds: extra.slice(i, i + 10) }).catch(() => null);
  }

  await ticketLog(ticket, {
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

  if (pcfg.showLoad && panel) scheduleLoadRefresh(guild, panel.id);

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
  const tg = i18n.forGuild(channel.guild.id);
  const ticket = ticketsModel.getByChannel(channel.id);
  if (!ticket) throw new Error(tg('tickets.errors.not_a_ticket'));
  if (ticket.claimed_by) throw new Error(tg('tickets.errors.already_claimed', { user: ticket.claimed_by }));

  const updated = ticketsModel.claim(ticket.id, member.id);
  await updateManagementMessage(channel, updated);

  // Übernommene Tickets ggf. in eine andere Discord-Kategorie verschieben
  const panel = ticket.panel_id ? ticketPanels.getPanel(ticket.panel_id) : null;
  if (claimCategoryOn(panel)) {
    await channel.setParent(panel.claim_category_id, { lockPermissions: false }).catch(() => null);
  }

  await channel
    .send({ embeds: [embeds.info(tg('tickets.claim.channel_title'), tg('tickets.claim.channel_desc', { user: member.id }))] })
    .catch(() => null);

  await ticketLog(ticket, {
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

async function unclaimTicket(channel, member) {
  const tg = i18n.forGuild(channel.guild.id);
  const ticket = ticketsModel.getByChannel(channel.id);
  if (!ticket) throw new Error(tg('tickets.errors.not_a_ticket'));
  if (!ticket.claimed_by) throw new Error(tg('tickets.errors.not_claimed'));

  const previousClaimer = ticket.claimed_by;
  const updated = ticketsModel.unclaim(ticket.id);
  await updateManagementMessage(channel, updated);

  // Falls beim Übernehmen verschoben wurde: zurück in die ursprüngliche Kategorie.
  const cat = ticket.category_id ? ticketPanels.getCategory(ticket.category_id) : null;
  const settings = settingsModel.get(channel.guild.id);
  const backCategoryId = cat?.discord_category_id || settings.ticket_category_id;
  const panel = ticket.panel_id ? ticketPanels.getPanel(ticket.panel_id) : null;
  if (claimCategoryOn(panel) && backCategoryId && channel.parentId === panel.claim_category_id) {
    await channel.setParent(backCategoryId, { lockPermissions: false }).catch(() => null);
  }

  await channel
    .send({ embeds: [embeds.warning(tg('tickets.unclaim.channel_title'), tg('tickets.unclaim.channel_desc', { user: member.id }))] })
    .catch(() => null);

  await ticketLog(ticket, {
    guildId: channel.guild.id,
    category: 'ticket',
    type: 'ticket_unclaim',
    title: '📌 Ticket freigegeben',
    fields: [
      { name: 'Ticket', value: `#${ticket.number}`, inline: true },
      { name: 'Freigegeben von', value: `<@${member.id}>`, inline: true },
      { name: 'Vorher übernommen von', value: `<@${previousClaimer}>`, inline: true },
    ],
    actorId: member.id,
    overrideChannelId: ticketLogOverride(ticket),
    meta: { ticketId: ticket.id },
  });
  return updated;
}

/** Kanalname eines Tickets ändern (Support/Manager). */
async function renameTicket(channel, member, rawName) {
  const tg = i18n.forGuild(channel.guild.id);
  const ticket = ticketsModel.getByChannel(channel.id);
  if (!ticket) throw new Error(tg('tickets.errors.not_a_ticket'));

  const clean = String(rawName || '')
    .toLowerCase()
    .replace(/[^a-z0-9\-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90);
  if (!clean) throw new Error(tg('tickets.errors.rename_invalid'));

  const oldName = channel.name;
  await channel.setName(clean).catch((err) => {
    throw new Error(tg('tickets.errors.rename_failed', { msg: err.message }));
  });

  await ticketLog(ticket, {
    guildId: channel.guild.id,
    category: 'ticket',
    type: 'ticket_rename',
    title: '✏️ Ticket umbenannt',
    fields: [
      { name: 'Ticket', value: `#${ticket.number}`, inline: true },
      { name: 'Von', value: `#${oldName}`, inline: true },
      { name: 'Zu', value: `#${clean}`, inline: true },
      { name: 'Durch', value: `<@${member.id}>`, inline: true },
    ],
    actorId: member.id,
    overrideChannelId: ticketLogOverride(ticket),
    meta: { ticketId: ticket.id },
  });
  return clean;
}

/** Einen weiteren Nutzer zum Ticket hinzufügen (Support/Manager). */
async function addMemberToTicket(channel, actor, targetUser) {
  const tg = i18n.forGuild(channel.guild.id);
  const ticket = ticketsModel.getByChannel(channel.id);
  if (!ticket) throw new Error(tg('tickets.errors.not_a_ticket'));

  await channel.permissionOverwrites
    .edit(targetUser.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true,
    })
    .catch((err) => {
      throw new Error(tg('tickets.errors.add_failed', { msg: err.message }));
    });

  await channel
    .send({ embeds: [embeds.success(tg('tickets.member.added_title'), tg('tickets.member.added_desc', { target: targetUser.id, actor: actor.id }))] })
    .catch(() => null);

  await ticketLog(ticket, {
    guildId: channel.guild.id,
    category: 'ticket',
    type: 'ticket_user_add',
    title: '➕ Nutzer zu Ticket hinzugefügt',
    fields: [
      { name: 'Ticket', value: `#${ticket.number}`, inline: true },
      { name: 'Nutzer', value: `<@${targetUser.id}>`, inline: true },
      { name: 'Durch', value: `<@${actor.id}>`, inline: true },
    ],
    actorId: actor.id,
    targetId: targetUser.id,
    overrideChannelId: ticketLogOverride(ticket),
    meta: { ticketId: ticket.id },
  });
}

/** Einen Nutzer wieder aus dem Ticket entfernen (Support/Manager). Der Ersteller kann nicht entfernt werden. */
async function removeMemberFromTicket(channel, actor, targetUser) {
  const tg = i18n.forGuild(channel.guild.id);
  const ticket = ticketsModel.getByChannel(channel.id);
  if (!ticket) throw new Error(tg('tickets.errors.not_a_ticket'));
  if (targetUser.id === ticket.opener_id) throw new Error(tg('tickets.errors.opener_not_removable'));

  await channel.permissionOverwrites.delete(targetUser.id, `Aus Ticket entfernt von ${actor.user.tag}`).catch((err) => {
    throw new Error(tg('tickets.errors.remove_failed', { msg: err.message }));
  });

  await channel
    .send({ embeds: [embeds.warning(tg('tickets.member.removed_title'), tg('tickets.member.removed_desc', { target: targetUser.id, actor: actor.id }))] })
    .catch(() => null);

  await ticketLog(ticket, {
    guildId: channel.guild.id,
    category: 'ticket',
    type: 'ticket_user_remove',
    title: '➖ Nutzer aus Ticket entfernt',
    fields: [
      { name: 'Ticket', value: `#${ticket.number}`, inline: true },
      { name: 'Nutzer', value: `<@${targetUser.id}>`, inline: true },
      { name: 'Durch', value: `<@${actor.id}>`, inline: true },
    ],
    actorId: actor.id,
    targetId: targetUser.id,
    overrideChannelId: ticketLogOverride(ticket),
    meta: { ticketId: ticket.id },
  });
}

/**
 * @param {import('discord.js').TextChannel} channel
 * @param {import('discord.js').GuildMember} member
 * @param {{ answers?: {question:string, answer:string}[] }} [opts]  Antworten des Schließen-Formulars
 */
async function closeTicket(channel, member, opts = {}) {
  const tg = i18n.forGuild(channel.guild.id);
  const ticket = ticketsModel.getByChannel(channel.id);
  if (!ticket) throw new Error(tg('tickets.errors.not_a_ticket'));
  if (ticket.status === 'closed') throw new Error(tg('tickets.errors.already_closed'));

  const updated = ticketsModel.close(ticket.id, member.id);
  ticketsModel.setCloseRequest(ticket.id, null);
  const closeAnswers = (Array.isArray(opts.answers) ? opts.answers : []).filter((a) => a.answer && a.answer.trim());
  if (closeAnswers.length) ticketsModel.setCloseAnswers(ticket.id, closeAnswers);
  const answerFields = closeAnswers.slice(0, 10).map((a) => ({
    name: String(a.question).slice(0, 256),
    value: String(a.answer).slice(0, 1024),
  }));

  // Ersteller darf nicht mehr schreiben, Kanal bleibt sichtbar.
  await channel.permissionOverwrites
    .edit(ticket.opener_id, { SendMessages: false })
    .catch(() => null);
  await channel
    .setName(`${ticket.application_id ? 'bewerbung-geschlossen' : 'geschlossen'}-${String(ticket.number).padStart(4, '0')}`)
    .catch(() => null);

  await updateManagementMessage(channel, updated);
  await channel
    .send({
      embeds: [
        embeds
          .warning(tg('tickets.close.channel_title'), tg('tickets.close.channel_desc', { user: member.id }))
          .addFields(answerFields),
      ],
    })
    .catch(() => null);

  await ticketLog(ticket, {
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
      ...answerFields,
    ].filter(Boolean),
    actorId: member.id,
    overrideChannelId: ticketLogOverride(ticket),
    meta: { ticketId: ticket.id },
  });

  // Transkript (wenn am Panel aktiviert)
  const closePanel = ticket.panel_id ? ticketPanels.getPanel(ticket.panel_id) : null;
  // Bewerber-Chats haben kein Panel: Transkript geht immer in den Bewerbungs-Log-Kanal (falls gesetzt)
  const wantTranscript = closePanel ? ticketPanels.panelCfg(closePanel).transcripts : Boolean(ticket.application_id);
  if (wantTranscript) {
    await require('./transcriptService')
      .send(channel, ticketsModel.get(ticket.id))
      .catch((err) => logger.warn(`[ticket] Transkript #${ticket.number}: ${err.message}`));
  }
  if (closePanel && ticketPanels.panelCfg(closePanel).showLoad) scheduleLoadRefresh(channel.guild, closePanel.id);

  await maybeRequestRating(channel, ticket).catch(() => null);
  if (ticket.is_modmail) {
    await require('./modmailService').notifyStateChange(ticket, 'close').catch(() => null);
  }
  return updated;
}

async function reopenTicket(channel, member) {
  const tg = i18n.forGuild(channel.guild.id);
  const ticket = ticketsModel.getByChannel(channel.id);
  if (!ticket) throw new Error(tg('tickets.errors.not_a_ticket'));
  if (ticket.status !== 'closed') throw new Error(tg('tickets.errors.not_closed'));

  const updated = ticketsModel.reopen(ticket.id);
  await channel.permissionOverwrites
    .edit(ticket.opener_id, { SendMessages: true, ViewChannel: true })
    .catch(() => null);
  await channel
    .setName(`${ticket.application_id ? 'bewerbung' : 'ticket'}-${String(ticket.number).padStart(4, '0')}`)
    .catch(() => null);

  await updateManagementMessage(channel, updated);
  await channel
    .send({ embeds: [embeds.success(tg('tickets.reopen.channel_title'), tg('tickets.reopen.channel_desc', { user: member.id }))] })
    .catch(() => null);

  await ticketLog(ticket, {
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
  if (ticket.is_modmail) {
    await require('./modmailService').notifyStateChange(ticket, 'reopen').catch(() => null);
  }
  return updated;
}

async function deleteTicket(channel, member) {
  const tg = i18n.forGuild(channel.guild.id);
  const ticket = ticketsModel.getByChannel(channel.id);
  if (!ticket) throw new Error(tg('tickets.errors.not_a_ticket'));

  ticketsModel.markDeleted(ticket.id, member.id);

  await ticketLog(ticket, {
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

  if (ticket.is_modmail) {
    await require('./modmailService').notifyStateChange(ticket, 'delete').catch(() => null);
  }

  await channel
    .send({ embeds: [embeds.error(tg('tickets.delete.channel_title'), tg('tickets.delete.channel_desc'))] })
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
  const tg = i18n.forGuild(channel.guild.id);
  await channel
    .send({
      embeds: [embeds.info(tg('tickets.rating.title'), tg('tickets.rating.desc'))],
      components: [row],
    })
    .catch(() => null);
}

/**
 * Verarbeitet eine Bewertung (Button "ticket:rate:<ticketId>:<stars>").
 */
async function submitRating(guild, ticketId, stars, member, answers = []) {
  const tg = i18n.forGuild(guild.id);
  const ticket = ticketsModel.get(ticketId);
  if (!ticket) throw new Error(tg('tickets.errors.no_ticket_found'));
  const panel = ticket.panel_id ? ticketPanels.getPanel(ticket.panel_id) : null;
  const pcfg = ticketPanels.panelCfg(panel);
  const form = (Array.isArray(answers) ? answers : []).filter((a) => a.answer && a.answer.trim());
  const formFields = form.slice(0, 10).map((a) => ({ name: String(a.question).slice(0, 256), value: String(a.answer).slice(0, 1024) }));

  const send = async (channelId, embed) => {
    if (!channelId) return;
    const ch = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
    if (ch?.isTextBased()) await ch.send({ embeds: [embed] }).catch(() => null);
  };

  // Team-Kanal: Angezeigte Werte laut Panel-Einstellung (Ersteller, Kategorie, Bearbeitungszeit)
  const teamEmbed = embeds
    .brand('⭐ Ticket-Bewertung', `${'⭐'.repeat(stars)} (${stars}/5)`)
    .addFields(
      { name: 'Ticket', value: `#${ticket.number}`, inline: true },
      ...(pcfg.ratingShow.includes('creator') ? [{ name: 'Ersteller', value: `<@${ticket.opener_id}>`, inline: true }] : []),
      ...(pcfg.ratingShow.includes('category') && ticket.category_label ? [{ name: 'Kategorie', value: ticket.category_label, inline: true }] : []),
      ...(pcfg.ratingShow.includes('time') && ticket.created_at
        ? [{ name: 'Bearbeitungszeit', value: formatDuration((ticket.closed_at || Date.now()) - ticket.created_at), inline: true }]
        : []),
      { name: 'Bewertet von', value: `<@${member.id}>`, inline: true },
      ...formFields,
    );
  await send(panel?.rating_channel_id || panel?.log_channel_id, teamEmbed);

  // Öffentlicher Kanal: nur Sterne und Kommentare, ohne Namen des Teams
  if (pcfg.ratingPublicChannelId) {
    const publicEmbed = embeds
      .brand('⭐ Neue Bewertung', `${'⭐'.repeat(stars)} (${stars}/5)`)
      .addFields(
        ...(pcfg.ratingShow.includes('category') && ticket.category_label ? [{ name: 'Kategorie', value: ticket.category_label, inline: true }] : []),
        ...(pcfg.ratingShow.includes('time') && ticket.created_at
          ? [{ name: 'Bearbeitungszeit', value: formatDuration((ticket.closed_at || Date.now()) - ticket.created_at), inline: true }]
          : []),
        ...formFields,
      );
    await send(pcfg.ratingPublicChannelId, publicEmbed);
  }
}

function formatDuration(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} Std. ${min % 60} Min.`;
  return `${Math.floor(h / 24)} Tage ${h % 24} Std.`;
}

/* ---------------- Automationen ---------------- */

const HOUR = 3600_000;

/**
 * Läuft jede Minute. Je Ticket (mit Panel) gelten die Automationen der Kategorie
 * (bei Überschreibung) oder des Panels:
 *  - Auto-Alert: erinnert den Ersteller nach Inaktivität
 *  - Ticket schließen, wenn der Ersteller nach dem Alert nicht reagiert
 *  - Auto-Team-Alert: erinnert das Teammitglied des Tickets, gibt es danach frei
 *  - Auto-Unclaim: gibt inaktive Tickets frei
 *  - Auto-Close: schließt Tickets nach Inaktivität
 */
async function autoCloseSweep() {
  const now = Date.now();
  // Mindestens 1 Stunde – kürzere Zeiten gibt es in den Einstellungen nicht.
  const candidates = ticketsModel.listStaleOpen(now - HOUR);
  for (const ticket of candidates) {
    try {
      await autoProcess(ticket, now);
    } catch (err) {
      logger.warn(`[ticket] Automation #${ticket.id}: ${err.message}`);
    }
  }
}

async function autoProcess(ticket, now) {
  const panel = ticketPanels.getPanel(ticket.panel_id);
  const cat = ticket.category_id ? ticketPanels.getCategory(ticket.category_id) : null;
  const a = ticketPanels.effectiveAuto(panel, cat);
  const any =
    a.autoClose.enabled || a.autoAlert.enabled || a.autoTeamAlert.enabled || a.autoUnclaim.enabled || a.closeUnresponsive.enabled;
  if (!any) return;

  const guild = client.guilds.cache.get(ticket.guild_id);
  if (!guild) return;
  const channel =
    guild.channels.cache.get(ticket.channel_id) ?? (await guild.channels.fetch(ticket.channel_id).catch(() => null));
  if (!channel) {
    ticketsModel.markDeleted(ticket.id, client.user.id);
    return;
  }
  const me = guild.members.me;
  const tg = i18n.forGuild(guild.id);
  const last = ticket.last_activity_at || ticket.created_at;
  const idle = now - last;

  // 1) Ersteller reagiert nach dem Alert nicht -> schließen
  if (a.closeUnresponsive.enabled && ticket.alerted_at && now - ticket.alerted_at >= a.closeUnresponsive.hours * HOUR) {
    await closeTicket(channel, me);
    await channel
      .send({ embeds: [embeds.warning('⏰ Automatisch geschlossen', `Der Ersteller hat auf die Erinnerung nicht geantwortet (${a.closeUnresponsive.hours} Std.).`)] })
      .catch(() => null);
    return;
  }

  // 2) Team-Alert -> danach automatisch freigeben
  if (ticket.claimed_by && a.autoTeamAlert.enabled) {
    const h = a.autoTeamAlert.hours * HOUR;
    if (ticket.team_alerted_at && now - ticket.team_alerted_at >= h) {
      await unclaimTicket(channel, me);
      ticketsModel.setTeamAlerted(ticket.id, null);
      return;
    }
    if (!ticket.team_alerted_at && idle >= h) {
      await channel
        .send({
          content: `<@${ticket.claimed_by}>`,
          embeds: [embeds.warning('⏰ Team-Erinnerung', `Dieses Ticket ist seit ${a.autoTeamAlert.hours} Std. inaktiv. Bitte kümmere dich darum – sonst wird es wieder freigegeben.`)],
          allowedMentions: { users: [ticket.claimed_by] },
        })
        .catch(() => null);
      ticketsModel.setTeamAlerted(ticket.id, now);
    }
  } else if (ticket.claimed_by && a.autoUnclaim.enabled && idle >= a.autoUnclaim.hours * HOUR) {
    // 3) Auto-Unclaim (nur wenn kein Team-Alert läuft)
    await unclaimTicket(channel, me);
    return;
  }

  // 4) Auto-Alert an den Ersteller
  if (a.autoAlert.enabled && !ticket.alerted_at && idle >= a.autoAlert.hours * HOUR) {
    await channel
      .send({
        content: `<@${ticket.opener_id}>`,
        embeds: [embeds.warning('⏰ Erinnerung', `Dieses Ticket ist seit ${a.autoAlert.hours} Std. inaktiv. Brauchst du noch Hilfe? Schreibe eine Nachricht, sonst wird es eventuell geschlossen.`)],
        allowedMentions: { users: [ticket.opener_id] },
      })
      .catch(() => null);
    ticketsModel.setAlerted(ticket.id, now);
  }

  // 5) Auto-Close nach Inaktivität
  if (a.autoClose.enabled && idle >= a.autoClose.hours * HOUR) {
    await closeTicket(channel, me);
    await channel
      .send({ embeds: [embeds.warning(tg('tickets.close.auto_title'), tg('tickets.close.auto_desc', { hours: a.autoClose.hours }))] })
      .catch(() => null);
  }
}

/* ---------------- Close-Request ---------------- */

/** Das Team fragt den Ersteller, ob das Ticket geschlossen werden kann. */
async function requestClose(channel, member) {
  const ticket = ticketsModel.getByChannel(channel.id);
  if (!ticket) throw new Error(i18n.forGuild(channel.guild.id)('tickets.errors.not_a_ticket'));
  if (ticket.status !== 'open') throw new Error('Das Ticket ist nicht offen.');

  ticketsModel.setCloseRequest(ticket.id, member.id);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket:closereq:accept:${ticket.id}`).setLabel('Ja, schließen').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ticket:closereq:decline:${ticket.id}`).setLabel('Nein, offen lassen').setEmoji('❌').setStyle(ButtonStyle.Secondary),
  );
  await channel.send({
    content: `<@${ticket.opener_id}>`,
    embeds: [embeds.info('🔒 Kann dieses Ticket geschlossen werden?', `<@${member.id}> möchte dieses Ticket schließen. Ist dein Anliegen gelöst?`)],
    components: [row],
    allowedMentions: { users: [ticket.opener_id] },
  });
  await ticketLog(ticket, {
    guildId: channel.guild.id,
    category: 'ticket',
    type: 'ticket_close_request',
    title: '🔒 Close-Request gesendet',
    fields: [
      { name: 'Ticket', value: `#${ticket.number}`, inline: true },
      { name: 'Angefragt von', value: `<@${member.id}>`, inline: true },
    ],
    actorId: member.id,
    overrideChannelId: ticketLogOverride(ticket),
    meta: { ticketId: ticket.id },
  });
}

/** Antwort auf eine Close-Request: schließt das Ticket (wenn „nach Close-Request schließen“ aktiv ist) oder meldet die Zustimmung. */
async function answerCloseRequest(channel, member, accept) {
  const ticket = ticketsModel.getByChannel(channel.id);
  if (!ticket || ticket.status !== 'open' || !ticket.close_request_by) throw new Error('Es gibt keine offene Close-Request.');
  ticketsModel.setCloseRequest(ticket.id, null);

  if (!accept) {
    await channel.send({ embeds: [embeds.info('❌ Close-Request abgelehnt', `<@${member.id}> möchte, dass das Ticket offen bleibt.`)] }).catch(() => null);
    return 'declined';
  }
  const panel = ticket.panel_id ? ticketPanels.getPanel(ticket.panel_id) : null;
  const cat = ticket.category_id ? ticketPanels.getCategory(ticket.category_id) : null;
  if (ticketPanels.effectiveAuto(panel, cat).closeAfterRequest) {
    await closeTicket(channel, member);
    return 'closed';
  }
  await channel
    .send({ embeds: [embeds.success('✅ Close-Request angenommen', `<@${member.id}> stimmt zu – das Team kann das Ticket jetzt schließen.`)] })
    .catch(() => null);
  return 'accepted';
}

/* ---------------- Ticket im Auftrag eines Nutzers ---------------- */

/** Rollen-IDs, die für eine Kategorie zuständig sind (Haupt-Rolle + zusätzliche). */
function categoryRoleIds(cat) {
  return [cat.support_role_id, ...String(ticketPanels.categoryCfg(cat).supportRoleIds || '').split(',')]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
}

/** Kategorien, in denen dieses Mitglied Tickets im Auftrag anderer öffnen darf. */
function onBehalfCategories(guildId, member, settings) {
  const out = [];
  for (const p of ticketPanels.listPanels(guildId)) {
    for (const c of ticketPanels.listCategories(p.id)) {
      if (c.enabled === 0 || !ticketPanels.categoryCfg(c).onBehalf) continue;
      const allowed = isSupport(member, settings) || categoryRoleIds(c).some((id) => member.roles.cache.has(id));
      if (allowed) out.push({ id: c.id, label: c.label, panel: p.name });
    }
  }
  return out;
}

async function openOnBehalf(guild, staff, targetUser, categoryId) {
  const settings = settingsModel.get(guild.id);
  const allowed = onBehalfCategories(guild.id, staff, settings).some((c) => c.id === categoryId);
  if (!allowed) throw new Error('Für diese Kategorie darfst du keine Tickets im Auftrag öffnen.');
  const target = await guild.members.fetch(targetUser.id).catch(() => null);
  if (!target) throw new Error('Das Mitglied ist nicht auf diesem Server.');
  const { channel, ticket } = await createTicket(guild, target, { categoryId });
  await channel
    .send({ embeds: [embeds.info('📝 Im Auftrag erstellt', `Dieses Ticket wurde von <@${staff.id}> für <@${target.id}> geöffnet.`)] })
    .catch(() => null);
  return { channel, ticket };
}

module.exports = {
  buildPanelMessage,
  buildQuestionsModal,
  readModalAnswers,
  closePermissionError,
  closeFormQuestions,
  scheduleLoadRefresh,
  postOrUpdatePanel,
  createTicket,
  claimTicket,
  unclaimTicket,
  renameTicket,
  addMemberToTicket,
  removeMemberFromTicket,
  closeTicket,
  reopenTicket,
  deleteTicket,
  buildManagementRow,
  buildTicketModal,
  submitRating,
  autoCloseSweep,
  requestClose,
  answerCloseRequest,
  onBehalfCategories,
  openOnBehalf,
  rerenderPanelMessage,
};
