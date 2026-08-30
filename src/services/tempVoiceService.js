'use strict';

const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const settingsModel = require('../database/models/settings');
const tempVoice = require('../database/models/tempVoice');
const { isManager } = require('../utils/permissions');
const config = require('../../config/config');
const logger = require('../utils/logger');

/**
 * Temp-Voice ("Join to Create").
 * Betritt jemand den Hub-Sprachkanal, wird ein eigener temporärer Kanal
 * erstellt und die Person hineingezogen. Ist der Kanal leer, wird er gelöscht.
 */

const MAX_LIMIT = 99;

function renderName(format, member, guild) {
  return String(format || '{user} • Voice')
    .replaceAll('{user}', member.displayName || member.user.username)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', guild.name)
    .trim()
    .slice(0, 100) || `${member.user.username} • Voice`;
}

function panelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tempvoice:btn:rename').setLabel('Umbenennen').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tempvoice:btn:limit').setLabel('User-Limit').setEmoji('👥').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tempvoice:btn:lock').setLabel('Sperren / Frei').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tempvoice:btn:hide').setLabel('Verbergen / Zeigen').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tempvoice:btn:claim').setLabel('Übernehmen').setEmoji('👑').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tempvoice:btn:delete').setLabel('Löschen').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function panelEmbed(ownerId) {
  return new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle('🔊 Dein Sprachkanal')
    .setDescription(
      [
        `Besitzer: <@${ownerId}>`,
        '',
        'Steuere deinen Kanal über die Buttons:',
        '✏️ **Umbenennen** · 👥 **User-Limit** · 🔒 **Sperren** (nur reingelassene dürfen rein)',
        '👁️ **Verbergen** · 👑 **Übernehmen** (wenn der Besitzer weg ist) · 🗑️ **Löschen**',
      ].join('\n'),
    );
}

/** Reagiert auf jede Sprachkanal-Änderung. */
async function onVoiceUpdate(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  // 1) Aufräumen: hat jemand einen temporären Kanal verlassen?
  if (oldState.channelId && oldState.channelId !== newState.channelId && tempVoice.isTemp(oldState.channelId)) {
    await maybeDeleteEmpty(guild, oldState.channelId);
  }

  // 2) Erstellen: hat jemand den Hub-Kanal betreten?
  const settings = settingsModel.get(guild.id);
  if (
    settings.tempvoice_enabled &&
    settings.tempvoice_hub_channel_id &&
    newState.channelId === settings.tempvoice_hub_channel_id &&
    newState.member &&
    !newState.member.user.bot
  ) {
    await createFor(newState.member, settings).catch((err) =>
      logger.warn(`[tempvoice] Erstellen fehlgeschlagen: ${err.message}`),
    );
  }
}

async function createFor(member, settings) {
  const guild = member.guild;
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels) || !me?.permissions.has(PermissionFlagsBits.MoveMembers)) {
    logger.warn('[tempvoice] Bot braucht "Kanäle verwalten" + "Mitglieder verschieben".');
    return;
  }

  const hub = guild.channels.cache.get(settings.tempvoice_hub_channel_id);
  const parentId = settings.tempvoice_category_id || hub?.parentId || null;
  const limit = Math.max(0, Math.min(MAX_LIMIT, Number(settings.tempvoice_user_limit) || 0));

  const channel = await guild.channels.create({
    name: renderName(settings.tempvoice_name_format, member, guild),
    type: ChannelType.GuildVoice,
    parent: parentId,
    userLimit: limit,
    reason: `Temp-Voice für ${member.user.tag}`,
    permissionOverwrites: [
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.MoveMembers,
        ],
      },
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
      },
    ],
  });

  tempVoice.add({ channelId: channel.id, guildId: guild.id, ownerId: member.id });

  // Mitglied hineinziehen – klappt nur, wenn es noch im Hub sitzt.
  try {
    await member.voice.setChannel(channel);
  } catch {
    await channel.delete('Temp-Voice: Ersteller nicht mehr im Voice').catch(() => null);
    tempVoice.remove(channel.id);
    return;
  }

  channel
    .send({ content: `<@${member.id}>`, embeds: [panelEmbed(member.id)], components: panelComponents(), allowedMentions: { users: [member.id] } })
    .catch((err) => logger.warn(`[tempvoice] Panel: ${err.message}`));
}

async function maybeDeleteEmpty(guild, channelId) {
  const channel =
    guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel) {
    tempVoice.remove(channelId);
    return;
  }
  if (channel.members.filter((m) => !m.user.bot).size === 0) {
    await channel.delete('Temp-Voice: leer').catch(() => null);
    tempVoice.remove(channelId);
  }
}

/** Beim Start: verwaiste/leere Temp-Kanäle entfernen. */
async function cleanup(client) {
  for (const row of tempVoice.listAll()) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) {
      tempVoice.remove(row.channel_id);
      continue;
    }
    const channel =
      guild.channels.cache.get(row.channel_id) ??
      (await guild.channels.fetch(row.channel_id).catch(() => null));
    if (!channel) {
      tempVoice.remove(row.channel_id);
      continue;
    }
    if (channel.members.filter((m) => !m.user.bot).size === 0) {
      await channel.delete('Temp-Voice: Aufräumen beim Start').catch(() => null);
      tempVoice.remove(row.channel_id);
    }
  }
}

/* ----------------------------------------------------------------
 *  Steuer-Aktionen (von den Button-/Modal-Handlern genutzt)
 * ---------------------------------------------------------------- */

/** @returns {{ ok: boolean, row?: object, reason?: string }} */
function assertControl(channelId, member) {
  const row = tempVoice.get(channelId);
  if (!row) return { ok: false, reason: 'Das ist kein temporärer Sprachkanal.' };
  if (row.owner_id === member.id || isManager(member)) return { ok: true, row };
  return { ok: false, reason: 'Nur der Besitzer dieses Kanals kann das ändern.' };
}

async function rename(channel, newName) {
  const name = String(newName || '').trim().slice(0, 100);
  if (!name) throw new Error('Bitte einen Namen angeben.');
  await channel.setName(name, 'Temp-Voice: umbenannt');
  return `Kanal heißt jetzt **${name}**.`;
}

async function setLimit(channel, value) {
  const n = Math.max(0, Math.min(MAX_LIMIT, Number.parseInt(value, 10) || 0));
  await channel.setUserLimit(n, 'Temp-Voice: User-Limit');
  return n === 0 ? 'User-Limit entfernt.' : `User-Limit auf **${n}** gesetzt.`;
}

async function toggleLock(channel, row) {
  const locked = !row.locked;
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
    Connect: locked ? false : null,
  });
  tempVoice.setFlags(channel.id, { locked });
  return locked ? '🔒 Kanal **gesperrt** – nur du kannst Leute reinlassen.' : '🔓 Kanal ist wieder **frei**.';
}

async function toggleHide(channel, row) {
  const hidden = !row.hidden;
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
    ViewChannel: hidden ? false : null,
  });
  tempVoice.setFlags(channel.id, { hidden });
  return hidden ? '👁️ Kanal ist jetzt **versteckt**.' : '👁️ Kanal ist wieder **sichtbar**.';
}

async function claim(channel, member) {
  const row = tempVoice.get(channel.id);
  if (!row) throw new Error('Kein temporärer Kanal.');
  if (row.owner_id === member.id) throw new Error('Du bist bereits Besitzer.');
  const ownerStillHere = channel.members.has(row.owner_id);
  if (ownerStillHere && !isManager(member)) throw new Error('Der Besitzer ist noch im Kanal.');
  tempVoice.setOwner(channel.id, member.id);
  await channel.permissionOverwrites
    .edit(member.id, {
      ViewChannel: true,
      Connect: true,
      Speak: true,
      ManageChannels: true,
      MoveMembers: true,
    })
    .catch(() => null);
  return `👑 <@${member.id}> ist jetzt Besitzer dieses Kanals.`;
}

async function destroy(channel) {
  tempVoice.remove(channel.id);
  await channel.delete('Temp-Voice: vom Besitzer gelöscht');
}

module.exports = {
  onVoiceUpdate,
  cleanup,
  assertControl,
  rename,
  setLimit,
  toggleLock,
  toggleHide,
  claim,
  destroy,
  MAX_LIMIT,
};
