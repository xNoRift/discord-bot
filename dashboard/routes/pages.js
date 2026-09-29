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
    label: 'Allgemein',
    items: [
      { key: 'overview', label: 'Übersicht', icon: 'home', path: '' },
      { key: 'settings', label: 'Einstellungen', icon: 'settings', path: '/settings' },
      { key: 'commands', label: 'Befehle', icon: 'terminal', path: '/commands' },
      { key: 'logs', label: 'Logs', icon: 'file', path: '/logs' },
    ],
  },
  {
    label: 'Support',
    items: [
      { key: 'tickets', label: 'Tickets', icon: 'ticket', path: '/tickets' },
      { key: 'applications', label: 'Bewerbungen', icon: 'clipboard', path: '/applications' },
      { key: 'voicesupport', label: 'Voice Support', icon: 'chat', path: '/voicesupport' },
      { key: 'tempvoice', label: 'Private Kanäle', icon: 'hash', path: '/tempvoice' },
    ],
  },
  {
    label: 'Community',
    items: [
      { key: 'welcome', label: 'Willkommen', icon: 'bell', path: '/welcome' },
      { key: 'rules', label: 'Regeln', icon: 'scale', path: '/rules' },
      { key: 'suggestions', label: 'Vorschläge', icon: 'bulb', path: '/suggestions' },
      { key: 'levels', label: 'Level', icon: 'star', path: '/levels' },
      { key: 'clubs', label: 'Clubs', icon: 'users', path: '/clubs' },
      { key: 'music', label: 'Musik', icon: 'music', path: '/music' },
      { key: 'games', label: 'Spiele', icon: 'sparkles', path: '/games' },
    ],
  },
  {
    label: 'Moderation',
    items: [
      { key: 'moderation', label: 'Moderation', icon: 'shield', path: '/moderation' },
      { key: 'protection', label: 'Guild Protection', icon: 'lock', path: '/protection' },
      { key: 'members', label: 'Mitglieder', icon: 'users', path: '/members', ownerOnly: true },
      { key: 'structure', label: 'Server-Struktur', icon: 'layers', path: '/structure', ownerOnly: true },
    ],
  },
  {
    label: 'Inhalte',
    items: [
      { key: 'messages', label: 'Nachrichten', icon: 'send', path: '/messages' },
      { key: 'social', label: 'Social-Media', icon: 'bell', path: '/social' },
      { key: 'giveaways', label: 'Giveaways', icon: 'gift', path: '/giveaways' },
      { key: 'statistics', label: 'Statistik-Kanäle', icon: 'chart', path: '/statistics' },
    ],
  },
];

function footerNav() {
  const items = [
    { key: 'impressum', label: 'Impressum', icon: 'scale', path: '/impressum' },
    { key: 'datenschutz', label: 'Datenschutzerklärung', icon: 'lock', path: '/datenschutz' },
    { key: 'support', label: 'Support', icon: 'chat', path: '/support' },
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
  rules: { crumb: 'Regeln', crumbIcon: 'scale' },
  music: { crumb: 'Musik', crumbIcon: 'music' },
  tempvoice: { crumb: 'Private Kanäle', crumbIcon: 'hash' },
  games: { crumb: 'Spiele', crumbIcon: 'sparkles' },
  tickets: { crumb: 'Tickets', crumbIcon: 'ticket' },
  giveaways: { crumb: 'Giveaways', crumbIcon: 'gift' },
  applications: { crumb: 'Bewerbungen', crumbIcon: 'clipboard' },
  moderation: { crumb: 'Moderation', crumbIcon: 'shield' },
  statistics: { crumb: 'Statistik-Kanäle', crumbIcon: 'chart' },
  commands: { crumb: 'Befehle', crumbIcon: 'terminal' },
  settings: { crumb: 'Einstellungen', crumbIcon: 'settings' },
  logs: { crumb: 'Logs', crumbIcon: 'file' },
  suggestions: { crumb: 'Vorschläge', crumbIcon: 'bulb' },
  social: { crumb: 'Social-Media', crumbIcon: 'bell' },
  protection: { crumb: 'Guild Protection', crumbIcon: 'lock' },
  levels: { crumb: 'Level', crumbIcon: 'star' },
  clubs: { crumb: 'Clubs', crumbIcon: 'users' },
  impressum: { crumb: 'Impressum', crumbIcon: 'scale' },
  datenschutz: { crumb: 'Datenschutzerklärung', crumbIcon: 'lock' },
  support: { crumb: 'Support', crumbIcon: 'chat' },
  voicesupport: { crumb: 'Voice Support', crumbIcon: 'chat' },
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
    impressum: config.impressum,
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

router.get('/impressum', (req, res) => {
  res.render('impressum-public', { brandName: config.branding.name, brand: config.branding, impressum: config.impressum });
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
  ['/rules', 'rules'],
  ['/music', 'music'],
  ['/tempvoice', 'tempvoice'],
  ['/games', 'games'],
  ['/tickets', 'tickets'],
  ['/giveaways', 'giveaways'],
  ['/applications', 'applications'],
  ['/moderation', 'moderation'],
  ['/statistics', 'statistics'],
  ['/commands', 'commands'],
  ['/settings', 'settings'],
  ['/logs', 'logs'],
  ['/suggestions', 'suggestions'],
  ['/social', 'social'],
  ['/protection', 'protection'],
  ['/levels', 'levels'],
  ['/clubs', 'clubs'],
  ['/impressum', 'impressum'],
  ['/datenschutz', 'datenschutz'],
  ['/support', 'support'],
  ['/voicesupport', 'voicesupport'],
];

// Zusammengelegte Seiten: alte Links leiten weiter
g.get('/news', (req, res) => res.redirect(301, `/dashboard/${req.params.guildId}/messages`));
g.get('/team', (req, res) => res.redirect(301, `/dashboard/${req.params.guildId}`));
g.get('/twitchsubs', (req, res) => res.redirect(301, `/dashboard/${req.params.guildId}/social?tab=subs`));

for (const [path, view] of PAGES) {
  g.get(path, (req, res) => res.render(view, pageLocals(req, view)));
}

// Gespeicherter Verlauf eines Tickets
g.get('/tickets/:ticketId/transcript', (req, res) => {
  const ticketId = parseInt(req.params.ticketId, 10);
  res.render('transcript', pageLocals(req, 'tickets', { ticketId: Number.isFinite(ticketId) ? ticketId : 0 }));
});

// Owner-only Seiten
g.get('/members', requireOwner, (req, res) => res.render('members', pageLocals(req, 'members')));
g.get('/structure', requireOwner, (req, res) => res.render('structure', pageLocals(req, 'structure')));

router.use('/dashboard/:guildId', g);

module.exports = router;
