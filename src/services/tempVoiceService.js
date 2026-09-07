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
 *
 * Jeder Kanal bekommt in seinem eingebauten Text-Chat ein Steuer-Panel
 * (Buttons) – ähnlich dem "TempVoice Interface" bekannter Bots.
 */

const MAX_LIMIT = 99;

function renderName(format, member, guild) {
  return (
    String(format || '{user} • Voice')
      .replaceAll('{user}', member.displayName || member.user.username)
      .replaceAll('{username}', member.user.username)
      .replaceAll('{server}', guild.name)
      .trim()
      .slice(0, 100) || `${member.user.username} • Voice`
  );
}

/* ----------------------------------------------------------------
 *  Panel (Embed + Buttons)
 * ---------------------------------------------------------------- */

function panelComponents(row = {}) {
  const locked = Boolean(row.locked);
  const hidden = Boolean(row.hidden);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tempvoice:btn:rename').setLabel('Umbenennen').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tempvoice:btn:limit').setLabel('Benutzerlimit').setEmoji('👥').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('tempvoice:btn:lock')
        .setLabel(locked ? 'Entsperren' : 'Sperren')
        .setEmoji(locked ? '🔓' : '🔒')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('tempvoice:btn:hide')
        .setLabel(hidden ? 'Zeigen' : 'Verstecken')
        .setEmoji(hidden ? '👁️' : '🙈')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tempvoice:btn:region').setLabel('Region').setEmoji('🌍').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tempvoice:btn:permit').setLabel('Hinzufügen').setEmoji('➕').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('tempvoice:btn:reject').setLabel('Entfernen').setEmoji('➖').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tempvoice:btn:block').setLabel('Blockieren').setEmoji('🚫').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('tempvoice:btn:unblock').setLabel('Entblockieren').setEmoji('♻️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tempvoice:btn:disconnect').setLabel('Trennen').setEmoji('🔌').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tempvoice:btn:claim').setLabel('Übernehmen').setEmoji('👑').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tempvoice:btn:delete').setLabel('Löschen').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function panelEmbed(row, channel) {
  const limit = channel?.userLimit || 0;
  return new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle('🔊 TempVoice-Interface')
    .setDescription(
      'Mit diesem Interface steuerst du **deinen** temporären Sprachkanal. ' +
        'Nur der Besitzer (und das Team) kann die Buttons benutzen.',
    )
    .addFields(
      { name: 'Besitzer', value: `<@${row.owner_id}>`, inline: true },
      { name: 'Benutzerlimit', value: limit ? String(limit) : 'kein Limit', inline: true },
      {
        name: 'Status',
        value: `${row.locked ? '🔒 Gesperrt' : '🔓 Offen'} · ${row.hidden ? '🙈 Versteckt' : '👁️ Sichtbar'}`,
        inline: true,
      },
    )
    .setFooter({ text: 'Umbenennen · Limit · Sperren · Verstecken · Region · Hinzufügen/Entfernen · Blockieren · Trennen' });
}

/** Panel-Nachricht neu zeichnen (nach Statusänderungen). */
async function refreshPanel(channel) {
  try {
    const row = tempVoice.get(channel.id);
    if (!row) return;
    let msg = null;
    if (row.panel_message_id) {
      msg = await channel.messages.fetch(row.panel_message_id).catch(() => null);
    }
    if (!msg) {
      const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
      msg = recent?.find((m) => m.author.id === channel.client.user.id && m.components.length > 0) || null;
      if (msg) tempVoice.setPanelMessage(channel.id, msg.id);
    }
    if (msg) await msg.edit({ embeds: [panelEmbed(row, channel)], components: panelComponents(row) });
  } catch (err) {
    logger.warn(`[tempvoice] Panel-Refresh: ${err.message}`);
  }
}

/* ----------------------------------------------------------------
 *  Voice-State-Handling
 * ---------------------------------------------------------------- */

async function onVoiceUpdate(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  if (oldState.channelId && oldState.channelId !== newState.channelId && tempVoice.isTemp(oldState.channelId)) {
    await maybeDeleteEmpty(guild, oldState.channelId);
  }

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

  try {
    await member.voice.setChannel(channel);
  } catch {
    await channel.delete('Temp-Voice: Ersteller nicht mehr im Voice').catch(() => null);
    tempVoice.remove(channel.id);
    return;
  }

  const row = tempVoice.get(channel.id);
  channel
    .send({
      content: `<@${member.id}>`,
      embeds: [panelEmbed(row, channel)],
      components: panelComponents(row),
      allowedMentions: { users: [member.id] },
    })
    .then((msg) => tempVoice.setPanelMessage(channel.id, msg.id))
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
 *  Steuer-Aktionen (von den Button-/Select-/Modal-Handlern genutzt)
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
  await refreshPanel(channel);
  return `Kanal heißt jetzt **${name}**.`;
}

async function setLimit(channel, value) {
  const n = Math.max(0, Math.min(MAX_LIMIT, Number.parseInt(value, 10) || 0));
  await channel.setUserLimit(n, 'Temp-Voice: Benutzerlimit');
  await refreshPanel(channel);
  return n === 0 ? 'Benutzerlimit entfernt.' : `Benutzerlimit auf **${n}** gesetzt.`;
}

async function toggleLock(channel, row) {
  const locked = !row.locked;
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { Connect: locked ? false : null });
  tempVoice.setFlags(channel.id, { locked });
  await refreshPanel(channel);
  return locked
    ? '🔒 Kanal **gesperrt** – nur hinzugefügte Leute dürfen rein.'
    : '🔓 Kanal ist wieder **frei**.';
}

async function toggleHide(channel, row) {
  const hidden = !row.hidden;
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { ViewChannel: hidden ? false : null });
  tempVoice.setFlags(channel.id, { hidden });
  await refreshPanel(channel);
  return hidden ? '🙈 Kanal ist jetzt **versteckt**.' : '👁️ Kanal ist wieder **sichtbar**.';
}

async function setRegion(channel, region) {
  const value = !region || region === 'auto' ? null : region;
  await channel.setRTCRegion(value, 'Temp-Voice: Region');
  return value ? `🌍 Region auf **${value}** gesetzt.` : '🌍 Region auf **Automatisch** gesetzt.';
}

async function permitUser(channel, targetId) {
  await channel.permissionOverwrites.edit(targetId, { ViewChannel: true, Connect: true });
  return `➕ <@${targetId}> darf jetzt beitreten.`;
}

async function rejectUser(channel, targetId, row) {
  if (targetId === row.owner_id) throw new Error('Den Besitzer kannst du nicht entfernen.');
  await channel.permissionOverwrites.delete(targetId, 'Temp-Voice: Zugriff entfernt').catch(() => null);
  const m = channel.members.get(targetId);
  if (m) await m.voice.disconnect('Temp-Voice: entfernt').catch(() => null);
  return `➖ <@${targetId}> wurde entfernt.`;
}

async function blockUser(channel, targetId, row) {
  if (targetId === row.owner_id) throw new Error('Den Besitzer kannst du nicht blockieren.');
  await channel.permissionOverwrites.edit(targetId, { ViewChannel: false, Connect: false });
  const m = channel.members.get(targetId);
  if (m) await m.voice.disconnect('Temp-Voice: blockiert').catch(() => null);
  return `🚫 <@${targetId}> ist jetzt **blockiert**.`;
}

async function unblockUser(channel, targetId) {
  await channel.permissionOverwrites.delete(targetId, 'Temp-Voice: entblockiert').catch(() => null);
  return `♻️ <@${targetId}> ist nicht mehr blockiert.`;
}

async function disconnectUser(channel, targetId, row) {
  if (targetId === row.owner_id) throw new Error('Dich selbst kannst du hier nicht trennen.');
  const m = channel.members.get(targetId);
  if (!m) throw new Error('Diese Person ist nicht in deinem Kanal.');
  await m.voice.disconnect('Temp-Voice: getrennt');
  return `🔌 <@${targetId}> wurde aus dem Kanal getrennt.`;
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
  await refreshPanel(channel);
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
  refreshPanel,
  panelEmbed,
  panelComponents,
  rename,
  setLimit,
  toggleLock,
  toggleHide,
  setRegion,
  permitUser,
  rejectUser,
  blockUser,
  unblockUser,
  disconnectUser,
  claim,
  destroy,
  MAX_LIMIT,
};
