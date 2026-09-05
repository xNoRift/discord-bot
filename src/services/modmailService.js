'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionsBitField,
} = require('discord.js');
const client = require('../core/client');
const settingsModel = require('../database/models/settings');
const ticketsModel = require('../database/models/tickets');
const ticketService = require('./ticketService');
const logService = require('./logService');
const embeds = require('../utils/embeds');
const config = require('../../config/config');
const { discordTimestamp } = require('../utils/time');

/**
 * ModMail: Schreibt jemand dem Bot eine DM, wird daraus ein Ticket auf einem
 * Server erstellt. Nachrichten werden zwischen DM und Ticket-Kanal in beide
 * Richtungen weitergeleitet. Baut auf dem bestehenden Ticket-System auf
 * (tickets-Tabelle mit is_modmail = 1, buildManagementRow, close/reopen/delete).
 */

const NOTE_PREFIX = '//'; // Nachrichten im Ticket, die damit anfangen, werden NICHT an den Nutzer weitergeleitet
const RELAY_COOLDOWN_MS = 700; // simple Drossel pro Nutzer

// userId -> { content, files:[url], expiresAt }  (wartet auf Server-Auswahl)
const pending = new Map();
// userId -> letzter Relay-Zeitpunkt
const lastRelay = new Map();
// userId -> true, solange gerade ein Thread erstellt wird (verhindert Doppel-Tickets bei schnellen DMs)
const opening = new Set();

function cleanPending() {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k);
}

function attachmentUrls(message) {
  return [...(message.attachments?.values() || [])].map((a) => a.url);
}

/** Server, auf denen ModMail an ist UND der Nutzer Mitglied ist. */
async function resolvableGuilds(userId) {
  const out = [];
  for (const guild of client.guilds.cache.values()) {
    const s = settingsModel.get(guild.id);
    if (!s.modmail_enabled) continue;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) out.push(guild);
  }
  return out;
}

async function notifyUserDM(dmChannelId, payload) {
  if (!dmChannelId) return;
  const dm = await client.channels.fetch(dmChannelId).catch(() => null);
  if (dm) await dm.send(payload).catch(() => null);
}

/** Erstellt einen ModMail-Ticket-Kanal und leitet die erste Nachricht weiter. */
async function openThread(guild, user, firstContent, files = []) {
  const settings = settingsModel.get(guild.id);

  const categoryId = settings.modmail_category_id || settings.ticket_category_id;
  if (!categoryId) throw new Error('kein-kanal');
  const category =
    guild.channels.cache.get(categoryId) ?? (await guild.channels.fetch(categoryId).catch(() => null));
  if (!category || category.type !== ChannelType.GuildCategory) throw new Error('kein-kanal');

  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageChannels)) throw new Error('bot-rechte');

  const supportRoleId = settings.modmail_support_role_id || settings.ticket_support_role_id;
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
        `bekommt sie als DM.\nInterne Notizen: Nachricht mit \`${NOTE_PREFIX}\` beginnen – die wird **nicht** weitergeleitet.`,
    )
    .addFields(
      { name: 'Nutzer', value: `<@${user.id}>`, inline: true },
      { name: 'Erstellt', value: discordTimestamp(Date.now(), 'F'), inline: true },
    )
    .setTimestamp();

  const pings = supportRoleId && settings.ticket_team_ping !== 0 ? `<@&${supportRoleId}>` : '';
  await channel.send({
    content: pings || undefined,
    embeds: [header],
    components: [ticketService.buildManagementRow(ticket)],
  });

  // Erste Nachricht des Nutzers weiterleiten
  if (firstContent || files.length) {
    await channel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(config.branding.color)
            .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
            .setDescription([firstContent, ...files].filter(Boolean).join('\n').slice(0, 4000) || '*(kein Text)*')
            .setTimestamp(),
        ],
      })
      .catch(() => null);
  }

  await notifyUserDM(dmChannel?.id, {
    embeds: [
      embeds.success(
        '📨 Anfrage aufgenommen',
        `Deine Nachricht wurde an das Team von **${guild.name}** weitergeleitet. Antworte einfach hier weiter – ich leite alles weiter, bis das Ticket geschlossen wird.`,
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
    overrideChannelId: settings.modmail_log_channel_id || undefined,
    meta: { ticketId: ticket.id, modmail: true },
  });

  return { channel, ticket };
}

/** DM des Nutzers -> in seinen ModMail-Kanal spiegeln. */
async function relayDmToChannel(message) {
  cleanPending();
  const userId = message.author.id;

  const existing = ticketsModel.findActiveModmailForUser(userId);

  if (existing) {
    const guild = client.guilds.cache.get(existing.guild_id);
    const channel = guild
      ? guild.channels.cache.get(existing.channel_id) ?? (await guild.channels.fetch(existing.channel_id).catch(() => null))
      : null;
    if (!channel) {
      // Kanal ist weg -> Ticket als gelöscht markieren, damit eine neue DM ein neues Ticket startet
      ticketsModel.markDeleted(existing.id, client.user.id);
    } else {
      if (existing.status === 'closed') {
        // reopenTicket meldet dem Nutzer per notifyStateChange, dass das Anliegen wieder offen ist
        await ticketService.reopenTicket(channel, { id: client.user.id, user: client.user }).catch(() => null);
      }
      const files = attachmentUrls(message);
      await channel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(config.branding.color)
              .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
              .setDescription([message.content, ...files].filter(Boolean).join('\n').slice(0, 4000) || '*(kein Text)*')
              .setTimestamp(),
          ],
        })
        .catch(() => null);
      ticketsModel.touch(existing.id);
      await message.react('📨').catch(() => null);
      return;
    }
  }

  // Kein aktives Ticket -> Server bestimmen.
  // Drossel nur für DIESEN Pfad (Kanal-Erstellung ist teuer, Relay in bestehende Tickets nicht).
  const now = Date.now();
  if (now - (lastRelay.get(userId) || 0) < RELAY_COOLDOWN_MS) return;
  lastRelay.set(userId, now);

  // Läuft schon eine Thread-Erstellung / eine Server-Auswahl offen -> nicht doppelt anstoßen
  if (opening.has(userId) || pending.has(userId)) return;
  opening.add(userId);
  try {
    const guilds = await resolvableGuilds(userId);
    if (!guilds.length) {
      await message.channel
        .send({
          embeds: [
            embeds.warning(
              'Kein Support möglich',
              'Ich kann dir hier gerade nicht weiterhelfen. Schreib bitte direkt auf dem Server, auf dem du Hilfe brauchst.',
            ),
          ],
        })
        .catch(() => null);
      return;
    }

    const files = attachmentUrls(message);
    if (guilds.length === 1) {
      try {
        await openThread(guilds[0], message.author, message.content, files);
      } catch (err) {
        await message.channel.send({ embeds: [embeds.error(undefined, friendlyOpenError(err))] }).catch(() => null);
      }
      return;
    }

    // Mehrere Server -> Auswahl
    pending.set(userId, { content: message.content, files, expiresAt: Date.now() + 10 * 60 * 1000 });
    await message.channel
      .send({
        embeds: [embeds.brand('Für welchen Server?', 'Du bist auf mehreren Servern mit ModMail. Wähle aus, wohin deine Anfrage soll:')],
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('modmail:guild')
              .setPlaceholder('Server wählen…')
              .addOptions(guilds.slice(0, 25).map((g) => ({ label: g.name.slice(0, 100), value: g.id }))),
          ),
        ],
      })
      .catch(() => null);
  } finally {
    opening.delete(userId);
  }
}

function friendlyOpenError(err) {
  if (err.message === 'kein-kanal') return 'Der Server hat ModMail noch nicht fertig eingerichtet (keine Kategorie).';
  if (err.message === 'bot-rechte') return 'Dem Bot fehlt auf dem Server die Berechtigung „Kanäle verwalten".';
  return 'Da ist beim Erstellen des Tickets etwas schiefgelaufen.';
}

/** Nach einer Server-Auswahl im Select-Menü. */
async function resolveGuildChoice(interaction) {
  cleanPending();
  const p = pending.get(interaction.user.id);
  const guild = client.guilds.cache.get(interaction.values[0]);
  if (!guild) {
    return interaction.reply({ embeds: [embeds.error(undefined, 'Server nicht gefunden.')] }).catch(() => null);
  }

  pending.delete(interaction.user.id);
  await interaction.deferUpdate().catch(() => null);
  if (opening.has(interaction.user.id)) return;
  opening.add(interaction.user.id);
  try {
    await openThread(guild, interaction.user, p?.content || '', p?.files || []);
    await interaction.message.edit({ components: [] }).catch(() => null);
  } catch (err) {
    await interaction.followUp({ embeds: [embeds.error(undefined, friendlyOpenError(err))] }).catch(() => null);
  } finally {
    opening.delete(interaction.user.id);
  }
}

/** Team-Nachricht im ModMail-Kanal -> an den Nutzer weiterleiten. */
async function relayChannelToDm(message) {
  if (message.author.bot) return;
  const ticket = ticketsModel.getByChannel(message.channelId);
  if (!ticket || !ticket.is_modmail || ticket.status === 'deleted') return;
  if (message.author.id === ticket.opener_id) return; // der Nutzer selbst schreibt hier nicht
  if ((message.content || '').startsWith(NOTE_PREFIX)) return; // interne Notiz

  const files = attachmentUrls(message);
  await notifyUserDM(ticket.dm_channel_id, {
    embeds: [
      new EmbedBuilder()
        .setColor(config.branding.success)
        .setAuthor({ name: `${message.member?.displayName || message.author.username} • Team`, iconURL: message.author.displayAvatarURL() })
        .setDescription([message.content, ...files].filter(Boolean).join('\n').slice(0, 4000) || '*(kein Text)*')
        .setTimestamp(),
    ],
  });
  ticketsModel.touch(ticket.id);
  await message.react('📨').catch(() => null);
}

/** Vom ticketService aufgerufen, nachdem ein ModMail-Ticket geschlossen/… wurde. */
async function notifyStateChange(ticket, action, actor) {
  if (!ticket?.is_modmail || !ticket.dm_channel_id) return;
  const map = {
    close: embeds.warning('🔒 Anliegen geschlossen', 'Dein Anliegen wurde geschlossen. Schreib mir einfach wieder, wenn du weiter Hilfe brauchst.'),
    reopen: embeds.success('🔓 Anliegen wieder offen', 'Dein Anliegen ist wieder offen – du kannst hier weiterschreiben.'),
    delete: embeds.error('🗑️ Anliegen abgeschlossen', 'Dein Anliegen wurde abgeschlossen. Bei Bedarf kannst du mir jederzeit neu schreiben.'),
  };
  if (map[action]) await notifyUserDM(ticket.dm_channel_id, { embeds: [map[action]] });
}

module.exports = { openThread, relayDmToChannel, relayChannelToDm, resolveGuildChoice, notifyStateChange, resolvableGuilds };
