'use strict';

const { GuildVerificationLevel } = require('discord.js');
const antiRaidModel = require('../database/models/antiRaidSettings');
const moderationService = require('./moderationService');
const logService = require('./logService');
const client = require('../core/client');
const logger = require('../utils/logger');
const config = require('../../config/config');

/**
 * Anti-Raid: erkennt Join-Spikes (zu viele Beitritte in kurzer Zeit) und
 * optional zu junge Accounts. Reagiert mit Alarm+Log (immer) und optional
 * Kick/Ban (moderationService, keine eigene Aktions-Logik) sowie einem
 * temporären "Lockdown" (angehobene Verifizierungsstufe).
 *
 * Join-Tracking und Lockdown-Status liegen bewusst nur im Arbeitsspeicher
 * (wie automodService) – ein Neustart mitten in einem Raid ist ein sehr
 * seltener Grenzfall, der schlimmstenfalls einmal neu anlaufen muss.
 */

const RAID_RENOTIFY_MS = 5 * 60 * 1000; // höchstens alle 5 Minuten erneut den Besitzer benachrichtigen

/** guildId -> Liste von Beitritts-Zeitstempeln im aktuellen Fenster. */
const joinWindows = new Map();
/** guildId -> { since, notifiedAt } – für Renotify-Throttling. */
const raidState = new Map();
/** guildId -> { previousLevel, revertAt } – für den automatischen Lockdown-Revert. */
const lockdowns = new Map();

function safeIds(json) {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function isExempt(member, settings) {
  if (safeIds(settings.exempt_user_ids).includes(member.id)) return true;
  const roles = safeIds(settings.exempt_role_ids);
  return roles.some((rid) => member.roles.cache.has(rid));
}

async function notifyOwner(guild, text) {
  try {
    const owner = await guild.fetchOwner();
    await owner.send(text).catch(() => null);
  } catch {
    /* Owner nicht ladbar – ignorieren */
  }
}

async function applyLockdown(guild, settings) {
  if (lockdowns.has(guild.id)) return; // schon aktiv
  try {
    const previousLevel = guild.verificationLevel;
    await guild.setVerificationLevel(GuildVerificationLevel.VeryHigh, 'Anti-Raid: automatischer Join-Schutz');
    lockdowns.set(guild.id, { previousLevel, revertAt: Date.now() + settings.lockdown_minutes * 60_000 });
    logger.info(`[antiRaid] Lockdown aktiviert für Guild ${guild.id}`);
  } catch (err) {
    logger.warn(`[antiRaid] Lockdown fehlgeschlagen: ${err.message}`);
  }
}

async function revertLockdown(guild, entry) {
  try {
    await guild.setVerificationLevel(entry.previousLevel, 'Anti-Raid: Lockdown aufgehoben');
  } catch (err) {
    logger.warn(`[antiRaid] Lockdown-Revert fehlgeschlagen: ${err.message}`);
  } finally {
    lockdowns.delete(guild.id);
  }
}

/** Hebt einen aktiven Lockdown sofort auf (z. B. per Dashboard-Button). */
async function liftLockdown(guildId) {
  const entry = lockdowns.get(guildId);
  if (!entry) return false;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    lockdowns.delete(guildId);
    return false;
  }
  await revertLockdown(guild, entry);
  return true;
}

/** Läuft im 60s-Sweep: hebt abgelaufene Lockdowns automatisch auf. */
async function sweep() {
  const now = Date.now();
  for (const [guildId, entry] of lockdowns) {
    if (now < entry.revertAt) continue;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      lockdowns.delete(guildId);
      continue;
    }
    await revertLockdown(guild, entry);
  }
}

/**
 * Aufgerufen von guildMemberAdd.
 * @returns {Promise<boolean>} true, wenn das Mitglied gekickt/gebannt wurde
 *   (Aufrufer sollte dann Auto-Rolle/Willkommensnachricht überspringen).
 */
async function handleJoin(member) {
  const guild = member.guild;
  const settings = antiRaidModel.get(guild.id);
  if (!settings.enabled) return false;
  if (isExempt(member, settings)) return false;

  const accountAgeHours = (Date.now() - member.user.createdTimestamp) / 3_600_000;
  const tooYoung = settings.min_account_age_hours > 0 && accountAgeHours < settings.min_account_age_hours;

  const now = Date.now();
  const windowMs = settings.window_seconds * 1000;
  const arr = (joinWindows.get(guild.id) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  joinWindows.set(guild.id, arr);
  const spike = arr.length > settings.max_joins;

  if (!spike && !tooYoung) return false;

  const reason = spike
    ? `Join-Spike erkannt (${arr.length} Beitritte in ${settings.window_seconds}s)`
    : `Account zu jung (${accountAgeHours.toFixed(1)}h < ${settings.min_account_age_hours}h)`;

  const last = raidState.get(guild.id);
  const shouldNotify = spike && (!last || now - last.notifiedAt > RAID_RENOTIFY_MS);
  if (spike) raidState.set(guild.id, { since: last?.since ?? now, notifiedAt: shouldNotify ? now : last?.notifiedAt ?? now });

  await logService
    .log({
      guildId: guild.id,
      category: 'security',
      type: spike ? 'antiraid_spike' : 'antiraid_young_account',
      title: '🚨 Anti-Raid Alarm',
      description: reason,
      color: config.branding.danger,
      fields: [{ name: 'Nutzer', value: `<@${member.id}> (${member.id})`, inline: true }],
      targetId: member.id,
    })
    .catch(() => null);

  if (settings.notify_owner && shouldNotify) {
    await notifyOwner(guild, `🚨 **Anti-Raid Alarm** auf **${guild.name}**\n${reason}`);
  }

  if (spike && settings.lockdown) {
    await applyLockdown(guild, settings);
  }

  if (settings.action === 'log') return false;

  try {
    await moderationService.act(guild, {
      action: settings.action, // 'kick' | 'ban'
      userId: member.id,
      reason: `Anti-Raid: ${reason}`,
      actorTag: 'Anti-Raid',
    });
    return true;
  } catch (err) {
    logger.warn(`[antiRaid] Aktion „${settings.action}" fehlgeschlagen: ${err.message}`);
    return false;
  }
}

/** Live-Status fürs Dashboard: aktuelle Join-Zahl im Fenster + Lockdown-Info. */
function status(guildId) {
  const settings = antiRaidModel.get(guildId);
  const windowMs = settings.window_seconds * 1000;
  const now = Date.now();
  const recentJoins = (joinWindows.get(guildId) || []).filter((t) => now - t < windowMs).length;
  const lockdown = lockdowns.get(guildId);
  return {
    recentJoins,
    raidActive: recentJoins > settings.max_joins,
    lockdownActive: Boolean(lockdown),
    lockdownRevertAt: lockdown?.revertAt ?? null,
  };
}

module.exports = { handleJoin, liftLockdown, sweep, status };
