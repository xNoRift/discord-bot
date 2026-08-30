'use strict';

const express = require('express');
const { requireAuth, loadGuild } = require('../middleware/auth');
const config = require('../../config/config');
const ticketsModel = require('../../src/database/models/tickets');
const giveawaysModel = require('../../src/database/models/giveaways');
const appModel = require('../../src/database/models/applications');

const router = express.Router();

const NAV = [
  { items: [{ key: 'overview', label: 'Übersicht', icon: 'home', path: '' }] },
  {
    label: 'Serververwaltung',
    items: [
      { key: 'messages', label: 'Nachrichten', icon: 'send', path: '/messages' },
      { key: 'tickets', label: 'Tickets', icon: 'ticket', path: '/tickets' },
      { key: 'giveaways', label: 'Giveaways', icon: 'gift', path: '/giveaways' },
      { key: 'applications', label: 'Bewerbungen', icon: 'clipboard', path: '/applications' },
      { key: 'moderation', label: 'Moderation', icon: 'shield', path: '/moderation' },
      { key: 'statistics', label: 'Server Statistiken', icon: 'chart', path: '/statistics' },
      { key: 'team', label: 'Teamverwaltung', icon: 'users', path: '/team' },
    ],
  },
  {
    label: 'Weitere Funktionen',
    items: [
      { key: 'welcome', label: 'Willkommen', icon: 'bell', path: '/welcome' },
      { key: 'settings', label: 'Einstellungen', icon: 'settings', path: '/settings' },
      { key: 'logs', label: 'Logs', icon: 'file', path: '/logs' },
      { key: 'suggestions', label: 'Vorschläge', icon: 'bulb', path: '/suggestions' },
    ],
  },
];

const FOOTER_NAV = [
  { key: 'impressum', label: 'Impressum', icon: 'scale', path: '/impressum' },
  { key: 'datenschutz', label: 'Datenschutz', icon: 'lock', path: '/datenschutz' },
  { key: 'support', label: 'Support', icon: 'chat', path: '/support' },
];

const CRUMB = {
  overview: { crumb: 'Übersicht', crumbIcon: 'home' },
  messages: { crumb: 'Nachrichten', crumbIcon: 'send' },
  welcome: { crumb: 'Willkommen', crumbIcon: 'bell' },
  tickets: { crumb: 'Tickets', crumbIcon: 'ticket' },
  giveaways: { crumb: 'Giveaways', crumbIcon: 'gift' },
  applications: { crumb: 'Bewerbungen', crumbIcon: 'clipboard' },
  moderation: { crumb: 'Moderation', crumbIcon: 'shield' },
  statistics: { crumb: 'Server Statistiken', crumbIcon: 'chart' },
  team: { crumb: 'Teamverwaltung', crumbIcon: 'users' },
  settings: { crumb: 'Einstellungen', crumbIcon: 'settings' },
  logs: { crumb: 'Logs', crumbIcon: 'file' },
  suggestions: { crumb: 'Vorschläge', crumbIcon: 'bulb' },
  impressum: { crumb: 'Impressum', crumbIcon: 'scale' },
  datenschutz: { crumb: 'Datenschutz', crumbIcon: 'lock' },
  support: { crumb: 'Support', crumbIcon: 'chat' },
  servers: { crumb: 'Server auswählen', crumbIcon: 'server' },
};

function pageLocals(req, active, extra = {}) {
  const locals = {
    user: req.session.user,
    dashboardUrl: config.dashboard.url,
    brandName: config.branding.name,
    nav: NAV,
    footerNav: FOOTER_NAV,
    active,
    guild: req.guild ? { id: req.guild.id, name: req.guild.name, icon: req.guild.icon } : null,
    navBadges: {},
    ...(CRUMB[active] || {}),
    ...extra,
  };

  if (req.guild) {
    try {
      locals.navBadges = {
        tickets: ticketsModel.stats(req.guild.id).open || 0,
        giveaways: giveawaysModel.stats(req.guild.id).active || 0,
        applications: appModel.stats(req.guild.id).pending || 0,
      };
    } catch {
      /* ignore */
    }
  }
  return locals;
}

/* ---------------- Öffentlich ---------------- */

router.get('/', (req, res) => {
  if (req.session?.user) return res.redirect('/servers');
  res.render('landing', { brandName: config.branding.name, brand: config.branding, dashboardUrl: config.dashboard.url });
});

router.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/servers');
  res.render('login', { brandName: config.branding.name, brand: config.branding });
});

/* ---------------- Geschützt ---------------- */

router.get('/servers', requireAuth, (req, res) => {
  res.render('servers', pageLocals(req, 'servers', { clientId: config.discord.clientId }));
});

const g = express.Router({ mergeParams: true });
g.use(requireAuth, loadGuild);

const PAGES = [
  ['/', 'overview'],
  ['/messages', 'messages'],
  ['/welcome', 'welcome'],
  ['/tickets', 'tickets'],
  ['/giveaways', 'giveaways'],
  ['/applications', 'applications'],
  ['/moderation', 'moderation'],
  ['/statistics', 'statistics'],
  ['/team', 'team'],
  ['/settings', 'settings'],
  ['/logs', 'logs'],
  ['/suggestions', 'suggestions'],
  ['/impressum', 'impressum'],
  ['/datenschutz', 'datenschutz'],
  ['/support', 'support'],
];

for (const [path, view] of PAGES) {
  g.get(path, (req, res) => res.render(view, pageLocals(req, view)));
}

router.use('/dashboard/:guildId', g);

module.exports = router;
