'use strict';

const { EmbedBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const client = require('../core/client');
const settingsModel = require('../database/models/settings');
const botConfig = require('../database/models/botConfig');
const ticketsModel = require('../database/models/tickets');
const ticketService = require('./ticketService');
const logService = require('./logService');
const embeds = require('../utils/embeds');
const config = require('../../config/config');
const { discordTimestamp } = require('../utils/time');

/**
 * ModMail (Bot-Support per DM).
 * Schreibt jemand dem Bot eine DM, wird daraus ein Ticket auf EINEM festen
 * Support-Server (bot-weit in bot_config, nur vom Bot-Besitzer einstellbar –
 * genau wie der Bot-Status). Nachrichten laufen in beide Richtungen:
 * DM -> Ticket-Kanal, Team-Antwort -> DM. Baut auf dem bestehenden
 * Ticket-System auf (tickets-Tabelle mit is_modmail = 1).
 */

const NOTE_PREFIX = '//'; // Team-Nachricht mit diesem Präfix wird NICHT an den Nutzer weitergeleitet
const CREATE_COOLDOWN_MS = 800; // Drossel nur fürs Ticket-Erstellen

const lastCreate = new Map(); // userId -> letzter Erstell-Zeitpunkt
const opening = new Set(); // userId -> läuft gerade eine Ticket-Erstellung

function attachmentUrls(message) {
  return [...(message.attachments?.values() || [])].map((a) => a.url);
}

function relayEmbed({ name, iconURL, color, content, files }) {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: String(name).slice(0, 256), iconURL })
    .setDescription([content, ...files].filter(Boolean).join('\n').slice(0, 4000) || '*(kein Text)*')
    .setTimestamp();
}

async function dmUser(dmChannelId, payload) {
  if (!dmChannelId) return;
  const dm = await client.channels.fetch(dmChannelId).catch(() => null);
  if (dm) await dm.send(payload).catch(() => null);
}

/** Der eine konfigurierte Support-Server – oder null, wenn ModMail aus / nicht eingerichtet. */
function supportGuild() {
  const c = botConfig.get();
  if (!c.modmail_enabled || !c.modmail_guild_id) return null;
  return client.guilds.cache.get(c.modmail_guild_id) || null;
}

function friendlyOpenError(err) {
  if (err.message === 'kein-kanal') return 'Der Bot-Support ist noch nicht fertig eingerichtet (keine Kategorie hinterlegt).';
  if (err.message === 'bot-rechte') return 'Dem Bot fehlt auf dem Support-Server die Berechtigung „Kanäle verwalten".';
  return 'Beim Erstellen des Tickets ist etwas schiefgelaufen.';
}

/** Erstellt einen ModMail-Ticket-Kanal auf dem Support-Server und leitet die erste Nachricht weiter. */
async function openThread(user, firstContent, files = []) {
  const c = botConfig.get();
  const guild = client.guilds.cache.get(c.modmail_guild_id);
  if (!guild) throw new Error('kein-kanal');

  const settings = settingsModel.get(guild.id);
  const categoryId = c.modmail_category_id || settings.ticket_category_id;
  if (!categoryId) throw new Error('kein-kanal');
  const category =
    guild.channels.cache.get(categoryId) ?? (await guild.channels.fetch(categoryId).catch(() => null));
  if (!category || category.type !== ChannelType.GuildCategory) throw new Error('kein-kanal');

  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageChannels)) throw new Error('bot-rechte');

  const supportRoleId = c.modmail_support_role_id || settings.ticket_support_role_id;
  const supportPerms = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.AttachFiles,
    PermissionsBitField.Flags.EmbedLinks,
  ];
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
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

  const number = settingsModel.incrementTicketCounter(guild.id);
  const name = `modmail-${String(number).padStart(4, '0')}`;

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: overwrites,
    topic: `ModMail #${number} • DM von ${user.tag} (${user.id})`,
  });

  const dmChannel = await user.createDM().catch(() => null);
  const ticket = ticketsModel.createModmail({
    guildId: guild.id,
    channelId: channel.id,
    number,
    openerId: user.id,
    dmChannelId: dmChannel?.id ?? null,
  });
  ticketsModel.touch(ticket.id);

  const header = new EmbedBuilder()
    .setColor(config.branding.color)
    .setAuthor({ name: `${user.tag} (${user.id})`, iconURL: user.displayAvatarURL() })
    .setTitle(`📨 ModMail #${number}`)
    .setDescription(
      'Dieser Kanal ist mit den **Direktnachrichten** dieser Person verbunden. Alles, was das Team hier schreibt, ' +
        `bekommt sie als DM.\nInterne Notiz? Nachricht mit \`${NOTE_PREFIX}\` beginnen – die wird **nicht** weitergeleitet.`,
    )
    .addFields(
      { name: 'Nutzer', value: `<@${user.id}>`, inline: true },
      { name: 'Erstellt', value: discordTimestamp(Date.now(), 'F'), inline: true },
    )
    .setTimestamp();

  const ping = supportRoleId && settings.ticket_team_ping !== 0 ? `<@&${supportRoleId}>` : undefined;
  await channel.send({
    content: ping,
    embeds: [header],
    components: [ticketService.buildManagementRow(ticket)],
  });

  if (firstContent || files.length) {
    await channel
      .send({
        embeds: [
          relayEmbed({
            name: user.tag,
            iconURL: user.displayAvatarURL(),
            color: config.branding.color,
            content: firstContent,
            files,
          }),
        ],
      })
      .catch(() => null);
  }

  await dmUser(dmChannel?.id, {
    embeds: [
      embeds.success(
        '📨 Anfrage aufgenommen',
        'Deine Nachricht ist beim Support-Team angekommen. Antworte einfach hier weiter – ich leite alles weiter, bis das Anliegen geschlossen wird.',
      ),
    ],
  });

  await logService.log({
    guildId: guild.id,
    category: 'ticket',
    type: 'ticket_create',
    title: '📨 ModMail-Ticket erstellt',
    color: config.branding.success,
    fields: [
      { name: 'Ticket', value: `#${number} (<#${channel.id}>)`, inline: true },
      { name: 'Von', value: `<@${user.id}>`, inline: true },
    ],
    actorId: user.id,
    overrideChannelId: c.modmail_log_channel_id || undefined,
    meta: { ticketId: ticket.id, modmail: true },
  });

  return { channel, ticket };
}

/** DM des Nutzers -> in seinen ModMail-Kanal spiegeln (oder Ticket öffnen). */
async function relayDmToChannel(message) {
  const userId = message.author.id;
  const existing = ticketsModel.findActiveModmailForUser(userId);

  if (existing) {
    const guild = client.guilds.cache.get(existing.guild_id);
    const channel = guild
      ? guild.channels.cache.get(existing.channel_id) ??
        (await guild.channels.fetch(existing.channel_id).catch(() => null))
      : null;

    if (!channel) {
      // Kanal wurde entfernt -> Ticket schließen, damit die nächste DM neu startet
      ticketsModel.markDeleted(existing.id, client.user.id);
    } else {
      if (existing.status === 'closed') {
        // reopenTicket meldet dem Nutzer per notifyStateChange, dass das Anliegen wieder offen ist
        await ticketService.reopenTicket(channel, { id: client.user.id, user: client.user }).catch(() => null);
      }
      await channel
        .send({
          embeds: [
            relayEmbed({
              name: message.author.tag,
              iconURL: message.author.displayAvatarURL(),
              color: config.branding.color,
              content: message.content,
              files: attachmentUrls(message),
            }),
          ],
        })
        .catch(() => null);
      ticketsModel.touch(existing.id);
      await message.react('📨').catch(() => null);
      return;
    }
  }

  // Kein aktives Ticket -> neues auf dem Support-Server öffnen
  const guild = supportGuild();
  if (!guild) {
    await message.channel
      .send({
        embeds: [
          embeds.warning(
            'Support nicht erreichbar',
            'Der Bot-Support ist aktuell nicht verfügbar. Bitte versuch es später noch einmal.',
          ),
        ],
      })
      .catch(() => null);
    return;
  }

  // Drossel + Sperre nur fürs Erstellen (Kanal-Erstellung ist teuer)
  const now = Date.now();
  if (now - (lastCreate.get(userId) || 0) < CREATE_COOLDOWN_MS) return;
  if (opening.has(userId)) return;
  lastCreate.set(userId, now);
  opening.add(userId);
  try {
    await openThread(message.author, message.content, attachmentUrls(message));
  } catch (err) {
    await message.channel.send({ embeds: [embeds.error(undefined, friendlyOpenError(err))] }).catch(() => null);
  } finally {
    opening.delete(userId);
  }
}

/** Team-Nachricht im ModMail-Kanal -> an den Nutzer weiterleiten. */
async function relayChannelToDm(message) {
  if (message.author.bot) return;
  const ticket = ticketsModel.getByChannel(message.channelId);
  if (!ticket || !ticket.is_modmail || ticket.status === 'deleted') return;
  if (message.author.id === ticket.opener_id) return; // der Nutzer selbst schreibt hier nicht
  if ((message.content || '').startsWith(NOTE_PREFIX)) return; // interne Notiz

  await dmUser(ticket.dm_channel_id, {
    embeds: [
      relayEmbed({
        name: `${message.member?.displayName || message.author.username} • Team`,
        iconURL: message.author.displayAvatarURL(),
        color: config.branding.success,
        content: message.content,
        files: attachmentUrls(message),
      }),
    ],
  });
  ticketsModel.touch(ticket.id);
  await message.react('📨').catch(() => null);
}

/** Vom ticketService aufgerufen, nachdem ein ModMail-Ticket geschlossen/geöffnet/gelöscht wurde. */
async function notifyStateChange(ticket, action) {
  if (!ticket?.is_modmail || !ticket.dm_channel_id) return;
  const map = {
    close: embeds.warning(
      '🔒 Anliegen geschlossen',
      'Dein Anliegen wurde geschlossen. Schreib mir einfach wieder, wenn du weiter Hilfe brauchst.',
    ),
    reopen: embeds.success('🔓 Anliegen wieder offen', 'Dein Anliegen ist wieder offen – du kannst hier weiterschreiben.'),
    delete: embeds.error('🗑️ Anliegen abgeschlossen', 'Dein Anliegen wurde abgeschlossen. Bei Bedarf kannst du mir jederzeit neu schreiben.'),
  };
  if (map[action]) await dmUser(ticket.dm_channel_id, { embeds: [map[action]] });
}

module.exports = { openThread, relayDmToChannel, relayChannelToDm, notifyStateChange, supportGuild };
