/* global document, Dash */
'use strict';

const { apiFor, escapeHtml, fmtDate, getRoles, icon, confirmModal, toast } = Dash;

let CHAN = { text: [] };

const chName = (id) => {
  const c = (CHAN.text || []).find((x) => x.id === id);
  return c ? '#' + c.name : '#gelöschter-kanal';
};

async function loadList() {
  const w = document.getElementById('newsList');
  try {
    const list = await apiFor('GET', '/news');
    w.innerHTML = list.length
      ? list.map((n) => `<div class="list-row">
          <div class="list-row__head">
            <span class="list-row__title">${icon('bell', 'icon--sm')} ${escapeHtml(n.title || '(ohne Titel)')}</span>
            <span class="spacer"></span>
            <button type="button" class="btn btn--danger btn--sm" data-del="${n.id}" title="Entfernen">${icon('trash', 'icon--sm')}</button>
          </div>
          <div class="list-row__meta"><span>${escapeHtml(chName(n.channel_id))}</span><span>${escapeHtml(fmtDate(n.created_at))}</span></div>
        </div>`).join('')
      : `<div class="empty">${icon('bell')}<b>Noch nichts veröffentlicht</b>Verfasse links deine erste Ankündigung.</div>`;
  } catch (e) { w.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}

document.getElementById('newsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await apiFor('POST', '/news', {
      channelId: document.getElementById('nsChannel').value,
      title: document.getElementById('nsTitle').value,
      body: document.getElementById('nsBody').value,
      color: document.getElementById('nsColor').value,
      ping: document.getElementById('nsPing').value,
      imageUrl: document.getElementById('nsImage').value.trim(),
    });
    toast('Ankündigung veröffentlicht.', 'success');
    document.getElementById('nsTitle').value = '';
    document.getElementById('nsBody').value = '';
    document.getElementById('nsImage').value = '';
    await loadList();
  } catch (err) { toast(err.message, 'error'); }
  btn.disabled = false;
});

document.getElementById('newsList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-del]');
  if (!btn) return;
  const id = btn.dataset.del;
  try {
    if (!(await confirmModal('Ankündigung entfernen? Die Nachricht im Discord-Kanal wird ebenfalls gelöscht.', { danger: true, confirmLabel: 'Entfernen' }))) return;
    await apiFor('DELETE', `/news/${id}?discord=1`);
    toast('Entfernt.', 'success');
    await loadList();
  } catch (err) { toast(err.message, 'error'); }
});

(async function init() {
  try {
    const [chans, roles] = await Promise.all([Dash.getChannels(), getRoles()]);
    CHAN = chans;
    document.getElementById('nsPing').insertAdjacentHTML('beforeend', roles.filter((r) => !r.managed).map((r) => `<option value="${r.id}">@${escapeHtml(r.name)}</option>`).join(''));
    const mf = await Dash.moduleForm('news', document.getElementById('newsDefaults'), {
      on: 'Das Neuigkeiten-Modul ist aktiv. Du kannst Ankündigungen veröffentlichen.',
      off: 'Das Neuigkeiten-Modul ist deaktiviert. Aktiviere es, um Ankündigungen zu veröffentlichen.',
    });
    const sel = document.getElementById('nsChannel');
    sel.value = mf.cfg.defaultChannelId || sel.value;
    await loadList();
  } catch (e) { toast(e.message, 'error'); }
})();
