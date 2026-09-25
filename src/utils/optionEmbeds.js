'use strict';

const { EmbedBuilder } = require('discord.js');

/**
 * Eigene Embeds pro Antwortmöglichkeit (Ticket-Formular „Auswahl/Radio“, Bewerbungs-Frage „Auswahl“).
 * Gespeichert als JSON { "<Optionstext>": { title, description, color, imageUrl, thumbnailUrl, footer } }.
 */

const url = (u) => (/^https:\/\/\S+$/i.test(String(u ?? '').trim()) ? String(u).trim().slice(0, 500) : '');
const str = (v, max) => String(v ?? '').slice(0, max);

function sanitizeOne(v) {
  const i = v && typeof v === 'object' ? v : {};
  const color = String(i.color ?? '').trim();
  return {
    title: str(i.title, 256),
    description: str(i.description, 4000),
    color: /^#?[0-9a-f]{6}$/i.test(color) ? (color[0] === '#' ? color : '#' + color) : '',
    imageUrl: url(i.imageUrl),
    thumbnailUrl: url(i.thumbnailUrl),
    footer: str(i.footer, 2048),
  };
}

const isEmpty = (e) => !e.title.trim() && !e.description.trim() && !e.imageUrl && !e.thumbnailUrl;

/** Bereinigt die Zuordnung; nur Optionen aus `options` (falls angegeben) und nur nicht-leere Embeds bleiben. */
function sanitize(map, options) {
  const input = map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  const allowed = Array.isArray(options) ? new Set(options.map(String)) : null;
  const out = {};
  for (const [key, val] of Object.entries(input).slice(0, 25)) {
    const k = String(key).slice(0, 100);
    if (allowed && !allowed.has(k)) continue;
    const e = sanitizeOne(val);
    if (!isEmpty(e)) out[k] = e;
  }
  return out;
}

function parse(raw) {
  if (!raw) return {};
  try { return sanitize(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch { return {}; }
}

function fill(text, vars) {
  let out = String(text || '');
  for (const [k, v] of Object.entries(vars || {})) out = out.replaceAll(`{${k}}`, v ?? '');
  return out;
}

/** Baut das Embed einer gewählten Option (oder null, wenn für sie nichts hinterlegt ist). */
function build(map, option, vars = {}, fallbackColor = null) {
  const e = map?.[option];
  if (!e) return null;
  const v = { ...vars, option };
  const embed = new EmbedBuilder();
  const color = e.color ? parseInt(e.color.slice(1), 16) : fallbackColor;
  if (color !== null && color !== undefined) embed.setColor(color);
  if (e.title) embed.setTitle(fill(e.title, v).slice(0, 256));
  if (e.description) embed.setDescription(fill(e.description, v).slice(0, 4000));
  if (e.imageUrl) embed.setImage(e.imageUrl);
  if (e.thumbnailUrl) embed.setThumbnail(e.thumbnailUrl);
  if (e.footer) embed.setFooter({ text: fill(e.footer, v).slice(0, 2048) });
  return embed;
}

module.exports = { sanitize, parse, build };
