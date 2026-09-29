'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { requireAuth, loadGuild } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const guildAccess = require('../services/guildAccess');
const twitchSubs = require('../../src/database/models/twitchSubs');
const twitchSubService = require('../../src/services/twitchSubService');
const client = require('../../src/core/client');
const moduleSettings = require('../../src/database/models/moduleSettings');
const i18n = require('../../src/utils/i18n');
const logger = require('../../src/utils/logger');

/**
 * Twitch-OAuth für die Twitch-Sub-Rollen.
 *  /twitch/connect/:guildId – Admin verbindet den Twitch-Kanal des Servers (aus dem Dashboard)
 *  /twitch/link?t=…        – Mitglied verknüpft sein Twitch-Konto (signierter Link aus dem Discord-Button)
 *  /twitch/callback        – gemeinsame Rücksprung-Adresse (muss auf dev.twitch.tv eingetragen sein)
 */

const router = express.Router();
const { L } = i18n;

function startOAuth(req, res, data, scopes) {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.twitchOAuth = { ...data, state, at: Date.now() };
  res.redirect(twitchSubService.authorizeUrl(state, scopes));
}

function memberResult(res, guildId, { ok, title, message, lines = [] }) {
  i18n.runFor(guildId, () => {
    res.status(ok ? 200 : 400).render('twitch-result', {
      ok,
      title: title(),
      message: message(),
      lines,
      backUrl: guildId ? `https://discord.com/channels/${guildId}` : 'https://discord.com/app',
      backLabel: L('Zurück zu Discord', 'Back to Discord'),
    });
  });
}

const notConfigured = (res) => res.status(503).render('error', { title: 'Twitch nicht eingerichtet', message: 'TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET fehlen in der .env des Servers.' });

/* ---------------- Admin: Twitch-Kanal des Servers verbinden ---------------- */

router.get('/connect/:guildId', requireAuth, loadGuild, (req, res) => {
  if (!twitchSubService.configured()) return notConfigured(res);
  startOAuth(req, res, { kind: 'broadcaster', guildId: req.guild.id }, twitchSubService.BROADCASTER_SCOPES);
});

/* ---------------- Mitglied: eigenes Twitch-Konto verknüpfen ---------------- */

router.get('/link', authLimiter, (req, res) => {
  if (!twitchSubService.configured()) return notConfigured(res);
  const t = twitchSubService.verifyLinkToken(req.query.t);
  if (!t) {
    return memberResult(res, null, {
      ok: false,
      title: () => L('Link abgelaufen', 'Link expired'),
      message: () => L('Dieser Link ist ungültig oder abgelaufen. Klicke in Discord erneut auf „Twitch verknüpfen".', 'This link is invalid or has expired. Click "Link Twitch" in Discord again.'),
    });
  }
  startOAuth(req, res, { kind: 'member', userId: t.userId, guildId: t.guildId }, []);
});

/* ---------------- Rücksprung von Twitch ---------------- */

router.get('/callback', authLimiter, async (req, res, next) => {
  const pending = req.session.twitchOAuth;
  delete req.session.twitchOAuth;
  const { code, state, error } = req.query;
  const guildId = pending?.guildId || null;

  try {
    if (!pending || !state || state !== pending.state || Date.now() - pending.at > 15 * 60_000) {
      return memberResult(res, guildId, {
        ok: false,
        title: () => L('Vorgang abgelaufen', 'Request expired'),
        message: () => L('Die Anmeldung ist ungültig oder abgelaufen. Bitte noch einmal von vorne beginnen.', 'The login is invalid or has expired. Please start again.'),
      });
    }
    if (error || !code) {
      if (pending.kind === 'broadcaster') return res.redirect(`/dashboard/${guildId}/social?tab=subs`);
      return memberResult(res, guildId, {
        ok: false,
        title: () => L('Abgebrochen', 'Cancelled'),
        message: () => L('Die Twitch-Anmeldung wurde abgebrochen.', 'The Twitch login was cancelled.'),
      });
    }

    const token = await twitchSubService.exchangeCode(String(code));
    const me = await twitchSubService.fetchSelf(token.access_token);

    if (pending.kind === 'broadcaster') {
      const userId = req.session.user?.id;
      if (!userId || !(await guildAccess.userCanManageGuild(userId, guildId))) {
        await twitchSubService.revokeToken(token.access_token);
        return res.status(403).render('error', { title: 'Kein Zugriff', message: 'Du darfst diesen Server nicht verwalten.' });
      }
      const scopes = token.scope || [];
      if (!twitchSubService.BROADCASTER_SCOPES.every((s) => scopes.includes(s))) {
        await twitchSubService.revokeToken(token.access_token);
        return res.status(400).render('error', { title: 'Berechtigung fehlt', message: 'Twitch hat die Berechtigung zum Lesen der Abonnenten nicht erteilt. Bitte erneut verbinden und zustimmen.' });
      }
      twitchSubs.saveBroadcaster({
        guildId, twitchUserId: me.id, login: me.login, name: me.name,
        accessToken: token.access_token, refreshToken: token.refresh_token, expiresInSec: token.expires_in, connectedBy: userId,
      });
      logger.info(`[twitchsubs] Server ${guildId} mit Twitch-Kanal ${me.login} verbunden (von ${userId})`);
      // Fehlende Stufen-Rollen gleich mit anlegen und eintragen (vorhandene bleiben unangetastet)
      let created = [];
      try {
        created = await i18n.runFor(guildId, () => twitchSubService.createRoles(client.guilds.cache.get(guildId), { any: true }));
      } catch (err) {
        logger.warn('[twitchsubs] Rollen erstellen:', err.message);
        twitchSubs.setSyncResult(guildId, { error: `Rollen konnten nicht automatisch erstellt werden: ${err.message}` });
      }
      // Modul beim Verbinden automatisch einschalten
      moduleSettings.update(guildId, 'twitchsubs', { enabled: true });
      twitchSubService.syncGuild(guildId).catch((err) => logger.warn('[twitchsubs] Erst-Abgleich:', err.message));
      return res.redirect(`/dashboard/${guildId}/social?tab=subs&connected=${created.length}`);
    }

    // Mitglied: nur die Twitch-ID wird gebraucht – Token sofort widerrufen
    await twitchSubService.revokeToken(token.access_token);
    const results = await twitchSubService.linkAccount(pending.userId, me);
    const tierText = (t) => (t ? L('Stufe {t}', 'Tier {t}', { t }) : L('kein Sub', 'not subscribed'));
    return i18n.runFor(guildId, () => memberResult(res, guildId, {
      ok: true,
      title: () => L('Twitch verknüpft', 'Twitch linked'),
      message: () => L('Dein Discord-Konto ist jetzt mit {name} verknüpft. Deine Rollen wurden aktualisiert.', 'Your Discord account is now linked to {name}. Your roles have been updated.', { name: me.name }),
      lines: results.map((r) => `${r.guildName} (${r.channel}): ${r.error ? L('Prüfung fehlgeschlagen', 'check failed') : tierText(r.tier)}`),
    }));
  } catch (err) {
    logger.warn('[twitchsubs] OAuth-Callback:', err.message);
    return next(err);
  }
});

module.exports = router;
