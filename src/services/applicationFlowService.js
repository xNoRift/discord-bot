'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const client = require('../core/client');
const appModel = require('../database/models/applications');
const applicationService = require('./applicationService');
const embeds = require('../utils/embeds');
const config = require('../../config/config');
const logger = require('../utils/logger');

/**
 * Bewerbung per Direktnachricht: Der Bot stellt die Fragen nacheinander in der DM.
 * Der Stand steckt in application_sessions (überlebt einen Neustart), max. eine Sitzung je Nutzer.
 */

const CANCEL_WORDS = ['abbrechen', 'cancel', 'stop'];

function cancelRow(sessionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`app:dmcancel:${sessionId}`).setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
  );
}

function questionEmbed(session, type, questions) {
  const q = questions[session.step];
  const hints = [];
  hints.push(q.required ? 'Pflichtfrage' : 'Optional – schreibe `-` zum Überspringen');
  if (q.style === 'number') {
    hints.push(`Antworte mit einer Zahl${q.min_length > 0 || q.max_length > 0 ? ` (${q.min_length > 0 ? `min. ${q.min_length}` : ''}${q.min_length > 0 && q.max_length > 0 ? ', ' : ''}${q.max_length > 0 ? `max. ${q.max_length}` : ''})` : ''}`);
  } else if (q.style === 'choice') {
    hints.push('Wähle eine Option im Menü (oder schreibe sie)');
  } else if (q.min_length > 0 || q.max_length > 0) {
    hints.push(`${q.min_length > 0 ? `mind. ${q.min_length}` : ''}${q.min_length > 0 && q.max_length > 0 ? ', ' : ''}${q.max_length > 0 ? `max. ${q.max_length}` : ''} Zeichen`);
  }
  const e = new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle(`📋 ${type.name} – Frage ${session.step + 1}/${questions.length}`)
    .setDescription(`**${q.label}**${q.description ? `\n${q.description}` : ''}`)
    .setFooter({ text: hints.join(' • ') });
  return e;
}

async function sendQuestion(user, session, type, questions) {
  const q = questions[session.step];
  const components = [];
  const embed = questionEmbed(session, type, questions);
  if (q.style === 'choice' && q.options.length) {
    // Discord: max. 25 Optionen je Menü, 4 Menüs + Abbrechen-Zeile je Nachricht -> ab 100 Optionen zusätzlich als Text antworten
    for (let start = 0, k = 0; start < q.options.length && k < 4; start += 25, k++) {
      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`app:dmsel:${session.id}:${session.step}:${k}`)
            .setPlaceholder(q.options.length > 25 ? `Wähle eine Option … (${k + 1})` : 'Wähle eine Option …')
            .addOptions(q.options.slice(start, start + 25).map((o, i) => ({ label: o.slice(0, 100), value: String(start + i) }))),
        ),
      );
    }
    if (q.options.length > 100) {
      embed.setDescription(`${embed.data.description}\n\n**Weitere Antworten (schreibe sie einfach):**\n${q.options.slice(100).join(' · ').slice(0, 1500)}`);
    }
  }
  components.push(cancelRow(session.id));
  await user.send({ embeds: [embed], components });
}

/** Startet die DM-Sitzung (nach „Starten“). Wirft bei Problemen eine verständliche Fehlermeldung. */
async function start(user, guild, type) {
  if (appModel.getSessionByUser(user.id)) throw new Error('Du hast bereits eine laufende Bewerbung.');
  const cfg = appModel.typeCfg(type);
  const questions = appModel.listQuestions(type.id);
  const session = appModel.createSession({ guildId: guild.id, typeId: type.id, userId: user.id, timeLimitMin: cfg.timeLimitMin });
  try {
    await user.send({
      embeds: [
        embeds
          .info(
            `📋 Bewerbung: ${type.name}`,
            `Los geht's! Ich stelle dir **${questions.length}** Frage${questions.length === 1 ? '' : 'n'}. Antworte einfach hier im Chat.\n` +
              `Du hast **${applicationService.formatDuration(cfg.timeLimitMin * 60_000)}** Zeit. Schreibe \`abbrechen\`, um zu stoppen.`,
          )
          .setFooter({ text: guild.name }),
      ],
    });
    await sendQuestion(user, session, type, questions);
  } catch {
    appModel.deleteSession(session.id);
    throw new Error('Ich kann dir keine Direktnachricht schicken. Erlaube in den Privatsphäre-Einstellungen des Servers Direktnachrichten von Servermitgliedern und versuche es erneut.');
  }
}

/** Prüft eine Antwort; liefert { value } oder { error }. */
function validate(q, raw) {
  const text = String(raw ?? '').trim();
  if (!text || text === '-') return q.required ? { error: 'Diese Frage ist ein Pflichtfeld – bitte antworte.' } : { value: '' };

  if (q.style === 'choice') {
    const hit = q.options.find((o) => o.toLowerCase() === text.toLowerCase());
    return hit ? { value: hit } : { error: 'Bitte wähle eine der Optionen im Menü (oder schreibe sie genau so).' };
  }
  if (q.style === 'number') {
    const n = Number(text.replace(',', '.'));
    if (!Number.isFinite(n)) return { error: 'Bitte antworte mit einer Zahl.' };
    if (q.min_length > 0 && n < q.min_length) return { error: `Die Zahl muss mindestens ${q.min_length} sein.` };
    if (q.max_length > 0 && n > q.max_length) return { error: `Die Zahl darf höchstens ${q.max_length} sein.` };
    return { value: String(n) };
  }
  if (q.min_length > 0 && text.length < q.min_length) return { error: `Deine Antwort ist zu kurz (mindestens ${q.min_length} Zeichen).` };
  if (q.max_length > 0 && text.length > q.max_length) return { error: `Deine Antwort ist zu lang (höchstens ${q.max_length} Zeichen).` };
  return { value: text.slice(0, 4000) };
}

async function finish(user, session, type, questions, answers) {
  const guild = client.guilds.cache.get(session.guild_id);
  appModel.deleteSession(session.id);
  if (!guild) {
    return user.send({ embeds: [embeds.error(undefined, 'Der Server ist nicht mehr erreichbar. Deine Bewerbung wurde nicht gespeichert.')] }).catch(() => null);
  }
  try {
    await applicationService.submitApplication(guild, { id: user.id, tag: user.tag }, type, answers, { source: 'dm', durationMs: Date.now() - session.started_at });
    const cfg = appModel.typeCfg(type);
    await user.send({
      embeds: [
        embeds
          .success('✅ Bewerbung eingereicht', applicationService.fillTemplate(cfg.completionMessage || 'Deine Bewerbung wurde eingereicht.', { applicationName: type.name, server: guild.name }))
          .setFooter({ text: guild.name }),
      ],
    });
  } catch (err) {
    logger.warn(`[application] DM-Bewerbung abschließen: ${err.message}`);
    await user.send({ embeds: [embeds.error(undefined, `Deine Bewerbung konnte nicht gespeichert werden: ${err.message}`)] }).catch(() => null);
  }
}

/** Antwort annehmen (Text oder Menüwahl) und weiter zur nächsten Frage bzw. abschließen. */
async function acceptAnswer(user, session, value) {
  const type = appModel.getType(session.type_id);
  const questions = appModel.listQuestions(session.type_id);
  const q = questions[session.step];
  const answers = JSON.parse(session.answers_json || '[]');
  answers.push({ question: q.label, answer: value });
  const next = appModel.updateSession(session.id, { step: session.step + 1, answers });
  if (next.step >= questions.length) return finish(user, next, type, questions, answers);
  return sendQuestion(user, next, type, questions);
}

async function cancel(user, session, silent = false) {
  appModel.deleteSession(session.id);
  if (!silent) await user.send({ embeds: [embeds.warning('Bewerbung abgebrochen', 'Du kannst jederzeit neu starten.')] }).catch(() => null);
}

/**
 * DM-Nachricht eines Nutzers. Gibt true zurück, wenn sie Teil einer laufenden Bewerbung war
 * (dann darf ModMail sie nicht zusätzlich verarbeiten).
 */
async function handleDm(message) {
  const session = appModel.getSessionByUser(message.author.id);
  if (!session) return false;

  if (session.expires_at < Date.now()) {
    await cancel(message.author, session, true);
    await message.author.send({ embeds: [embeds.warning('⌛ Zeit abgelaufen', 'Die Zeit für diese Bewerbung ist um. Starte sie bitte neu.')] }).catch(() => null);
    return true;
  }
  if (CANCEL_WORDS.includes(message.content.trim().toLowerCase())) {
    await cancel(message.author, session);
    return true;
  }

  const questions = appModel.listQuestions(session.type_id);
  const q = questions[session.step];
  if (!q) {
    appModel.deleteSession(session.id);
    return false;
  }
  const res = validate(q, message.content);
  if (res.error) {
    await message.author.send({ embeds: [embeds.warning(undefined, res.error)] }).catch(() => null);
    return true;
  }
  await acceptAnswer(message.author, session, res.value);
  return true;
}

/** Abgelaufene Sitzungen aufräumen (Scheduler, jede Minute). */
async function sweep() {
  for (const session of appModel.listExpiredSessions()) {
    appModel.deleteSession(session.id);
    const user = await client.users.fetch(session.user_id).catch(() => null);
    await user?.send({ embeds: [embeds.warning('⌛ Zeit abgelaufen', 'Die Zeit für deine Bewerbung ist um. Starte sie bitte neu.')] }).catch(() => null);
  }
}

module.exports = { start, validate, handleDm, acceptAnswer, cancel, sweep };
