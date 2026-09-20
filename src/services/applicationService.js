'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const client = require('../core/client');
const appModel = require('../database/models/applications');
const ticketsModel = require('../database/models/tickets');
const settingsModel = require('../database/models/settings');
const logService = require('./logService');
const embeds = require('../utils/embeds');
const config = require('../../config/config');
const { botCanManageRole } = require('../utils/permissions');
const { discordTimestamp } = require('../utils/time');
const logger = require('../utils/logger');

/**
 * Bewerbungssystem: Panel, Modal, Einreichung, Review.
 * Hinweis: Ein Discord-Modal erlaubt maximal 5 Eingabefelder -> max. 5 Fragen pro Bewerbungsart.
 */

const MAX_QUESTIONS = 5;

/* ---------------- Panel ---------------- */

function buildPanelMessage(settings, types) {
  const embed = new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle(settings.application_panel_title || config.defaults.applicationPanelTitle)
    .setDescription(
      (settings.application_panel_message || config.defaults.applicationPanelMessage) +
        '\n\n' +
        types.map((t) => `${t.emoji ? t.emoji + ' ' : ''}**${t.name}**${t.description ? ` – ${t.description}` : ''}`).join('\n'),
    )
    .setFooter({ text: 'Wähle unten eine Position aus.' });

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
        .setEmoji(t.emoji || '📋')
        .setStyle(ButtonStyle.Secondary),
    );
  });
  if (current.components.length) rows.push(current);

  return { embeds: [embed], components: rows.slice(0, 5) };
}

async function postOrUpdatePanel(guild, channelId) {
  const settings = settingsModel.get(guild.id);
  const types = appModel.listTypes(guild.id, { onlyEnabled: true });
  if (!types.length) throw new Error('Es sind keine (aktiven) Bewerbungsarten konfiguriert.');

  const channel =
    guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel || !channel.isTextBased()) throw new Error('Panel-Kanal nicht gefunden oder kein Textkanal.');

  const payload = buildPanelMessage(settings, types);

  if (settings.application_panel_channel_id === channelId && settings.application_panel_message_id) {
    const existing = await channel.messages.fetch(settings.application_panel_message_id).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      return existing;
    }
  }

  const message = await channel.send(payload);
  settingsModel.update(guild.id, {
    application_panel_channel_id: channelId,
    application_panel_message_id: message.id,
  });
  return message;
}

/* ---------------- Modal ---------------- */

function buildModal(type, questions) {
  const modal = new ModalBuilder()
    .setCustomId(`app:modal:${type.id}`)
    .setTitle(`Bewerbung: ${type.name}`.slice(0, 45));

  questions.slice(0, MAX_QUESTIONS).forEach((q, i) => {
    const input = new TextInputBuilder()
      .setCustomId(`q_${q.id ?? i}`)
      .setLabel(q.label.slice(0, 45))
      .setStyle(q.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(Boolean(q.required));
    if (q.min_length) input.setMinLength(Math.min(q.min_length, 1000));
    if (q.max_length) input.setMaxLength(Math.min(q.max_length, 4000));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  });

  return modal;
}

/* ---------------- Einreichung ---------------- */

function buildReviewMessage(application, answers) {
  const embed = new EmbedBuilder()
    .setColor(
      application.status === 'accepted'
        ? config.branding.success
        : application.status === 'rejected'
          ? config.branding.danger
          : config.branding.color,
    )
    .setTitle(`📋 Bewerbung #${application.id} – ${application.type_name}`)
    .setDescription(`**Bewerber:** <@${application.user_id}> (${application.user_tag ?? application.user_id})`)
    .addFields(
      answers.slice(0, 24).map((a) => ({
        name: a.question.slice(0, 256),
        value: (a.answer || '*(keine Angabe)*').slice(0, 1024),
      })),
    )
    .setFooter({ text: `Status: ${statusLabel(application.status)}` })
    .setTimestamp(application.created_at);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`app:accept:${application.id}`)
      .setLabel('Annehmen')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(application.status !== 'pending'),
    new ButtonBuilder()
      .setCustomId(`app:reject:${application.id}`)
      .setLabel('Ablehnen')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(application.status !== 'pending'),
    new ButtonBuilder()
      .setCustomId(`app:chat:${application.id}`)
      .setLabel('Chat')
      .setEmoji('💬')
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row] };
}

function statusLabel(status) {
  return { pending: '🕓 Offen', accepted: '✅ Angenommen', rejected: '❌ Abgelehnt' }[status] ?? status;
}

/**
 * Speichert eine eingereichte Bewerbung und postet sie in den Bewerbungs-Channel.
 * @param {import('discord.js').Guild} guild
 * @param {object} user  { id, tag }
 * @param {object} type  application_types Zeile
 * @param {Array<{question:string, answer:string}>} answers
 */
async function submitApplication(guild, user, type, answers) {
  const settings = settingsModel.get(guild.id);

  const application = appModel.createApplication({
    guildId: guild.id,
    typeId: type.id,
    typeName: type.name,
    userId: user.id,
    userTag: user.tag,
    answers,
  });

  const channelId = settings.application_channel_id;
  if (channelId) {
    const channel =
      guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
    if (channel && channel.isTextBased()) {
      const payload = buildReviewMessage(application, answers);
      if (settings.application_team_role_id) payload.content = `<@&${settings.application_team_role_id}>`;
      const message = await channel.send(payload).catch(() => null);
      if (message) appModel.setApplicationMessage(application.id, channel.id, message.id);
    }
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

  // Chat automatisch öffnen (Einstellung der Bewerbungsart)
  if (type.auto_chat) {
    await openChat(guild, application, null).catch((err) =>
      logger.warn(`[application] Auto-Chat für #${application.id}: ${err.message}`),
    );
  }

  return application;
}

/* ---------------- Bewerber-Chat ---------------- */

const CHAT_PERMS = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.ReadMessageHistory,
  PermissionsBitField.Flags.AttachFiles,
  PermissionsBitField.Flags.EmbedLinks,
];

async function fetchChannel(guild, id) {
  if (!id) return null;
  return guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
}

function chatChannelName(user) {
  const base = String(user.username ?? user.tag ?? user.id)
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `bewerbung-${base || user.id}`;
}

/** Discord-Kategorie für Bewerber-Chats: Bewerbungsart > Server-Standard > keine (oberste Ebene). */
function chatCategoryId(type, settings) {
  return type?.chat_category_id || settings.application_chat_category_id || null;
}

/**
 * Öffnet einen privaten Chat (Ticket) zwischen Team und Bewerber.
 * Existiert bereits ein Chat, wird er wiederverwendet (ein geschlossener wird wieder geöffnet).
 * @param {import('discord.js').Guild} guild
 * @param {object} application  applications-Zeile
 * @param {{id:string}|null} staff  Teammitglied, das den Chat öffnet (null = automatisch bei Eingang)
 * @returns {Promise<{ channel: import('discord.js').TextChannel, ticket: object, created: boolean }>}
 */
async function openChat(guild, application, staff) {
  const settings = settingsModel.get(guild.id);
  const embedColor = config.branding.color;

  // Vorhandenen Chat wiederverwenden
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

  const teamRoleId = settings.application_team_role_id;
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: member.id, allow: CHAT_PERMS },
    {
      id: me.id,
      allow: [...CHAT_PERMS, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageMessages],
    },
  ];
  if (teamRoleId && guild.roles.cache.has(teamRoleId)) overwrites.push({ id: teamRoleId, allow: CHAT_PERMS });

  const channel = await guild.channels.create({
    name: chatChannelName(member.user),
    type: ChannelType.GuildText,
    ...(parent ? { parent: parent.id } : {}),
    permissionOverwrites: overwrites,
    topic: `Bewerbung #${application.id}${application.type_name ? ' • ' + application.type_name : ''} • Bewerber: ${member.user.tag} (${member.id})`,
  });

  const ticket = ticketsModel.createApplicationChat({
    guildId: guild.id,
    channelId: channel.id,
    applicationId: application.id,
    openerId: member.id,
  });
  ticketsModel.touch(ticket.id);

  const welcome = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`💬 Bewerbung #${application.id}${application.type_name ? ` – ${application.type_name}` : ''}`)
    .setDescription(
      `Hallo <@${member.id}>, das Team möchte sich mit dir über deine Bewerbung unterhalten.\n` +
        'Bitte beantworte Rückfragen hier im Chat.',
    )
    .addFields(
      { name: 'Bewerber', value: `<@${member.id}>`, inline: true },
      { name: 'Status', value: statusLabel(application.status), inline: true },
      ...(staff ? [{ name: 'Geöffnet von', value: `<@${staff.id}>`, inline: true }] : []),
    )
    .setTimestamp();

  const pings = [`<@${member.id}>`];
  if (teamRoleId && guild.roles.cache.has(teamRoleId)) pings.push(`<@&${teamRoleId}>`);

  await channel.send({
    content: pings.join(' • '),
    embeds: [welcome],
    components: [require('./ticketService').buildManagementRow(ticket)],
  });

  // Eingereichte Antworten im Chat mitlesen können
  const answers = JSON.parse(application.answers_json || '[]');
  if (answers.length) {
    await channel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(embedColor)
            .setTitle('📋 Eingereichte Antworten')
            .addFields(
              answers.slice(0, 24).map((a) => ({
                name: String(a.question).slice(0, 256),
                value: (a.answer && a.answer.trim() ? a.answer : '*(keine Angabe)*').slice(0, 1024),
              })),
            ),
        ],
      })
      .catch(() => null);
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

/* ---------------- Review ---------------- */

/**
 * Nimmt eine Bewerbung an oder lehnt sie ab.
 * @param {import('discord.js').Guild} guild
 * @param {number} applicationId
 * @param {object} reviewer  { id, tag }
 * @param {'accepted'|'rejected'} decision
 * @param {string} [note]
 */
async function reviewApplication(guild, applicationId, reviewer, decision, note) {
  const application = appModel.getApplication(applicationId);
  if (!application) throw new Error('Bewerbung nicht gefunden.');
  if (application.status !== 'pending') throw new Error(`Diese Bewerbung wurde bereits bearbeitet (${statusLabel(application.status)}).`);

  const updated = appModel.reviewApplication(applicationId, {
    status: decision,
    reviewerId: reviewer.id,
    note,
  });

  const answers = JSON.parse(updated.answers_json || '[]');

  // Nachricht aktualisieren
  if (updated.channel_id && updated.message_id) {
    const channel =
      guild.channels.cache.get(updated.channel_id) ??
      (await guild.channels.fetch(updated.channel_id).catch(() => null));
    if (channel) {
      const msg = await channel.messages.fetch(updated.message_id).catch(() => null);
      if (msg) {
        const payload = buildReviewMessage(updated, answers);
        payload.content = `Bearbeitet von <@${reviewer.id}> • ${statusLabel(decision)}`;
        await msg.edit(payload).catch(() => null);
      }
    }
  }

  // Rolle vergeben bei Annahme
  let roleNote = '';
  if (decision === 'accepted') {
    const type = updated.type_id ? appModel.getType(updated.type_id) : null;
    const roleId = type?.accept_role_id;
    if (roleId) {
      const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
      const member = await guild.members.fetch(updated.user_id).catch(() => null);
      const can = role ? botCanManageRole(guild, role) : { ok: false, reason: 'Rolle nicht gefunden.' };
      if (role && member && can.ok) {
        await member.roles.add(role, `Bewerbung #${applicationId} angenommen`).catch((err) => {
          roleNote = `\n⚠️ Rolle konnte nicht vergeben werden: ${err.message}`;
        });
        if (!roleNote) roleNote = `\n✅ Rolle <@&${roleId}> vergeben.`;
      } else {
        roleNote = `\n⚠️ Rolle nicht vergeben: ${can.reason || 'Mitglied nicht gefunden.'}`;
      }
    }
  }

  // Bewerber per DM informieren
  const member = await guild.members.fetch(updated.user_id).catch(() => null);
  if (member) {
    const dm =
      decision === 'accepted'
        ? embeds.success(
            '✅ Bewerbung angenommen',
            `Deine Bewerbung als **${updated.type_name}** auf **${guild.name}** wurde angenommen!` +
              (note ? `\n\n**Nachricht vom Team:** ${note}` : ''),
          )
        : embeds.error(
            '❌ Bewerbung abgelehnt',
            `Deine Bewerbung als **${updated.type_name}** auf **${guild.name}** wurde leider abgelehnt.` +
              (note ? `\n\n**Nachricht vom Team:** ${note}` : ''),
          );
    await member.send({ embeds: [dm] }).catch(() => null);
  }

  // Ist ein Chat offen, das Ergebnis dort festhalten
  const chat = ticketsModel.getActiveByApplication(applicationId);
  if (chat?.status === 'open') {
    const chatChannel = await fetchChannel(guild, chat.channel_id);
    if (chatChannel) {
      await chatChannel
        .send({
          embeds: [
            (decision === 'accepted'
              ? embeds.success('✅ Bewerbung angenommen', `<@${reviewer.id}> hat die Bewerbung angenommen.`)
              : embeds.error('❌ Bewerbung abgelehnt', `<@${reviewer.id}> hat die Bewerbung abgelehnt.`)
            ).addFields(note ? [{ name: 'Nachricht vom Team', value: note.slice(0, 1024) }] : []),
          ],
        })
        .catch(() => null);
    }
  }

  await logService.log({
    guildId: guild.id,
    category: 'application',
    type: decision === 'accepted' ? 'application_accept' : 'application_reject',
    title: decision === 'accepted' ? '✅ Bewerbung angenommen' : '❌ Bewerbung abgelehnt',
    color: decision === 'accepted' ? config.branding.success : config.branding.danger,
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

module.exports = {
  MAX_QUESTIONS,
  buildPanelMessage,
  postOrUpdatePanel,
  buildModal,
  buildReviewMessage,
  submitApplication,
  reviewApplication,
  openChat,
  statusLabel,
};
