'use strict';

const express = require('express');
const { requireAuth, loadGuild } = require('../middleware/auth');
const config = require('../../config/config');
const ticketsModel = require('../../src/database/models/tickets');
const giveawaysModel = require('../../src/database/models/giveaways');
const appModel = require('../../src/database/models/applications');

const router = express.Router();

// `label` / `sectionLabel` sind i18n-Schlüssel (siehe dashboard/locales/*.json),
// die im App-Shell-Partial über t() übersetzt werden.
const NAV = [
  { items: [{ key: 'overview', label: 'nav.overview', icon: 'home', path: '' }] },
  {
    sectionLabel: 'nav.sections.community',
    items: [
      { key: 'welcome', label: 'nav.welcome', icon: 'bell', path: '/welcome' },
      { key: 'music', label: 'nav.music', icon: 'sparkles', path: '/music' },
      { key: 'tempvoice', label: 'nav.tempvoice', icon: 'hash', path: '/tempvoice' },
      { key: 'games', label: 'nav.games', icon: 'sparkles', path: '/games' },
      { key: 'giveaways', label: 'nav.giveaways', icon: 'gift', path: '/giveaways' },
      { key: 'suggestions', label: 'nav.suggestions', icon: 'bulb', path: '/suggestions' },
      { key: 'social', label: 'nav.social', icon: 'bell', path: '/social' },
    ],
  },
  {
    sectionLabel: 'nav.sections.support_team',
    items: [
      { key: 'tickets', label: 'nav.tickets', icon: 'ticket', path: '/tickets' },
      { key: 'applications', label: 'nav.applications', icon: 'clipboard', path: '/applications' },
      { key: 'team', label: 'nav.team', icon: 'users', path: '/team' },
    ],
  },
  {
    sectionLabel: 'nav.sections.moderation',
    items: [
      { key: 'moderation', label: 'nav.moderation', icon: 'shield', path: '/moderation' },
      { key: 'logs', label: 'nav.logs', icon: 'file', path: '/logs' },
    ],
  },
  {
    sectionLabel: 'nav.sections.server',
    items: [
      { key: 'messages', label: 'nav.messages', icon: 'send', path: '/messages' },
      { key: 'statistics', label: 'nav.statistics', icon: 'chart', path: '/statistics' },
      { key: 'settings', label: 'nav.settings', icon: 'settings', path: '/settings' },
    ],
  },
];

const FOOTER_NAV = [
  { key: 'impressum', label: 'nav.impressum', icon: 'scale', path: '/impressum' },
  { key: 'datenschutz', label: 'nav.datenschutz', icon: 'lock', path: '/datenschutz' },
  { key: 'support', label: 'nav.support', icon: 'chat', path: '/support' },
];

// `crumb` ist ein i18n-Schlüssel, im App-Shell-Partial über t() übersetzt.
const CRUMB = {
  overview: { crumb: 'nav.overview', crumbIcon: 'home' },
  messages: { crumb: 'nav.messages', crumbIcon: 'send' },
  welcome: { crumb: 'nav.welcome', crumbIcon: 'bell' },
  music: { crumb: 'nav.music', crumbIcon: 'music' },
  tempvoice: { crumb: 'nav.tempvoice', crumbIcon: 'hash' },
  games: { crumb: 'nav.games', crumbIcon: 'sparkles' },
  tickets: { crumb: 'nav.tickets', crumbIcon: 'ticket' },
  giveaways: { crumb: 'nav.giveaways', crumbIcon: 'gift' },
  applications: { crumb: 'nav.applications', crumbIcon: 'clipboard' },
  moderation: { crumb: 'nav.moderation', crumbIcon: 'shield' },
  statistics: { crumb: 'nav.statistics', crumbIcon: 'chart' },
  team: { crumb: 'nav.team', crumbIcon: 'users' },
  settings: { crumb: 'nav.settings', crumbIcon: 'settings' },
  logs: { crumb: 'nav.logs', crumbIcon: 'file' },
  suggestions: { crumb: 'nav.suggestions', crumbIcon: 'bulb' },
  social: { crumb: 'nav.social', crumbIcon: 'bell' },
  impressum: { crumb: 'nav.impressum', crumbIcon: 'scale' },
  datenschutz: { crumb: 'nav.datenschutz', crumbIcon: 'lock' },
  support: { crumb: 'nav.support', crumbIcon: 'chat' },
  servers: { crumb: 'nav.servers', crumbIcon: 'server' },
};

function pageLocals(req, active, extra = {}) {
  const locals = {
    user: req.session.user,
    isOwner: config.isOwner(req.session.user?.id),
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
  res.render('servers', pageLocals(req, 'servers', {
    clientId: config.discord.clientId,
    invitePermissions: config.discord.invitePermissions,
  }));
});

const g = express.Router({ mergeParams: true });
g.use(requireAuth, loadGuild);

const PAGES = [
  ['/', 'overview'],
  ['/messages', 'messages'],
  ['/welcome', 'welcome'],
  ['/music', 'music'],
  ['/tempvoice', 'tempvoice'],
  ['/games', 'games'],
  ['/tickets', 'tickets'],
  ['/giveaways', 'giveaways'],
  ['/applications', 'applications'],
  ['/moderation', 'moderation'],
  ['/statistics', 'statistics'],
  ['/team', 'team'],
  ['/settings', 'settings'],
  ['/logs', 'logs'],
  ['/suggestions', 'suggestions'],
  ['/social', 'social'],
  ['/impressum', 'impressum'],
  ['/datenschutz', 'datenschutz'],
  ['/support', 'support'],
];

for (const [path, view] of PAGES) {
  g.get(path, (req, res) => res.render(view, pageLocals(req, view)));
}

router.use('/dashboard/:guildId', g);

module.exports = router;
