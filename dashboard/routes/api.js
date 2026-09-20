'use strict';

const express = require('express');
const { ChannelType, EmbedBuilder, PermissionFlagsBits, GatewayIntentBits } = require('discord.js');
const client = require('../../src/core/client');
const config = require('../../config/config');

const { requireAuth, requireOwner, verifyCsrf, loadGuild } = require('../middleware/auth');
const loginAudit = require('../../src/database/models/loginAudit');
const { apiLimiter, actionLimiter } = require('../middleware/rateLimit');
const guildAccess = require('../services/guildAccess');

const settingsModel = require('../../src/database/models/settings');
const ticketsModel = require('../../src/database/models/tickets');
const ticketPanels = require('../../src/database/models/ticketPanels');
const giveawaysModel = require('../../src/database/models/giveaways');
const giveawayTicketButtons = require('../../src/database/models/giveawayTicketButtons');
const appModel = require('../../src/database/models/applications');
const activity = require('../../src/database/models/activity');
const tempRolesModel = require('../../src/database/models/temporaryRoles');

const ticketService = require('../../src/services/ticketService');
const giveawayService = require('../../src/services/giveawayService');
const applicationService = require('../../src/services/applicationService');

const { parseDuration } = require('../../src/utils/time');

const router = express.Router();

router.use(requireAuth);
router.use(apiLimiter);
router.use(verifyCsrf);

/* ----------------------------------------------------------------
 *  Helpers
 * ---------------------------------------------------------------- */

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function serializeChannels(guild) {
  const list = [...guild.channels.cache.values()];
  return {
    categories: list
      .filter((c) => c.type === ChannelType.GuildCategory)
      .map((c) => ({ id: c.id, name: c.name, position: c.rawPosition }))
      .sort((a, b) => a.position - b.position),
    text: list
      .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
      .map((c) => ({ id: c.id, name: c.name, parentId: c.parentId, position: c.rawPosition }))
      .sort((a, b) => a.position - b.position),
    voice: list
      .filter((c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
      .map((c) => ({ id: c.id, name: c.name, parentId: c.parentId, position: c.rawPosition }))
      .sort((a, b) => a.position - b.position),
  };
}

function serializeRoles(guild) {
  return [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id) // @everyone raus
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.hexColor,
      managed: r.managed,
      position: r.position,
    }))
    .sort((a, b) => b.position - a.position);
}

function num(value, fallback = null) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/* ----------------------------------------------------------------
 *  Nutzer & Server-Liste
 * ---------------------------------------------------------------- */

router.get('/me', (req, res) => {
  res.json({ user: req.session.user, ownerIds: undefined });
});

router.get(
  '/guilds',
  asyncHandler(async (req, res) => {
    const data = await guildAccess.getManageableGuilds(req.session.user.id, {
      force: req.query.refresh === '1',
    });
    res.json(data);
  }),
);

function discordErr(err) {
  if (err?.code === 50013) return 'Dem Bot fehlt die nötige Berechtigung auf diesem Server.';
  if (err?.code === 50035) return 'Ungültige Eingabe.';
  return err?.message || 'Discord-Fehler.';
}

/* ----------------------------------------------------------------
 *  Bot-Status / Aktivität (bot-weit) – NUR Bot-Besitzer
 * ---------------------------------------------------------------- */

const botConfig = require('../../src/database/models/botConfig');
const presenceService = require('../../src/services/presenceService');
const tempVoiceService = require('../../src/services/tempVoiceService');

const STATUS = ['online', 'idle', 'dnd', 'invisible'];
const ACT_TYPES = ['none', 'playing', 'watching', 'listening', 'competing', 'streaming', 'custom'];

router.get('/bot/presence', requireOwner, (req, res) => {
  const c = botConfig.get();
  res.json({
    status: c.presence_status,
    activityType: c.activity_type,
    activityText: c.activity_text,
    activityUrl: c.activity_url,
  });
});

router.post(
  '/bot/presence',
  requireOwner,
  actionLimiter,
  asyncHandler(async (req, res) => {
    const patch = {};
    if (STATUS.includes(req.body.status)) patch.presence_status = req.body.status;
    if (ACT_TYPES.includes(req.body.activityType)) patch.activity_type = req.body.activityType;
    if (req.body.activityText !== undefined) patch.activity_text = String(req.body.activityText).slice(0, 128);
    if (req.body.activityUrl !== undefined) patch.activity_url = String(req.body.activityUrl).slice(0, 300);
    botConfig.update(patch);
    try {
      presenceService.apply();
    } catch {
      /* ignore */
    }
    res.json({ ok: true });
  }),
);

/* ----------------------------------------------------------------
 *  ModMail / Bot-Support per DM (bot-weit, NUR Bot-Besitzer)
 * ---------------------------------------------------------------- */

router.get('/bot/modmail', requireOwner, (req, res) => {
  const c = botConfig.get();
  res.json({
    enabled: c.modmail_enabled === 1,
    guildId: c.modmail_guild_id || null,
    categoryId: c.modmail_category_id || null,
    supportRoleId: c.modmail_support_role_id || null,
    logChannelId: c.modmail_log_channel_id || null,
  });
});

router.post(
  '/bot/modmail',
  requireOwner,
  actionLimiter,
  asyncHandler(async (req, res) => {
    const enabled = req.body.enabled === true || req.body.enabled === 'true' || req.body.enabled === 1;
    const patch = {
      modmail_enabled: enabled ? 1 : 0,
      modmail_category_id: req.body.categoryId ? String(req.body.categoryId) : null,
      modmail_support_role_id: req.body.supportRoleId ? String(req.body.supportRoleId) : null,
      modmail_log_channel_id: req.body.logChannelId ? String(req.body.logChannelId) : null,
    };

    if (enabled) {
      const guildId = String(req.body.guildId || '');
      if (!client.guilds.cache.has(guildId)) {
        return res.status(400).json({ error: 'Der Bot ist nicht auf diesem Server.' });
      }
      if (!patch.modmail_category_id) {
        return res.status(400).json({ error: 'Bitte eine Kategorie für die DM-Tickets wählen.' });
      }
      patch.modmail_guild_id = guildId;
    }

    botConfig.update(patch);
    res.json({ ok: true });
  }),
);

/* ----------------------------------------------------------------
 *  Sicherheit – Login-Protokoll (NUR Bot-Besitzer)
 * ---------------------------------------------------------------- */

router.get('/security/logins', requireOwner, (req, res) => {
  res.json({
    ownerOnly: config.dashboard.ownerOnly,
    owners: config.ownerIds,
    logins: loginAudit.recent(25).map((r) => ({
      userId: r.user_id,
      username: r.username,
      ip: r.ip,
      ok: !!r.ok,
      at: r.created_at,
    })),
  });
});

/* ----------------------------------------------------------------
 *  Ab hier: alles pro Guild (mit Zugriffsschutz)
 * ---------------------------------------------------------------- */

router.use('/guilds/:guildId', loadGuild);

/* --- Bot-Serverprofil: Nickname + Server-Avatar (nur auf DIESEM Server) --- */

router.get(
  '/guilds/:guildId/bot-member',
  asyncHandler(async (req, res) => {
    const me = req.guild.members.me ?? (await req.guild.members.fetchMe().catch(() => null));
    res.json({
      nick: me?.nickname ?? null,
      username: client.user?.username ?? null,
      avatarUrl:
        me?.displayAvatarURL?.({ size: 256, extension: 'png' }) ??
        client.user?.displayAvatarURL({ size: 256, extension: 'png' }) ??
        null,
    });
  }),
);

router.post(
  '/guilds/:guildId/bot-member/nick',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const nick = String(req.body.nick ?? '').trim().slice(0, 32);
    try {
      const me = req.guild.members.me ?? (await req.guild.members.fetchMe());
      await me.setNickname(nick || null, 'Geändert über das Dashboard');
      res.json({ ok: true, nick: nick || null });
    } catch (err) {
      res.status(400).json({ error: discordErr(err) });
    }
  }),
);

/** Bild hochladen (Embed-Bilder, Banner …) -> öffentliche URL. Body: { data: "data:image/png;base64,…" } */
router.post(
  '/guilds/:guildId/uploads',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const { url, bytes } = require('../../src/services/uploadService').saveImage(req.params.guildId, req.body.data);
    res.json({ ok: true, url, bytes });
  }),
);

router.post(
  '/guilds/:guildId/bot-member/avatar',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const data = String(req.body.avatar || '');
    const reset = data === 'reset' || data === '';
    if (!reset && !/^data:image\/(png|jpe?g|gif|webp);base64,/.test(data)) {
      return res.status(400).json({ error: 'Ungültiges Bild.' });
    }
    if (!reset && data.length > 10 * 1024 * 1024 * 1.4) {
      return res.status(413).json({ error: 'Bild zu groß (max. ~10 MB).' });
    }
    try {
      // "Aktuelles Mitglied bearbeiten" – setzt den Server-spezifischen Avatar des Bots
      await client.rest.patch(`/guilds/${req.guild.id}/members/@me`, {
        body: { avatar: reset ? null : data },
        reason: 'Server-Avatar über das Dashboard geändert',
      });
      const me = await req.guild.members.fetchMe();
      res.json({ ok: true, avatarUrl: me.displayAvatarURL({ size: 256, extension: 'png' }) });
    } catch (err) {
      const msg =
        err?.status === 400 || err?.code === 50035
          ? 'Server-Avatare für Bots sind für diese App/diesen Server nicht verfügbar.'
          : discordErr(err);
      res.status(400).json({ error: msg });
    }
  }),
);

router.get(
  '/guilds/:guildId/overview',
  asyncHandler(async (req, res) => {
    const g = req.guild;
    const tStats = ticketsModel.stats(g.id);
    const gStats = giveawaysModel.stats(g.id);
    const aStats = appModel.stats(g.id);
    res.json({
      guild: {
        id: g.id,
        name: g.name,
        icon: g.icon,
        memberCount: g.memberCount,
        ownerId: g.ownerId,
      },
      bot: {
        online: client.isReady?.() ?? false,
        ping: Math.max(0, Math.round(client.ws?.ping ?? 0)),
        guildCount: client.guilds?.cache?.size ?? 0,
      },
      tickets: tStats,
      giveaways: gStats,
      applications: aStats,
      tempRoles: tempRolesModel.listActiveByGuild(g.id).length,
      activity: activity.recent(g.id, 15),
    });
  }),
);

router.get('/guilds/:guildId/channels', (req, res) => res.json(serializeChannels(req.guild)));
router.get('/guilds/:guildId/roles', (req, res) => res.json(serializeRoles(req.guild)));

/* ----------------------------------------------------------------
 *  Server-Struktur – NUR Bot-Besitzer
 *  Kanäle & Kategorien erstellen, Rollen-Reihenfolge ändern.
 * ---------------------------------------------------------------- */

router.post(
  '/guilds/:guildId/channels',
  requireOwner,
  actionLimiter,
  asyncHandler(async (req, res) => {
    const me = req.guild.members.me ?? (await req.guild.members.fetchMe());
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return res.status(403).json({ error: 'Dem Bot fehlt die Berechtigung „Kanäle verwalten".' });
    }
    const name = String(req.body.name || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: 'Bitte einen Namen angeben.' });
    const kind = String(req.body.type || 'text');
    const typeMap = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, category: ChannelType.GuildCategory, announcement: ChannelType.GuildAnnouncement, stage: ChannelType.GuildStageVoice };
    const type = typeMap[kind];
    if (type === undefined) return res.status(400).json({ error: 'Unbekannter Kanaltyp.' });

    let parent;
    if (kind !== 'category' && req.body.parentId) {
      parent = req.guild.channels.cache.get(String(req.body.parentId));
      if (!parent || parent.type !== ChannelType.GuildCategory) {
        return res.status(400).json({ error: 'Die gewählte Kategorie existiert nicht.' });
      }
    }
    try {
      const ch = await req.guild.channels.create({
        name,
        type,
        parent: parent?.id,
        reason: `Dashboard (Besitzer): ${req.session.user.username}`,
      });
      res.json({ ok: true, channel: { id: ch.id, name: ch.name, type: kind, parentId: ch.parentId } });
    } catch (err) {
      res.status(400).json({ error: discordErr(err) });
    }
  }),
);

router.get(
  '/guilds/:guildId/roles/:roleId/permissions',
  requireOwner,
  asyncHandler(async (req, res) => {
    const role = req.guild.roles.cache.get(req.params.roleId);
    if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden.' });
    const me = req.guild.members.me ?? (await req.guild.members.fetchMe());
    const meAdmin = me.permissions.has(PermissionFlagsBits.Administrator);
    const canEdit =
      me.permissions.has(PermissionFlagsBits.ManageRoles) &&
      !role.managed &&
      (role.id === req.guild.id || role.position < me.roles.highest.position);
    res.json({
      name: role.name,
      isEveryone: role.id === req.guild.id,
      canEdit,
      permissions: role.permissions.toArray(),
      botPermissions: meAdmin ? Object.keys(PermissionFlagsBits) : me.permissions.toArray(),
    });
  }),
);

router.patch(
  '/guilds/:guildId/roles/:roleId/permissions',
  requireOwner,
  actionLimiter,
  asyncHandler(async (req, res) => {
    const role = req.guild.roles.cache.get(req.params.roleId);
    if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden.' });
    const me = req.guild.members.me ?? (await req.guild.members.fetchMe());
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return res.status(403).json({ error: 'Dem Bot fehlt die Berechtigung „Rollen verwalten".' });
    }
    if (role.managed) return res.status(400).json({ error: 'Diese Rolle wird von einer Integration verwaltet.' });
    if (role.id !== req.guild.id && role.position >= me.roles.highest.position) {
      return res.status(400).json({ error: 'Diese Rolle steht über der höchsten Bot-Rolle.' });
    }

    const wanted = (Array.isArray(req.body.permissions) ? req.body.permissions : [])
      .map(String)
      .filter((p) => Object.prototype.hasOwnProperty.call(PermissionFlagsBits, p));

    let finalPerms = wanted;
    if (!me.permissions.has(PermissionFlagsBits.Administrator)) {
      const botSet = new Set(me.permissions.toArray());
      const current = new Set(role.permissions.toArray());
      // Berechtigungen, die der Bot selbst nicht hat, bleiben unverändert.
      finalPerms = [
        ...new Set([
          ...wanted.filter((p) => botSet.has(p)),
          ...[...current].filter((p) => !botSet.has(p)),
        ]),
      ];
    }
    try {
      const updated = await role.setPermissions(finalPerms, `Dashboard (Besitzer): ${req.session.user.username}`);
      res.json({ ok: true, permissions: updated.permissions.toArray() });
    } catch (err) {
      res.status(400).json({ error: discordErr(err) });
    }
  }),
);

router.patch(
  '/guilds/:guildId/roles/order',
  requireOwner,
  actionLimiter,
  asyncHandler(async (req, res) => {
    const me = req.guild.members.me ?? (await req.guild.members.fetchMe());
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return res.status(403).json({ error: 'Dem Bot fehlt die Berechtigung „Rollen verwalten".' });
    }
    const order = Array.isArray(req.body.order) ? req.body.order.map(String) : [];
    if (order.length < 2) return res.status(400).json({ error: 'Ungültige Reihenfolge.' });

    const botTop = me.roles.highest.position;
    const roles = order.map((id) => req.guild.roles.cache.get(id)).filter(Boolean);
    if (roles.length !== order.length) return res.status(400).json({ error: 'Unbekannte Rolle in der Liste.' });
    for (const r of roles) {
      if (r.id === req.guild.id) return res.status(400).json({ error: '@everyone kann nicht verschoben werden.' });
      if (r.managed) return res.status(400).json({ error: `„${r.name}" wird von einer Integration verwaltet und kann nicht verschoben werden.` });
      if (r.position >= botTop) return res.status(400).json({ error: `„${r.name}" steht über der höchsten Bot-Rolle und kann nicht verschoben werden.` });
    }
    // Die betroffenen Positionen bleiben dieselben – nur neu verteilt (oben = höchste Position).
    const slots = roles.map((r) => r.position).sort((a, b) => b - a); // absteigend
    const payload = roles.map((r, i) => ({ role: r.id, position: slots[i] }));
    try {
      await req.guild.roles.setPositions(payload);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: discordErr(err) });
    }
  }),
);

/* ----------------------------------------------------------------
 *  Über den Bot in einen Kanal schreiben (auch: bestehende Bot-Nachricht bearbeiten)
 * ---------------------------------------------------------------- */

function parseHexColor(input) {
  const m = String(input || '').trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? parseInt(m[1], 16) : null;
}

router.post(
  '/guilds/:guildId/message',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const channelId = String(b.channelId || '');
    if (!/^\d{5,25}$/.test(channelId)) return res.status(400).json({ error: 'Bitte einen Kanal wählen.' });

    const channel = req.guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased?.() || channel.type === ChannelType.GuildCategory) {
      return res.status(400).json({ error: 'Kanal nicht gefunden oder kein Textkanal.' });
    }

    const content = String(b.content ?? '').replace(/\r\n/g, '\n');
    const asEmbed = Boolean(b.asEmbed);
    const embedTitle = String(b.embedTitle ?? '').slice(0, 256);
    const color = parseHexColor(b.embedColor);
    const mention = normalizeMention(b.pingMention ?? b.pingRoleId, req.guild); // '@everyone' | '@here' | '<@&id>' | null

    if (asEmbed) {
      if (content.length > 4096) return res.status(400).json({ error: 'Embed-Text max. 4096 Zeichen.' });
    } else if (content.length > 2000) {
      return res.status(400).json({ error: 'Nachricht max. 2000 Zeichen.' });
    }
    if (!content.trim() && !embedTitle.trim() && !mention) {
      return res.status(400).json({ error: 'Die Nachricht ist leer.' });
    }

    const me = req.guild.members.me ?? (await req.guild.members.fetchMe().catch(() => null));
    const perms = me && channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) {
      return res.status(403).json({ error: 'Der Bot darf in diesem Kanal nicht schreiben.' });
    }
    if (asEmbed && !perms?.has(PermissionFlagsBits.EmbedLinks)) {
      return res.status(403).json({ error: 'Dem Bot fehlt das Recht „Links einbetten" in diesem Kanal.' });
    }

    // Erwähnung: allowedMentions passend setzen + ggf. Berechtigung prüfen
    const allowedMentions = { parse: [], roles: [], users: [] };
    if (mention === '@everyone' || mention === '@here') {
      if (!perms?.has(PermissionFlagsBits.MentionEveryone)) {
        return res.status(403).json({ error: 'Dem Bot fehlt das Recht „Alle erwähnen" in diesem Kanal.' });
      }
      allowedMentions.parse = ['everyone'];
    } else if (mention) {
      const roleId = mention.replace(/\D/g, '');
      const role = req.guild.roles.cache.get(roleId);
      if (role && !role.mentionable && !perms?.has(PermissionFlagsBits.MentionEveryone)) {
        return res.status(403).json({
          error: `Die Rolle „${role.name}" ist nicht „erwähnbar" und dem Bot fehlt das Recht „Alle erwähnen".`,
        });
      }
      allowedMentions.roles = [roleId];
    }

    const embedBuilt = asEmbed
      ? (() => {
          const e = new EmbedBuilder();
          if (embedTitle.trim()) e.setTitle(embedTitle);
          if (content.trim()) e.setDescription(content);
          e.setColor(color ?? config.branding.color);
          return e;
        })()
      : null;

    const payload = asEmbed
      ? { content: mention || undefined, embeds: [embedBuilt], allowedMentions }
      : {
          content: mention ? (content.trim() ? `${mention}\n${content}` : mention) : content,
          allowedMentions,
        };

    try {
      const messageId = b.messageId ? String(b.messageId) : '';
      if (/^\d{5,25}$/.test(messageId)) {
        const existing = await channel.messages.fetch(messageId).catch(() => null);
        if (!existing) return res.status(404).json({ error: 'Zu bearbeitende Nachricht nicht gefunden.' });
        if (existing.author.id !== client.user.id) {
          return res.status(400).json({ error: 'Es können nur Nachrichten des Bots bearbeitet werden.' });
        }
        const edited = await existing.edit(payload);
        return res.json({ ok: true, edited: true, id: edited.id, url: edited.url });
      }
      const sent = await channel.send(payload);
      res.json({ ok: true, edited: false, id: sent.id, url: sent.url });
    } catch (err) {
      res.status(400).json({ error: discordErr(err) });
    }
  }),
);

/* ----------------------------------------------------------------
 *  Nachrichten-Verlauf eines Kanals
 * ---------------------------------------------------------------- */

router.get(
  '/guilds/:guildId/messages/history',
  asyncHandler(async (req, res) => {
    const channelId = String(req.query.channelId || '');
    if (!/^\d{5,25}$/.test(channelId)) return res.status(400).json({ error: 'Bitte einen Kanal wählen.' });

    const channel = req.guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased?.() || channel.type === ChannelType.GuildCategory) {
      return res.status(400).json({ error: 'Kanal nicht gefunden oder kein Textkanal.' });
    }

    const me = req.guild.members.me ?? (await req.guild.members.fetchMe().catch(() => null));
    const perms = me && channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.ReadMessageHistory)) {
      return res.status(403).json({ error: 'Der Bot darf den Verlauf dieses Kanals nicht lesen.' });
    }

    const limit = Math.max(1, Math.min(100, num(req.query.limit, 50)));
    const before = /^\d{5,25}$/.test(String(req.query.before || '')) ? String(req.query.before) : undefined;

    try {
      const fetched = await channel.messages.fetch({ limit, before });
      const messages = [...fetched.values()]
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map((m) => ({
          id: m.id,
          authorId: m.author.id,
          authorTag: m.author.tag,
          authorAvatar: m.author.displayAvatarURL({ size: 64 }),
          bot: m.author.bot,
          content: m.content,
          embeds: m.embeds.length,
          attachments: m.attachments.map((a) => ({ name: a.name, url: a.url, contentType: a.contentType })),
          editedAt: m.editedTimestamp,
          createdAt: m.createdTimestamp,
          url: m.url,
        }));
      res.json({
        channelName: channel.name,
        messages,
        hasMore: fetched.size === limit,
        intentActive: messageContentActive(),
      });
    } catch (err) {
      res.status(400).json({ error: discordErr(err) });
    }
  }),
);

/* ----------------------------------------------------------------
 *  Willkommens-System – Testnachricht
 * ---------------------------------------------------------------- */

const welcomeService = require('../../src/services/welcomeService');

router.post(
  '/guilds/:guildId/welcome/test',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const kind = req.body?.kind === 'leave' ? 'leave' : 'join';
    const s = settingsModel.get(req.guild.id);
    if (kind === 'join' && (!s.welcome_enabled || !s.welcome_channel_id)) {
      return res.status(400).json({ error: 'Bitte zuerst „Willkommensnachricht aktivieren" + Kanal wählen und speichern.' });
    }
    if (kind === 'leave' && (!s.leave_enabled || !s.leave_channel_id)) {
      return res.status(400).json({ error: 'Bitte zuerst die Abschiedsnachricht aktivieren + Kanal wählen und speichern.' });
    }
    const me = await req.guild.members.fetch(req.session.user.id).catch(() => null);
    if (!me) return res.status(400).json({ error: 'Du bist selbst nicht auf diesem Server – Test nicht möglich.' });
    try {
      if (kind === 'leave') await welcomeService.sendLeave(me);
      else await welcomeService.sendJoin(me);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: discordErr(err) });
    }
  }),
);

/* ----------------------------------------------------------------
 *  Temp-Voice – Hub-Kanal anlegen
 * ---------------------------------------------------------------- */

router.post(
  '/guilds/:guildId/tempvoice/create-hub',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const me = req.guild.members.me ?? (await req.guild.members.fetchMe().catch(() => null));
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return res.status(403).json({ error: 'Dem Bot fehlt „Kanäle verwalten".' });
    }
    try {
      const channel = await req.guild.channels.create({
        name: '➕ Kanal erstellen',
        type: ChannelType.GuildVoice,
        reason: 'Temp-Voice Hub-Kanal (Dashboard)',
      });
      settingsModel.update(req.guild.id, { tempvoice_hub_channel_id: channel.id });
      res.json({ ok: true, id: channel.id, name: channel.name });
    } catch (err) {
      res.status(400).json({ error: discordErr(err) });
    }
  }),
);

// Interface-Kanal anlegen (nur lesbar, der Bot darf schreiben), als Interface setzen und die Nachricht senden
router.post(
  '/guilds/:guildId/tempvoice/create-interface',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const me = req.guild.members.me ?? (await req.guild.members.fetchMe().catch(() => null));
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return res.status(403).json({ error: 'Dem Bot fehlt „Kanäle verwalten".' });
    }
    try {
      const s = settingsModel.get(req.guild.id);
      const hub = s.tempvoice_hub_channel_id ? req.guild.channels.cache.get(s.tempvoice_hub_channel_id) : null;
      const channel = await req.guild.channels.create({
        name: '🎛️・interface',
        type: ChannelType.GuildText,
        parent: s.tempvoice_category_id || hub?.parentId || null,
        topic: 'Steuere hier deinen eigenen Sprachkanal – du musst dafür in deinem Kanal sitzen.',
        reason: 'Temp-Voice Interface-Kanal (Dashboard)',
        permissionOverwrites: [
          { id: req.guild.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages] },
          {
            id: me.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ],
      });
      settingsModel.update(req.guild.id, {
        tempvoice_interface_channel_id: channel.id,
        tempvoice_interface_message_id: null,
      });
      const msg = await tempVoiceService.postOrUpdateInterface(req.guild);
      res.json({ ok: true, id: channel.id, name: channel.name, url: msg?.url || null });
    } catch (err) {
      res.status(400).json({ error: discordErr(err) });
    }
  }),
);

// Interface-Nachricht in den konfigurierten Text-Kanal posten / aktualisieren
router.post(
  '/guilds/:guildId/tempvoice/post-interface',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const channelId = req.body.channelId ? String(req.body.channelId) : null;
    if (channelId) {
      settingsModel.update(req.guild.id, {
        tempvoice_interface_channel_id: channelId,
        tempvoice_interface_message_id: null,
      });
    }
    const s = settingsModel.get(req.guild.id);
    if (!s.tempvoice_interface_channel_id) {
      return res.status(400).json({ error: 'Bitte zuerst einen Interface-Kanal wählen.' });
    }
    try {
      const msg = await tempVoiceService.postOrUpdateInterface(req.guild);
      if (!msg) return res.status(400).json({ error: 'Kanal nicht gefunden oder kein Textkanal.' });
      res.json({ ok: true, url: msg.url });
    } catch (err) {
      res.status(400).json({ error: discordErr(err) });
    }
  }),
);

/* ----------------------------------------------------------------
 *  Mini-Spiele – Zählen
 * ---------------------------------------------------------------- */

const countingGame = require('../../src/database/models/countingGame');

function messageContentActive() {
  try {
    return client.options.intents.has(GatewayIntentBits.MessageContent);
  } catch {
    return false;
  }
}

function serializeCounting(s) {
  return {
    enabled: !!s.enabled,
    channelId: s.channel_id,
    current: s.current,
    best: s.best,
    totalCounts: s.total_counts,
    allowSameUser: !!s.allow_same_user,
    resetOnFail: !!s.reset_on_fail,
    reactEmoji: s.react_emoji || '✅',
    intentActive: messageContentActive(),
  };
}

router.get('/guilds/:guildId/games/counting', (req, res) => {
  res.json(serializeCounting(countingGame.get(req.guild.id)));
});

router.post(
  '/guilds/:guildId/games/counting',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (b.enabled !== undefined) patch.enabled = b.enabled ? 1 : 0;
    if (b.channelId !== undefined) {
      const id = String(b.channelId || '');
      if (id && !/^\d{5,25}$/.test(id)) return res.status(400).json({ error: 'Ungültiger Kanal.' });
      if (id && !req.guild.channels.cache.get(id)?.isTextBased?.()) {
        return res.status(400).json({ error: 'Bitte einen Textkanal wählen.' });
      }
      patch.channel_id = id || null;
    }
    if (b.allowSameUser !== undefined) patch.allow_same_user = b.allowSameUser ? 1 : 0;
    if (b.resetOnFail !== undefined) patch.reset_on_fail = b.resetOnFail ? 1 : 0;
    if (b.reactEmoji !== undefined) {
      const e = String(b.reactEmoji || '').trim().slice(0, 8);
      patch.react_emoji = e || '✅';
    }
    if (patch.enabled && (patch.channel_id === null || (patch.channel_id === undefined && !countingGame.get(req.guild.id).channel_id))) {
      return res.status(400).json({ error: 'Bitte zuerst einen Kanal wählen.' });
    }
    res.json(serializeCounting(countingGame.update(req.guild.id, patch)));
  }),
);

router.post(
  '/guilds/:guildId/games/counting/reset',
  actionLimiter,
  asyncHandler(async (req, res) => {
    res.json(serializeCounting(countingGame.resetCount(req.guild.id)));
  }),
);

const countingService = require('../../src/services/countingService');

router.post(
  '/guilds/:guildId/games/counting/panel',
  actionLimiter,
  asyncHandler(async (req, res) => {
    try {
      const msg = await countingService.postPanel(req.guild);
      res.json({ ok: true, url: msg.url });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }),
);

/* ----------------------------------------------------------------
 *  Moderation – Aktionen + Purge
 * ---------------------------------------------------------------- */

const moderationService = require('../../src/services/moderationService');

router.post(
  '/guilds/:guildId/moderation/action',
  actionLimiter,
  asyncHandler(async (req, res) => {
    try {
      const summary = await moderationService.act(req.guild, {
        action: req.body.action,
        userId: req.body.userId,
        reason: req.body.reason,
        minutes: req.body.minutes,
        actorTag: req.session.user.username,
      });
      res.json({ ok: true, summary });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }),
);

router.post(
  '/guilds/:guildId/moderation/purge',
  actionLimiter,
  asyncHandler(async (req, res) => {
    if (!/^\d{5,25}$/.test(String(req.body.channelId || ''))) {
      return res.status(400).json({ error: 'Bitte einen Kanal wählen.' });
    }
    try {
      const deleted = await moderationService.purge(req.guild, req.body.channelId, req.body.count, req.body.userId);
      res.json({ ok: true, deleted });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }),
);

/* ----------------------------------------------------------------
 *  Musik
 * ---------------------------------------------------------------- */

const musicService = require('../../src/services/musicService');
const musicStations = require('../../src/database/models/musicStations');
const { canControl: musicCanControl } = require('../../src/utils/music');

function musicState(guild) {
  const s = musicService.getSession(guild.id);
  const base = s ? s.state() : { connected: false, current: null, queue: [], volume: 100, loop: false, paused: false };
  base.youtube = musicService.youtubeAvailable();
  base.enabled = musicService.musicEnabled();
  base.error = musicService.musicError();
  base.moduleEnabled = settingsModel.get(guild.id).music_enabled !== 0;
  return base;
}

async function requireMusicMember(req) {
  const member = await req.guild.members.fetch(req.session.user.id).catch(() => null);
  if (!member) throw Object.assign(new Error('Du bist nicht auf diesem Server.'), { status: 400 });
  if (!musicCanControl(member, settingsModel.get(req.guild.id))) {
    throw Object.assign(new Error('Dir fehlt die DJ-Rolle für die Musiksteuerung.'), { status: 403 });
  }
  return member;
}

router.get('/guilds/:guildId/music', (req, res) => {
  res.json(musicState(req.guild));
});

router.post(
  '/guilds/:guildId/music/join',
  actionLimiter,
  asyncHandler(async (req, res) => {
    try {
      const member = await requireMusicMember(req);
      const vc = member.voice?.channel;
      if (!vc) return res.status(400).json({ error: 'Geh zuerst selbst in einen Sprachkanal auf diesem Server.' });
      const me = req.guild.members.me;
      if (!vc.permissionsFor(me)?.has(PermissionFlagsBits.Connect) || !vc.permissionsFor(me)?.has(PermissionFlagsBits.Speak)) {
        return res.status(403).json({ error: 'Der Bot darf diesem Sprachkanal nicht beitreten.' });
      }
      await musicService.join(req.guild, vc, req.body.textChannelId || null);
      res.json({ ok: true, channel: vc.name, state: musicState(req.guild) });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  }),
);

router.post(
  '/guilds/:guildId/music/play',
  actionLimiter,
  asyncHandler(async (req, res) => {
    try {
      const member = await requireMusicMember(req);
      const vc = member.voice?.channel;
      if (!vc) return res.status(400).json({ error: 'Geh zuerst selbst in einen Sprachkanal auf diesem Server.' });
      const me = req.guild.members.me;
      if (!vc.permissionsFor(me)?.has(PermissionFlagsBits.Connect) || !vc.permissionsFor(me)?.has(PermissionFlagsBits.Speak)) {
        return res.status(403).json({ error: 'Der Bot darf diesem Sprachkanal nicht beitreten.' });
      }
      const q = String(req.body.query || '').trim().slice(0, 400);
      if (!q) return res.status(400).json({ error: 'Bitte einen Suchbegriff oder Link eingeben.' });
      const r = await musicService.play(req.guild, vc, req.body.textChannelId || null, q, {
        id: member.id,
        tag: req.session.user.username,
      });
      res.json({ ok: true, added: r.added, title: r.first?.title || null, startedNow: r.startedNow, state: musicState(req.guild) });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  }),
);

router.post(
  '/guilds/:guildId/music/control',
  actionLimiter,
  asyncHandler(async (req, res) => {
    try {
      await requireMusicMember(req);
      const s = musicService.getSession(req.guild.id);
      if (!s) return res.status(400).json({ error: 'Es läuft gerade nichts.' });
      const action = String(req.body.action || '');
      if (action === 'skip') s.skip();
      else if (action === 'stop') s.destroy();
      else if (action === 'pause') s.pause();
      else if (action === 'resume') s.resume();
      else if (action === 'shuffle') s.shuffle();
      else if (action === 'loop') s.toggleLoop();
      else return res.status(400).json({ error: 'Unbekannte Aktion.' });
      res.json({ ok: true, state: action === 'stop' ? musicState(req.guild) : s.state() });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  }),
);

router.post(
  '/guilds/:guildId/music/volume',
  actionLimiter,
  asyncHandler(async (req, res) => {
    try {
      await requireMusicMember(req);
      const s = musicService.getSession(req.guild.id);
      if (!s) return res.status(400).json({ error: 'Es läuft gerade nichts.' });
      const v = Math.max(0, Math.min(150, num(req.body.volume, 100)));
      s.setVolume(v / 100);
      res.json({ ok: true, state: s.state() });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  }),
);

router.post(
  '/guilds/:guildId/music/queue/remove',
  actionLimiter,
  asyncHandler(async (req, res) => {
    try {
      await requireMusicMember(req);
      const s = musicService.getSession(req.guild.id);
      if (!s) return res.status(400).json({ error: 'Es läuft gerade nichts.' });
      const t = s.removeAt(num(req.body.index, -1));
      if (!t) return res.status(400).json({ error: 'Ungültige Position.' });
      res.json({ ok: true, removed: t.title, state: s.state() });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  }),
);

router.get('/guilds/:guildId/music/stations', (req, res) => {
  res.json({
    builtin: musicService.BUILTIN_STATIONS.map((s) => ({ name: s.name, genre: s.genre })),
    custom: musicStations.list(req.guild.id).map((r) => ({ id: r.id, name: r.name, url: r.url })),
  });
});

router.post(
  '/guilds/:guildId/music/stations',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 80);
    const url = String(req.body.url || '').trim().slice(0, 500);
    if (!name || !/^https?:\/\/.+/i.test(url)) {
      return res.status(400).json({ error: 'Name und eine gültige http(s)-URL angeben.' });
    }
    if (musicStations.count(req.guild.id) >= 30) {
      return res.status(400).json({ error: 'Maximal 30 eigene Sender.' });
    }
    const st = musicStations.add({ guildId: req.guild.id, name, url, addedBy: req.session.user.id });
    res.json({ ok: true, station: { id: st.id, name: st.name, url: st.url } });
  }),
);

router.delete('/guilds/:guildId/music/stations/:id', (req, res) => {
  musicStations.remove(req.guild.id, num(req.params.id));
  res.json({ ok: true });
});

/* Aktive temporäre Giveaway-Gewinnerrollen (für Dashboard-Anzeige). */
router.get('/guilds/:guildId/temp-roles', (req, res) => {
  res.json(
    tempRolesModel.listActiveByGuild(req.params.guildId).map((r) => ({
      id: r.id,
      user_id: r.user_id,
      role_id: r.role_id,
      giveaway_id: r.giveaway_id,
      granted_at: r.granted_at,
      expires_at: r.expires_at,
    })),
  );
});

/* Kombinierte Statistiken für die Statistik-Seite. */
router.get('/guilds/:guildId/stats', (req, res) => {
  const gid = req.params.guildId;
  res.json({
    guild: { memberCount: req.guild.memberCount, channels: req.guild.channels.cache.size, roles: req.guild.roles.cache.size },
    tickets: ticketsModel.stats(gid),
    giveaways: giveawaysModel.stats(gid),
    applications: appModel.stats(gid),
    tempRoles: tempRolesModel.listActiveByGuild(gid).length,
    activity: activity.recent(gid, 60),
  });
});

/* ---------------- Settings ---------------- */

router.get('/guilds/:guildId/settings', (req, res) => {
  res.json(settingsModel.get(req.params.guildId));
});

router.patch(
  '/guilds/:guildId/settings',
  asyncHandler(async (req, res) => {
    const patch = {};
    for (const key of settingsModel.EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) patch[key] = req.body[key];
    }
    // Numerische Felder saeubern
    if ('ticket_max_per_user' in patch) patch.ticket_max_per_user = Math.max(0, num(patch.ticket_max_per_user, 1));
    if ('giveaway_winner_role_duration_ms' in patch) {
      const raw = patch.giveaway_winner_role_duration_ms;
      const ms = typeof raw === 'string' && !/^\d+$/.test(raw) ? parseDuration(raw) : num(raw, null);
      patch.giveaway_winner_role_duration_ms = ms && ms > 0 ? ms : 24 * 60 * 60 * 1000;
    }
    if ('application_enabled' in patch) {
      patch.application_enabled = patch.application_enabled ? 1 : 0;
    }
    const updated = settingsModel.update(req.params.guildId, patch);
    res.json(updated);
  }),
);

router.get('/guilds/:guildId/activity', (req, res) => {
  res.json(activity.recent(req.params.guildId, Math.min(100, num(req.query.limit, 40))));
});

/* ---------------- Tickets ---------------- */

router.get('/guilds/:guildId/tickets', (req, res) => {
  res.json(ticketsModel.listByGuild(req.params.guildId, { status: req.query.status, limit: 200 }));
});

/* --- Ticket-Panels (mehrere pro Server) --- */

function ownedPanel(req) {
  const p = ticketPanels.getPanel(num(req.params.panelId));
  return p && p.guild_id === req.params.guildId ? p : null;
}

router.get('/guilds/:guildId/ticket-panels', (req, res) => {
  res.json(ticketPanels.listPanelsWithCategories(req.params.guildId));
});

router.post(
  '/guilds/:guildId/ticket-panels',
  asyncHandler(async (req, res) => {
    if (!req.body.name) return res.status(400).json({ error: 'Name erforderlich.' });
    const panel = ticketPanels.createPanel({
      guildId: req.params.guildId,
      name: String(req.body.name).slice(0, 80),
      title: req.body.title ? String(req.body.title).slice(0, 240) : '🎫 Support',
      description: req.body.description ? String(req.body.description).slice(0, 2000) : 'Erstelle hier ein Ticket und unser Team hilft dir.',
      color: req.body.color || null,
      useSelect: Boolean(req.body.useSelect),
      buttonLabel: req.body.buttonLabel ? String(req.body.buttonLabel).slice(0, 60) : null,
    });
    res.json(ticketPanels.panelWithCategories(panel.id));
  }),
);

router.patch(
  '/guilds/:guildId/ticket-panels/:panelId',
  asyncHandler(async (req, res) => {
    if (!ownedPanel(req)) return res.status(404).json({ error: 'Panel nicht gefunden.' });
    const b = req.body;
    const patch = {};
    for (const k of ['name', 'title', 'description', 'color', 'image_url', 'thumbnail_url']) {
      if (b[k] !== undefined) patch[k] = b[k];
    }
    if (b.buttonLabel !== undefined) patch.button_label = b.buttonLabel || null;
    if (b.layout !== undefined) {
      const layout = ['buttons', 'select', 'both'].includes(b.layout) ? b.layout : 'buttons';
      patch.panel_layout = layout;
      patch.use_select = layout === 'buttons' ? 0 : 1; // Alt-Flag synchron halten
    } else if (b.useSelect !== undefined) {
      patch.use_select = b.useSelect ? 1 : 0;
      patch.panel_layout = b.useSelect ? 'select' : 'buttons';
    }
    if (b.log_channel_id !== undefined) patch.log_channel_id = b.log_channel_id || null;
    if (b.rating_enabled !== undefined || b.ratingEnabled !== undefined) {
      patch.rating_enabled = (b.rating_enabled ?? b.ratingEnabled) ? 1 : 0;
    }
    if (b.rating_channel_id !== undefined) patch.rating_channel_id = b.rating_channel_id || null;
    if (b.claim_category_id !== undefined) patch.claim_category_id = b.claim_category_id || null;
    if (b.autoclose_hours !== undefined) patch.autoclose_hours = Math.max(0, num(b.autoclose_hours, 0));
    if (b.cfg && typeof b.cfg === 'object') patch.cfg = ticketPanels.mergePanelCfg(ownedPanel(req), b.cfg);
    const updated = ticketPanels.updatePanel(num(req.params.panelId), patch);
    res.json(ticketPanels.panelWithCategories(updated.id));
  }),
);

router.delete(
  '/guilds/:guildId/ticket-panels/:panelId',
  asyncHandler(async (req, res) => {
    if (!ownedPanel(req)) return res.status(404).json({ error: 'Panel nicht gefunden.' });
    ticketPanels.deletePanel(num(req.params.panelId));
    res.json({ ok: true });
  }),
);

router.post(
  '/guilds/:guildId/ticket-panels/:panelId/post',
  actionLimiter,
  asyncHandler(async (req, res) => {
    if (!ownedPanel(req)) return res.status(404).json({ error: 'Panel nicht gefunden.' });
    const channelId = req.body.channelId ? String(req.body.channelId) : undefined;
    if (channelId && !/^\d{5,25}$/.test(channelId)) return res.status(400).json({ error: 'Ungültiger Kanal.' });
    const msg = await ticketService.postOrUpdatePanel(req.guild, num(req.params.panelId), channelId);
    res.json({ ok: true, messageId: msg.id, url: msg.url });
  }),
);

/* --- Kategorien eines Panels --- */

router.post(
  '/guilds/:guildId/ticket-panels/:panelId/categories',
  asyncHandler(async (req, res) => {
    if (!ownedPanel(req)) return res.status(404).json({ error: 'Panel nicht gefunden.' });
    if (ticketPanels.countCategories(num(req.params.panelId)) >= 25) {
      return res.status(400).json({ error: 'Maximal 25 Kategorien pro Panel.' });
    }
    if (!req.body.label) return res.status(400).json({ error: 'Bezeichnung erforderlich.' });
    const c = ticketPanels.createCategory({
      panelId: num(req.params.panelId),
      guildId: req.params.guildId,
      label: String(req.body.label).slice(0, 80),
      emoji: req.body.emoji ? String(req.body.emoji).slice(0, 16) : null,
      description: req.body.description ? String(req.body.description).slice(0, 100) : null,
    });
    res.json(c);
  }),
);

router.patch(
  '/guilds/:guildId/ticket-panels/:panelId/categories/:catId',
  asyncHandler(async (req, res) => {
    if (!ownedPanel(req)) return res.status(404).json({ error: 'Panel nicht gefunden.' });
    const cat = ticketPanels.getCategory(num(req.params.catId));
    if (!cat || cat.panel_id !== num(req.params.panelId)) return res.status(404).json({ error: 'Kategorie nicht gefunden.' });
    const patch = {};
    const map = {
      label: 'label',
      emoji: 'emoji',
      description: 'description',
      prefix: 'prefix',
      discordCategoryId: 'discord_category_id',
      supportRoleId: 'support_role_id',
      pingRoleId: 'ping_role_id',
      welcomeMessage: 'welcome_message',
      nameFormat: 'name_format',
      position: 'position',
    };
    for (const [k, col] of Object.entries(map)) {
      if (req.body[k] !== undefined) patch[col] = req.body[k] === '' ? null : req.body[k];
    }
    if (patch.label === null || (typeof patch.label === 'string' && !patch.label.trim())) {
      delete patch.label; // Name darf nicht leer sein
    }
    if (req.body.enabled !== undefined) patch.enabled = req.body.enabled ? 1 : 0;
    if (req.body.maxOpen !== undefined) patch.max_open = Math.max(0, num(req.body.maxOpen, 0));
    if (req.body.cfg && typeof req.body.cfg === 'object') patch.cfg = ticketPanels.mergeCategoryCfg(cat, req.body.cfg);
    res.json(ticketPanels.updateCategory(cat.id, patch));
  }),
);

router.delete(
  '/guilds/:guildId/ticket-panels/:panelId/categories/:catId',
  asyncHandler(async (req, res) => {
    if (!ownedPanel(req)) return res.status(404).json({ error: 'Panel nicht gefunden.' });
    const cat = ticketPanels.getCategory(num(req.params.catId));
    if (!cat || cat.panel_id !== num(req.params.panelId)) return res.status(404).json({ error: 'Kategorie nicht gefunden.' });
    ticketPanels.deleteCategory(cat.id);
    res.json({ ok: true });
  }),
);

/* --- Öffnen-Formular pro Kategorie --- */

const QUESTION_TYPES = ['short', 'paragraph', 'select', 'radio', 'checkbox', 'user', 'role', 'channel', 'mentionable'];

/** Optionen als Array von { label, value } aus Text (eine pro Zeile) oder Array lesen. */
function parseOptions(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/\r?\n/);
  return list
    .map((o) => (typeof o === 'string' ? o : o?.label))
    .map((o) => String(o || '').trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 25)
    .map((label) => ({ label, value: label }));
}

function ownedCategory(req) {
  if (!ownedPanel(req)) return null;
  const cat = ticketPanels.getCategory(num(req.params.catId));
  return cat && cat.panel_id === num(req.params.panelId) ? cat : null;
}

router.post(
  '/guilds/:guildId/ticket-panels/:panelId/categories/:catId/questions',
  asyncHandler(async (req, res) => {
    if (!ownedCategory(req)) return res.status(404).json({ error: 'Kategorie nicht gefunden.' });
    const form = ticketPanels.FORMS.includes(req.body.form) ? req.body.form : 'open';
    if (ticketPanels.countQuestions(num(req.params.catId), form) >= 5) {
      return res.status(400).json({ error: 'Maximal 5 Felder pro Formular (Discord-Limit).' });
    }
    if (!req.body.label) return res.status(400).json({ error: 'Feldname erforderlich.' });
    const q = ticketPanels.addQuestion({
      categoryId: num(req.params.catId),
      form,
      label: String(req.body.label).slice(0, 45),
      style: QUESTION_TYPES.includes(req.body.style) ? req.body.style : 'short',
      options: req.body.options !== undefined ? parseOptions(req.body.options) : null,
      description: req.body.description ? String(req.body.description).slice(0, 100) : null,
      placeholder: req.body.placeholder ? String(req.body.placeholder).slice(0, 100) : null,
      required: req.body.required !== false,
      minLength: Math.max(0, num(req.body.minLength, 0)),
      maxLength: Math.min(4000, Math.max(1, num(req.body.maxLength, 400))),
    });
    res.json(q);
  }),
);

function ownedQuestion(req) {
  const cat = ownedCategory(req);
  if (!cat) return null;
  const q = ticketPanels.getQuestion(num(req.params.qid));
  return q && q.category_id === cat.id ? q : null;
}

router.patch(
  '/guilds/:guildId/ticket-panels/:panelId/categories/:catId/questions/:qid',
  asyncHandler(async (req, res) => {
    if (!ownedQuestion(req)) return res.status(404).json({ error: 'Formularfeld nicht gefunden.' });
    const patch = {};
    if (req.body.label !== undefined) patch.label = String(req.body.label).slice(0, 45);
    if (req.body.style !== undefined) patch.style = QUESTION_TYPES.includes(req.body.style) ? req.body.style : 'short';
    if (req.body.options !== undefined) patch.options = parseOptions(req.body.options);
    if (req.body.description !== undefined) patch.description = String(req.body.description).slice(0, 100);
    if (req.body.placeholder !== undefined) patch.placeholder = String(req.body.placeholder).slice(0, 100);
    if (req.body.required !== undefined) patch.required = req.body.required ? 1 : 0;
    if (req.body.position !== undefined) patch.position = num(req.body.position, 0);
    if (req.body.minLength !== undefined) patch.min_length = Math.max(0, num(req.body.minLength, 0));
    if (req.body.maxLength !== undefined) patch.max_length = Math.min(4000, Math.max(1, num(req.body.maxLength, 400)));
    res.json(ticketPanels.updateQuestion(num(req.params.qid), patch));
  }),
);

router.delete(
  '/guilds/:guildId/ticket-panels/:panelId/categories/:catId/questions/:qid',
  asyncHandler(async (req, res) => {
    if (!ownedQuestion(req)) return res.status(404).json({ error: 'Formularfeld nicht gefunden.' });
    ticketPanels.deleteQuestion(num(req.params.qid));
    res.json({ ok: true });
  }),
);

/* ---------------- Auto-Rolle ---------------- */

router.post(
  '/guilds/:guildId/autorole/apply-all',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const autoRoleService = require('../../src/services/autoRoleService');
    const result = await autoRoleService.applyToAll(req.guild);
    res.json({ ok: true, ...result });
  }),
);

/* ---------------- Giveaways ---------------- */

router.get('/guilds/:guildId/giveaways', (req, res) => {
  const status = req.query.status;
  const list =
    status === 'ended'
      ? giveawaysModel.listEnded(req.params.guildId, 100)
      : giveawaysModel.listActive(req.params.guildId);
  res.json(
    list.map((g) => ({
      ...g,
      entry_count: giveawaysModel.countEntries(g.id),
      winners: JSON.parse(g.winners_json || '[]'),
    })),
  );
});

router.get('/guilds/:guildId/giveaways/:id', (req, res) => {
  const g = giveawaysModel.get(num(req.params.id));
  if (!g || g.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
  res.json({
    ...g,
    entry_count: giveawaysModel.countEntries(g.id),
    entries: giveawaysModel.getEntries(g.id),
    winners: JSON.parse(g.winners_json || '[]'),
    winner_history: giveawaysModel.getWinnerHistory(g.id),
  });
});

router.post(
  '/guilds/:guildId/giveaways',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const b = req.body;
    const durationMs =
      typeof b.duration === 'string' ? parseDuration(b.duration) : num(b.durationMs, null);
    if (!b.prize || !durationMs) {
      return res.status(400).json({ error: 'Preis und eine gültige Dauer sind erforderlich.' });
    }
    const bypass = config.isOwner(req.session.user.id);
    const giveaway = await giveawayService.createGiveaway(req.guild, {
      prize: String(b.prize).slice(0, 200),
      description: b.description ? String(b.description).slice(0, 1000) : undefined,
      durationMs,
      winnerCount: Math.max(1, num(b.winnerCount, 1)),
      channelId: b.channelId || undefined,
      requiredRoleId: b.requiredRoleId || undefined,
      useWinnerRole: b.useWinnerRole !== false && b.useWinnerRole !== 'false',
      winnerRoleId: b.winnerRoleId || undefined,
      winnerRoleDurationMs:
        typeof b.winnerRoleDuration === 'string'
          ? parseDuration(b.winnerRoleDuration)
          : num(b.winnerRoleDurationMs, undefined) || undefined,
      hostId: (bypass && b.hostId) ? String(b.hostId) : req.session.user.id,
      bypass,
    });
    res.json(giveaway);
  }),
);

router.patch(
  '/guilds/:guildId/giveaways/:id',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const g = giveawaysModel.get(num(req.params.id));
    if (!g || g.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    const bypass = config.isOwner(req.session.user.id);
    if (g.ended && !bypass) return res.status(400).json({ error: 'Beendete Giveaways können nicht bearbeitet werden.' });

    const patch = {};
    if (req.body.prize) patch.prize = String(req.body.prize).slice(0, 200);
    if (req.body.description !== undefined) patch.description = String(req.body.description).slice(0, 1000);
    if (req.body.winnerCount) patch.winner_count = Math.max(1, num(req.body.winnerCount, 1));
    if (req.body.requiredRoleId !== undefined) patch.required_role_id = req.body.requiredRoleId || null;
    if (req.body.winnerRoleId !== undefined) patch.winner_role_id = req.body.winnerRoleId || null;
    if (bypass && req.body.hostId !== undefined) patch.host_id = req.body.hostId || null;
    if (req.body.addTime) {
      const add = parseDuration(req.body.addTime);
      if (add) patch.ends_at = g.ends_at + add;
    }
    if (req.body.endsAt) patch.ends_at = num(req.body.endsAt);

    const updated = giveawaysModel.update(g.id, patch);
    if (updated.ended) {
      await giveawayService.refreshEndedMessage(g.id).catch(() => null);
    } else {
      giveawayService.scheduleEnd(updated);
      await giveawayService.refreshGiveawayMessage(g.id).catch(() => null);
    }
    res.json(updated);
  }),
);

router.post(
  '/guilds/:guildId/giveaways/:id/end',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const g = giveawaysModel.get(num(req.params.id));
    if (!g || g.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    const updated = await giveawayService.endGiveaway(g.id, { actorId: req.session.user.id, reason: 'manual' });
    res.json({ ...updated, winners: JSON.parse(updated.winners_json || '[]') });
  }),
);

router.post(
  '/guilds/:guildId/giveaways/:id/reroll',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const g = giveawaysModel.get(num(req.params.id));
    if (!g || g.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    const result = await giveawayService.rerollGiveaway(g.id, {
      count: num(req.body.count, undefined) || undefined,
      excludeIds: Array.isArray(req.body.excludeIds) ? req.body.excludeIds : [],
      keepPrevious: Boolean(req.body.keepPrevious),
      actorId: req.session.user.id,
    });
    res.json({ newWinners: result.newWinners, finalWinners: result.finalWinners });
  }),
);

router.post(
  '/guilds/:guildId/giveaways/:id/cancel',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const g = giveawaysModel.get(num(req.params.id));
    if (!g || g.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    const updated = await giveawayService.cancelGiveaway(g.id, { actorId: req.session.user.id });
    res.json(updated);
  }),
);

/* ---------------- Giveaway-Ticket-Buttons (Gewinner-Nachricht) ---------------- */

router.get('/guilds/:guildId/giveaway-ticket-buttons', (req, res) => {
  const list = giveawayTicketButtons.list(req.params.guildId).map((b) => ({
    ...b,
    questions: giveawayTicketButtons.listQuestions(b.id),
  }));
  res.json(list);
});

router.post(
  '/guilds/:guildId/giveaway-ticket-buttons',
  actionLimiter,
  asyncHandler(async (req, res) => {
    if (giveawayTicketButtons.count(req.params.guildId) >= 5) {
      return res.status(400).json({ error: 'Maximal 5 Ticket-Buttons.' });
    }
    const b = req.body;
    const created = giveawayTicketButtons.create(req.params.guildId, {
      label: b.label ? String(b.label).slice(0, 80) : 'Ticket erstellen',
      emoji: b.emoji ? String(b.emoji).slice(0, 16) : null,
      discordCategoryId: b.discordCategoryId || null,
      supportRoleId: b.supportRoleId || null,
      nameFormat: b.nameFormat ? String(b.nameFormat).slice(0, 90) : null,
      welcomeMessage: b.welcomeMessage ? String(b.welcomeMessage).slice(0, 2000) : null,
      showPrize: b.showPrize !== false && b.showPrize !== 'false',
    });
    res.json(created);
  }),
);

router.patch(
  '/guilds/:guildId/giveaway-ticket-buttons/:id',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const btn = giveawayTicketButtons.get(num(req.params.id));
    if (!btn || btn.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    const b = req.body;
    const patch = {};
    if (b.label !== undefined) {
      const label = String(b.label).trim().slice(0, 80);
      if (label) patch.label = label;
    }
    if (b.emoji !== undefined) patch.emoji = b.emoji ? String(b.emoji).slice(0, 16) : null;
    if (b.discordCategoryId !== undefined) patch.discord_category_id = b.discordCategoryId || null;
    if (b.supportRoleId !== undefined) patch.support_role_id = b.supportRoleId || null;
    if (b.nameFormat !== undefined) patch.name_format = b.nameFormat ? String(b.nameFormat).slice(0, 90) : null;
    if (b.welcomeMessage !== undefined) patch.welcome_message = b.welcomeMessage ? String(b.welcomeMessage).slice(0, 2000) : null;
    if (b.showPrize !== undefined) patch.show_prize = b.showPrize ? 1 : 0;
    res.json(giveawayTicketButtons.update(btn.id, patch));
  }),
);

router.delete('/guilds/:guildId/giveaway-ticket-buttons/:id', (req, res) => {
  const btn = giveawayTicketButtons.get(num(req.params.id));
  if (!btn || btn.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
  giveawayTicketButtons.remove(btn.id);
  res.json({ ok: true });
});

/* --- Öffnen-Formular pro Giveaway-Ticket-Button --- */

function ownedGwtb(req) {
  const btn = giveawayTicketButtons.get(num(req.params.id));
  return btn && btn.guild_id === req.params.guildId ? btn : null;
}

router.post(
  '/guilds/:guildId/giveaway-ticket-buttons/:id/questions',
  asyncHandler(async (req, res) => {
    if (!ownedGwtb(req)) return res.status(404).json({ error: 'Button nicht gefunden.' });
    if (giveawayTicketButtons.countQuestions(num(req.params.id)) >= 5) {
      return res.status(400).json({ error: 'Maximal 5 Felder pro Button (Discord-Limit).' });
    }
    if (!req.body.label) return res.status(400).json({ error: 'Feldname erforderlich.' });
    const q = giveawayTicketButtons.addQuestion({
      buttonId: num(req.params.id),
      label: String(req.body.label).slice(0, 45),
      style: req.body.style === 'paragraph' ? 'paragraph' : 'short',
      placeholder: req.body.placeholder ? String(req.body.placeholder).slice(0, 100) : null,
      required: req.body.required !== false,
      minLength: Math.max(0, num(req.body.minLength, 0)),
      maxLength: Math.min(4000, Math.max(1, num(req.body.maxLength, 400))),
    });
    res.json(q);
  }),
);

function ownedGwtbQuestion(req) {
  if (!ownedGwtb(req)) return null;
  const q = giveawayTicketButtons.getQuestion(num(req.params.qid));
  return q && q.button_id === num(req.params.id) ? q : null;
}

router.patch(
  '/guilds/:guildId/giveaway-ticket-buttons/:id/questions/:qid',
  asyncHandler(async (req, res) => {
    if (!ownedGwtbQuestion(req)) return res.status(404).json({ error: 'Formularfeld nicht gefunden.' });
    const patch = {};
    if (req.body.label !== undefined) patch.label = String(req.body.label).slice(0, 45);
    if (req.body.style !== undefined) patch.style = req.body.style === 'paragraph' ? 'paragraph' : 'short';
    if (req.body.placeholder !== undefined) patch.placeholder = String(req.body.placeholder).slice(0, 100);
    if (req.body.required !== undefined) patch.required = req.body.required ? 1 : 0;
    if (req.body.position !== undefined) patch.position = num(req.body.position, 0);
    if (req.body.minLength !== undefined) patch.min_length = Math.max(0, num(req.body.minLength, 0));
    if (req.body.maxLength !== undefined) patch.max_length = Math.min(4000, Math.max(1, num(req.body.maxLength, 400)));
    res.json(giveawayTicketButtons.updateQuestion(num(req.params.qid), patch));
  }),
);

router.delete(
  '/guilds/:guildId/giveaway-ticket-buttons/:id/questions/:qid',
  asyncHandler(async (req, res) => {
    if (!ownedGwtbQuestion(req)) return res.status(404).json({ error: 'Formularfeld nicht gefunden.' });
    giveawayTicketButtons.deleteQuestion(num(req.params.qid));
    res.json({ ok: true });
  }),
);

/* ---------------- Neue Module: Einstellungen (Guild Protection, Belohnungen, News, Clubs) ---------------- */

const moduleSettings = require('../../src/database/models/moduleSettings');

router.get('/guilds/:guildId/modules/:module', (req, res) => {
  if (!moduleSettings.SCHEMAS[req.params.module]) return res.status(404).json({ error: 'Unbekanntes Modul.' });
  res.json(moduleSettings.get(req.params.guildId, req.params.module));
});

router.patch('/guilds/:guildId/modules/:module', actionLimiter, (req, res) => {
  if (!moduleSettings.SCHEMAS[req.params.module]) return res.status(404).json({ error: 'Unbekanntes Modul.' });
  res.json(moduleSettings.update(req.params.guildId, req.params.module, req.body || {}));
});

/* ---------------- Beteiligungs-Belohnungen (Level) ---------------- */

const levelsModel = require('../../src/database/models/levels');
const levelService = require('../../src/services/levelService');

router.get('/guilds/:guildId/levels/leaderboard', (req, res) => {
  const limit = Math.min(100, Math.max(1, num(req.query.limit, 20)));
  const rows = levelsModel.top(req.params.guildId, limit).map((r, i) => {
    const m = req.guild.members.cache.get(r.user_id);
    const { into, needed } = levelsModel.levelInfo(req.params.guildId, r.xp);
    return {
      rank: i + 1,
      userId: r.user_id,
      name: m ? m.displayName : null,
      avatarUrl: m ? m.displayAvatarURL({ size: 64 }) : null,
      xp: r.xp,
      level: r.level,
      progress: needed ? Math.round((into / needed) * 100) : 100,
      maxLevel: !needed,
      messages: r.messages,
      voiceMinutes: r.voice_minutes,
    };
  });
  res.json({ total: levelsModel.count(req.params.guildId), rows });
});

// Mitglieder-Suche für die XP-Verwaltung (Name oder ID) inkl. aktuellem XP-Stand.
router.get(
  '/guilds/:guildId/levels/search',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    let members = [];
    try {
      if (/^\d{5,25}$/.test(q)) {
        const m = await req.guild.members.fetch({ user: q, force: true }).catch(() => null);
        if (m) members = [m];
      } else {
        members = [...(await req.guild.members.fetch({ query: q, limit: 10 })).values()];
      }
    } catch (err) {
      return res.status(400).json({ error: discordErr(err) });
    }
    res.json(
      members
        .filter((m) => !m.user.bot)
        .map((m) => {
          const row = levelsModel.get(req.params.guildId, m.id);
          return {
            id: m.id,
            name: m.displayName,
            tag: m.user.username,
            avatarUrl: m.displayAvatarURL({ size: 64 }),
            xp: row?.xp ?? 0,
            level: row?.level ?? 0,
          };
        }),
    );
  }),
);

// XP manuell vergeben / entziehen / setzen.
router.post(
  '/guilds/:guildId/levels/users/:userId/xp',
  actionLimiter,
  asyncHandler(async (req, res) => {
    if (!/^\d{5,25}$/.test(req.params.userId)) return res.status(400).json({ error: 'Ungültige ID.' });
    const mode = String(req.body.mode || '');
    if (!['add', 'remove', 'set'].includes(mode)) return res.status(400).json({ error: 'Ungültige Aktion.' });
    const amount = Number.parseInt(req.body.amount, 10);
    if (!Number.isFinite(amount) || amount < 0 || amount > levelsModel.MAX_XP) {
      return res.status(400).json({ error: `XP muss eine Zahl zwischen 0 und ${levelsModel.MAX_XP.toLocaleString('de-DE')} sein.` });
    }
    if (mode !== 'set' && amount === 0) return res.status(400).json({ error: 'Bitte mehr als 0 XP angeben.' });
    const member = await req.guild.members.fetch({ user: req.params.userId, force: true }).catch(() => null);
    if (!member) return res.status(404).json({ error: 'Mitglied nicht auf dem Server gefunden.' });
    if (member.user.bot) return res.status(400).json({ error: 'Bots sammeln keine XP.' });
    res.json(await levelService.adjustXp(req.guild, member, mode, amount));
  }),
);

// Level-Stufen: ab wie viel Gesamt-XP welches Level gilt.
function curveState(guildId) {
  const curve = levelsModel.getCurve(guildId);
  return { custom: Boolean(curve), curve, defaults: levelsModel.defaultCurve(20), maxLevels: levelsModel.MAX_CURVE_LEVELS };
}

router.get('/guilds/:guildId/levels/curve', (req, res) => {
  res.json(curveState(req.params.guildId));
});

router.put('/guilds/:guildId/levels/curve', actionLimiter, (req, res) => {
  const raw = req.body.curve;
  if (!Array.isArray(raw) || !raw.length) return res.status(400).json({ error: 'Mindestens eine Level-Stufe angeben.' });
  if (raw.length > levelsModel.MAX_CURVE_LEVELS) {
    return res.status(400).json({ error: `Maximal ${levelsModel.MAX_CURVE_LEVELS} Level-Stufen.` });
  }
  const curve = raw.map((v) => Number(v));
  for (let i = 0; i < curve.length; i++) {
    if (!Number.isInteger(curve[i]) || curve[i] < 1 || curve[i] > levelsModel.MAX_XP) {
      return res.status(400).json({ error: `Level ${i + 1}: XP muss eine ganze Zahl zwischen 1 und ${levelsModel.MAX_XP.toLocaleString('de-DE')} sein.` });
    }
    if (i > 0 && curve[i] <= curve[i - 1]) {
      return res.status(400).json({ error: `Level ${i + 1} braucht mehr XP als Level ${i} (${curve[i - 1]}).` });
    }
  }
  levelsModel.setCurve(req.params.guildId, curve);
  res.json(curveState(req.params.guildId));
});

router.delete('/guilds/:guildId/levels/curve', actionLimiter, (req, res) => {
  levelsModel.setCurve(req.params.guildId, null);
  res.json(curveState(req.params.guildId));
});

router.get('/guilds/:guildId/levels/rewards', (req, res) => {
  res.json(levelsModel.listRewards(req.params.guildId));
});

router.post('/guilds/:guildId/levels/rewards', actionLimiter, (req, res) => {
  const level = num(req.body.level);
  const roleId = String(req.body.roleId || '');
  if (!level || level < 1 || level > 500) return res.status(400).json({ error: 'Level muss zwischen 1 und 500 liegen.' });
  if (!req.guild.roles.cache.has(roleId)) return res.status(400).json({ error: 'Bitte eine gültige Rolle wählen.' });
  if (levelsModel.listRewards(req.params.guildId).length >= 50) return res.status(400).json({ error: 'Maximal 50 Belohnungen.' });
  levelsModel.addReward(req.params.guildId, level, roleId);
  res.json(levelsModel.listRewards(req.params.guildId));
});

router.delete('/guilds/:guildId/levels/rewards/:id', (req, res) => {
  const r = levelsModel.getReward(num(req.params.id));
  if (!r || r.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
  levelsModel.removeReward(r.id);
  res.json({ ok: true });
});

router.delete('/guilds/:guildId/levels/users/:userId', (req, res) => {
  if (!/^\d{5,25}$/.test(req.params.userId)) return res.status(400).json({ error: 'Ungültige ID.' });
  levelsModel.resetUser(req.params.guildId, req.params.userId);
  res.json({ ok: true });
});

router.post('/guilds/:guildId/levels/reset', actionLimiter, (req, res) => {
  levelsModel.resetAll(req.params.guildId);
  res.json({ ok: true });
});

/* ---------------- Neuigkeiten ---------------- */

const newsModel = require('../../src/database/models/news');

router.get('/guilds/:guildId/news', (req, res) => {
  res.json(newsModel.list(req.params.guildId));
});

router.post(
  '/guilds/:guildId/news',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const newsCfg = moduleSettings.get(req.guild.id, 'news');
    if (!newsCfg.enabled) return res.status(400).json({ error: 'Das Neuigkeiten-Modul ist deaktiviert. Bitte oben aktivieren.' });
    const title = String(b.title || '').trim().slice(0, 256);
    const body = String(b.body || '').trim().slice(0, 4000);
    if (!title && !body) return res.status(400).json({ error: 'Bitte einen Titel oder Text angeben.' });

    const channel = req.guild.channels.cache.get(String(b.channelId || ''));
    if (!channel || !channel.isTextBased()) return res.status(400).json({ error: 'Bitte einen gültigen Textkanal wählen.' });

    const embed = new EmbedBuilder().setColor(/^#?[0-9a-fA-F]{6}$/.test(b.color || '') ? parseInt(String(b.color).replace('#', ''), 16) : config.branding.color).setTimestamp();
    if (title) embed.setTitle(title);
    if (body) embed.setDescription(body);
    if (/^https:\/\//i.test(b.imageUrl || '')) embed.setImage(String(b.imageUrl));
    embed.setFooter({ text: `Von ${req.session.user.globalName || req.session.user.username}` });

    let content;
    const allowedMentions = { parse: [] };
    const ping = String(b.ping || 'none');
    if (ping === '@everyone' || ping === '@here') {
      content = ping;
      allowedMentions.parse = ['everyone'];
    } else if (ping === 'default') {
      const ids = String(newsCfg.pingRoleIds || '').split(',').map((x) => x.trim()).filter((id) => req.guild.roles.cache.has(id));
      if (ids.length) {
        content = ids.map((id) => `<@&${id}>`).join(' ');
        allowedMentions.roles = ids;
      }
    } else if (/^\d{5,25}$/.test(ping) && req.guild.roles.cache.has(ping)) {
      content = `<@&${ping}>`;
      allowedMentions.roles = [ping];
    }

    let msg;
    try {
      msg = await channel.send({ content, embeds: [embed], allowedMentions });
    } catch (err) {
      return res.status(400).json({ error: 'Senden fehlgeschlagen: ' + discordErr(err) });
    }
    const row = newsModel.add({ guildId: req.params.guildId, channelId: channel.id, messageId: msg.id, title, body, authorId: req.session.user.id });
    res.json({ ...row, url: msg.url });
  }),
);

router.delete(
  '/guilds/:guildId/news/:id',
  asyncHandler(async (req, res) => {
    const post = newsModel.get(num(req.params.id));
    if (!post || post.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    if (req.query.discord === '1' && post.channel_id && post.message_id) {
      const ch = req.guild.channels.cache.get(post.channel_id);
      await ch?.messages.delete(post.message_id).catch(() => null);
    }
    newsModel.remove(post.id);
    res.json({ ok: true });
  }),
);

/* ---------------- Server-Statistiken (Stat-Kanäle) ---------------- */

const statsChannelService = require('../../src/services/statsChannelService');

router.post(
  '/guilds/:guildId/stats/create',
  actionLimiter,
  asyncHandler(async (req, res) => {
    try {
      const created = await statsChannelService.create(req.guild);
      await statsChannelService.update(req.guild);
      res.json({ ok: true, created, settings: moduleSettings.get(req.guild.id, 'stats') });
    } catch (err) {
      res.status(400).json({ error: discordErr(err) });
    }
  }),
);

/* ---------------- Verifizierung ---------------- */

const verificationService = require('../../src/services/verificationService');

router.post(
  '/guilds/:guildId/verification/post',
  actionLimiter,
  asyncHandler(async (req, res) => {
    try {
      const msg = await verificationService.postPanel(req.guild);
      res.json({ ok: true, url: msg.url });
    } catch (err) {
      res.status(400).json({ error: discordErr(err) });
    }
  }),
);

/* ---------------- Club-Management ---------------- */

const clubsModel = require('../../src/database/models/clubs');

function snowflake(v) {
  const m = String(v || '').match(/\d{5,25}/);
  return m ? m[0] : null;
}

function serializeClub(guild, c) {
  return {
    ...c,
    members: clubsModel.members(c.id).map((m) => {
      const gm = guild.members.cache.get(m.user_id);
      return { userId: m.user_id, rank: m.rank, name: gm ? gm.displayName : null, avatarUrl: gm ? gm.displayAvatarURL({ size: 64 }) : null };
    }),
  };
}

async function addRole(guild, userId, roleId) {
  if (!roleId) return;
  const gm = await guild.members.fetch(userId).catch(() => null);
  await gm?.roles.add(roleId, 'Club-Mitglied').catch(() => null);
}
async function dropRole(guild, userId, roleId) {
  if (!roleId) return;
  const gm = await guild.members.fetch(userId).catch(() => null);
  await gm?.roles.remove(roleId, 'Club verlassen').catch(() => null);
}

router.get('/guilds/:guildId/clubs', (req, res) => {
  res.json(clubsModel.list(req.params.guildId).map((c) => serializeClub(req.guild, c)));
});

router.post(
  '/guilds/:guildId/clubs',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const cfg = moduleSettings.get(req.params.guildId, 'clubs');
    if (!cfg.enabled) return res.status(400).json({ error: 'Das Club-Modul ist deaktiviert.' });
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: 'Bitte einen Club-Namen angeben.' });
    if (clubsModel.list(req.params.guildId).length >= 100) return res.status(400).json({ error: 'Maximal 100 Clubs pro Server.' });
    const leaderId = snowflake(b.leaderId);
    if (!leaderId) return res.status(400).json({ error: 'Bitte die Nutzer-ID des Club-Leiters angeben.' });
    if (clubsModel.ledBy(req.params.guildId, leaderId) >= cfg.maxClubsPerUser) {
      return res.status(400).json({ error: `Diese Person leitet bereits ${cfg.maxClubsPerUser} Club(s) (Maximum).` });
    }
    const leader = await req.guild.members.fetch(leaderId).catch(() => null);
    if (!leader) return res.status(400).json({ error: 'Dieses Mitglied wurde auf dem Server nicht gefunden.' });

    let role = null;
    let channel = null;
    try {
      if (cfg.createRole) {
        role = await req.guild.roles.create({ name: `${b.emoji ? b.emoji + ' ' : ''}${name}`.slice(0, 100), mentionable: true, reason: 'Club erstellt' });
      }
      if (cfg.createChannel) {
        const parent = cfg.categoryId && req.guild.channels.cache.get(cfg.categoryId)?.type === ChannelType.GuildCategory ? cfg.categoryId : undefined;
        const overwrites = [{ id: req.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
        if (role) overwrites.push({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
        overwrites.push({ id: req.guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] });
        channel = await req.guild.channels.create({
          name: name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'club',
          type: ChannelType.GuildText,
          parent,
          permissionOverwrites: overwrites,
          reason: 'Club erstellt',
        });
      }
    } catch (err) {
      await role?.delete().catch(() => null);
      return res.status(400).json({ error: 'Rolle/Kanal konnte nicht erstellt werden: ' + discordErr(err) });
    }

    const club = clubsModel.create({
      guildId: req.params.guildId,
      name,
      description: b.description ? String(b.description).slice(0, 300) : null,
      emoji: b.emoji ? String(b.emoji).slice(0, 16) : null,
      leaderId,
      roleId: role?.id,
      channelId: channel?.id,
    });
    clubsModel.addMember(club.id, leaderId, 'leader');
    await addRole(req.guild, leaderId, role?.id);
    res.json(serializeClub(req.guild, club));
  }),
);

router.patch(
  '/guilds/:guildId/clubs/:id',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const club = clubsModel.get(num(req.params.id));
    if (!club || club.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    const b = req.body || {};
    const patch = {};
    if (b.name !== undefined && String(b.name).trim()) patch.name = String(b.name).trim().slice(0, 60);
    if (b.description !== undefined) patch.description = String(b.description).slice(0, 300) || null;
    if (b.emoji !== undefined) patch.emoji = String(b.emoji).slice(0, 16) || null;
    if (b.leaderId !== undefined) {
      const lid = snowflake(b.leaderId);
      if (!lid) return res.status(400).json({ error: 'Ungültige Nutzer-ID.' });
      const gm = await req.guild.members.fetch(lid).catch(() => null);
      if (!gm) return res.status(400).json({ error: 'Dieses Mitglied wurde auf dem Server nicht gefunden.' });
      patch.leader_id = lid;
      if (club.leader_id && club.leader_id !== lid && clubsModel.getMember(club.id, club.leader_id)) clubsModel.addMember(club.id, club.leader_id, 'officer');
      clubsModel.addMember(club.id, lid, 'leader');
      await addRole(req.guild, lid, club.role_id);
    }
    const updated = clubsModel.update(club.id, patch);
    if (patch.name && club.role_id) await req.guild.roles.cache.get(club.role_id)?.setName(`${updated.emoji ? updated.emoji + ' ' : ''}${patch.name}`.slice(0, 100)).catch(() => null);
    res.json(serializeClub(req.guild, updated));
  }),
);

router.delete(
  '/guilds/:guildId/clubs/:id',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const club = clubsModel.get(num(req.params.id));
    if (!club || club.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    if (req.query.discord === '1') {
      await req.guild.roles.cache.get(club.role_id)?.delete('Club aufgelöst').catch(() => null);
      await req.guild.channels.cache.get(club.channel_id)?.delete('Club aufgelöst').catch(() => null);
    }
    clubsModel.remove(club.id);
    res.json({ ok: true });
  }),
);

router.post(
  '/guilds/:guildId/clubs/:id/members',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const club = clubsModel.get(num(req.params.id));
    if (!club || club.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    const uid = snowflake(req.body?.userId);
    if (!uid) return res.status(400).json({ error: 'Bitte eine gültige Nutzer-ID angeben.' });
    const gm = await req.guild.members.fetch(uid).catch(() => null);
    if (!gm) return res.status(400).json({ error: 'Dieses Mitglied wurde auf dem Server nicht gefunden.' });
    if (clubsModel.members(club.id).length >= 200) return res.status(400).json({ error: 'Maximal 200 Mitglieder pro Club.' });
    const rank = ['officer', 'member'].includes(req.body?.rank) ? req.body.rank : 'member';
    if (uid === club.leader_id) return res.status(400).json({ error: 'Der Leiter ist bereits Mitglied.' });
    clubsModel.addMember(club.id, uid, rank);
    await addRole(req.guild, uid, club.role_id);
    res.json(serializeClub(req.guild, club));
  }),
);

router.patch('/guilds/:guildId/clubs/:id/members/:userId', actionLimiter, (req, res) => {
  const club = clubsModel.get(num(req.params.id));
  if (!club || club.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
  const m = clubsModel.getMember(club.id, req.params.userId);
  if (!m || m.rank === 'leader') return res.status(400).json({ error: 'Rang dieses Mitglieds kann nicht geändert werden.' });
  const rank = req.body?.rank === 'officer' ? 'officer' : 'member';
  clubsModel.addMember(club.id, m.user_id, rank);
  res.json(serializeClub(req.guild, club));
});

router.delete(
  '/guilds/:guildId/clubs/:id/members/:userId',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const club = clubsModel.get(num(req.params.id));
    if (!club || club.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    if (req.params.userId === club.leader_id) return res.status(400).json({ error: 'Der Leiter kann nicht entfernt werden – erst einen neuen Leiter festlegen.' });
    clubsModel.removeMember(club.id, req.params.userId);
    await dropRole(req.guild, req.params.userId, club.role_id);
    res.json(serializeClub(req.guild, club));
  }),
);

/* ---------------- Applications (Appy-Aufbau) ---------------- */

const ID_RE = /^\d{5,25}$/;

function serializeAppType(t) {
  return { ...t, cfg: appModel.typeCfg(t), questions: appModel.listQuestions(t.id) };
}

function ownedAppType(req) {
  const type = appModel.getType(num(req.params.id));
  return type && type.guild_id === req.params.guildId ? type : null;
}

router.get('/guilds/:guildId/application-types', (req, res) => {
  res.json(appModel.listTypes(req.params.guildId).map(serializeAppType));
});

router.post(
  '/guilds/:guildId/application-types',
  asyncHandler(async (req, res) => {
    if (!String(req.body.name || '').trim()) return res.status(400).json({ error: 'Name erforderlich.' });
    const type = appModel.createType({
      guildId: req.params.guildId,
      name: String(req.body.name).trim().slice(0, 80),
      emoji: req.body.emoji ? String(req.body.emoji).slice(0, 16) : null,
      description: req.body.description ? String(req.body.description).slice(0, 200) : null,
    });
    res.json(serializeAppType(type));
  }),
);

router.patch(
  '/guilds/:guildId/application-types/:id',
  asyncHandler(async (req, res) => {
    const type = ownedAppType(req);
    if (!type) return res.status(404).json({ error: 'Nicht gefunden.' });
    const patch = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 80);
      if (!name) return res.status(400).json({ error: 'Der Name darf nicht leer sein.' });
      patch.name = name;
    }
    if (req.body.emoji !== undefined) patch.emoji = String(req.body.emoji).slice(0, 16);
    if (req.body.description !== undefined) patch.description = String(req.body.description).slice(0, 200);
    if (req.body.position !== undefined) patch.position = num(req.body.position, 0);
    if (req.body.enabled !== undefined) patch.enabled = req.body.enabled ? 1 : 0;
    if (req.body.chatCategoryId !== undefined) {
      const id = String(req.body.chatCategoryId || '');
      if (id && !ID_RE.test(id)) return res.status(400).json({ error: 'Ungültige Kategorie.' });
      patch.chat_category_id = id || null;
    }
    if (req.body.autoChat !== undefined) patch.auto_chat = req.body.autoChat ? 1 : 0;
    if (req.body.cfg && typeof req.body.cfg === 'object') patch.cfg = appModel.mergeTypeCfg(type, req.body.cfg);
    res.json(serializeAppType(appModel.updateType(type.id, patch)));
  }),
);

router.post(
  '/guilds/:guildId/application-types/:id/duplicate',
  asyncHandler(async (req, res) => {
    const type = ownedAppType(req);
    if (!type) return res.status(404).json({ error: 'Nicht gefunden.' });
    res.json(serializeAppType(appModel.duplicateType(type.id)));
  }),
);

router.delete(
  '/guilds/:guildId/application-types/:id',
  asyncHandler(async (req, res) => {
    const type = ownedAppType(req);
    if (!type) return res.status(404).json({ error: 'Nicht gefunden.' });
    appModel.deleteType(type.id);
    res.json({ ok: true });
  }),
);

/** Frage-Felder aus dem Request-Body prüfen -> { patch } oder { error }. */
function questionPatch(body, current) {
  const patch = {};
  if (body.label !== undefined) {
    const label = String(body.label).trim().slice(0, 200);
    if (!label) return { error: 'Fragetext erforderlich.' };
    patch.label = label;
  }
  if (body.style !== undefined) {
    if (!appModel.QUESTION_STYLES.includes(body.style)) return { error: 'Ungültiger Fragetyp.' };
    patch.style = body.style;
  }
  if (body.required !== undefined) patch.required = body.required ? 1 : 0;
  if (body.position !== undefined) patch.position = num(body.position, 0);
  if (body.minLength !== undefined) patch.min_length = Math.max(0, num(body.minLength, 0));
  if (body.maxLength !== undefined) patch.max_length = Math.min(4000, Math.max(0, num(body.maxLength, 0)));
  if (body.description !== undefined) patch.description = String(body.description).slice(0, 100);
  if (body.options !== undefined) patch.options = body.options;
  const style = patch.style ?? current?.style;
  if (style === 'choice') {
    const opts = body.options !== undefined ? body.options : current?.options;
    const n = (Array.isArray(opts) ? opts : String(opts ?? '').split('\n')).map((o) => String(o).trim()).filter(Boolean).length;
    if (n < 2) return { error: 'Eine Auswahl-Frage braucht mindestens 2 Antwortmöglichkeiten.' };
  }
  return { patch };
}

router.post(
  '/guilds/:guildId/application-types/:id/questions',
  asyncHandler(async (req, res) => {
    const type = ownedAppType(req);
    if (!type) return res.status(404).json({ error: 'Nicht gefunden.' });
    if (!String(req.body.label || '').trim()) return res.status(400).json({ error: 'Fragetext erforderlich.' });
    const { patch, error } = questionPatch(req.body, null);
    if (error) return res.status(400).json({ error });
    const style = patch.style ?? 'short';
    const q = appModel.addQuestion({
      typeId: type.id,
      label: patch.label,
      style,
      required: patch.required !== 0,
      minLength: patch.min_length ?? 0,
      maxLength: patch.max_length ?? (style === 'number' ? 0 : 400),
      options: patch.options,
      description: patch.description,
    });
    res.json(q);
  }),
);

function ownedAppQuestion(req) {
  const type = ownedAppType(req);
  if (!type) return null;
  const q = appModel.getQuestion(num(req.params.qid));
  return q && q.type_id === type.id ? q : null;
}

router.patch(
  '/guilds/:guildId/application-types/:id/questions/:qid',
  asyncHandler(async (req, res) => {
    const q = ownedAppQuestion(req);
    if (!q) return res.status(404).json({ error: 'Frage nicht gefunden.' });
    const { patch, error } = questionPatch(req.body, q);
    if (error) return res.status(400).json({ error });
    res.json(appModel.updateQuestion(q.id, patch));
  }),
);

router.delete(
  '/guilds/:guildId/application-types/:id/questions/:qid',
  asyncHandler(async (req, res) => {
    const q = ownedAppQuestion(req);
    if (!q) return res.status(404).json({ error: 'Frage nicht gefunden.' });
    appModel.deleteQuestion(q.id);
    res.json({ ok: true });
  }),
);

/* --- Panels --- */

function ownedAppPanel(req) {
  const p = appModel.getPanel(num(req.params.id));
  return p && p.guild_id === req.params.guildId ? p : null;
}

function serializeAppPanel(p) {
  return { ...p, typeIds: appModel.panelTypeIds(p), cfg: appModel.panelCfg(p) };
}

router.get('/guilds/:guildId/application-panels', (req, res) => {
  res.json(appModel.listPanels(req.params.guildId).map(serializeAppPanel));
});

router.post(
  '/guilds/:guildId/application-panels',
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || 'Neues Panel').trim().slice(0, 80) || 'Neues Panel';
    res.json(serializeAppPanel(appModel.createPanel({ guildId: req.params.guildId, name })));
  }),
);

router.patch(
  '/guilds/:guildId/application-panels/:id',
  asyncHandler(async (req, res) => {
    const panel = ownedAppPanel(req);
    if (!panel) return res.status(404).json({ error: 'Nicht gefunden.' });
    const patch = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim().slice(0, 80) || panel.name;
    if (req.body.channelId !== undefined) {
      const id = String(req.body.channelId || '');
      if (id && !ID_RE.test(id)) return res.status(400).json({ error: 'Ungültiger Kanal.' });
      patch.channel_id = id || null;
      if ((id || null) !== (panel.channel_id || null)) patch.message_id = null; // neuer Kanal -> neue Nachricht
    }
    if (req.body.typeIds !== undefined) {
      const valid = new Set(appModel.listTypes(req.params.guildId).map((t) => t.id));
      patch.type_ids = JSON.stringify([...new Set((Array.isArray(req.body.typeIds) ? req.body.typeIds : []).map(Number))].filter((id) => valid.has(id)));
    }
    if (req.body.panelType !== undefined) patch.panel_type = req.body.panelType === 'select' ? 'select' : 'buttons';
    if (req.body.cfg && typeof req.body.cfg === 'object') {
      patch.cfg = JSON.stringify({ ...appModel.sanitizePanelCfg(JSON.parse(panel.cfg || '{}')), ...appModel.sanitizePanelCfg(req.body.cfg) });
    }
    res.json(serializeAppPanel(appModel.updatePanel(panel.id, patch)));
  }),
);

router.post(
  '/guilds/:guildId/application-panels/:id/duplicate',
  asyncHandler(async (req, res) => {
    const panel = ownedAppPanel(req);
    if (!panel) return res.status(404).json({ error: 'Nicht gefunden.' });
    res.json(serializeAppPanel(appModel.duplicatePanel(panel.id)));
  }),
);

router.delete(
  '/guilds/:guildId/application-panels/:id',
  asyncHandler(async (req, res) => {
    const panel = ownedAppPanel(req);
    if (!panel) return res.status(404).json({ error: 'Nicht gefunden.' });
    if (panel.channel_id && panel.message_id) {
      const ch = req.guild.channels.cache.get(panel.channel_id);
      await ch?.messages?.delete(panel.message_id).catch(() => null);
    }
    appModel.deletePanel(panel.id);
    res.json({ ok: true });
  }),
);

router.post(
  '/guilds/:guildId/application-panels/:id/send',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const panel = ownedAppPanel(req);
    if (!panel) return res.status(404).json({ error: 'Nicht gefunden.' });
    const msg = await applicationService.sendPanel(req.guild, panel);
    res.json({ ok: true, messageId: msg.id, url: msg.url });
  }),
);

/* --- Einreichungen --- */

router.get('/guilds/:guildId/applications', (req, res) => {
  const gid = req.params.guildId;
  const limit = Math.min(100, Math.max(1, num(req.query.limit, 20)));
  const page = Math.max(1, num(req.query.page, 1));
  const q = String(req.query.q || '').trim();
  const { items, total } = appModel.listSubmissions(gid, {
    status: ['pending', 'accepted', 'rejected'].includes(req.query.status) ? req.query.status : undefined,
    typeId: num(req.query.typeId, undefined),
    userId: ID_RE.test(q) ? q : undefined,
    order: req.query.order === 'oldest' ? 'oldest' : 'newest',
    limit,
    offset: (page - 1) * limit,
  });
  res.json({
    items: items.map((a) => {
      const chat = ticketsModel.getActiveByApplication(a.id);
      return {
        ...a,
        answers: JSON.parse(a.answers_json || '[]'),
        chat: chat ? { status: chat.status, url: `https://discord.com/channels/${a.guild_id}/${chat.channel_id}` } : null,
      };
    }),
    total,
    page,
    limit,
    stats: appModel.stats(gid),
  });
});

router.post(
  '/guilds/:guildId/applications/:id/chat',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const app = appModel.getApplication(num(req.params.id));
    if (!app || app.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    const { channel, created } = await applicationService.openChat(req.guild, app, { id: req.session.user.id });
    res.json({ ok: true, created, url: `https://discord.com/channels/${app.guild_id}/${channel.id}` });
  }),
);

router.post(
  '/guilds/:guildId/applications/:id/review',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const app = appModel.getApplication(num(req.params.id));
    if (!app || app.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    const decision = req.body.decision === 'accept' ? 'accepted' : req.body.decision === 'reject' ? 'rejected' : null;
    if (!decision) return res.status(400).json({ error: 'decision muss "accept" oder "reject" sein.' });
    const { application, roleNote } = await applicationService.reviewApplication(
      req.guild,
      app.id,
      { id: req.session.user.id, tag: req.session.user.username },
      decision,
      req.body.note ? String(req.body.note).slice(0, 1000) : null,
    );
    res.json({ application, roleNote });
  }),
);

router.delete(
  '/guilds/:guildId/applications/:id',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const app = appModel.getApplication(num(req.params.id));
    if (!app || app.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    await applicationService.deleteSubmission(req.guild, app);
    res.json({ ok: true });
  }),
);

/* ---------------- Social-Media-Benachrichtigungen ---------------- */

const socialModel = require('../../src/database/models/social');
const socialService = require('../../src/services/socialService');

function serializeSub(s) {
  return {
    id: s.id,
    platform: s.platform,
    account: s.account,
    accountLabel: s.account_label,
    channelId: s.channel_id,
    mention: s.mention,
    message: s.message,
    embed: s.embed === 1,
    enabled: s.enabled === 1,
    isLive: s.is_live === 1,
    lastAnnouncedAt: s.last_announced_at,
    lastCheckedAt: s.last_checked_at,
    failing: (s.fail_count || 0) >= 3,
  };
}

router.get('/guilds/:guildId/social', (req, res) => {
  res.json({
    twitchReady: socialService.twitchConfigured(),
    subscriptions: socialModel.list(req.params.guildId).map(serializeSub),
  });
});

router.post(
  '/guilds/:guildId/social',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const b = req.body;
    const platform = String(b.platform || '').toLowerCase();
    if (!socialModel.PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: 'Plattform muss youtube, twitch, tiktok oder rss sein.' });
    }
    if (platform === 'twitch' && !socialService.twitchConfigured()) {
      return res.status(400).json({ error: 'Twitch ist nicht eingerichtet (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET in der .env fehlen).' });
    }
    const channelId = String(b.channelId || '');
    if (!req.guild.channels.cache.has(channelId)) {
      return res.status(400).json({ error: 'Bitte einen gültigen Kanal wählen.' });
    }
    if (socialModel.countByGuild(req.params.guildId) >= 40) {
      return res.status(400).json({ error: 'Maximal 40 Benachrichtigungen pro Server.' });
    }

    let resolved;
    try {
      resolved = await socialService.resolveAccount(platform, b.account);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const mention = normalizeMention(b.mention, req.guild);
    try {
      const created = socialModel.create({
        guildId: req.params.guildId,
        platform,
        // resolveAccount() normalisiert je Plattform selbst (Twitch/TikTok-Handle klein,
        // YouTube-ID + Feed-URLs bleiben unveraendert).
        account: resolved.account,
        accountLabel: resolved.label,
        channelId,
        mention,
        message: b.message ? String(b.message).slice(0, 500) : null,
        embed: b.embed === false || b.embed === 'false' ? 0 : 1,
      });
      res.json(serializeSub(created));
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return res.status(409).json({ error: 'Dieser Account wird in diesem Kanal schon überwacht.' });
      }
      throw err;
    }
  }),
);

router.patch(
  '/guilds/:guildId/social/:id',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const sub = socialModel.get(num(req.params.id));
    if (!sub || sub.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    const b = req.body;
    const patch = {};
    if (b.channelId !== undefined) {
      if (!req.guild.channels.cache.has(String(b.channelId))) return res.status(400).json({ error: 'Ungültiger Kanal.' });
      patch.channel_id = String(b.channelId);
    }
    if (b.mention !== undefined) patch.mention = normalizeMention(b.mention, req.guild);
    if (b.message !== undefined) patch.message = b.message ? String(b.message).slice(0, 500) : null;
    if (b.embed !== undefined) patch.embed = b.embed ? 1 : 0;
    if (b.enabled !== undefined) patch.enabled = b.enabled ? 1 : 0;
    res.json(serializeSub(socialModel.update(sub.id, patch)));
  }),
);

router.post(
  '/guilds/:guildId/social/:id/test',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const sub = socialModel.get(num(req.params.id));
    if (!sub || sub.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    try {
      await socialService.sendTest(sub);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }),
);

router.delete('/guilds/:guildId/social/:id', (req, res) => {
  const sub = socialModel.get(num(req.params.id));
  if (!sub || sub.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
  socialModel.remove(sub.id);
  res.json({ ok: true });
});

function normalizeMention(input, guild) {
  const v = String(input || '').trim();
  if (!v || v === 'none') return null;
  if (v === '@everyone' || v === 'everyone') return '@everyone';
  if (v === '@here' || v === 'here') return '@here';
  const roleId = v.replace(/\D/g, '');
  if (roleId && guild.roles.cache.has(roleId)) return `<@&${roleId}>`;
  return null;
}

/* ----------------------------------------------------------------
 *  Mitglieder-Verwaltung – NUR Bot-Besitzer
 *  Nickname setzen + einzelnen Mitgliedern Rollen geben/entziehen.
 * ---------------------------------------------------------------- */

function serializeMember(m) {
  return {
    id: m.id,
    tag: m.user.tag,
    username: m.user.username,
    displayName: m.displayName,
    nickname: m.nickname ?? null,
    avatarUrl: m.displayAvatarURL({ size: 128, extension: 'png' }),
    bot: m.user.bot,
    isGuildOwner: m.id === m.guild.ownerId,
    roleIds: [...m.roles.cache.keys()].filter((id) => id !== m.guild.id),
    joinedAt: m.joinedTimestamp || null,
    voiceChannelId: m.voice?.channelId ?? null,
    voiceChannelName: m.voice?.channel?.name ?? null,
  };
}

router.get(
  '/guilds/:guildId/member-tools',
  requireOwner,
  asyncHandler(async (req, res) => {
    const me = req.guild.members.me ?? (await req.guild.members.fetchMe().catch(() => null));
    res.json({
      botTopRolePosition: me?.roles.highest.position ?? 0,
      canNick: Boolean(me?.permissions.has(PermissionFlagsBits.ManageNicknames)),
      canRoles: Boolean(me?.permissions.has(PermissionFlagsBits.ManageRoles)),
      canMove: Boolean(me?.permissions.has(PermissionFlagsBits.MoveMembers)),
      canChannels: Boolean(me?.permissions.has(PermissionFlagsBits.ManageChannels)),
      guildOwnerId: req.guild.ownerId,
    });
  }),
);

router.post(
  '/guilds/:guildId/roles',
  requireOwner,
  actionLimiter,
  asyncHandler(async (req, res) => {
    const me = req.guild.members.me ?? (await req.guild.members.fetchMe());
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return res.status(403).json({ error: 'Dem Bot fehlt die Berechtigung „Rollen verwalten".' });
    }
    const name = String(req.body.name || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: 'Bitte einen Rollennamen angeben.' });
    if (req.guild.roles.cache.size >= 250) {
      return res.status(400).json({ error: 'Der Server hat das Rollen-Limit (250) erreicht.' });
    }
    const colorRaw = String(req.body.color || '').trim();
    const color = /^#?[0-9a-fA-F]{6}$/.test(colorRaw) ? parseInt(colorRaw.replace('#', ''), 16) : 0;
    const wantAdmin = req.body.admin === true || req.body.admin === 'true';
    if (wantAdmin && !me.permissions.has(PermissionFlagsBits.Administrator)) {
      return res.status(400).json({ error: 'Der Bot selbst hat keine Administrator-Rechte und kann daher keine Admin-Rolle erstellen.' });
    }
    try {
      const role = await req.guild.roles.create({
        name,
        color: color || undefined,
        hoist: req.body.hoist === true || req.body.hoist === 'true',
        mentionable: req.body.mentionable === true || req.body.mentionable === 'true',
        permissions: wantAdmin ? [PermissionFlagsBits.Administrator] : [],
        reason: `Dashboard (Besitzer): ${req.session.user.username}`,
      });
      res.json({ ok: true, role: { id: role.id, name: role.name, color: role.hexColor, position: role.position, managed: false } });
    } catch (err) {
      res.status(400).json({ error: discordErr(err) });
    }
  }),
);

router.get(
  '/guilds/:guildId/members',
  requireOwner,
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    let members = [];
    try {
      if (/^\d{5,25}$/.test(q)) {
        const m = await req.guild.members.fetch({ user: q, force: true }).catch(() => null);
        if (m) members = [m];
      } else {
        const coll = await req.guild.members.fetch({ query: q, limit: 25 });
        members = [...coll.values()];
      }
    } catch (err) {
      return res.status(400).json({ error: discordErr(err) });
    }
    res.json(members.map(serializeMember));
  }),
);

router.get(
  '/guilds/:guildId/members/:userId',
  requireOwner,
  asyncHandler(async (req, res) => {
    const m = await req.guild.members.fetch({ user: req.params.userId, force: true }).catch(() => null);
    if (!m) return res.status(404).json({ error: 'Mitglied nicht gefunden.' });
    res.json(serializeMember(m));
  }),
);

router.patch(
  '/guilds/:guildId/members/:userId',
  requireOwner,
  actionLimiter,
  asyncHandler(async (req, res) => {
    const m = await req.guild.members.fetch({ user: req.params.userId, force: true }).catch(() => null);
    if (!m) return res.status(404).json({ error: 'Mitglied nicht gefunden.' });
    const me = req.guild.members.me ?? (await req.guild.members.fetchMe());
    const b = req.body || {};
    const reason = `Dashboard (Besitzer): ${req.session.user.username}`;
    const out = { ok: true };

    // ---- Nickname ----
    if (b.nickname !== undefined) {
      if (!me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
        return res.status(403).json({ error: 'Dem Bot fehlt die Berechtigung „Nicknamen verwalten".' });
      }
      if (m.id === req.guild.ownerId) {
        return res.status(400).json({ error: 'Der Server-Inhaber kann von keinem Bot umbenannt werden.' });
      }
      if (m.id !== me.id && me.roles.highest.comparePositionTo(m.roles.highest) <= 0) {
        return res.status(400).json({ error: 'Dieses Mitglied steht (durch seine Rollen) über dem Bot – Nickname nicht änderbar.' });
      }
      const nick = String(b.nickname ?? '').trim().slice(0, 32);
      try {
        await m.setNickname(nick || null, reason);
        out.nickname = nick || null;
      } catch (err) {
        return res.status(400).json({ error: discordErr(err) });
      }
    }

    // ---- Rollen ----
    const addRoles = Array.isArray(b.addRoles) ? b.addRoles.map(String).filter(Boolean) : [];
    const removeRoles = Array.isArray(b.removeRoles) ? b.removeRoles.map(String).filter(Boolean) : [];
    if (addRoles.length || removeRoles.length) {
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return res.status(403).json({ error: 'Dem Bot fehlt die Berechtigung „Rollen verwalten".' });
      }
      const botTop = me.roles.highest.position;
      for (const id of new Set([...addRoles, ...removeRoles])) {
        const role = req.guild.roles.cache.get(id);
        if (!role) return res.status(400).json({ error: 'Unbekannte Rolle.' });
        if (role.id === req.guild.id) return res.status(400).json({ error: '@everyone kann nicht vergeben werden.' });
        if (role.managed) return res.status(400).json({ error: `„${role.name}" wird von einer Integration verwaltet und kann nicht manuell vergeben werden.` });
        if (role.position >= botTop) return res.status(400).json({ error: `„${role.name}" steht über der höchsten Bot-Rolle – der Bot kann sie nicht vergeben/entziehen.` });
      }
      try {
        if (addRoles.length) await m.roles.add(addRoles, reason);
        if (removeRoles.length) await m.roles.remove(removeRoles, reason);
      } catch (err) {
        return res.status(400).json({ error: discordErr(err) });
      }
    }

    // ---- In einen Sprachkanal verschieben / aus dem Voice trennen ----
    if (b.moveTo !== undefined) {
      if (!me.permissions.has(PermissionFlagsBits.MoveMembers)) {
        return res.status(403).json({ error: 'Dem Bot fehlt die Berechtigung „Mitglieder verschieben".' });
      }
      if (!m.voice?.channelId) {
        return res.status(400).json({ error: 'Dieses Mitglied ist gerade in keinem Sprachkanal.' });
      }
      const targetId = b.moveTo ? String(b.moveTo) : null;
      if (targetId) {
        const ch = req.guild.channels.cache.get(targetId);
        if (!ch || !(ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice)) {
          return res.status(400).json({ error: 'Der Zielkanal ist kein Sprachkanal.' });
        }
        const perms = ch.permissionsFor(me);
        if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.Connect)) {
          return res.status(400).json({ error: `Der Bot hat auf „${ch.name}" keinen Zugriff – dorthin kann nicht verschoben werden.` });
        }
      }
      try {
        await m.voice.setChannel(targetId, reason); // null = aus dem Sprachkanal trennen
        out.moved = true;
      } catch (err) {
        return res.status(400).json({ error: discordErr(err) });
      }
    }

    const fresh = await req.guild.members.fetch({ user: m.id, force: true }).catch(() => m);
    out.member = serializeMember(fresh);
    res.json(out);
  }),
);

module.exports = router;
