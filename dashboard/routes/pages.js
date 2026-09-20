'use strict';

const express = require('express');
const { requireAuth, requireOwner, loadGuild } = require('../middleware/auth');
const config = require('../../config/config');
const ticketsModel = require('../../src/database/models/tickets');
const giveawaysModel = require('../../src/database/models/giveaways');
const appModel = require('../../src/database/models/applications');

const router = express.Router();

const NAV = [
  {
    items: [
      { key: 'overview', label: 'Übersicht', icon: 'home', path: '' },
      { key: 'welcome', label: 'Willkommen', icon: 'bell', path: '/welcome' },
      { key: 'support', label: 'Support', icon: 'chat', path: '/support' },
      { key: 'tickets', label: 'Ticket', icon: 'ticket', path: '/tickets' },
      { key: 'moderation', label: 'Moderation', icon: 'shield', path: '/moderation' },
      { key: 'tempvoice', label: 'Private Kanäle', icon: 'hash', path: '/tempvoice' },
      { key: 'statistics', label: 'Server Statistiken', icon: 'chart', path: '/statistics' },
      { key: 'levels', label: 'Beteiligungs-Belohnungen', icon: 'star', path: '/levels' },
      { key: 'team', label: 'Teamverwaltung', icon: 'users', path: '/team' },
      { key: 'news', label: 'Neuigkeiten', icon: 'bell', path: '/news' },
      { key: 'social', label: 'Social-Media', icon: 'send', path: '/social' },
      { key: 'protection', label: 'Guild Protection', icon: 'shield', path: '/protection' },
      { key: 'suggestions', label: 'Vorschläge', icon: 'bulb', path: '/suggestions' },
      { key: 'giveaways', label: 'Giveaways', icon: 'gift', path: '/giveaways' },
      { key: 'applications', label: 'Bewerbungen', icon: 'clipboard', path: '/applications' },
      { key: 'music', label: 'Musik', icon: 'sparkles', path: '/music' },
      { key: 'games', label: 'Spiele', icon: 'sparkles', path: '/games' },
      { key: 'messages', label: 'Nachrichten', icon: 'send', path: '/messages' },
      { key: 'logs', label: 'Logs', icon: 'file', path: '/logs' },
      { key: 'members', label: 'Mitglieder', icon: 'users', path: '/members', ownerOnly: true },
      { key: 'structure', label: 'Server-Struktur', icon: 'layers', path: '/structure', ownerOnly: true },
      { key: 'settings', label: 'Einstellungen', icon: 'settings', path: '/settings' },
    ],
  },
];

function footerNav() {
  const items = [
    { key: 'impressum', label: 'Impressum', icon: 'scale', path: '/impressum' },
    { key: 'datenschutz', label: 'Datenschutzerklärung', icon: 'lock', path: '/datenschutz' },
  ];
  if (config.links.supportDiscord) items.push({ key: 'support-discord', label: 'Support-Discord', icon: 'chat', href: config.links.supportDiscord });
  items.push({ key: 'docs', label: 'Dokumentation', icon: 'file', href: config.links.docs || config.dashboard.url + '/#funktionen' });
  return items;
}

const CRUMB = {
  overview: { crumb: 'Übersicht', crumbIcon: 'home' },
  messages: { crumb: 'Nachrichten', crumbIcon: 'send' },
  members: { crumb: 'Mitglieder', crumbIcon: 'users' },
  structure: { crumb: 'Server-Struktur', crumbIcon: 'layers' },
  welcome: { crumb: 'Willkommen', crumbIcon: 'bell' },
  music: { crumb: 'Musik', crumbIcon: 'music' },
  tempvoice: { crumb: 'Private Kanäle', crumbIcon: 'hash' },
  games: { crumb: 'Spiele', crumbIcon: 'sparkles' },
  tickets: { crumb: 'Ticket', crumbIcon: 'ticket' },
  giveaways: { crumb: 'Giveaways', crumbIcon: 'gift' },
  applications: { crumb: 'Bewerbungen', crumbIcon: 'clipboard' },
  moderation: { crumb: 'Moderation', crumbIcon: 'shield' },
  statistics: { crumb: 'Server Statistiken', crumbIcon: 'chart' },
  team: { crumb: 'Teamverwaltung', crumbIcon: 'users' },
  settings: { crumb: 'Einstellungen', crumbIcon: 'settings' },
  logs: { crumb: 'Logs', crumbIcon: 'file' },
  suggestions: { crumb: 'Vorschläge', crumbIcon: 'bulb' },
  social: { crumb: 'Social-Media', crumbIcon: 'send' },
  protection: { crumb: 'Guild Protection', crumbIcon: 'shield' },
  levels: { crumb: 'Beteiligungs-Belohnungen', crumbIcon: 'star' },
  news: { crumb: 'Neuigkeiten', crumbIcon: 'bell' },
  impressum: { crumb: 'Impressum', crumbIcon: 'scale' },
  datenschutz: { crumb: 'Datenschutzerklärung', crumbIcon: 'lock' },
  support: { crumb: 'Support', crumbIcon: 'chat' },
  servers: { crumb: 'Server auswählen', crumbIcon: 'server' },
};

function pageLocals(req, active, extra = {}) {
  const locals = {
    user: req.session.user,
    isOwner: config.isOwner(req.session.user?.id),
    dashboardUrl: config.dashboard.url,
    brandName: config.branding.name,
    nav: NAV,
    footerNav: footerNav(),
    links: config.links,
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
  const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${config.discord.clientId}&scope=bot+applications.commands&permissions=${config.discord.invitePermissions}`;
  res.render('landing', { brandName: config.branding.name, brand: config.branding, dashboardUrl: config.dashboard.url, inviteUrl });
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
  ['/protection', 'protection'],
  ['/levels', 'levels'],
  ['/news', 'news'],
  ['/impressum', 'impressum'],
  ['/datenschutz', 'datenschutz'],
  ['/support', 'support'],
];

for (const [path, view] of PAGES) {
  g.get(path, (req, res) => res.render(view, pageLocals(req, view)));
}

// Owner-only Seiten
g.get('/members', requireOwner, (req, res) => res.render('members', pageLocals(req, 'members')));
g.get('/structure', requireOwner, (req, res) => res.render('structure', pageLocals(req, 'structure')));

router.use('/dashboard/:guildId', g);

module.exports = router;
