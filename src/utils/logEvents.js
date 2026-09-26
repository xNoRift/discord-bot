'use strict';

/**
 * Verzeichnis aller Log-Ereignisse. Auf der Dashboard-Seite „Logs“ kann pro Server
 * jedes Ereignis an/aus geschaltet und auf einen eigenen Kanal gelegt werden.
 *
 * Kanal-Reihenfolge beim Senden: Ereignis-Kanal > spezieller Kanal des Aufrufers (z. B. Log-Kanal
 * eines Ticket-Panels) > Kanal der Gruppe > allgemeiner Log-Kanal.
 *
 * settingsField: Gruppen-Kanal liegt (historisch) in guild_settings; sonst in module_settings "logs" (g_<gruppe>).
 */
const GROUPS = [
  {
    key: 'tickets',
    label: 'Tickets',
    emoji: '🎫',
    color: 0x5865f2,
    settingsField: 'ticket_log_channel_id',
    note: 'Ein Ticket-Panel kann unter Tickets → Panel → Logs einen eigenen Kanal haben, ModMail unter Einstellungen. Ein hier gewählter Ereignis-Kanal hat Vorrang. Transkripte gehen in den Kanal der Gruppe bzw. des Panels.',
    events: [
      ['ticket_create', 'Ticket erstellt'],
      ['modmail_create', 'ModMail-Ticket erstellt (DM an den Bot)'],
      ['ticket_claim', 'Ticket übernommen'],
      ['ticket_unclaim', 'Ticket freigegeben'],
      ['ticket_close_request', 'Schließ-Anfrage gesendet'],
      ['ticket_close', 'Ticket geschlossen'],
      ['ticket_reopen', 'Ticket wieder geöffnet'],
      ['ticket_delete', 'Ticket gelöscht'],
      ['ticket_rename', 'Ticket umbenannt'],
      ['ticket_user_add', 'Nutzer zum Ticket hinzugefügt'],
      ['ticket_user_remove', 'Nutzer aus Ticket entfernt'],
    ],
  },
  {
    key: 'applications',
    label: 'Bewerbungen',
    emoji: '📋',
    color: 0xf0b232,
    settingsField: 'application_log_channel_id',
    events: [
      ['application_create', 'Bewerbung eingereicht'],
      ['application_accept', 'Bewerbung angenommen'],
      ['application_reject', 'Bewerbung abgelehnt'],
      ['application_chat', 'Bewerber-Chat geöffnet'],
    ],
  },
  {
    key: 'giveaways',
    label: 'Giveaways',
    emoji: '🎉',
    color: 0xeb459e,
    settingsField: 'giveaway_log_channel_id',
    events: [
      ['giveaway_create', 'Giveaway erstellt'],
      ['giveaway_end', 'Giveaway beendet'],
      ['giveaway_winners', 'Gewinner ausgelost'],
      ['giveaway_reroll', 'Neu ausgelost'],
      ['giveaway_cancel', 'Giveaway abgebrochen'],
      ['giveaway_role_granted', 'Gewinnerrolle vergeben'],
      ['giveaway_role_removed', 'Gewinnerrolle entfernt'],
      ['giveaway_role_failed', 'Gewinnerrolle fehlgeschlagen'],
    ],
  },
  {
    key: 'moderation',
    label: 'Moderation',
    emoji: '🛡️',
    color: 0xf0616d,
    settingsField: 'mod_log_channel_id',
    events: [
      ['mod_warn', 'Verwarnung'],
      ['mod_timeout', 'Timeout'],
      ['mod_untimeout', 'Timeout aufgehoben'],
      ['mod_kick', 'Kick'],
      ['mod_ban', 'Bann'],
      ['mod_unban', 'Entbannung'],
      ['mod_purge', 'Nachrichten gelöscht (Purge)'],
    ],
  },
  {
    key: 'protection',
    label: 'Guild Protection',
    emoji: '🔒',
    color: 0xf0616d,
    settingsField: null,
    events: [['protection', 'Schutz hat eingegriffen (Raid, Spam, Links, junges Konto)']],
  },
  {
    key: 'members',
    label: 'Mitglieder',
    emoji: '👥',
    color: 0x35c98b,
    settingsField: null,
    events: [['autorole', 'Auto-Rolle vergeben']],
  },
  {
    key: 'suggestions',
    label: 'Vorschläge',
    emoji: '💡',
    color: 0xf0b232,
    settingsField: null,
    events: [['suggestion', 'Neuer Vorschlag']],
  },
];

/** Englische Namen für die Kopfzeile der Discord-Log-Nachrichten (Dashboard bleibt deutsch). */
const EN_GROUPS = {
  tickets: 'Tickets', applications: 'Applications', giveaways: 'Giveaways', moderation: 'Moderation',
  protection: 'Guild Protection', members: 'Members', suggestions: 'Suggestions',
};
const EN_EVENTS = {
  ticket_create: 'Ticket created', modmail_create: 'ModMail ticket created', ticket_claim: 'Ticket claimed',
  ticket_unclaim: 'Ticket unclaimed', ticket_close_request: 'Close request sent', ticket_close: 'Ticket closed',
  ticket_reopen: 'Ticket reopened', ticket_delete: 'Ticket deleted', ticket_rename: 'Ticket renamed',
  ticket_user_add: 'User added to ticket', ticket_user_remove: 'User removed from ticket',
  application_create: 'Application submitted', application_accept: 'Application accepted',
  application_reject: 'Application rejected', application_chat: 'Applicant chat opened',
  giveaway_create: 'Giveaway created', giveaway_end: 'Giveaway ended', giveaway_winners: 'Winners drawn',
  giveaway_reroll: 'Rerolled', giveaway_cancel: 'Giveaway cancelled', giveaway_role_granted: 'Winner role given',
  giveaway_role_removed: 'Winner role removed', giveaway_role_failed: 'Winner role failed',
  mod_warn: 'Warning', mod_timeout: 'Timeout', mod_untimeout: 'Timeout removed', mod_kick: 'Kick', mod_ban: 'Ban',
  mod_unban: 'Unban', mod_purge: 'Messages deleted (purge)',
  protection: 'Protection stepped in', autorole: 'Auto role given', suggestion: 'New suggestion',
};

/** Name einer Gruppe bzw. eines Ereignisses in der aktuellen Sprache. */
function groupName(group) {
  const { currentLang } = require('./i18n');
  return currentLang() === 'en' ? EN_GROUPS[group.key] || group.label : group.label;
}
function eventName(type) {
  const { currentLang } = require('./i18n');
  const de = EVENTS.get(type)?.label;
  return currentLang() === 'en' ? EN_EVENTS[type] || de : de;
}

/** Ereignis-Typ -> { group, label } */
const EVENTS = new Map();
for (const g of GROUPS) for (const [type, label] of g.events) EVENTS.set(type, { group: g, label });

/** Alte Kategorien der Aufrufer -> Gruppe (für Ereignisse, die (noch) nicht im Verzeichnis stehen) */
const CATEGORY_GROUP = { ticket: 'tickets', giveaway: 'giveaways', application: 'applications', moderation: 'moderation' };

function groupOf(type, category) {
  return EVENTS.get(type)?.group || GROUPS.find((g) => g.key === CATEGORY_GROUP[category]) || null;
}

/** Schema-Felder für module_settings "logs". */
function schema() {
  const out = {};
  for (const g of GROUPS) {
    if (!g.settingsField) out[`g_${g.key}`] = ['', 'text:32'];
    for (const [type] of g.events) {
      out[`e_${type}`] = [true, 'bool'];
      out[`c_${type}`] = ['', 'text:32'];
    }
  }
  return out;
}

module.exports = { GROUPS, EVENTS, groupOf, schema, groupName, eventName };
