'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const client = require('../core/client');
const giveaways = require('../database/models/giveaways');
const settingsModel = require('../database/models/settings');
const temporaryRoleService = require('./temporaryRoleService');
const logService = require('./logService');
const embeds = require('../utils/embeds');
const config = require('../../config/config');
const logger = require('../utils/logger');
const { formatDuration, discordTimestamp } = require('../utils/time');

/**
 * Giveaway-Logik: Erstellen, Anzeige aktualisieren, Beenden, Neu-Auslosen.
 */

const timers = new Map(); // giveawayId -> Timeout
const MAX_TIMEOUT = 2_147_483_000;

function clearGiveawayTimer(id) {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

function scheduleEnd(giveaway) {
  clearGiveawayTimer(giveaway.id);
  if (giveaway.ended || giveaway.cancelled) return;

  const delay = giveaway.ends_at - Date.now();
  if (delay > MAX_TIMEOUT) {
    const t = setTimeout(() => scheduleEnd(giveaways.get(giveaway.id)), MAX_TIMEOUT);
    timers.set(giveaway.id, t);
    return;
  }

  const t = setTimeout(() => {
    endGiveaway(giveaway.id, { reason: 'time' }).catch((err) =>
      logger.error(`[giveaway] Beenden von #${giveaway.id} fehlgeschlagen:`, err.message),
    );
  }, Math.max(0, delay));
  timers.set(giveaway.id, t);
}

/* ---------------- Nachrichten-Aufbau ---------------- */

function buildActiveMessage(giveaway, entryCount) {
  const embed = new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle('🎉 GIVEAWAY 🎉')
    .setDescription(
      [
        `### ${giveaway.prize}`,
        giveaway.description ? `\n${giveaway.description}\n` : '',
        `**Endet:** ${discordTimestamp(giveaway.ends_at, 'F')} (${discordTimestamp(giveaway.ends_at, 'R')})`,
        `**Gewinner:** ${giveaway.winner_count}`,
        giveaway.host_id ? `**Veranstalter:** <@${giveaway.host_id}>` : '',
        giveaway.required_role_id ? `**Benötigte Rolle:** <@&${giveaway.required_role_id}>` : '',
        giveaway.winner_role_id
          ? `**Gewinnerrolle:** <@&${giveaway.winner_role_id}> für ${formatDuration(
              giveaway.winner_role_duration_ms || settingsModel.get(giveaway.guild_id).giveaway_winner_role_duration_ms,
            )}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({ text: `${entryCount} Teilnahme${entryCount === 1 ? '' : 'n'} • Giveaway-ID ${giveaway.id}` })
    .setTimestamp(giveaway.ends_at);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:enter:${giveaway.id}`)
      .setLabel('Teilnehmen')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Success),
  );

  return { embeds: [embed], components: [row] };
}

function buildEndedMessage(giveaway, winnerIds, entryCount) {
  const embed = new EmbedBuilder()
    .setColor(winnerIds.length ? config.branding.success : config.branding.danger)
    .setTitle('🎉 GIVEAWAY BEENDET 🎉')
    .setDescription(
      [
        `### ${giveaway.prize}`,
        giveaway.description ? `\n${giveaway.description}\n` : '',
        `**Beendet:** ${discordTimestamp(Date.now(), 'F')}`,
        giveaway.host_id ? `**Veranstalter:** <@${giveaway.host_id}>` : '',
        '',
        winnerIds.length
          ? `**Gewinner:**\n${winnerIds.map((id) => `> 🏆 <@${id}>`).join('\n')}`
          : '**Es gab keine gültigen Teilnahmen – kein Gewinner.**',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({ text: `${entryCount} Teilnahme${entryCount === 1 ? '' : 'n'} • Giveaway-ID ${giveaway.id}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:enter:${giveaway.id}`)
      .setLabel('Teilnehmen')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
  );

  return { embeds: [embed], components: [row] };
}

async function fetchGiveawayMessage(giveaway) {
  const guild = client.guilds.cache.get(giveaway.guild_id);
  if (!guild) return null;
  const channel =
    guild.channels.cache.get(giveaway.channel_id) ??
    (await guild.channels.fetch(giveaway.channel_id).catch(() => null));
  if (!channel || !channel.isTextBased()) return null;
  if (!giveaway.message_id) return { channel, message: null };
  const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
  return { channel, message };
}

async function refreshGiveawayMessage(giveawayId) {
  const giveaway = giveaways.get(giveawayId);
  if (!giveaway || giveaway.ended) return;
  const found = await fetchGiveawayMessage(giveaway);
  if (!found || !found.message) return;
  const count = giveaways.countEntries(giveawayId);
  await found.message.edit(buildActiveMessage(giveaway, count)).catch(() => null);
}

/* ---------------- Erstellen ---------------- */

/**
 * @param {import('discord.js').Guild} guild
 * @param {object} data
 * @param {string} data.prize
 * @param {number} data.durationMs
 * @param {number} data.winnerCount
 * @param {string} [data.channelId]
 * @param {string} [data.description]
 * @param {string} [data.requiredRoleId]
 * @param {string} [data.hostId]
 * @param {boolean} [data.useWinnerRole]  Gewinnerrolle vergeben? (Default true, wenn konfiguriert)
 * @param {string} [data.winnerRoleId]
 * @param {number} [data.winnerRoleDurationMs]
 */
async function createGiveaway(guild, data) {
  const settings = settingsModel.get(guild.id);
  const channelId = data.channelId || settings.giveaway_channel_id;
  if (!channelId) throw new Error('Kein Giveaway-Kanal angegeben oder konfiguriert.');

  const channel =
    guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel || !channel.isTextBased()) throw new Error('Giveaway-Kanal nicht gefunden oder kein Textkanal.');

  const durationMs = Number(data.durationMs);
  if (!Number.isFinite(durationMs) || durationMs < 10_000) {
    throw new Error('Ungültige Dauer (mindestens 10 Sekunden).');
  }
  const winnerCount = Math.max(1, Number.parseInt(data.winnerCount ?? 1, 10) || 1);

  const useWinnerRole = data.useWinnerRole ?? true;
  const winnerRoleId = useWinnerRole ? data.winnerRoleId || settings.giveaway_winner_role_id || null : null;
  const winnerRoleDurationMs =
    data.winnerRoleDurationMs || settings.giveaway_winner_role_duration_ms || config.defaults.giveawayWinnerRoleDurationMs;

  const endsAt = Date.now() + durationMs;

  let giveaway = giveaways.create({
    guildId: guild.id,
    channelId,
    prize: data.prize,
    description: data.description ?? null,
    winnerCount,
    requiredRoleId: data.requiredRoleId ?? null,
    hostId: data.hostId ?? null,
    endsAt,
    winnerRoleId,
    winnerRoleDurationMs: winnerRoleId ? winnerRoleDurationMs : null,
  });

  const message = await channel.send(buildActiveMessage(giveaway, 0));
  giveaways.setMessageId(giveaway.id, message.id);
  giveaway = giveaways.get(giveaway.id);

  scheduleEnd(giveaway);

  await logService.log({
    guildId: guild.id,
    category: 'giveaway',
    type: 'giveaway_create',
    title: '🎉 Giveaway erstellt',
    color: config.branding.color,
    fields: [
      { name: 'Preis', value: giveaway.prize, inline: true },
      { name: 'Gewinner', value: String(winnerCount), inline: true },
      { name: 'Dauer', value: formatDuration(durationMs), inline: true },
      { name: 'Kanal', value: `<#${channelId}>`, inline: true },
      { name: 'Endet', value: discordTimestamp(endsAt, 'F'), inline: true },
      winnerRoleId
        ? { name: 'Gewinnerrolle', value: `<@&${winnerRoleId}> (${formatDuration(winnerRoleDurationMs)})`, inline: true }
        : { name: 'Gewinnerrolle', value: 'keine', inline: true },
    ],
    actorId: data.hostId,
    meta: { giveawayId: giveaway.id },
  });

  return giveaway;
}

/* ---------------- Gewinner ziehen ---------------- */

async function pickEligibleWinners(giveaway, { count, excludeIds = [] } = {}) {
  const guild = client.guilds.cache.get(giveaway.guild_id);
  if (!guild) return [];

  const entryIds = giveaways
    .getEntries(giveaway.id)
    .filter((id) => !excludeIds.includes(id));

  // Bei Rollen-Voraussetzung: Mitglieder pruefen.
  let pool = entryIds;
  if (giveaway.required_role_id) {
    pool = [];
    for (const id of entryIds) {
      const member = await guild.members.fetch(id).catch(() => null);
      if (member && member.roles.cache.has(giveaway.required_role_id)) pool.push(id);
    }
  }

  // Fisher-Yates Shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, Math.max(0, count));
}

async function assignWinnerRoles(giveaway, winnerIds) {
  if (!giveaway.winner_role_id || !winnerIds.length) return;
  const guild = client.guilds.cache.get(giveaway.guild_id);
  if (!guild) return;
  for (const userId of winnerIds) {
    const res = await temporaryRoleService
      .grantGiveawayRole(guild, userId, {
        giveawayId: giveaway.id,
        roleId: giveaway.winner_role_id,
        durationMs: giveaway.winner_role_duration_ms || undefined,
      })
      .catch((err) => ({ ok: false, reason: err.message }));
    if (!res.ok) {
      logger.warn(`[giveaway] Gewinnerrolle für ${userId} nicht vergeben: ${res.reason}`);
      await logService.log({
        guildId: giveaway.guild_id,
        category: 'giveaway',
        type: 'giveaway_role_failed',
        title: '⚠️ Gewinnerrolle konnte nicht vergeben werden',
        color: config.branding.danger,
        fields: [
          { name: 'Nutzer', value: `<@${userId}>`, inline: true },
          { name: 'Grund', value: res.reason || 'unbekannt', inline: false },
        ],
      });
    }
  }
}

async function announceWinners(giveaway, winnerIds) {
  const found = await fetchGiveawayMessage(giveaway);
  if (!found) return;
  const link = giveaway.message_id
    ? `https://discord.com/channels/${giveaway.guild_id}/${giveaway.channel_id}/${giveaway.message_id}`
    : null;

  if (winnerIds.length) {
    await found.channel
      .send({
        content: `🎉 Glückwunsch ${winnerIds.map((id) => `<@${id}>`).join(', ')}! Ihr habt **${giveaway.prize}** gewonnen!`,
        embeds: [
          embeds.success(
            '🏆 Giveaway Gewinner',
            [
              `**Preis:** ${giveaway.prize}`,
              `**Gewinner:** ${winnerIds.map((id) => `<@${id}>`).join(', ')}`,
              link ? `[Zum Giveaway](${link})` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          ),
        ],
      })
      .catch(() => null);
  } else {
    await found.channel
      .send({
        embeds: [
          embeds.error(
            '😕 Kein Gewinner',
            `Für **${giveaway.prize}** gab es keine gültigen Teilnahmen.`,
          ),
        ],
      })
      .catch(() => null);
  }
}

/**
 * Beendet ein Giveaway (durch Zeitablauf oder manuell) und lost die Gewinner aus.
 * @param {number} giveawayId
 * @param {object} [opts]
 * @param {string} [opts.actorId]
 * @param {string} [opts.reason] 'time' | 'manual'
 */
async function endGiveaway(giveawayId, opts = {}) {
  clearGiveawayTimer(giveawayId);
  const giveaway = giveaways.get(giveawayId);
  if (!giveaway) throw new Error('Giveaway nicht gefunden.');
  if (giveaway.ended) return giveaway;

  const winnerIds = await pickEligibleWinners(giveaway, { count: giveaway.winner_count });
  const entryCount = giveaways.countEntries(giveawayId);

  giveaways.markEnded(giveawayId, winnerIds);
  if (winnerIds.length) giveaways.recordWinners(giveawayId, winnerIds, { isReroll: false });

  const updated = giveaways.get(giveawayId);

  const found = await fetchGiveawayMessage(updated);
  if (found?.message) {
    await found.message.edit(buildEndedMessage(updated, winnerIds, entryCount)).catch(() => null);
  }

  await announceWinners(updated, winnerIds);
  await assignWinnerRoles(updated, winnerIds);

  await logService.log({
    guildId: giveaway.guild_id,
    category: 'giveaway',
    type: 'giveaway_end',
    title: '🎉 Giveaway beendet',
    color: config.branding.color,
    fields: [
      { name: 'Preis', value: giveaway.prize, inline: true },
      { name: 'Teilnahmen', value: String(entryCount), inline: true },
      {
        name: 'Gewinner',
        value: winnerIds.length ? winnerIds.map((id) => `<@${id}>`).join(', ') : 'keine',
        inline: false,
      },
      { name: 'Ausgelöst durch', value: opts.actorId ? `<@${opts.actorId}>` : 'Zeitablauf', inline: true },
    ],
    actorId: opts.actorId,
    meta: { giveawayId, winnerIds },
  });

  if (winnerIds.length) {
    await logService.log({
      guildId: giveaway.guild_id,
      category: 'giveaway',
      type: 'giveaway_winners',
      title: '🏆 Gewinner ausgewählt',
      color: config.branding.success,
      fields: [
        { name: 'Preis', value: giveaway.prize, inline: true },
        { name: 'Gewinner', value: winnerIds.map((id) => `<@${id}>`).join(', '), inline: false },
      ],
      meta: { giveawayId, winnerIds },
    });
  }

  return updated;
}

/**
 * Zieht neue Gewinner fuer ein bereits beendetes Giveaway.
 * @param {number} giveawayId
 * @param {object} [opts]
 * @param {number} [opts.count]           Anzahl neuer Gewinner (Default: winner_count)
 * @param {string[]} [opts.excludeIds]    zusaetzlich auszuschliessende IDs
 * @param {boolean} [opts.keepPrevious]   bisherige Gewinner behalten (Default false -> ersetzen)
 * @param {string} [opts.actorId]
 */
async function rerollGiveaway(giveawayId, opts = {}) {
  const giveaway = giveaways.get(giveawayId);
  if (!giveaway) throw new Error('Giveaway nicht gefunden.');
  if (!giveaway.ended) throw new Error('Das Giveaway läuft noch. Beende es zuerst.');

  const previousWinners = JSON.parse(giveaway.winners_json || '[]');
  const count = opts.count ?? giveaway.winner_count;
  const exclude = [...new Set([...(opts.keepPrevious ? [] : previousWinners), ...previousWinners, ...(opts.excludeIds ?? [])])];

  const newWinners = await pickEligibleWinners(giveaway, { count, excludeIds: exclude });
  if (!newWinners.length) throw new Error('Keine weiteren gültigen Teilnehmer für einen Reroll gefunden.');

  const finalWinners = opts.keepPrevious ? [...previousWinners, ...newWinners] : newWinners;
  giveaways.setWinners(giveawayId, finalWinners);
  giveaways.recordWinners(giveawayId, newWinners, { isReroll: true });

  const updated = giveaways.get(giveawayId);
  const entryCount = giveaways.countEntries(giveawayId);

  const found = await fetchGiveawayMessage(updated);
  if (found?.message) {
    await found.message.edit(buildEndedMessage(updated, finalWinners, entryCount)).catch(() => null);
  }

  if (found?.channel) {
    await found.channel
      .send({
        content: `🔁 Neuauslosung! Neue${newWinners.length === 1 ? 'r' : ''} Gewinner für **${giveaway.prize}**: ${newWinners
          .map((id) => `<@${id}>`)
          .join(', ')}`,
      })
      .catch(() => null);
  }

  await assignWinnerRoles(updated, newWinners);

  await logService.log({
    guildId: giveaway.guild_id,
    category: 'giveaway',
    type: 'giveaway_reroll',
    title: '🔁 Giveaway neu ausgelost',
    color: config.branding.warning,
    fields: [
      { name: 'Preis', value: giveaway.prize, inline: true },
      { name: 'Neue Gewinner', value: newWinners.map((id) => `<@${id}>`).join(', '), inline: false },
    ],
    actorId: opts.actorId,
    meta: { giveawayId, newWinners },
  });

  return { giveaway: updated, newWinners, finalWinners };
}

async function cancelGiveaway(giveawayId, opts = {}) {
  clearGiveawayTimer(giveawayId);
  const giveaway = giveaways.get(giveawayId);
  if (!giveaway) throw new Error('Giveaway nicht gefunden.');
  giveaways.markCancelled(giveawayId);

  const found = await fetchGiveawayMessage(giveaway);
  if (found?.message) {
    await found.message
      .edit({
        embeds: [embeds.error('🎉 Giveaway abgebrochen', `**${giveaway.prize}**\nDieses Giveaway wurde abgebrochen.`)],
        components: [],
      })
      .catch(() => null);
  }

  await logService.log({
    guildId: giveaway.guild_id,
    category: 'giveaway',
    type: 'giveaway_cancel',
    title: '🚫 Giveaway abgebrochen',
    color: config.branding.danger,
    fields: [{ name: 'Preis', value: giveaway.prize, inline: true }],
    actorId: opts.actorId,
    meta: { giveawayId },
  });

  return giveaways.get(giveawayId);
}

/* ---------------- Wiederherstellen / Sweep ---------------- */

async function restoreAll() {
  const active = giveaways.listAllActive();
  logger.info(`[giveaway] ${active.length} aktive Giveaway(s) werden wiederhergestellt.`);
  for (const g of active) {
    if (g.ends_at <= Date.now()) {
      await endGiveaway(g.id, { reason: 'time' }).catch((err) =>
        logger.error(`[giveaway] restore/end #${g.id}:`, err.message),
      );
    } else {
      scheduleEnd(g);
    }
  }
}

async function sweep() {
  for (const g of giveaways.listAllActive()) {
    if (g.ends_at <= Date.now() && !timers.has(g.id)) {
      await endGiveaway(g.id, { reason: 'time' }).catch(() => null);
    } else if (!timers.has(g.id)) {
      scheduleEnd(g);
    }
  }
}

module.exports = {
  createGiveaway,
  endGiveaway,
  rerollGiveaway,
  cancelGiveaway,
  refreshGiveawayMessage,
  restoreAll,
  sweep,
  scheduleEnd,
  buildActiveMessage,
};
