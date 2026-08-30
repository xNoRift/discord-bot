'use strict';

const express = require('express');
const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const client = require('../../src/core/client');
const config = require('../../config/config');

const { requireAuth, verifyCsrf, loadGuild } = require('../middleware/auth');
const { apiLimiter, actionLimiter } = require('../middleware/rateLimit');
const guildAccess = require('../services/guildAccess');

const settingsModel = require('../../src/database/models/settings');
const ticketsModel = require('../../src/database/models/tickets');
const ticketPanels = require('../../src/database/models/ticketPanels');
const giveawaysModel = require('../../src/database/models/giveaways');
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
 *  Bot-Status / Aktivität (bot-weit)
 * ---------------------------------------------------------------- */

async function requireBotManager(req, res, next) {
  try {
    const { managed } = await guildAccess.getManageableGuilds(req.session.user.id);
    if (!managed.length) return res.status(403).json({ error: 'Keine Berechtigung.' });
    return next();
  } catch (err) {
    return next(err);
  }
}

const botConfig = require('../../src/database/models/botConfig');
const presenceService = require('../../src/services/presenceService');

const STATUS = ['online', 'idle', 'dnd', 'invisible'];
const ACT_TYPES = ['none', 'playing', 'watching', 'listening', 'competing', 'streaming', 'custom'];

router.get('/bot/presence', requireBotManager, (req, res) => {
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
  requireBotManager,
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

    if (asEmbed) {
      if (content.length > 4096) return res.status(400).json({ error: 'Embed-Text max. 4096 Zeichen.' });
    } else if (content.length > 2000) {
      return res.status(400).json({ error: 'Nachricht max. 2000 Zeichen.' });
    }
    if (!content.trim() && !embedTitle.trim()) {
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

    const payload = asEmbed
      ? {
          embeds: [
            (() => {
              const e = new EmbedBuilder();
              if (embedTitle.trim()) e.setTitle(embedTitle);
              if (content.trim()) e.setDescription(content);
              e.setColor(color ?? config.branding.color);
              return e;
            })(),
          ],
        }
      : { content, allowedMentions: { parse: [] } };

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
    for (const k of ['name', 'title', 'description', 'color']) {
      if (b[k] !== undefined) patch[k] = b[k];
    }
    if (b.buttonLabel !== undefined) patch.button_label = b.buttonLabel || null;
    if (b.useSelect !== undefined) patch.use_select = b.useSelect ? 1 : 0;
    if (b.log_channel_id !== undefined) patch.log_channel_id = b.log_channel_id || null;
    if (b.rating_enabled !== undefined || b.ratingEnabled !== undefined) {
      patch.rating_enabled = (b.rating_enabled ?? b.ratingEnabled) ? 1 : 0;
    }
    if (b.rating_channel_id !== undefined) patch.rating_channel_id = b.rating_channel_id || null;
    if (b.claim_category_id !== undefined) patch.claim_category_id = b.claim_category_id || null;
    if (b.autoclose_hours !== undefined) patch.autoclose_hours = Math.max(0, num(b.autoclose_hours, 0));
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

function ownedCategory(req) {
  if (!ownedPanel(req)) return null;
  const cat = ticketPanels.getCategory(num(req.params.catId));
  return cat && cat.panel_id === num(req.params.panelId) ? cat : null;
}

router.post(
  '/guilds/:guildId/ticket-panels/:panelId/categories/:catId/questions',
  asyncHandler(async (req, res) => {
    if (!ownedCategory(req)) return res.status(404).json({ error: 'Kategorie nicht gefunden.' });
    if (ticketPanels.countQuestions(num(req.params.catId)) >= 5) {
      return res.status(400).json({ error: 'Maximal 5 Felder pro Kategorie (Discord-Limit).' });
    }
    if (!req.body.label) return res.status(400).json({ error: 'Feldname erforderlich.' });
    const q = ticketPanels.addQuestion({
      categoryId: num(req.params.catId),
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

router.patch(
  '/guilds/:guildId/ticket-panels/:panelId/categories/:catId/questions/:qid',
  asyncHandler(async (req, res) => {
    if (!ownedCategory(req)) return res.status(404).json({ error: 'Kategorie nicht gefunden.' });
    const patch = {};
    if (req.body.label !== undefined) patch.label = String(req.body.label).slice(0, 45);
    if (req.body.style !== undefined) patch.style = req.body.style === 'paragraph' ? 'paragraph' : 'short';
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
    if (!ownedCategory(req)) return res.status(404).json({ error: 'Kategorie nicht gefunden.' });
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
      hostId: req.session.user.id,
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
    if (g.ended) return res.status(400).json({ error: 'Beendete Giveaways können nicht bearbeitet werden.' });

    const patch = {};
    if (req.body.prize) patch.prize = String(req.body.prize).slice(0, 200);
    if (req.body.description !== undefined) patch.description = String(req.body.description).slice(0, 1000);
    if (req.body.winnerCount) patch.winner_count = Math.max(1, num(req.body.winnerCount, 1));
    if (req.body.requiredRoleId !== undefined) patch.required_role_id = req.body.requiredRoleId || null;
    if (req.body.winnerRoleId !== undefined) patch.winner_role_id = req.body.winnerRoleId || null;
    if (req.body.addTime) {
      const add = parseDuration(req.body.addTime);
      if (add) patch.ends_at = g.ends_at + add;
    }
    if (req.body.endsAt) patch.ends_at = num(req.body.endsAt);

    const updated = giveawaysModel.update(g.id, patch);
    giveawayService.scheduleEnd(updated);
    await giveawayService.refreshGiveawayMessage(g.id).catch(() => null);
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

/* ---------------- Applications ---------------- */

router.get('/guilds/:guildId/application-types', (req, res) => {
  const types = appModel.listTypes(req.params.guildId).map((t) => ({
    ...t,
    questions: appModel.listQuestions(t.id),
  }));
  res.json(types);
});

router.post(
  '/guilds/:guildId/application-types',
  asyncHandler(async (req, res) => {
    if (!req.body.name) return res.status(400).json({ error: 'Name erforderlich.' });
    const type = appModel.createType({
      guildId: req.params.guildId,
      name: String(req.body.name).slice(0, 80),
      emoji: req.body.emoji ? String(req.body.emoji).slice(0, 16) : null,
      description: req.body.description ? String(req.body.description).slice(0, 200) : null,
      acceptRoleId: req.body.acceptRoleId || null,
    });
    res.json(type);
  }),
);

router.patch(
  '/guilds/:guildId/application-types/:id',
  asyncHandler(async (req, res) => {
    const type = appModel.getType(num(req.params.id));
    if (!type || type.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    const patch = {};
    for (const k of ['name', 'emoji', 'description', 'position']) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }
    if (req.body.acceptRoleId !== undefined) patch.accept_role_id = req.body.acceptRoleId || null;
    if (req.body.enabled !== undefined) patch.enabled = req.body.enabled ? 1 : 0;
    res.json(appModel.updateType(type.id, patch));
  }),
);

router.delete(
  '/guilds/:guildId/application-types/:id',
  asyncHandler(async (req, res) => {
    const type = appModel.getType(num(req.params.id));
    if (!type || type.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    appModel.deleteType(type.id);
    res.json({ ok: true });
  }),
);

router.post(
  '/guilds/:guildId/application-types/:id/questions',
  asyncHandler(async (req, res) => {
    const type = appModel.getType(num(req.params.id));
    if (!type || type.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    if (appModel.countQuestions(type.id) >= applicationService.MAX_QUESTIONS) {
      return res.status(400).json({ error: `Maximal ${applicationService.MAX_QUESTIONS} Fragen pro Bewerbungsart (Discord-Limit).` });
    }
    if (!req.body.label) return res.status(400).json({ error: 'Fragetext erforderlich.' });
    const q = appModel.addQuestion({
      typeId: type.id,
      label: String(req.body.label).slice(0, 45),
      style: req.body.style === 'paragraph' ? 'paragraph' : 'short',
      required: req.body.required !== false,
      minLength: Math.max(0, num(req.body.minLength, 0)),
      maxLength: Math.min(4000, Math.max(1, num(req.body.maxLength, 400))),
    });
    res.json(q);
  }),
);

router.patch(
  '/guilds/:guildId/application-types/:id/questions/:qid',
  asyncHandler(async (req, res) => {
    const type = appModel.getType(num(req.params.id));
    if (!type || type.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    const patch = {};
    if (req.body.label !== undefined) patch.label = String(req.body.label).slice(0, 45);
    if (req.body.style !== undefined) patch.style = req.body.style === 'paragraph' ? 'paragraph' : 'short';
    if (req.body.required !== undefined) patch.required = req.body.required ? 1 : 0;
    if (req.body.position !== undefined) patch.position = num(req.body.position, 0);
    if (req.body.minLength !== undefined) patch.min_length = Math.max(0, num(req.body.minLength, 0));
    if (req.body.maxLength !== undefined) patch.max_length = Math.min(4000, Math.max(1, num(req.body.maxLength, 400)));
    res.json(appModel.updateQuestion(num(req.params.qid), patch));
  }),
);

router.delete(
  '/guilds/:guildId/application-types/:id/questions/:qid',
  asyncHandler(async (req, res) => {
    const type = appModel.getType(num(req.params.id));
    if (!type || type.guild_id !== req.params.guildId) return res.status(404).json({ error: 'Nicht gefunden.' });
    appModel.deleteQuestion(num(req.params.qid));
    res.json({ ok: true });
  }),
);

router.post(
  '/guilds/:guildId/applications/panel',
  actionLimiter,
  asyncHandler(async (req, res) => {
    const channelId = String(req.body.channelId || '');
    if (!/^\d{5,25}$/.test(channelId)) return res.status(400).json({ error: 'Bitte einen Kanal wählen.' });
    const msg = await applicationService.postOrUpdatePanel(req.guild, channelId);
    res.json({ ok: true, messageId: msg.id, url: msg.url });
  }),
);

router.get('/guilds/:guildId/applications', (req, res) => {
  res.json(
    appModel.listApplications(req.params.guildId, { status: req.query.status, limit: 100 }).map((a) => ({
      ...a,
      answers: JSON.parse(a.answers_json || '[]'),
    })),
  );
});

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

module.exports = router;
