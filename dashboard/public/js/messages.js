/* global document, Dash */
'use strict';

const { apiFor, fillSelectors, getChannels, getRoles, toast, escapeHtml, fmtRelative, icon, dangerZone } = Dash;

const form = document.getElementById('msgForm');
const channelSel = document.getElementById('msgChannel');
const asEmbed = document.getElementById('msgAsEmbed');
const embedOpts = document.getElementById('msgEmbedOpts');
const titleIn = document.getElementById('msgEmbedTitle');
const content = document.getElementById('msgContent');
const imageIn = document.getElementById('msgImage');
const pingSel = document.getElementById('msgPing');
const editIdIn = document.getElementById('msgEditId');
const countEl = document.getElementById('msgCount');
const maxEl = document.getElementById('msgMax');
const colorPick = document.getElementById('msgColor');
const colorText = document.getElementById('msgColorText');
const statusEl = document.getElementById('msgStatus');
const sendBtn = document.getElementById('msgSend');
const dangerBox = document.getElementById('msgDanger');

let CHAN = { text: [] };
let SENT = [];
/** Eintrag aus „Gesendete Nachrichten“, der gerade bearbeitet wird (oder null = neue Nachricht). */
let editing = null;

const chName = (id) => {
  const c = (CHAN.text || []).find((x) => x.id === id);
  return c ? '#' + c.name : '#gelöschter-kanal';
};

function syncEmbedUi() {
  const on = asEmbed.checked;
  embedOpts.hidden = !on;
  maxEl.textContent = on ? '4096' : '2000';
  updateCount();
}
function updateCount() {
  const max = asEmbed.checked ? 4096 : 2000;
  countEl.textContent = String(content.value.length);
  countEl.style.color = content.value.length > max ? 'var(--red)' : '';
}
function setColor(hex) {
  colorText.value = hex;
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) colorPick.value = hex;
}

asEmbed.addEventListener('change', syncEmbedUi);
content.addEventListener('input', updateCount);
colorPick.addEventListener('input', () => { colorText.value = colorPick.value; });
colorText.addEventListener('input', () => {
  if (/^#?[0-9a-fA-F]{6}$/.test(colorText.value.trim())) {
    colorPick.value = colorText.value.trim().startsWith('#') ? colorText.value.trim() : '#' + colorText.value.trim();
  }
});
colorText.value = colorPick.value;
syncEmbedUi();

function clearForm() {
  content.value = '';
  titleIn.value = '';
  imageIn.value = '';
  pingSel.value = 'none';
  editIdIn.value = '';
  updateCount();
}

/* ---------------- Bearbeiten-Modus ---------------- */

function startEdit(post) {
  editing = post;
  channelSel.value = post.channel_id;
  channelSel.disabled = true;
  asEmbed.checked = post.as_embed !== 0;
  titleIn.value = post.title || '';
  content.value = post.body || '';
  imageIn.value = post.image_url || '';
  setColor(post.color || '#7c5cff');
  pingSel.value = 'none';
  editIdIn.value = post.message_id;
  syncEmbedUi();

  document.getElementById('msgEditBanner').hidden = false;
  document.getElementById('msgManualEdit').hidden = true;
  document.getElementById('msgHeading').lastChild.textContent = ' Nachricht bearbeiten';
  sendBtn.lastChild.textContent = ' Änderungen speichern';
  statusEl.textContent = '';

  dangerBox.replaceChildren(dangerZone({
    text: 'Löscht die Nachricht in Discord und entfernt sie aus dieser Liste.',
    label: 'Nachricht löschen',
    confirm: 'Nachricht löschen? Sie wird auch im Discord-Kanal entfernt.',
    onConfirm: async () => {
      await apiFor('DELETE', `/news/${post.id}?discord=1`);
      toast('Nachricht gelöscht.', 'success');
      stopEdit();
      await loadSent();
    },
  }));
  document.getElementById('msgCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function stopEdit() {
  editing = null;
  channelSel.disabled = false;
  document.getElementById('msgEditBanner').hidden = true;
  document.getElementById('msgManualEdit').hidden = false;
  document.getElementById('msgHeading').lastChild.textContent = ' Nachricht senden';
  sendBtn.lastChild.textContent = ' Senden';
  dangerBox.replaceChildren();
  clearForm();
  asEmbed.checked = false;
  setColor('#7c5cff');
  syncEmbedUi();
}

document.getElementById('msgEditCancel').addEventListener('click', stopEdit);

/* ---------------- Senden / Speichern ---------------- */

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    channelId: channelSel.value,
    content: content.value,
    asEmbed: asEmbed.checked,
    embedTitle: titleIn.value,
    embedColor: colorText.value,
    imageUrl: imageIn.value.trim(),
    pingMention: pingSel.value,
    messageId: editIdIn.value.trim(),
  };
  if (!body.channelId) return toast('Bitte einen Kanal wählen.', 'error');

  sendBtn.disabled = true;
  statusEl.textContent = editing ? 'Wird gespeichert…' : 'Wird gesendet…';
  try {
    const r = await apiFor('POST', '/message', body);
    toast(r.edited ? 'Nachricht bearbeitet.' : 'Nachricht gesendet.', 'success');
    statusEl.innerHTML = (r.edited ? 'Bearbeitet ✓ ' : 'Gesendet ✓ ') +
      (r.url ? `<a href="${r.url}" target="_blank" rel="noopener">In Discord ansehen</a>` : '');
    if (editing) stopEdit();
    else if (!r.edited) clearForm();
    await loadSent();
  } catch (err) {
    toast(err.message, 'error');
    statusEl.textContent = err.message;
  } finally {
    sendBtn.disabled = false;
  }
});

/* ---------------- Gesendete Nachrichten ---------------- */

async function loadSent() {
  const w = document.getElementById('sentList');
  try {
    SENT = await apiFor('GET', '/news');
    w.innerHTML = SENT.length
      ? SENT.map((n) => {
          const label = n.title || (n.body || '').split('\n')[0].slice(0, 80) || '(ohne Text)';
          return `<div class="list-row">
            <div class="list-row__head">
              <span class="list-row__title">${icon(n.as_embed === 0 ? 'chat' : 'bell', 'icon--sm')} ${escapeHtml(label)}</span>
              <span class="spacer"></span>
              <button type="button" class="btn btn--ghost btn--sm" data-edit="${n.id}">${icon('edit', 'icon--sm')} Bearbeiten</button>
            </div>
            <div class="list-row__meta"><span>${escapeHtml(chName(n.channel_id))}</span><span>${escapeHtml(fmtRelative(n.created_at))}</span></div>
          </div>`;
        }).join('')
      : `<div class="empty">${icon('send')}<b>Noch nichts gesendet</b>Schreibe oben deine erste Nachricht.</div>`;
  } catch (err) {
    w.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

document.getElementById('sentList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-edit]');
  if (!btn) return;
  const post = SENT.find((n) => String(n.id) === btn.dataset.edit);
  if (post) startEdit(post);
});

(async function init() {
  try {
    const [, roles, chans] = await Promise.all([fillSelectors({}), getRoles(), getChannels()]);
    CHAN = chans;
    if (Array.isArray(roles)) {
      pingSel.insertAdjacentHTML(
        'beforeend',
        roles
          .filter((r) => !r.managed)
          .map((r) => `<option value="${r.id}">@${escapeHtml(r.name)}</option>`)
          .join(''),
      );
    }
    await loadSent();
  } catch (e) {
    toast(e.message, 'error');
  }
})();

/* ---------------- Nachrichten-Verlauf ---------------- */

const histChannel = document.getElementById('histChannel');
const histList = document.getElementById('histList');
const histStatus = document.getElementById('histStatus');
const histLoadBtn = document.getElementById('histLoad');

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function renderHistory(data) {
  document.getElementById('histIntentBox').hidden = data.intentActive !== false;
  if (!data.messages.length) {
    histList.innerHTML = '<p class="muted">Keine Nachrichten gefunden.</p>';
    return;
  }
  histList.innerHTML = data.messages
    .map((m) => {
      const hasText = m.content && m.content.trim();
      const textHtml = hasText
        ? escapeHtml(m.content)
        : m.embeds
          ? '<span class="msg-row__text--empty">(Embed, kein Text)</span>'
          : '<span class="msg-row__text--empty">(kein Text sichtbar)</span>';
      const attach = m.attachments.length
        ? `<div class="msg-row__attach">${m.attachments
            .map((a) => `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">📎 ${escapeHtml(a.name || 'Datei')}</a>`)
            .join('')}</div>`
        : '';
      return `<div class="msg-row">
        <img class="msg-row__avatar" src="${escapeHtml(m.authorAvatar)}" alt="" loading="lazy" />
        <div class="msg-row__body">
          <div class="msg-row__head">
            <span class="msg-row__name${m.bot ? ' msg-row__name--bot' : ''}">${escapeHtml(m.authorTag)}${m.bot ? ' 🤖' : ''}</span>
            <span class="msg-row__time" title="${new Date(m.createdAt).toLocaleString('de-DE')}">${fmtRelative ? fmtRelative(m.createdAt) : fmtTime(m.createdAt)}</span>
            ${m.editedAt ? '<span class="msg-row__time">(bearbeitet)</span>' : ''}
          </div>
          <div class="msg-row__text">${textHtml}</div>
          ${attach}
        </div>
      </div>`;
    })
    .join('');
  histList.scrollTop = histList.scrollHeight;
}

async function loadHistory() {
  const channelId = histChannel.value;
  if (!channelId) return toast('Bitte einen Kanal wählen.', 'error');
  const limit = document.getElementById('histLimit').value;
  histStatus.textContent = 'Lädt…';
  histLoadBtn.disabled = true;
  try {
    const data = await apiFor('GET', `/messages/history?channelId=${channelId}&limit=${limit}`);
    renderHistory(data);
    histStatus.textContent = `${data.messages.length} Nachricht(en) aus #${data.channelName}`;
  } catch (err) {
    toast(err.message, 'error');
    histStatus.textContent = err.message;
  } finally {
    histLoadBtn.disabled = false;
  }
}

histLoadBtn.addEventListener('click', loadHistory);
document.getElementById('histReload').addEventListener('click', () => histChannel.value && loadHistory());
histChannel.addEventListener('change', () => { if (histChannel.value) loadHistory(); });
