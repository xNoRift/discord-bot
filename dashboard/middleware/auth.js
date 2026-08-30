'use strict';

const crypto = require('node:crypto');
const client = require('../../src/core/client');
const guildAccess = require('../services/guildAccess');
const settingsModel = require('../../src/database/models/settings');

/**
 * Auth- und Sicherheits-Middleware fuer das Dashboard.
 */

function isApiRequest(req) {
  return req.originalUrl.startsWith('/api/') || (req.baseUrl && req.baseUrl.startsWith('/api'));
}

/** Nutzer muss eingeloggt sein. */
function requireAuth(req, res, next) {
  if (req.session?.user?.id) return next();
  if (isApiRequest(req)) return res.status(401).json({ error: 'Nicht angemeldet.' });
  req.session.returnTo = req.originalUrl;
  return res.redirect('/login');
}

/** CSRF-Token pro Session erzeugen und in res.locals bereitstellen. */
function csrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

/** CSRF-Pruefung fuer veraendernde Requests. */
function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = req.get('x-csrf-token') || req.body?._csrf;
  if (sent && sent === req.session.csrfToken) return next();
  return res.status(403).json({ error: 'Ungültiges oder fehlendes CSRF-Token. Seite neu laden.' });
}

/**
 * Prueft, ob der eingeloggte Nutzer die Guild aus req.params.guildId verwalten darf.
 * Legt req.guild (discord.js Guild) und req.settings ab.
 */
async function loadGuild(req, res, next) {
  const guildId = req.params.guildId;
  if (!guildId || !/^\d{5,25}$/.test(guildId)) {
    return res.status(400).json(isApiRequest(req) ? { error: 'Ungültige Guild-ID.' } : { error: 'bad id' });
  }

  try {
    const allowed = await guildAccess.userCanManageGuild(req.session.user.id, guildId);
    if (!allowed) {
      if (isApiRequest(req)) return res.status(403).json({ error: 'Kein Zugriff auf diesen Server.' });
      return res.status(403).render('error', { title: 'Kein Zugriff', message: 'Du darfst diesen Server nicht verwalten.' });
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      if (isApiRequest(req)) return res.status(404).json({ error: 'Bot ist nicht auf diesem Server.' });
      return res.status(404).render('error', { title: 'Bot fehlt', message: 'Der Bot ist nicht (mehr) auf diesem Server.' });
    }

    req.guild = guild;
    req.settings = settingsModel.get(guildId);
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAuth, csrfToken, verifyCsrf, loadGuild };
