'use strict';

const crypto = require('node:crypto');
const express = require('express');
const oauth = require('../services/discordOAuth');
const dashboardUsers = require('../../src/database/models/dashboardUsers');
const loginAudit = require('../../src/database/models/loginAudit');
const guildAccess = require('../services/guildAccess');
const { authLimiter } = require('../middleware/rateLimit');
const config = require('../../config/config');
const logger = require('../../src/utils/logger');

const router = express.Router();

/** Startet den OAuth2-Flow. */
router.get('/discord', authLimiter, (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  res.redirect(oauth.buildAuthorizeUrl(state));
});

/** OAuth2 Callback. */
router.get('/discord/callback', authLimiter, async (req, res, next) => {
  try {
    const { code, state, error, error_description } = req.query;
    if (error) {
      return res.status(400).render('error', {
        title: 'Login abgebrochen',
        message: error_description || String(error),
      });
    }
    if (!code || !state || state !== req.session.oauthState) {
      return res.status(400).render('error', {
        title: 'Ungültiger Login',
        message: 'Der Login-Vorgang ist ungültig oder abgelaufen. Bitte erneut versuchen.',
      });
    }
    delete req.session.oauthState;

    const token = await oauth.exchangeCode(code);
    const me = await oauth.fetchCurrentUser(token.access_token);

    const ip = req.ip || req.socket?.remoteAddress || '?';
    const ua = req.get('user-agent') || '';

    // Owner-Only-Modus: nur Bot-Besitzer dürfen rein.
    if (config.dashboard.ownerOnly && !config.isOwner(me.id)) {
      loginAudit.record({ userId: me.id, username: me.username, ip, userAgent: ua, ok: false });
      logger.warn(`[auth] ABGELEHNT (owner-only): ${me.username} (${me.id}) von ${ip}`);
      return res.status(403).render('error', {
        title: 'Kein Zugriff',
        message: 'Dieses Dashboard ist auf den Bot-Besitzer beschränkt.',
      });
    }

    dashboardUsers.upsert({
      userId: me.id,
      username: me.username,
      globalName: me.global_name,
      avatar: me.avatar,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresInSec: token.expires_in,
    });

    // Guild-Liste direkt cachen
    try {
      const guilds = await oauth.fetchUserGuilds(token.access_token);
      dashboardUsers.saveGuildCache(me.id, guilds);
    } catch (err) {
      logger.warn(`[auth] Guilds beim Login nicht ladbar: ${err.message}`);
    }

    loginAudit.record({ userId: me.id, username: me.username, ip, userAgent: ua, ok: true });
    logger.info(`[auth] Login: ${me.username} (${me.id}) von ${ip}`);

    req.session.regenerate((regenErr) => {
      if (regenErr) return next(regenErr);
      req.session.user = {
        id: me.id,
        username: me.username,
        globalName: me.global_name,
        avatar: me.avatar,
        isOwner: config.isOwner(me.id),
      };
      const returnTo = req.session.returnTo || '/servers';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  } catch (err) {
    next(err);
  }
});

/** Logout. */
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('dbv1.sid');
    res.redirect('/');
  });
});

module.exports = router;
