/* global document, window, Dash, Blob, URL */
'use strict';

/* Ticket-Verlauf: rendert den gespeicherten Transkript-JSON als Chat im Discord-Stil. */

const { apiFor, escapeHtml: esc, fmtDate, icon, toast, PAGE_DATA } = Dash;

const CHAT = document.getElementById('trChat');
let DATA = null;
let TICKET = null;

const DEFAULT_AV = 'https://cdn.discordapp.com/embed/avatars/0.png';
const GROUP_MS = 7 * 60_000;

function user(id) {
  return DATA.users[id] || { n: id ? `Unbekannt (${id})` : 'Unbekannt', av: null, bot: false };
}

function time(ts) {
  return new Date(Number(ts)).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function day(ts) {
  return new Date(Number(ts)).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function safeUrl(u) {
  return /^https?:\/\//i.test(u || '') ? u : null;
}

function fmtSize(b) {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/* ---------------- Discord-Markdown (sicher: erst escapen, dann formatieren) ---------------- */

const TS_STYLES = {
  t: { timeStyle: 'short' },
  T: { timeStyle: 'medium' },
  d: { dateStyle: 'short' },
  D: { dateStyle: 'long' },
  f: { dateStyle: 'long', timeStyle: 'short' },
  F: { dateStyle: 'full', timeStyle: 'short' },
};

const BLOCK = '\u0001'; // Markierung hinter Block-Zeilen (Überschrift, Zitat, Liste)

function md(src) {
  if (!src) return '';
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = String(src);

  // Code-Blöcke und Inline-Code zuerst herausnehmen (dort keine Formatierung)
  s = s.replace(/```(?:[\w+-]*\n)?([\s\S]*?)```\n?/g, (_, code) => keep(`<pre class="tr-code">${esc(code.replace(/\n$/, ''))}</pre>`));
  s = s.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${esc(code)}</code>`));

  // Discord-Tokens (vor dem Escapen, weil sie < > enthalten)
  s = s.replace(/<(a?):(\w{2,32}):(\d{15,25})>/g, (_, a, name, id) =>
    keep(`<img class="tr-emoji" alt=":${esc(name)}:" title=":${esc(name)}:" src="https://cdn.discordapp.com/emojis/${id}.${a ? 'gif' : 'png'}?size=48" />`));
  s = s.replace(/<@!?(\d{15,25})>/g, (_, id) => keep(`<span class="tr-mention">@${esc(user(id).n)}</span>`));
  s = s.replace(/<@&(\d{15,25})>/g, (_, id) => {
    const r = DATA.roles[id];
    const style = r?.c ? ` style="color:${esc(r.c)};background:${esc(r.c)}22"` : '';
    return keep(`<span class="tr-mention"${style}>@${esc(r?.n || 'Rolle')}</span>`);
  });
  s = s.replace(/<#(\d{15,25})>/g, (_, id) => keep(`<span class="tr-mention">#${esc(DATA.channels[id] || 'Kanal')}</span>`));
  s = s.replace(/<t:(-?\d{1,13})(?::([tTdDfFR]))?>/g, (_, sec, st) => {
    const d = new Date(Number(sec) * 1000);
    const txt = st === 'R' ? d.toLocaleString('de-DE') : d.toLocaleString('de-DE', TS_STYLES[st || 'f']);
    return keep(`<span class="tr-ts">${esc(txt)}</span>`);
  });
  s = s.replace(/\[([^\]\n]+)\]\(<?(https?:\/\/[^\s)>]+)>?\)/g, (_, label, url) =>
    keep(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`));
  s = s.replace(/<?(https?:\/\/[^\s<>]+[^\s<>.,:;"')\]])>?/g, (_, url) =>
    keep(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`));

  s = esc(s);

  // Überschriften, Zitate, Listen (zeilenweise)
  s = s
    .split('\n')
    .map((line) => {
      let m = line.match(/^(#{1,3}) (.+)$/);
      if (m) return `<span class="tr-h tr-h${m[1].length}">${m[2]}</span>${BLOCK}`;
      m = line.match(/^-# (.+)$/);
      if (m) return `<span class="tr-sub">${m[1]}</span>${BLOCK}`;
      m = line.match(/^&gt; ?(.*)$/);
      if (m) return `<span class="tr-quote">${m[1] || '&nbsp;'}</span>${BLOCK}`;
      m = line.match(/^\s*[-*] (.+)$/);
      if (m) return `<span class="tr-li">• ${m[1]}</span>${BLOCK}`;
      return line;
    })
    .join('\n');

  s = s
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/\|\|(.+?)\|\|/g, '<span class="tr-spoiler" title="Spoiler – klicken zum Anzeigen">$1</span>')
    .split(BLOCK + '\n').join('') // Block-Zeilen brauchen keinen Zeilenumbruch danach
    .split(BLOCK).join('')
    .replace(/\n/g, '<br>');

  // eslint-disable-next-line no-control-regex
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

/* ---------------- Bausteine ---------------- */

function avatar(u) {
  return `<img class="tr-av" src="${esc(safeUrl(u.av) || DEFAULT_AV)}" alt="" loading="lazy" />`;
}

function nameTag(u, id) {
  const style = u.c ? ` style="color:${esc(u.c)}"` : '';
  return `<span class="tr-name"${style} title="${esc(u.u || '')} (${esc(id || '?')})">${esc(u.n)}</span>${u.bot ? '<span class="tr-bot">BOT</span>' : ''}`;
}

function embedHtml(e) {
  const color = /^#[0-9a-f]{6}$/i.test(e.col || '') ? e.col : 'var(--line-2)';
  const title = e.t ? (safeUrl(e.u)
    ? `<a class="tr-em__title" href="${esc(e.u)}" target="_blank" rel="noopener noreferrer">${md(e.t)}</a>`
    : `<div class="tr-em__title">${md(e.t)}</div>`) : '';
  const fields = (e.f || []).length
    ? `<div class="tr-em__fields">${e.f.map((f) => `<div class="tr-em__field${f.i ? ' is-inline' : ''}"><div class="tr-em__fname">${md(f.n)}</div><div class="tr-em__fval">${md(f.v)}</div></div>`).join('')}</div>`
    : '';
  const img = safeUrl(e.img) ? `<a href="${esc(e.img)}" target="_blank" rel="noopener noreferrer"><img class="tr-em__img" src="${esc(e.img)}" alt="" loading="lazy" /></a>` : '';
  const th = safeUrl(e.th) ? `<img class="tr-em__th" src="${esc(e.th)}" alt="" loading="lazy" />` : '';
  return `<div class="tr-em" style="border-left-color:${color}">
    <div class="tr-em__main">
      ${e.au ? `<div class="tr-em__author">${esc(e.au)}</div>` : ''}
      ${title}
      ${e.d ? `<div class="tr-em__desc">${md(e.d)}</div>` : ''}
      ${fields}
      ${img}
      ${e.ft ? `<div class="tr-em__footer">${esc(e.ft)}</div>` : ''}
    </div>${th}
  </div>`;
}

function attachmentHtml(a) {
  const url = safeUrl(a.u);
  if (!url) return '';
  const isImg = /^image\//.test(a.ct || '') || /\.(png|jpe?g|gif|webp)$/i.test(a.n || '');
  if (isImg) {
    return `<a class="tr-att-img" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" alt="${esc(a.n)}" loading="lazy" /></a>`;
  }
  return `<a class="tr-att" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('file', 'icon--sm')}<span><b>${esc(a.n)}</b><small>${esc(fmtSize(a.s))}</small></span></a>`;
}

function bodyHtml(m) {
  const parts = [];
  if (m.ref) {
    const r = DATA.messages.find((x) => x.id === m.ref);
    const ru = r ? user(r.a) : null;
    parts.push(`<div class="tr-reply">↪ ${r ? `<b>${esc(ru.n)}</b> ${esc((r.c || (r.em ? '[Embed]' : r.at ? '[Anhang]' : '')).replace(/[`*_~|>]+/g, '').replace(/\s+/g, ' ').slice(0, 90))}` : '<i>Nachricht nicht im Verlauf</i>'}</div>`);
  }
  if (m.c) parts.push(`<div class="tr-text">${md(m.c)}${m.ed ? ' <span class="tr-edited" title="' + esc(fmtDate(m.ed)) + '">(bearbeitet)</span>' : ''}</div>`);
  for (const e of m.em || []) parts.push(embedHtml(e));
  for (const a of m.at || []) parts.push(attachmentHtml(a));
  if (m.st?.length) parts.push(`<div class="tr-sticker">🏷️ Sticker: ${esc(m.st.join(', '))}</div>`);
  if (m.btn?.length) parts.push(`<div class="tr-btns">${m.btn.map((b) => `<span class="tr-btn">${esc(b)}</span>`).join('')}</div>`);
  if (!parts.length) parts.push('<div class="tr-text muted"><i>(kein lesbarer Inhalt)</i></div>');
  return parts.join('');
}

/* ---------------- Rendern ---------------- */

function searchText(m) {
  const u = user(m.a);
  return [u.n, u.u, m.c, ...(m.em || []).flatMap((e) => [e.t, e.d, e.au, e.ft, ...(e.f || []).flatMap((f) => [f.n, f.v])]), ...(m.at || []).map((a) => a.n)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function renderChat(filter = '') {
  const q = filter.trim().toLowerCase();
  const list = q ? DATA.messages.filter((m) => searchText(m).includes(q)) : DATA.messages;
  document.getElementById('trCount').textContent = q
    ? `${list.length} von ${DATA.messages.length} Nachrichten`
    : `${DATA.messages.length} Nachrichten`;

  if (!list.length) {
    CHAT.innerHTML = `<div class="tr-empty">${q ? 'Keine Nachricht passt zur Suche.' : 'Der Verlauf ist leer.'}</div>`;
    return;
  }

  const out = [];
  let prev = null;
  let lastDay = '';
  for (const m of list) {
    const d = day(m.ts);
    if (d !== lastDay) {
      out.push(`<div class="tr-day"><span>${esc(d)}</span></div>`);
      lastDay = d;
      prev = null;
    }
    const u = user(m.a);
    const grouped = !q && prev && prev.a === m.a && m.ts - prev.ts < GROUP_MS && !m.ref;
    out.push(grouped
      ? `<div class="tr-msg is-cont"><span class="tr-gutter">${esc(time(m.ts))}</span><div class="tr-body">${bodyHtml(m)}</div></div>`
      : `<div class="tr-msg">${avatar(u)}<div class="tr-body"><div class="tr-head">${nameTag(u, m.a)}<span class="tr-time" title="${esc(fmtDate(m.ts))}">${esc(fmtDate(m.ts))}</span></div>${bodyHtml(m)}</div></div>`);
    prev = m;
  }
  CHAT.innerHTML = out.join('');
}

function metaItem(label, value) {
  return `<div class="tr-meta__item"><span>${esc(label)}</span><b>${value}</b></div>`;
}

function who(id) {
  if (!id) return '–';
  const u = user(id);
  return `<span class="tr-who">${avatar(u)}${esc(u.n)}</span>`;
}

function renderMeta() {
  const m = DATA.meta;
  const title = m.applicationId ? `Bewerber-Chat #${m.applicationId}` : `Ticket #${m.number ?? TICKET.id}`;
  document.getElementById('trTitle').innerHTML = `${icon('file')} ${esc(title)} – Verlauf`;
  document.title = `${title} – Verlauf`;
  document.getElementById('trSub').textContent =
    `Gespeichert am ${fmtDate(m.savedAt)}${m.channelName ? ` aus #${m.channelName}` : ''}.` +
    (m.truncated ? ' Sehr langer Verlauf – nur die letzten 1500 Nachrichten wurden gespeichert.' : '');
  const status = { open: 'Offen', closed: 'Geschlossen', deleted: 'Gelöscht' }[TICKET.status] || TICKET.status;
  document.getElementById('trMeta').innerHTML = [
    metaItem('Ersteller', who(m.openerId)),
    metaItem('Kategorie', esc(m.category || '–')),
    metaItem('Status', `<span class="badge badge--${esc(TICKET.status)}">${esc(status)}</span>`),
    metaItem('Übernommen von', who(TICKET.claimed_by || m.claimedBy)),
    metaItem('Geschlossen von', who(TICKET.closed_by || m.closedBy)),
    metaItem('Erstellt', esc(fmtDate(m.createdAt))),
    metaItem('Geschlossen', esc(fmtDate(TICKET.closed_at || m.closedAt))),
  ].join('');
  document.getElementById('trMetaCard').hidden = false;
}

/** Textfassung zum Speichern (wird im Browser erzeugt). */
function asText() {
  const pad = (n) => String(n).padStart(2, '0');
  const st = (ts) => { const d = new Date(Number(ts)); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const m = DATA.meta;
  const lines = [`Transkript – Ticket #${m.number ?? TICKET.id}${m.category ? ` (${m.category})` : ''}`, `Ersteller: ${user(m.openerId).n} (${m.openerId})`, '='.repeat(60), ''];
  for (const x of DATA.messages) {
    const u = user(x.a);
    lines.push(`[${st(x.ts)}] ${u.n}${u.bot ? ' [BOT]' : ''}`);
    if (x.c) lines.push(`  ${x.c.replace(/\n/g, '\n  ')}`);
    for (const e of x.em || []) {
      const bits = [e.t, e.d, ...(e.f || []).map((f) => `${f.n}: ${f.v}`)].filter(Boolean);
      if (bits.length) lines.push(`  [Embed] ${bits.join(' | ').replace(/\n/g, ' ')}`);
    }
    for (const a of x.at || []) lines.push(`  [Anhang] ${a.n}: ${a.u}`);
    lines.push('');
  }
  return lines.join('\n');
}

document.getElementById('trDownload').addEventListener('click', () => {
  if (!DATA) return;
  const url = URL.createObjectURL(new Blob([asText()], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `transkript-${String(DATA.meta.number ?? TICKET.id).padStart(4, '0')}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

let searchTimer;
document.getElementById('trSearch').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => renderChat(e.target.value), 150);
});

CHAT.addEventListener('click', (e) => {
  const sp = e.target.closest('.tr-spoiler');
  if (sp) sp.classList.add('is-open');
});
CHAT.addEventListener('error', (e) => {
  if (e.target.classList?.contains('tr-av')) e.target.src = DEFAULT_AV;
}, true);

(async function init() {
  try {
    const res = await apiFor('GET', `/tickets/${Number(PAGE_DATA.ticketId) || 0}/transcript`);
    DATA = { users: {}, roles: {}, channels: {}, messages: [], meta: {}, ...res.transcript };
    TICKET = res.ticket;
    renderMeta();
    renderChat();
  } catch (e) {
    CHAT.innerHTML = `<div class="tr-empty">${esc(e.message)}</div>`;
    toast(e.message, 'error');
  }
})();
