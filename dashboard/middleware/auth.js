'use strict';

const crypto = require('node:crypto');
const client = require('../../src/core/client');
const guildAccess = require('../services/guildAccess');
const settingsModel = require('../../src/database/models/settings');
const dashboardRoles = require('../../src/database/models/dashboardRoles');
const { isManager } = require('../../src/utils/permissions');
const config = require('../../config/config');

/**
 * Auth- und Sicherheits-Middleware fuer das Dashboard.
 */

function isApiRequest(req) {
  return req.originalUrl.startsWith('/api/') || (req.baseUrl && req.baseUrl.startsWith('/api'));
}

/** Nutzer muss eingeloggt sein. */
function requireAuth(req, res, next) {
  if (!req.session?.user?.id) {
    if (isApiRequest(req)) return res.status(401).json({ error: 'Nicht angemeldet.' });
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  // Owner-Only-Modus: bestehende Sessions von Nicht-Besitzern sofort beenden.
  if (config.dashboard.ownerOnly && !config.isOwner(req.session.user.id)) {
    return req.session.destroy(() => {
      if (isApiRequest(req)) return res.status(403).json({ error: 'Kein Zugriff.' });
      return res.status(403).render('error', {
        title: 'Kein Zugriff',
        message: 'Dieses Dashboard ist auf den Bot-Besitzer beschränkt.',
      });
    });
  }
  return next();
}

/** Nur Bot-Besitzer (BOT_OWNER_IDS). */
function requireOwner(req, res, next) {
  if (req.session?.user?.id && config.isOwner(req.session.user.id)) return next();
  if (isApiRequest(req)) return res.status(403).json({ error: 'Nur der Bot-Besitzer darf das.' });
  return res.status(403).render('error', {
    title: 'Kein Zugriff',
    message: 'Diese Funktion ist nur für den Bot-Besitzer.',
  });
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
 * Legt req.guild (discord.js Guild), req.settings und req.dashboardScopes ab.
 *
 * req.dashboardScopes ist entweder '*' (Administrator/"Server verwalten"/Bot-Besitzer
 * – voller Zugriff wie bisher) oder ein Set<string> mit den ueber
 * guild_dashboard_roles freigeschalteten Bereichen (z.B. {'moderation'}) fuer ein
 * Mitglied ohne diese Discord-Rechte. Die nachgelagerte enforceDashboardScope-
 * Middleware entscheidet anhand dessen, welche Routen ein Nicht-'*'-Nutzer
 * erreichen darf (default-deny Allowlist).
 */
async function loadGuild(req, res, next) {
  const guildId = req.params.guildId;
  if (!guildId || !/^\d{5,25}$/.test(guildId)) {
    return res.status(400).json(isApiRequest(req) ? { error: 'Ungültige Guild-ID.' } : { error: 'bad id' });
  }

  try {
    const isFullManager = await guildAccess.userCanManageGuild(req.session.user.id, guildId);
    const guild = client.guilds.cache.get(guildId);
    let scopes = null;

    if (isFullManager) {
      scopes = '*';
    } else if (guild) {
      const member =
        guild.members.cache.get(req.session.user.id) ??
        (await guild.members.fetch(req.session.user.id).catch(() => null));
      if (member) {
        const granted = new Set(
          dashboardRoles
            .listForGuild(guildId)
            .filter((r) => member.roles.cache.has(r.role_id))
            .map((r) => r.scope),
        );
        if (granted.size) scopes = granted;
      }
    }

    if (!scopes) {
      if (isApiRequest(req)) return res.status(403).json({ error: 'Kein Zugriff auf diesen Server.' });
      return res.status(403).render('error', { title: 'Kein Zugriff', message: 'Du darfst diesen Server nicht verwalten.' });
    }
    if (!guild) {
      if (isApiRequest(req)) return res.status(404).json({ error: 'Bot ist nicht auf diesem Server.' });
      return res.status(404).render('error', { title: 'Bot fehlt', message: 'Der Bot ist nicht (mehr) auf diesem Server.' });
    }

    req.guild = guild;
    req.settings = settingsModel.get(guildId);
    req.dashboardScopes = scopes;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Default-Deny-Allowlist fuer Nutzer, die NICHT Administrator/"Server
 * verwalten"/Bot-Besitzer sind (req.dashboardScopes ist ein Set, nicht '*').
 * Muss direkt nach loadGuild eingehaengt werden.
 *
 * Absichtlich eine kurze, explizite Liste statt jede der ~60 Guild-Routen
 * einzeln zu pruefen: alles, was hier nicht steht, bleibt fuer reine
 * Rollen-Inhaber ohne Discord-Adminrechte gesperrt. Kann also nur zu wenig
 * statt zu viel freigeben.
 */
const SCOPED_ALLOWLIST = [
  { method: 'GET', path: /^\/settings$/ },
  { method: 'GET', path: /^\/channels$/ },
  { method: 'GET', path: /^\/roles$/ },
  { method: 'GET', path: /^\/activity(\/|$)/ },
  { method: 'GET', path: /^\/dashboard-roles$/ },
  { method: 'GET', path: /^\/moderation\/warnings$/ },
  { method: 'POST', path: /^\/moderation\/action$/ },
  { method: 'POST', path: /^\/moderation\/warnings\/\d+\/remove$/ },
  { method: 'POST', path: /^\/moderation\/purge$/ },
  { method: 'PATCH', path: /^\/moderation\/settings$/ },
  { method: 'GET', path: /^\/automod$/ },
  { method: 'PATCH', path: /^\/automod\/[a-z_]+$/ },
  { method: 'GET', path: /^\/antiraid$/ },
  { method: 'PATCH', path: /^\/antiraid$/ },
  { method: 'POST', path: /^\/antiraid\/lockdown\/lift$/ },
];

function enforceDashboardScope(req, res, next) {
  if (req.dashboardScopes === '*') return next();

  const prefix = `/guilds/${req.params.guildId}`;
  const sub = req.path.startsWith(prefix) ? req.path.slice(prefix.length) || '/' : req.path;
  const ok = SCOPED_ALLOWLIST.some((r) => r.method === req.method && r.path.test(sub));
  if (ok) return next();

  if (isApiRequest(req)) return res.status(403).json({ error: 'Dir fehlt der Zugriff für diesen Bereich.' });
  return res.status(403).render('error', { title: 'Kein Zugriff', message: 'Dir fehlt der Zugriff für diesen Bereich.' });
}

/**
 * Zusätzlich zu loadGuild: verlangt, dass das Mitglied Administrator/
 * "Server verwalten"/Bot-Besitzer ist ODER eine für `scope` freigeschaltete
 * Discord-Rolle hält (guild_dashboard_roles). Muss NACH loadGuild kommen.
 */
function requireScope(scope) {
  return async (req, res, next) => {
    try {
      const member = req.guild.members.cache.get(req.session.user.id) ?? (await req.guild.members.fetch(req.session.user.id).catch(() => null));
      if (member && (isManager(member) || dashboardRoles.memberHasScope(member, req.guild.id, scope))) {
        return next();
      }
      if (isApiRequest(req)) return res.status(403).json({ error: `Dir fehlt der Zugriff für „${scope}".` });
      return res.status(403).render('error', { title: 'Kein Zugriff', message: `Dir fehlt der Zugriff für „${scope}".` });
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requireAuth, requireOwner, requireScope, csrfToken, verifyCsrf, loadGuild, enforceDashboardScope };
