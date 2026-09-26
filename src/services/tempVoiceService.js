'use strict';

const i18n = require('../utils/i18n');

const {
  ChannelType,
  OverwriteType,
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
const buttonEmojis = require('../utils/buttonEmojis');
const logger = require('../utils/logger');
const { L } = require('../utils/i18n');

/**
 * Temp-Voice ("Join to Create").
 * Betritt jemand den Hub-Sprachkanal, wird ein eigener temporärer Kanal
 * erstellt und die Person hineingezogen. Ist der Kanal leer, wird er gelöscht.
 *
 * Jeder Kanal bekommt in seinem eingebauten Text-Chat ein Steuer-Panel
 * (Buttons) – ähnlich dem "TempVoice Interface" bekannter Bots.
 */

const MAX_LIMIT = 99;

// channelId -> Map<userId, Beitrittszeit>. Die Einfüge-Reihenfolge der Map = wer am längsten im Kanal ist.
// Nur im Speicher: nach einem Neustart wird die Reihenfolge aus den aktuellen Kanal-Mitgliedern neu aufgebaut.
const presence = new Map();

function trackJoin(channelId, userId) {
  let members = presence.get(channelId);
  if (!members) presence.set(channelId, (members = new Map()));
  if (!members.has(userId)) members.set(userId, Date.now());
}

function trackLeave(channelId, userId) {
  const members = presence.get(channelId);
  if (!members) return;
  members.delete(userId);
  if (members.size === 0) presence.delete(channelId);
}

function renderName(format, member, guild) {
  return (
    String(format || '{user} • Voice')
      .replaceAll('{user}', member.displayName || member.user.username)
      .replaceAll('{username}', member.user.username)
      .replaceAll('{display}', member.displayName || member.user.username)
      .replaceAll('{count}', String(member.guild.memberCount ?? ''))
      .replaceAll('{server}', guild.name)
      .trim()
      .slice(0, 100) || `${member.user.username} • Voice`
  );
}

/* ----------------------------------------------------------------
 *  Panel (Embed + Buttons)
 * ---------------------------------------------------------------- */

function panelComponents(row = {}, guildId = row.guild_id) {
  const locked = Boolean(row.locked);
  const hidden = Boolean(row.hidden);
  const e = buttonEmojis.forGuild(guildId, 'tempvoice');
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tempvoice:btn:rename').setLabel(L('Umbenennen', 'Rename')).setEmoji(e('rename')).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tempvoice:btn:limit').setLabel(L('Benutzerlimit', 'User limit')).setEmoji(e('limit')).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('tempvoice:btn:lock')
        .setLabel(locked ? L('Entsperren', 'Unlock') : L('Sperren', 'Lock'))
        .setEmoji(locked ? e('unlock') : e('lock'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('tempvoice:btn:hide')
        .setLabel(hidden ? L('Zeigen', 'Show') : L('Verstecken', 'Hide'))
        .setEmoji(hidden ? e('show') : e('hide'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tempvoice:btn:region').setLabel('Region').setEmoji(e('region')).setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tempvoice:btn:permit').setLabel(L('Hinzufügen', 'Add')).setEmoji(e('permit')).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('tempvoice:btn:reject').setLabel(L('Entfernen', 'Remove')).setEmoji(e('reject')).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tempvoice:btn:block').setLabel(L('Blockieren', 'Block')).setEmoji(e('block')).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('tempvoice:btn:unblock').setLabel(L('Entblockieren', 'Unblock')).setEmoji(e('unblock')).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('tempvoice:btn:disconnect').setLabel(L('Trennen', 'Disconnect')).setEmoji(e('disconnect')).setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tempvoice:btn:delete').setLabel(L('Löschen', 'Delete')).setEmoji(e('delete')).setStyle(ButtonStyle.Danger),
    ),
  ];
}

function panelEmbed(row, channel) {
  const limit = channel?.userLimit || 0;
  return new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle('🔊 TempVoice-Interface')
    .setDescription(
      L(
        'Mit diesem Interface steuerst du **deinen** temporären Sprachkanal. Nur der Besitzer (und das Team) kann die Buttons benutzen.',
        'Use this interface to control **your** temporary voice channel. Only the owner (and the team) can use the buttons.',
      ),
    )
    .addFields(
      { name: L('Besitzer', 'Owner'), value: `<@${row.owner_id}>`, inline: true },
      { name: L('Benutzerlimit', 'User limit'), value: limit ? String(limit) : L('kein Limit', 'no limit'), inline: true },
      {
        name: 'Status',
        value: `${row.locked ? L('🔒 Gesperrt', '🔒 Locked') : L('🔓 Offen', '🔓 Open')} · ${row.hidden ? L('🙈 Versteckt', '🙈 Hidden') : L('👁️ Sichtbar', '👁️ Visible')}`,
        inline: true,
      },
    )
    .setFooter({ text: L('Umbenennen · Limit · Sperren · Verstecken · Region · Hinzufügen/Entfernen · Blockieren · Trennen', 'Rename · Limit · Lock · Hide · Region · Add/Remove · Block · Disconnect') });
}

/* ---- Fester Interface-Kanal (eine dauerhafte Nachricht, steuert den Kanal, in dem der Klickende gerade sitzt) ---- */

function interfaceEmbed(guild) {
  return new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle('🔊 TempVoice Interface')
    .setDescription(
      [
        L('Mit diesem Interface bearbeitest du **deinen eigenen** temporären Sprachkanal.', 'Use this interface to edit **your own** temporary voice channel.'),
        L('Voraussetzung: Du sitzt gerade in einem Kanal, den du über den Hub-Kanal erstellt hast.', 'Requirement: you are currently in a channel you created via the hub channel.'),
        '',
        L('✏️ **Umbenennen** · 👥 **Benutzerlimit** · 🔒 **Sperren** · 🙈 **Verstecken** · 🌍 **Region**', '✏️ **Rename** · 👥 **User limit** · 🔒 **Lock** · 🙈 **Hide** · 🌍 **Region**'),
        L('➕ **Hinzufügen** · ➖ **Entfernen** · 🚫 **Blockieren** · ♻️ **Entblockieren** · 🔌 **Trennen**', '➕ **Add** · ➖ **Remove** · 🚫 **Block** · ♻️ **Unblock** · 🔌 **Disconnect**'),
        L('🗑️ **Löschen**', '🗑️ **Delete**'),
        '',
        L('👑 Verlässt der Besitzer den Kanal, wird automatisch die Person Besitzer, die am längsten im Kanal ist.', '👑 If the owner leaves the channel, whoever has been in the channel longest automatically becomes the owner.'),
      ].join('\n'),
    )
    .setFooter({ text: guild.name });
}

/** Postet die dauerhafte Interface-Nachricht in den konfigurierten Kanal – oder aktualisiert sie. */
async function postOrUpdateInterface(guild) {
  const s = settingsModel.get(guild.id);
  if (!s.tempvoice_interface_channel_id) return null;

  const channel =
    guild.channels.cache.get(s.tempvoice_interface_channel_id) ??
    (await guild.channels.fetch(s.tempvoice_interface_channel_id).catch(() => null));
  if (!channel || !channel.isTextBased()) return null;

  const payload = { embeds: [interfaceEmbed(guild)], components: panelComponents({}, guild.id) };

  if (s.tempvoice_interface_message_id) {
    const existing = await channel.messages.fetch(s.tempvoice_interface_message_id).catch(() => null);
    if (existing) {
      await existing.edit(payload).catch(() => null);
      return existing;
    }
  }
  const msg = await channel.send(payload);
  settingsModel.update(guild.id, { tempvoice_interface_message_id: msg.id });
  return msg;
}

/** Beim Start für alle Server die Interface-Nachricht sicherstellen. */
async function ensureInterfaces(client) {
  for (const guild of client.guilds.cache.values()) {
    await i18n.runFor(guild.id, () => postOrUpdateInterface(guild)).catch((err) =>
      logger.warn(`[tempvoice] Interface ${guild.id}: ${err.message}`),
    );
  }
}

/** Der temporäre Sprachkanal, in dem das Mitglied gerade sitzt – oder null. */
function resolveUserChannel(member) {
  const vc = member?.voice?.channel;
  if (vc && tempVoice.isTemp(vc.id)) return vc;
  return null;
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

  const moved = oldState.channelId !== newState.channelId;
  const who = newState.member || oldState.member;

  if (moved && who && !who.user.bot) {
    if (oldState.channelId) trackLeave(oldState.channelId, who.id);
    if (newState.channelId && tempVoice.isTemp(newState.channelId)) trackJoin(newState.channelId, who.id);
  }

  if (oldState.channelId && moved && tempVoice.isTemp(oldState.channelId)) {
    const stillThere = await maybeDeleteEmpty(guild, oldState.channelId);
    if (stillThere && who) {
      await handOverIfOwnerLeft(guild, oldState.channelId, who.id).catch((err) =>
        logger.warn(`[tempvoice] Besitzer-Übergabe fehlgeschlagen: ${err.message}`),
      );
    }
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
    bitrate: Math.min(guild.maximumBitrate || 96000, Math.max(8000, (Number(settings.tempvoice_bitrate) || 64) * 1000)),
    reason: L('Temp-Voice für {user}', 'Temp voice for {user}', { user: member.user.tag }),
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
    await channel.delete(L('Temp-Voice: Ersteller nicht mehr im Voice', 'Temp voice: creator no longer in voice')).catch(() => null);
    tempVoice.remove(channel.id);
    return;
  }

  // Ist ein fester Interface-Kanal konfiguriert, wird KEIN Panel je Kanal gepostet.
  if (settings.tempvoice_interface_channel_id) {
    channel
      .send({
        content: `<@${member.id}>`,
        embeds: [
          new EmbedBuilder()
            .setColor(config.branding.color)
            .setDescription(L('Dein Kanal ist bereit. Steuere ihn über das **TempVoice Interface** in {channel}.', 'Your channel is ready. Control it via the **TempVoice interface** in {channel}.', { channel: `<#${settings.tempvoice_interface_channel_id}>` })),
        ],
        allowedMentions: { users: [member.id] },
      })
      .catch(() => null);
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

/** Löscht den Kanal, wenn er leer ist. @returns {Promise<boolean>} true, wenn der Kanal weiter besteht. */
async function maybeDeleteEmpty(guild, channelId) {
  const channel =
    guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel) {
    tempVoice.remove(channelId);
    presence.delete(channelId);
    return false;
  }
  if (channel.members.filter((m) => !m.user.bot).size === 0) {
    await channel.delete('Temp-Voice: leer').catch(() => null);
    tempVoice.remove(channelId);
    presence.delete(channelId);
    return false;
  }
  return true;
}

/**
 * Macht das Mitglied, das am längsten im Kanal sitzt, zum neuen Besitzer –
 * aber nur, wenn der Besitzer den Kanal gerade verlassen hat.
 */
async function handOverIfOwnerLeft(guild, channelId, leftUserId) {
  const row = tempVoice.get(channelId);
  if (!row || row.owner_id !== leftUserId) return;
  const channel =
    guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel) return;
  await transferOwnership(channel, row);
}

/** Wählt aus den Anwesenden das Mitglied mit der längsten Verweildauer und macht es zum Besitzer. */
async function transferOwnership(channel, row) {
  const humans = channel.members.filter((m) => !m.user.bot && m.id !== row.owner_id);
  if (humans.size === 0) return;

  const joined = presence.get(channel.id);
  let next = null;
  let earliest = Infinity;
  for (const m of humans.values()) {
    const t = joined?.get(m.id) ?? Infinity;
    if (next === null || t < earliest) {
      next = m;
      earliest = t;
    }
  }

  const previousOwnerId = row.owner_id;
  tempVoice.setOwner(channel.id, next.id);
  await channel.permissionOverwrites
    .edit(next, { ViewChannel: true, Connect: true, Speak: true, ManageChannels: true, MoveMembers: true })
    .catch((err) => logger.warn(`[tempvoice] Rechte für neuen Besitzer: ${err.message}`));
  // Der bisherige Besitzer darf den Kanal weiter betreten, aber nicht mehr verwalten.
  await channel.permissionOverwrites
    .edit(previousOwnerId, { ManageChannels: null, MoveMembers: null }, { type: OverwriteType.Member })
    .catch(() => null);

  await refreshPanel(channel);
  channel
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(config.branding.color)
          .setDescription(L('👑 {user} ist jetzt Besitzer dieses Kanals – der bisherige Besitzer hat den Kanal verlassen.', '👑 {user} is now the owner of this channel – the previous owner left.', { user: `<@${next.id}>` })),
      ],
      allowedMentions: { parse: [] },
    })
    .catch(() => null);
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
    const humans = channel.members.filter((m) => !m.user.bot);
    if (humans.size === 0) {
      await channel.delete(L('Temp-Voice: Aufräumen beim Start', 'Temp voice: cleanup on start')).catch(() => null);
      tempVoice.remove(row.channel_id);
      continue;
    }

    // Beitrittsreihenfolge neu aufbauen; war der Besitzer beim Neustart nicht mehr im Kanal, geht der Kanal weiter.
    for (const m of humans.values()) trackJoin(channel.id, m.id);
    if (!humans.has(row.owner_id)) {
      await transferOwnership(channel, row).catch((err) =>
        logger.warn(`[tempvoice] Besitzer-Übergabe beim Start fehlgeschlagen: ${err.message}`),
      );
    }
  }
}

/* ----------------------------------------------------------------
 *  Steuer-Aktionen (von den Button-/Select-/Modal-Handlern genutzt)
 * ---------------------------------------------------------------- */

/** @returns {{ ok: boolean, row?: object, reason?: string }} */
function assertControl(channelId, member) {
  const row = tempVoice.get(channelId);
  if (!row) return { ok: false, reason: L('Das ist kein temporärer Sprachkanal.', 'This is not a temporary voice channel.') };
  if (row.owner_id === member.id || isManager(member)) return { ok: true, row };
  return { ok: false, reason: L('Nur der Besitzer dieses Kanals kann das ändern.', 'Only the owner of this channel can change that.') };
}

async function rename(channel, newName) {
  const name = String(newName || '').trim().slice(0, 100);
  if (!name) throw new Error('Bitte einen Namen angeben.');
  await channel.setName(name, 'Temp-Voice: umbenannt');
  await refreshPanel(channel);
  return L('Kanal heißt jetzt **{name}**.', 'Channel is now called **{name}**.', { name });
}

async function setLimit(channel, value) {
  const n = Math.max(0, Math.min(MAX_LIMIT, Number.parseInt(value, 10) || 0));
  await channel.setUserLimit(n, 'Temp-Voice: Benutzerlimit');
  await refreshPanel(channel);
  return n === 0 ? L('Benutzerlimit entfernt.', 'User limit removed.') : L('Benutzerlimit auf **{n}** gesetzt.', 'User limit set to **{n}**.', { n });
}

async function toggleLock(channel, row) {
  const locked = !row.locked;
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { Connect: locked ? false : null });
  tempVoice.setFlags(channel.id, { locked });
  await refreshPanel(channel);
  return locked
    ? L('🔒 Kanal **gesperrt** – nur hinzugefügte Leute dürfen rein.', '🔒 Channel **locked** – only added people can join.')
    : L('🔓 Kanal ist wieder **frei**.', '🔓 Channel is **open** again.');
}

async function toggleHide(channel, row) {
  const hidden = !row.hidden;
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { ViewChannel: hidden ? false : null });
  tempVoice.setFlags(channel.id, { hidden });
  await refreshPanel(channel);
  return hidden ? L('🙈 Kanal ist jetzt **versteckt**.', '🙈 Channel is now **hidden**.') : L('👁️ Kanal ist wieder **sichtbar**.', '👁️ Channel is **visible** again.');
}

async function setRegion(channel, region) {
  const value = !region || region === 'auto' ? null : region;
  await channel.setRTCRegion(value, 'Temp-Voice: Region');
  return value ? L('🌍 Region auf **{v}** gesetzt.', '🌍 Region set to **{v}**.', { v: value }) : L('🌍 Region auf **Automatisch** gesetzt.', '🌍 Region set to **Automatic**.');
}

async function permitUser(channel, targetId) {
  await channel.permissionOverwrites.edit(targetId, { ViewChannel: true, Connect: true });
  return L('➕ {user} darf jetzt beitreten.', '➕ {user} can now join.', { user: `<@${targetId}>` });
}

async function rejectUser(channel, targetId, row) {
  if (targetId === row.owner_id) throw new Error(L('Den Besitzer kannst du nicht entfernen.', 'You can\'t remove the owner.'));
  await channel.permissionOverwrites.delete(targetId, L('Temp-Voice: Zugriff entfernt', 'Temp voice: access removed')).catch(() => null);
  const m = channel.members.get(targetId);
  if (m) await m.voice.disconnect(L('Temp-Voice: entfernt', 'Temp voice: removed')).catch(() => null);
  return L('➖ {user} wurde entfernt.', '➖ {user} was removed.', { user: `<@${targetId}>` });
}

async function blockUser(channel, targetId, row) {
  if (targetId === row.owner_id) throw new Error(L('Den Besitzer kannst du nicht blockieren.', 'You can\'t block the owner.'));
  await channel.permissionOverwrites.edit(targetId, { ViewChannel: false, Connect: false });
  const m = channel.members.get(targetId);
  if (m) await m.voice.disconnect('Temp-Voice: blockiert').catch(() => null);
  return L('🚫 {user} ist jetzt **blockiert**.', '🚫 {user} is now **blocked**.', { user: `<@${targetId}>` });
}

async function unblockUser(channel, targetId) {
  await channel.permissionOverwrites.delete(targetId, 'Temp-Voice: entblockiert').catch(() => null);
  return L('♻️ {user} ist nicht mehr blockiert.', '♻️ {user} is no longer blocked.', { user: `<@${targetId}>` });
}

async function disconnectUser(channel, targetId, row) {
  if (targetId === row.owner_id) throw new Error(L('Dich selbst kannst du hier nicht trennen.', 'You can\'t disconnect yourself here.'));
  const m = channel.members.get(targetId);
  if (!m) throw new Error(L('Diese Person ist nicht in deinem Kanal.', 'This person is not in your channel.'));
  await m.voice.disconnect('Temp-Voice: getrennt');
  return L('🔌 {user} wurde aus dem Kanal getrennt.', '🔌 {user} was disconnected from the channel.', { user: `<@${targetId}>` });
}

async function destroy(channel) {
  tempVoice.remove(channel.id);
  presence.delete(channel.id);
  await channel.delete(L('Temp-Voice: vom Besitzer gelöscht', 'Temp voice: deleted by owner'));
}

module.exports = {
  onVoiceUpdate,
  cleanup,
  assertControl,
  refreshPanel,
  panelEmbed,
  panelComponents,
  postOrUpdateInterface,
  ensureInterfaces,
  resolveUserChannel,
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
  destroy,
  MAX_LIMIT,
};
