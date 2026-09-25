'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  StringSelectMenuBuilder,
} = require('discord.js');
const client = require('../core/client');
const appModel = require('../database/models/applications');
const ticketsModel = require('../database/models/tickets');
const settingsModel = require('../database/models/settings');
const logService = require('./logService');
const embeds = require('../utils/embeds');
const config = require('../../config/config');
const { botCanManageRole } = require('../utils/permissions');
const logger = require('../utils/logger');

/**
 * Bewerbungssystem (Appy-Aufbau): Panels, Anforderungen, Einreichung, Entscheidung, Bewerber-Chat.
 * Ausgefüllt wird per Direktnachricht (siehe applicationFlowService) – beliebig viele Fragen.
 */

const METHOD_LABEL = { modal: 'Discord-Fenster', dm: 'Direktnachricht', web: 'Webseite' };

/* ---------------- Hilfen ---------------- */

const idsOf = (csv) => String(csv || '').split(',').map((s) => s.trim()).filter(Boolean);

async function fetchChannel(guild, id) {
  if (!id) return null;
  return guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
}

function parseColor(hex) {
  const m = String(hex || '').match(/^#?([0-9a-fA-F]{6})$/);
  return m ? parseInt(m[1], 16) : null;
}

const validEmoji = (e) => /^(\p{Extended_Pictographic}|<a?:\w+:\d+>)/u.test(String(e || ''));

function fillTemplate(text, vars) {
  let out = String(text || '');
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v ?? '');
  return out;
}

/** Eigene Gestaltung einer Bewerbung (cfg.embeds[key]) auf ein Embed anwenden; leere Felder = Standard. */
function styleEmbed(embed, style, vars) {
  if (!style) return embed;
  if (style.title) embed.setTitle(fillTemplate(style.title, vars).slice(0, 256));
  const color = parseColor(style.color);
  if (color !== null) embed.setColor(color);
  if (style.imageUrl) embed.setImage(style.imageUrl);
  if (style.thumbnailUrl) embed.setThumbnail(style.thumbnailUrl);
  if (style.footer) embed.setFooter({ text: fillTemplate(style.footer, vars).slice(0, 2048) });
  return embed;
}

function formatDuration(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} Sek.`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} Min. ${s % 60} Sek.`;
  return `${Math.floor(m / 60)} Std. ${m % 60} Min.`;
}

function statusLabel(status) {
  return { pending: '🕓 Offen', accepted: '✅ Angenommen', rejected: '❌ Abgelehnt' }[status] ?? status;
}

/* ---------------- Panel ---------------- */

/** Panel-Nachricht: Embed + Buttons (je Bewerbung ein Button) oder ein Auswahlmenü. */
function buildPanelMessage(panel, types) {
  const cfg = appModel.panelCfg(panel);
  const embed = new EmbedBuilder()
    .setColor(parseColor(cfg.color) ?? config.branding.color)
    .setTitle(cfg.title || config.defaults.applicationPanelTitle)
    .setDescription(cfg.description || config.defaults.applicationPanelMessage);
  if (cfg.footer) embed.setFooter({ text: cfg.footer });
  if (cfg.imageUrl) embed.setImage(cfg.imageUrl);
  if (cfg.thumbnailUrl) embed.setThumbnail(cfg.thumbnailUrl);

  if (panel.panel_type === 'select') {
    const rows = [];
    for (let i = 0; i < types.length && rows.length < 5; i += 25) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`app:pick:${rows.length}`)
            .setPlaceholder(types.length > 25 ? `Wähle eine Bewerbung … (${rows.length + 1})` : 'Wähle eine Bewerbung …')
            .addOptions(
              types.slice(i, i + 25).map((t) => ({
                label: t.name.slice(0, 100),
                value: String(t.id),
                ...(t.description ? { description: t.description.slice(0, 100) } : {}),
                ...(validEmoji(t.emoji) ? { emoji: t.emoji } : {}),
              })),
            ),
        ),
      );
    }
    return { embeds: [embed], components: rows };
  }

  const rows = [];
  let current = new ActionRowBuilder();
  types.forEach((t, i) => {
    if (i > 0 && i % 5 === 0) {
      rows.push(current);
      current = new ActionRowBuilder();
    }
    current.addComponents(
      new ButtonBuilder()
        .setCustomId(`app:start:${t.id}`)
        .setLabel(t.name.slice(0, 80))
        .setEmoji(validEmoji(t.emoji) ? t.emoji : '📋')
        .setStyle(ButtonStyle.Secondary),
    );
  });
  if (current.components.length) rows.push(current);
  return { embeds: [embed], components: rows };
}

/** Panel senden bzw. die vorhandene Nachricht aktualisieren. */
async function sendPanel(guild, panel) {
  if (!panel.channel_id) throw new Error('Bitte zuerst einen Kanal für das Panel wählen.');
  const types = appModel
    .panelTypeIds(panel)
    .map((id) => appModel.getType(id))
    .filter((t) => t && t.guild_id === guild.id && t.enabled);
  if (!types.length) throw new Error('Verknüpfe mindestens eine (offene) Bewerbung mit dem Panel.');

  const channel = await fetchChannel(guild, panel.channel_id);
  if (!channel || !channel.isTextBased()) throw new Error('Panel-Kanal nicht gefunden oder kein Textkanal.');

  const payload = buildPanelMessage(panel, types);
  if (panel.message_id) {
    const existing = await channel.messages.fetch(panel.message_id).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      return existing;
    }
  }
  const message = await channel.send(payload);
  appModel.updatePanel(panel.id, { message_id: message.id });
  return message;
}

/** Zeichnet die Panel-Nachricht neu (setzt ein Auswahlmenü zurück). */
async function refreshPanelMessage(message) {
  const panel = message ? appModel.getPanelByMessage(message.id) : null;
  if (!panel) return;
  const types = appModel.panelTypeIds(panel).map((id) => appModel.getType(id)).filter((t) => t && t.enabled);
  if (types.length) await message.edit(buildPanelMessage(panel, types)).catch(() => null);
}

/* ---------------- Anforderungen & Start ---------------- */

/** Liefert eine Fehlermeldung, wenn das Mitglied sich (jetzt) nicht bewerben darf – sonst null. */
function eligibilityError(member, type, settings) {
  const cfg = appModel.typeCfg(type);
  if (!settings?.application_enabled) return 'Das Bewerbungssystem ist auf diesem Server derzeit deaktiviert.';
  if (!type || type.guild_id !== member.guild.id) return 'Diese Bewerbung existiert nicht (mehr).';
  if (!type.enabled) return 'Diese Bewerbung ist derzeit geschlossen.';
  const questions = appModel.listQuestions(type.id);
  if (!questions.length) return 'Für diese Bewerbung wurden noch keine Fragen konfiguriert.';

  const restricted = idsOf(cfg.restrictedRoleIds);
  if (restricted.length) {
    const has = restricted.map((id) => member.roles.cache.has(id));
    if (cfg.restrictedMode === 'any' ? has.some(Boolean) : has.every(Boolean)) {
      return 'Du darfst dich auf diese Bewerbung nicht bewerben.';
    }
  }
  const required = idsOf(cfg.requiredRoleIds);
  if (required.length) {
    const has = required.map((id) => member.roles.cache.has(id));
    if (!(cfg.requiredMode === 'any' ? has.some(Boolean) : has.every(Boolean))) {
      return 'Dir fehlt eine Rolle, die für diese Bewerbung nötig ist.';
    }
  }

  if (appModel.hasPending(member.guild.id, member.id, type.id)) {
    return 'Du hast bereits eine offene Bewerbung für diese Position.';
  }
  if (cfg.cooldownMin > 0) {
    const last = appModel.lastSubmissionAt(member.guild.id, member.id, type.id);
    const until = last ? last + cfg.cooldownMin * 60_000 : 0;
    if (until > Date.now()) return `Du kannst dich erst wieder <t:${Math.ceil(until / 1000)}:R> auf diese Bewerbung bewerben.`;
  }
  return null;
}

/**
 * Startet eine Bewerbung (Button, Auswahlmenü oder /apply).
 * Zeigt eine Bestätigung mit „Starten“ – danach stellt der Bot die Fragen per Direktnachricht.
 */
async function beginApplication(interaction, typeId) {
  const type = appModel.getType(typeId);
  const settings = interaction.settings ?? settingsModel.get(interaction.guildId);
  const reply = (embed, components = []) => interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });

  if (!interaction.guild || !interaction.member) return reply(embeds.error(undefined, 'Bewerbungen sind nur auf einem Server möglich.'));
  const problem = eligibilityError(interaction.member, type, settings);
  if (problem) return reply(embeds.warning('Bewerbung nicht möglich', problem));
  if (appModel.getSessionByUser(interaction.user.id)) {
    return reply(embeds.warning('Bewerbung läuft bereits', 'Du hast schon eine Bewerbung per Direktnachricht begonnen. Schließe sie ab oder schreibe mir `abbrechen`.'));
  }

  const cfg = appModel.typeCfg(type);
  const text =
    cfg.confirmationMessage ||
    `Möchtest du dich auf **${type.name}** bewerben?\n\nNach dem Start schicke ich dir eine Reihe von Fragen per Direktnachricht. ` +
      `Du hast **${formatDuration(cfg.timeLimitMin * 60_000)}** Zeit, sie zu beantworten. Mit dem Button unten (oder \`abbrechen\`) kannst du jederzeit stoppen.`;
  const vars = { applicationName: type.name, applicant: `<@${interaction.user.id}>`, server: interaction.guild.name };
  return reply(
    styleEmbed(embeds.info(`📋 Bewerbung: ${type.name}`, fillTemplate(text, vars)), cfg.embeds.confirmation, vars),
    [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`app:begin:${type.id}`).setLabel('Starten').setEmoji('▶️').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('app:cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
      ),
    ],
  );
}

/* ---------------- Einreichung ---------------- */

/** Antworten -> Embed-Felder, in Blöcke geteilt (Discord: max. 6000 Zeichen je Nachricht). */
function chunkAnswers(answers, budget) {
  const chunks = [[]];
  let used = 0;
  for (const a of answers) {
    const name = String(a.question).slice(0, 256);
    const value = (a.answer && String(a.answer).trim() ? String(a.answer) : '*(keine Angabe)*').slice(0, 1024);
    if (chunks.at(-1).length >= 20 || (used + name.length + value.length > budget && chunks.at(-1).length)) {
      chunks.push([]);
      used = 0;
    }
    chunks.at(-1).push({ name, value });
    used += name.length + value.length;
  }
  return chunks;
}

/** Weitere Antwort-Embeds, wenn nicht alles in die Hauptnachricht passt. */
function overflowEmbeds(application, answers, hide) {
  if (hide) return [];
  return chunkAnswers(answers, 3500)
    .slice(1)
    .map((fields, i) => new EmbedBuilder().setColor(config.branding.color).setTitle(`Antworten (Teil ${i + 2}) – Bewerbung #${application.id}`).addFields(fields));
}

function buildReviewMessage(application, answers, type) {
  const cfg = appModel.typeCfg(type ?? (application.type_id ? appModel.getType(application.type_id) : null));
  const embed = new EmbedBuilder()
    .setColor(
      application.status === 'accepted' ? config.branding.success : application.status === 'rejected' ? config.branding.danger : config.branding.color,
    )
    .setTitle(`📋 Bewerbung #${application.id} – ${application.type_name}`)
    .setDescription(`**Bewerber:** <@${application.user_id}> (${application.user_tag ?? application.user_id})`)
    .setFooter({ text: `Status: ${statusLabel(application.status)}` })
    .setTimestamp(application.created_at);

  if (cfg.hideAnswers) {
    embed.addFields({ name: 'Antworten', value: '🔒 Ausgeblendet – nur im Dashboard einsehbar.' });
  } else {
    embed.addFields(chunkAnswers(answers, 3500)[0]);
  }
  if (cfg.showStats) {
    embed.addFields(
      { name: 'Methode', value: METHOD_LABEL[application.source] ?? '–', inline: true },
      { name: 'Ausfüllzeit', value: application.duration_ms ? formatDuration(application.duration_ms) : '–', inline: true },
    );
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`app:accept:${application.id}`).setLabel('Annehmen').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(application.status !== 'pending'),
    new ButtonBuilder().setCustomId(`app:reject:${application.id}`).setLabel('Ablehnen').setEmoji('❌').setStyle(ButtonStyle.Danger).setDisabled(application.status !== 'pending'),
    new ButtonBuilder().setCustomId(`app:chat:${application.id}`).setLabel('Chat').setEmoji('💬').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

/** Rollen hinzufügen/entfernen; liefert Hinweise zu Fehlschlägen. */
async function applyRoles(guild, member, addCsv, removeCsv, reason) {
  const notes = [];
  const run = async (csv, action) => {
    for (const id of idsOf(csv)) {
      const role = guild.roles.cache.get(id) ?? (await guild.roles.fetch(id).catch(() => null));
      const can = botCanManageRole(guild, role);
      if (!role || !can.ok) {
        notes.push(`⚠️ Rolle ${role ? `**${role.name}**` : id}: ${can.reason}`);
        continue;
      }
      await member.roles[action](role, reason).catch((err) => notes.push(`⚠️ Rolle **${role.name}**: ${err.message}`));
    }
  };
  await run(addCsv, 'add');
  await run(removeCsv, 'remove');
  return notes;
}

/**
 * Speichert eine eingereichte Bewerbung und postet sie in den Bewerbungs-Kanal.
 * @param {object} user  { id, tag }
 * @param {{source?: 'dm'|'web', durationMs?: number}} [opts]
 */
async function submitApplication(guild, user, type, answers, opts = {}) {
  const settings = settingsModel.get(guild.id);
  const cfg = appModel.typeCfg(type);

  const application = appModel.createApplication({
    guildId: guild.id,
    typeId: type.id,
    typeName: type.name,
    userId: user.id,
    userTag: user.tag,
    answers,
    durationMs: opts.durationMs,
    source: opts.source ?? 'dm',
  });

  const channel = await fetchChannel(guild, cfg.pendingChannelId || settings.application_channel_id);
  let message = null;
  if (channel && channel.isTextBased()) {
    const payload = buildReviewMessage(application, answers, type);
    const pings = idsOf(cfg.pingRoleIds);
    if (!pings.length && settings.application_team_role_id) pings.push(settings.application_team_role_id);
    if (pings.length) payload.content = pings.map((id) => `<@&${id}>`).join(' ');
    message = await channel.send(payload).catch(() => null);
    if (message) {
      appModel.setApplicationMessage(application.id, channel.id, message.id);
      for (const e of overflowEmbeds(application, answers, cfg.hideAnswers)) await channel.send({ embeds: [e] }).catch(() => null);
      if (cfg.staffThreads) {
        const thread = await message
          .startThread({ name: `Bewerbung #${application.id} – ${user.tag ?? user.id}`.slice(0, 100), autoArchiveDuration: 1440 })
          .catch(() => null);
        if (thread) appModel.setThread(application.id, thread.id);
      }
    }
  }

  // Rollen beim Einreichen (Wartet-Rollen geben, andere entfernen)
  if (cfg.pendingRoleIds || cfg.submitRemovalRoleIds) {
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (member) await applyRoles(guild, member, cfg.pendingRoleIds, cfg.submitRemovalRoleIds, `Bewerbung #${application.id} eingereicht`);
  }

  await logService.log({
    guildId: guild.id,
    category: 'application',
    type: 'application_create',
    title: '📋 Bewerbung erstellt',
    color: config.branding.color,
    fields: [
      { name: 'Bewerbung', value: `#${application.id} – ${type.name}`, inline: true },
      { name: 'Bewerber', value: `<@${user.id}>`, inline: true },
    ],
    actorId: user.id,
    meta: { applicationId: application.id, typeId: type.id },
  });

  if (type.auto_chat) {
    await openChat(guild, application, null).catch((err) => logger.warn(`[application] Auto-Chat für #${application.id}: ${err.message}`));
  }
  return application;
}

/* ---------------- Entscheidung ---------------- */

/**
 * Nimmt eine Bewerbung an oder lehnt sie ab (Nachrichten, Kanäle und Rollen aus den Einstellungen der Bewerbung).
 * @param {'accepted'|'rejected'} decision
 */
async function reviewApplication(guild, applicationId, reviewer, decision, note) {
  const application = appModel.getApplication(applicationId);
  if (!application) throw new Error('Bewerbung nicht gefunden.');
  if (application.status !== 'pending') throw new Error(`Diese Bewerbung wurde bereits bearbeitet (${statusLabel(application.status)}).`);

  const type = application.type_id ? appModel.getType(application.type_id) : null;
  const cfg = appModel.typeCfg(type);
  const accepted = decision === 'accepted';
  const updated = appModel.reviewApplication(applicationId, { status: decision, reviewerId: reviewer.id, note });
  const answers = JSON.parse(updated.answers_json || '[]');

  // Nachricht aktualisieren – bei eigenem Annahme-/Ablehn-Kanal dorthin verschieben
  const payload = buildReviewMessage(updated, answers, type);
  payload.content = `Bearbeitet von <@${reviewer.id}> • ${statusLabel(decision)}`;
  const oldChannel = await fetchChannel(guild, updated.channel_id);
  const oldMessage = oldChannel && updated.message_id ? await oldChannel.messages.fetch(updated.message_id).catch(() => null) : null;
  const targetId = accepted ? cfg.acceptedChannelId : cfg.deniedChannelId;
  const target = targetId && targetId !== updated.channel_id ? await fetchChannel(guild, targetId) : null;
  if (target && target.isTextBased()) {
    const moved = await target.send(payload).catch(() => null);
    if (moved) {
      appModel.setApplicationMessage(applicationId, target.id, moved.id);
      await oldMessage?.delete().catch(() => null);
    } else {
      await oldMessage?.edit(payload).catch(() => null);
    }
  } else {
    await oldMessage?.edit(payload).catch(() => null);
  }

  // Rollen
  let roleNote = '';
  const member = await guild.members.fetch(updated.user_id).catch(() => null);
  if (member) {
    const notes = await applyRoles(
      guild,
      member,
      accepted ? cfg.acceptedRoleIds : cfg.deniedRoleIds,
      [accepted ? cfg.acceptedRemovalRoleIds : cfg.deniedRemovalRoleIds, cfg.pendingRoleIds].filter(Boolean).join(','),
      `Bewerbung #${applicationId} ${accepted ? 'angenommen' : 'abgelehnt'}`,
    );
    const given = idsOf(accepted ? cfg.acceptedRoleIds : cfg.deniedRoleIds);
    roleNote = notes.length ? `\n${notes.join('\n')}` : given.length ? `\n✅ Rolle(n) vergeben: ${given.map((id) => `<@&${id}>`).join(' ')}` : '';
  }

  // Bewerber per DM informieren
  if (member) {
    const vars = { applicationName: updated.type_name ?? '', user: `<@${reviewer.id}>`, applicant: `<@${updated.user_id}>`, server: guild.name, note: note ?? '' };
    const body = fillTemplate(accepted ? cfg.acceptedMessage : cfg.deniedMessage, vars) + (note ? `\n\n**Nachricht vom Team:** ${note}` : '');
    const dm = accepted ? embeds.success('✅ Bewerbung angenommen', body) : embeds.error('❌ Bewerbung abgelehnt', body);
    dm.setFooter({ text: guild.name });
    styleEmbed(dm, accepted ? cfg.embeds.accepted : cfg.embeds.denied, vars);
    await member.send({ embeds: [dm] }).catch(() => null);
  }

  // Ist ein Chat offen, das Ergebnis dort festhalten
  const chat = ticketsModel.getActiveByApplication(applicationId);
  if (chat?.status === 'open') {
    const chatChannel = await fetchChannel(guild, chat.channel_id);
    await chatChannel
      ?.send({
        embeds: [
          (accepted
            ? embeds.success('✅ Bewerbung angenommen', `<@${reviewer.id}> hat die Bewerbung angenommen.`)
            : embeds.error('❌ Bewerbung abgelehnt', `<@${reviewer.id}> hat die Bewerbung abgelehnt.`)
          ).addFields(note ? [{ name: 'Nachricht vom Team', value: note.slice(0, 1024) }] : []),
        ],
      })
      .catch(() => null);
  }

  await logService.log({
    guildId: guild.id,
    category: 'application',
    type: accepted ? 'application_accept' : 'application_reject',
    title: accepted ? '✅ Bewerbung angenommen' : '❌ Bewerbung abgelehnt',
    color: accepted ? config.branding.success : config.branding.danger,
    fields: [
      { name: 'Bewerbung', value: `#${applicationId} – ${updated.type_name}`, inline: true },
      { name: 'Bewerber', value: `<@${updated.user_id}>`, inline: true },
      { name: 'Bearbeiter', value: `<@${reviewer.id}>`, inline: true },
      note ? { name: 'Notiz', value: note.slice(0, 1024), inline: false } : null,
    ].filter(Boolean),
    actorId: reviewer.id,
    meta: { applicationId, decision },
  });

  return { application: updated, roleNote };
}

/** Bewerbung samt Nachricht löschen. */
async function deleteSubmission(guild, application) {
  const channel = await fetchChannel(guild, application.channel_id);
  if (channel && application.message_id) await channel.messages.delete(application.message_id).catch(() => null);
  appModel.deleteApplication(application.id);
}

/** Bewerber verlässt den Server: offene Bewerbungen nach der Einstellung „Aktion beim Verlassen“ behandeln. */
async function onMemberLeave(member) {
  const session = appModel.getSessionByUser(member.id);
  if (session && session.guild_id === member.guild.id) appModel.deleteSession(session.id);

  for (const application of appModel.listPendingByUser(member.guild.id, member.id)) {
    const type = application.type_id ? appModel.getType(application.type_id) : null;
    const action = appModel.typeCfg(type).onLeave;
    if (action === 'deny') {
      await reviewApplication(member.guild, application.id, { id: client.user.id, tag: client.user.tag }, 'rejected', 'Der Bewerber hat den Server verlassen.').catch((err) =>
        logger.warn(`[application] onLeave deny #${application.id}: ${err.message}`),
      );
    } else if (action === 'delete') {
      await deleteSubmission(member.guild, application).catch((err) => logger.warn(`[application] onLeave delete #${application.id}: ${err.message}`));
    }
  }
}

/* ---------------- Bewerber-Chat ---------------- */

const CHAT_PERMS = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.ReadMessageHistory,
  PermissionsBitField.Flags.AttachFiles,
  PermissionsBitField.Flags.EmbedLinks,
];

function chatChannelName(user) {
  const base = String(user.username ?? user.tag ?? user.id)
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `bewerbung-${base || user.id}`;
}

/** Discord-Kategorie für Bewerber-Chats: Bewerbung > Server-Standard > keine (oberste Ebene). */
function chatCategoryId(type, settings) {
  return type?.chat_category_id || settings.application_chat_category_id || null;
}

/**
 * Öffnet einen privaten Chat (Ticket) zwischen Team und Bewerber.
 * Existiert bereits ein Chat, wird er wiederverwendet (ein geschlossener wird wieder geöffnet).
 * @param {{id:string}|null} staff  Teammitglied, das den Chat öffnet (null = automatisch bei Eingang)
 * @returns {Promise<{ channel, ticket, created: boolean }>}
 */
async function openChat(guild, application, staff) {
  const settings = settingsModel.get(guild.id);
  const embedColor = config.branding.color;

  const existing = ticketsModel.getActiveByApplication(application.id);
  if (existing) {
    const channel = await fetchChannel(guild, existing.channel_id);
    if (channel) {
      if (existing.status === 'closed') {
        await require('./ticketService').reopenTicket(channel, { id: staff?.id ?? client.user?.id });
      }
      return { channel, ticket: ticketsModel.get(existing.id), created: false };
    }
    ticketsModel.markDeleted(existing.id, staff?.id ?? client.user?.id); // Kanal wurde manuell gelöscht
  }

  const member = await guild.members.fetch(application.user_id).catch(() => null);
  if (!member) throw new Error('Der Bewerber ist nicht (mehr) auf diesem Server.');

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
    throw new Error('Dem Bot fehlt die Berechtigung „Kanäle verwalten“.');
  }

  const type = application.type_id ? appModel.getType(application.type_id) : null;
  const parentId = chatCategoryId(type, settings);
  let parent = null;
  if (parentId) {
    parent = await fetchChannel(guild, parentId);
    if (!parent || parent.type !== ChannelType.GuildCategory) {
      throw new Error('Die eingestellte Kategorie für Bewerber-Chats existiert nicht mehr.');
    }
  }

  const teamRoleIds = [...new Set([settings.application_team_role_id, ...idsOf(appModel.typeCfg(type).managerRoleIds)].filter((id) => id && guild.roles.cache.has(id)))];
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: member.id, allow: CHAT_PERMS },
    { id: me.id, allow: [...CHAT_PERMS, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageMessages] },
    ...teamRoleIds.map((id) => ({ id, allow: CHAT_PERMS })),
  ];

  const channel = await guild.channels.create({
    name: chatChannelName(member.user),
    type: ChannelType.GuildText,
    ...(parent ? { parent: parent.id } : {}),
    permissionOverwrites: overwrites,
    topic: `Bewerbung #${application.id}${application.type_name ? ' • ' + application.type_name : ''} • Bewerber: ${member.user.tag} (${member.id})`,
  });

  const ticket = ticketsModel.createApplicationChat({ guildId: guild.id, channelId: channel.id, applicationId: application.id, openerId: member.id });
  ticketsModel.touch(ticket.id);

  const typeCfg = appModel.typeCfg(type);
  const vars = { applicationName: application.type_name ?? '', applicant: `<@${member.id}>`, user: staff ? `<@${staff.id}>` : '', server: guild.name, id: String(application.id) };
  const welcome = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`💬 Bewerbung #${application.id}${application.type_name ? ` – ${application.type_name}` : ''}`)
    .setDescription(
      fillTemplate(typeCfg.chatMessage || `Hallo {applicant}, das Team möchte sich mit dir über deine Bewerbung unterhalten.\nBitte beantworte Rückfragen hier im Chat.`, vars).slice(0, 4000),
    )
    .addFields(
      { name: 'Bewerber', value: `<@${member.id}>`, inline: true },
      { name: 'Status', value: statusLabel(application.status), inline: true },
      ...(staff ? [{ name: 'Geöffnet von', value: `<@${staff.id}>`, inline: true }] : []),
    )
    .setTimestamp();
  styleEmbed(welcome, typeCfg.embeds.chat, vars);

  await channel.send({
    content: [`<@${member.id}>`, ...teamRoleIds.map((id) => `<@&${id}>`)].join(' • '),
    embeds: [welcome],
    components: [require('./ticketService').buildManagementRow(ticket)],
  });

  // Eingereichte Antworten im Chat mitlesen können
  const answers = JSON.parse(application.answers_json || '[]');
  if (answers.length) {
    for (const [i, fields] of chunkAnswers(answers, 5000).entries()) {
      await channel
        .send({ embeds: [new EmbedBuilder().setColor(embedColor).setTitle(i ? `📋 Eingereichte Antworten (Teil ${i + 1})` : '📋 Eingereichte Antworten').addFields(fields)] })
        .catch(() => null);
    }
  }

  await member
    .send({
      embeds: [
        embeds.info(
          '💬 Chat zu deiner Bewerbung',
          `Das Team von **${guild.name}** hat einen Chat zu deiner Bewerbung als **${application.type_name ?? 'Bewerbung'}** geöffnet: <#${channel.id}>`,
        ),
      ],
    })
    .catch(() => null);

  await logService.log({
    guildId: guild.id,
    category: 'application',
    type: 'application_chat',
    title: '💬 Bewerber-Chat geöffnet',
    color: config.branding.color,
    fields: [
      { name: 'Bewerbung', value: `#${application.id} – ${application.type_name ?? '?'}`, inline: true },
      { name: 'Bewerber', value: `<@${member.id}>`, inline: true },
      { name: 'Kanal', value: `<#${channel.id}>`, inline: true },
      staff ? { name: 'Geöffnet von', value: `<@${staff.id}>`, inline: true } : null,
    ].filter(Boolean),
    actorId: staff?.id ?? member.id,
    meta: { applicationId: application.id, channelId: channel.id },
  });

  return { channel, ticket, created: true };
}

module.exports = {
  METHOD_LABEL,
  fillTemplate,
  styleEmbed,
  formatDuration,
  buildPanelMessage,
  sendPanel,
  refreshPanelMessage,
  eligibilityError,
  beginApplication,
  buildReviewMessage,
  submitApplication,
  reviewApplication,
  deleteSubmission,
  onMemberLeave,
  openChat,
  statusLabel,
};
