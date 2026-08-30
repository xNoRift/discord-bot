'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const client = require('../core/client');
const appModel = require('../database/models/applications');
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

  return application;
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
  statusLabel,
};
