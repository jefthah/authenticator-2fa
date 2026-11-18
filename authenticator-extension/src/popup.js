import * as vault from './vault.js';
import { generateCode, formatCode, secondsRemaining, totpStep, parseAnyText, accountKey } from './core.js';
import { decodeDataUrl } from './qr.js';
import { $, h, toast, avatar, title, subtitle, authForm, icon, ICONS, dialog, confirmReset, ago } from './ui.js';
import { t, initI18n, setLang, languagePref, LANGUAGES } from './i18n.js';

const root = $('#root');
const RING = 2 * Math.PI * 9;
let accounts = [];
let rows = new Map(); // id -> { li, code, ring, secs, step }
let query = '';
let timer = null;
let view = 'main';

function openImportPage(hash = '') {
  chrome.tabs.create({ url: chrome.runtime.getURL('import.html') + hash });
  window.close();
}

async function start() {
  clearInterval(timer);
  await initI18n();
  const st = await vault.status();
  if (st !== 'unlocked') await authForm(root, st);
  await vault.touch();
  accounts = await vault.loadAccounts();
  showMain();
  vault.syncNow(); // ambil perubahan dari laptop lain (jika sinkron aktif)
}

// ---------- Tampilan utama ----------

function header(...actions) {
  return h('header', { class: 'bar' },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon32.png', alt: '', width: 22, height: 22 }), 'Authenticator'),
    h('div', { class: 'actions' }, ...actions));
}

const iconBtn = (name, label, onclick) =>
  h('button', { class: 'icon-btn', title: label, 'aria-label': label, onclick }, icon(ICONS[name]));

function showMain() {
  view = 'main';
  clearInterval(timer);
  const search = h('input', {
    type: 'search', id: 'search', placeholder: t('searchPlaceholder'), value: query, autocomplete: 'off',
    oninput: (e) => { query = e.target.value; renderList(); },
  });
  root.replaceChildren(
    header(
      iconBtn('scan', t('scanTab'), scanTab),
      iconBtn('plus', t('addImport'), () => openImportPage()),
      iconBtn('gear', t('settings'), showSettings)),
    h('div', { id: 'sync-banner', class: 'banner', hidden: true }),
    accounts.length > 3 ? h('div', { class: 'search' }, icon(ICONS.search, 16), search) : '',
    h('ul', { id: 'list', class: 'list', onpointerdown: onDragStart }),
  );
  // Klik yang menyusul akhir seret tidak boleh menyalin kode.
  $('#list').addEventListener('click', (e) => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  renderList();
  vault.syncStatus().then(renderBanner);
  timer = setInterval(tick, 200);
  // Ketik langsung = cari
  document.onkeydown = (e) => {
    if (view !== 'main' || e.target.tagName === 'INPUT' || e.ctrlKey || e.metaKey || e.altKey) return;
    const s = $('#search');
    if (s && e.key.length === 1) s.focus();
  };
}

function renderList() {
  const list = $('#list');
  if (!list) return;
  rows = new Map();
  const q = query.trim().toLowerCase();
  const shown = accounts.filter((a) => !q || `${a.issuer} ${a.name}`.toLowerCase().includes(q));

  if (!accounts.length) {
    list.replaceWith(h('div', { class: 'empty', id: 'list' },
      h('div', { class: 'empty-art', 'aria-hidden': 'true' }, icon(ICONS.scan, 36)),
      h('h2', {}, t('emptyTitle')),
      h('p', { class: 'muted' }, t('emptyBody')),
      h('button', { class: 'btn primary block', onclick: () => openImportPage() }, t('importFromGA')),
      h('button', { class: 'btn ghost block', onclick: scanTab }, t('scanTab'))));
    return;
  }
  if (!shown.length) {
    list.replaceChildren(h('li', { class: 'none muted' }, t('noMatch', { q: query })));
    return;
  }
  list.classList.toggle('sortable', !q); // urutan hanya bisa diubah saat tidak mencari
  list.replaceChildren(...shown.map(row));
  tick(true);
}

function row(a) {
  const code = h('div', { class: 'code' }, '••• •••');
  const secs = h('span', { class: 'secs' });
  let ring;
  if (a.type === 'hotp') {
    ring = h('button', { class: 'icon-btn hotp', title: t('nextCode'), 'aria-label': t('nextCode'),
      onclick: (e) => { e.stopPropagation(); nextHotp(a); } }, icon(ICONS.refresh, 18));
  } else {
    ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 24 24');
    ring.setAttribute('class', 'ring');
    ring.innerHTML = `<circle cx="12" cy="12" r="9" class="track"/><circle cx="12" cy="12" r="9" class="fill" stroke-dasharray="${RING}"/>`;
  }
  const li = h('li', {
    class: 'item', tabindex: 0, 'data-id': a.id, 'data-copied': t('copiedBadge'),
    'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown',
    onclick: () => copy(a),
    onkeydown: (e) => {
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        moveByKey(li, e.key === 'ArrowUp' ? -1 : 1);
      } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy(a); }
    },
  },
  avatar(title(a)),
  h('div', { class: 'meta' },
    h('div', { class: 'issuer' }, title(a)),
    subtitle(a) && h('div', { class: 'name' }, subtitle(a)),
    code),
  h('div', { class: 'timer' }, ring, a.type === 'hotp' ? '' : secs),
  h('button', { class: 'icon-btn more', title: t('editDelete'), 'aria-label': t('editDeleteAria'),
    onclick: (e) => { e.stopPropagation(); editAccount(a); } }, icon(ICONS.more, 18)));
  rows.set(a.id, { li, code, ring, secs, step: null, value: '' });
  return li;
}

async function tick() {
  const now = Date.now();
  for (const a of accounts) {
    const r = rows.get(a.id);
    if (!r) continue;
    const step = a.type === 'hotp' ? `h${a.counter}` : totpStep(a, now);
    if (step !== r.step) {
      r.step = step;
      generateCode(a, now).then((c) => {
        if (r.step !== step) return;
        r.value = c;
        r.code.textContent = formatCode(c);
      }).catch(() => { r.code.textContent = 'Error'; });
    }
    if (a.type !== 'hotp') {
      const left = secondsRemaining(a, now);
      const period = a.period || 30;
      r.ring.querySelector('.fill').style.strokeDashoffset = String(RING * (1 - left / period));
      r.secs.textContent = Math.ceil(left);
      r.li.classList.toggle('warn', left <= 5);
    }
  }
}

async function copy(a) {
  const r = rows.get(a.id);
  if (!r?.value) return;
  try {
    await navigator.clipboard.writeText(r.value);
    r.li.classList.remove('copied');
    void r.li.offsetWidth;
    r.li.classList.add('copied');
    toast(t('copied', { name: title(a) }));
    vault.touch();
  } catch {
    toast(t('copyFailed'), 'warn');
  }
}

async function nextHotp(a) {
  await vault.updateAccount({ ...a, counter: (a.counter || 0) + 1 });
}

// ---------- Ubah urutan: seret akun (mouse) atau Alt+↑/↓ (keyboard) ----------

let drag = null; // { li, pointerId, startY, y, grab, active, startIds, scroller }
let suppressClick = false;
let refreshAfterDrag = false;

const listIds = () => [...document.querySelectorAll('#list > li.item')].map((li) => li.dataset.id);

/** Pindahkan elemen di DOM dengan animasi geser halus untuk `el`. */
function flip(el, move) {
  const before = el.getBoundingClientRect().top;
  move();
  const delta = before - el.getBoundingClientRect().top;
  if (delta) el.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], { duration: 150, easing: 'ease-out' });
}

function onDragStart(e) {
  if (drag || e.button !== 0 || e.pointerType === 'touch' || query.trim()) return;
  const li = e.target.closest('li.item');
  if (!li || e.target.closest('button')) return;
  drag = { li, pointerId: e.pointerId, startY: e.clientY, y: e.clientY, grab: 0, active: false, startIds: listIds() };
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragEnd);
}

function onDragMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.y = e.clientY;
  if (!drag.active) {
    if (Math.abs(drag.y - drag.startY) < 6) return; // klik biasa, bukan seret
    drag.active = true;
    drag.grab = drag.startY - drag.li.getBoundingClientRect().top;
    try { $('#list').setPointerCapture(drag.pointerId); } catch { /* tetap jalan tanpa capture */ } // terima gerakan walau kursor keluar popup
    drag.li.classList.add('dragging');
    document.body.classList.add('is-dragging');
    drag.scroller = setInterval(autoScroll, 16);
  }
  e.preventDefault();
  layoutDrag();
}

/** Tukar posisi dengan tetangga saat titik tengah terlewati, lalu tempelkan baris ke kursor. */
function layoutDrag() {
  const list = $('#list');
  const { li } = drag;
  const top = () => list.getBoundingClientRect().top;
  const maxTop = top() + list.clientHeight - li.offsetHeight;
  const want = Math.min(Math.max(drag.y - drag.grab, top()), maxTop);
  const mid = want + li.offsetHeight / 2;
  for (;;) {
    const next = li.nextElementSibling;
    if (next && mid > top() + next.offsetTop + next.offsetHeight / 2) { flip(next, () => next.after(li)); continue; }
    const prev = li.previousElementSibling;
    if (prev && mid < top() + prev.offsetTop + prev.offsetHeight / 2) { flip(prev, () => prev.before(li)); continue; }
    break;
  }
  li.style.transform = `translateY(${want - (top() + li.offsetTop)}px)`;
}

/** Gulir otomatis saat kursor mendekati tepi atas/bawah popup. */
function autoScroll() {
  if (!drag?.active) return;
  const edge = 44;
  const topEdge = ($('.bar')?.getBoundingClientRect().bottom || 0) + edge;
  const bottomEdge = window.innerHeight - edge;
  const dy = drag.y < topEdge ? -Math.ceil((topEdge - drag.y) / 3) : drag.y > bottomEdge ? Math.ceil((drag.y - bottomEdge) / 3) : 0;
  if (dy) {
    const before = window.scrollY;
    window.scrollBy(0, dy);
    if (window.scrollY !== before) layoutDrag();
  }
}

function onDragEnd(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragEnd);
  if (!d.active) return;
  clearInterval(d.scroller);
  const offset = d.li.style.transform;
  d.li.style.transform = '';
  d.li.classList.remove('dragging');
  document.body.classList.remove('is-dragging');
  if (offset) d.li.animate([{ transform: offset }, { transform: 'none' }], { duration: 120, easing: 'ease-out' });
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 0);
  const ids = listIds();
  if (e.type === 'pointercancel' || ids.join() === d.startIds.join()) {
    if (e.type === 'pointercancel') renderList();
  } else {
    saveOrder(ids);
  }
  if (refreshAfterDrag) {
    refreshAfterDrag = false;
    reloadAccounts();
  }
}

function moveByKey(li, dir) {
  if (query.trim() || drag) return;
  const sib = dir < 0 ? li.previousElementSibling : li.nextElementSibling;
  if (!sib) return;
  flip(sib, () => (dir < 0 ? sib.before(li) : sib.after(li)));
  li.focus();
  li.scrollIntoView({ block: 'nearest' });
  saveOrder(listIds());
}

async function saveOrder(ids) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  accounts = ids.map((id) => byId.get(id)).filter(Boolean).concat(accounts.filter((a) => !ids.includes(a.id)));
  try {
    await vault.reorderAccounts(ids);
  } catch (e) {
    toast(e.message, 'warn');
    reloadAccounts();
  }
}

/** Muat ulang dari brankas; tampilkan ulang hanya jika ada yang berubah. */
async function reloadAccounts() {
  if ((await vault.status()) !== 'unlocked') return;
  const fresh = await vault.loadAccounts();
  if (JSON.stringify(fresh) === JSON.stringify(accounts)) return;
  if (drag?.active) { refreshAfterDrag = true; return; }
  accounts = fresh;
  if (view === 'main') showMain();
}

// ---------- Ubah / hapus ----------

async function editAccount(a) {
  const issuer = h('input', { id: 'e-issuer', value: a.issuer });
  const name = h('input', { id: 'e-name', value: a.name });
  const secret = h('code', { class: 'secret', hidden: true }, a.secret.replace(/(.{4})/g, '$1 ').trim());
  const body = h('div', { class: 'stack' },
    h('label', { for: 'e-issuer' }, t('issuerLabel')), issuer,
    h('label', { for: 'e-name' }, t('accountName')), name,
    h('p', { class: 'muted small' },
      `${a.type.toUpperCase()} · ${a.algorithm} · ${t('digitsN', { n: a.digits })} · ${a.type === 'totp' ? t('periodSec', { n: a.period }) : t('counterN', { n: a.counter })}`),
    h('button', { type: 'button', class: 'link', onclick: (e) => {
      secret.hidden = !secret.hidden;
      e.target.textContent = secret.hidden ? t('showSecret') : t('hideSecret');
    } }, t('showSecret')),
    secret,
    h('button', { type: 'button', class: 'link danger', onclick: (e) => {
      wantDelete = true;
      e.target.closest('dialog').querySelector('.btn.ghost').click();
    } }, t('deleteThis')));
  let wantDelete = false;
  const save = await dialog({ heading: t('editTitle'), body, ok: t('save') });
  if (wantDelete) {
    const ok = await dialog({
      heading: t('deleteTitle', { name: title(a) }),
      body: t('deleteBody'),
      ok: t('delete'), danger: true,
    });
    if (!ok) return;
    await vault.deleteAccount(a.id);
    return toast(t('deleted'));
  }
  if (!save) return;
  await vault.updateAccount({ ...a, issuer: issuer.value.trim(), name: name.value.trim() });
}

// ---------- Pindai QR di tab aktif ----------

async function scanTab() {
  let url;
  try {
    url = await chrome.tabs.captureVisibleTab({ format: 'png' });
  } catch {
    return toast(t('scanBlocked'), 'warn');
  }
  const text = await decodeDataUrl(url);
  if (!text) return toast(t('noQrOnTab'), 'warn');
  const res = parseAnyText(text);
  if (!res.accounts.length) return toast(res.errors[0] || t('notTwoFa'), 'warn');
  const have = new Set(accounts.map(accountKey));
  const fresh = res.accounts.filter((a) => !have.has(accountKey(a)));
  if (!fresh.length) return toast(t('alreadySaved'));
  const ok = await dialog({
    heading: t('addNTitle', { n: fresh.length }),
    body: h('ul', { class: 'mini-list' }, fresh.map((a) => h('li', {}, avatar(title(a)),
      h('div', {}, h('strong', {}, title(a)), subtitle(a) && h('div', { class: 'muted small' }, subtitle(a)))))),
    ok: t('add'),
  });
  if (!ok) return;
  const { added } = await vault.addAccounts(fresh);
  toast(t('addedN', { n: added }));
}

// ---------- Pengaturan ----------

async function showSettings() {
  view = 'settings';
  clearInterval(timer);
  const settings = await vault.getSettings();
  const lockSel = h('select', { id: 'autolock', onchange: (e) => vault.setSettings({ autoLockMinutes: Number(e.target.value) }) },
    [[0, t('lockOnClose')], [5, t('lockAfter5')], [15, t('lockAfter15')], [60, t('lockAfter60')]].map(([v, label]) =>
      h('option', { value: v, selected: settings.autoLockMinutes === v }, label)));
  const pref = await languagePref();
  const langSel = h('select', { id: 'language', onchange: async (e) => {
    await vault.setSettings({ language: e.target.value });
    setLang(e.target.value);
    showSettings();
  } },
    [['auto', t('langAuto')], ...LANGUAGES].map(([v, label]) => h('option', { value: v, selected: pref === v }, label)));

  root.replaceChildren(
    h('header', { class: 'bar' },
      h('button', { class: 'icon-btn', 'aria-label': t('back'), onclick: showMain }, icon(ICONS.back)),
      h('div', { class: 'brand' }, t('settings')), h('div')),
    h('div', { class: 'settings' },
      h('section', {},
        h('label', { for: 'language' }, t('language')), langSel),
      h('section', {},
        h('label', { for: 'autolock' }, t('autoLock')), lockSel,
        h('p', { class: 'muted small' }, t('autoLockNote'))),
      h('section', { id: 'sync-section' }),
      h('section', {},
        h('button', { class: 'btn ghost block', onclick: () => openImportPage() }, t('addImport')),
        h('button', { class: 'btn ghost block', onclick: () => openImportPage('#backup') }, t('backupBtn')),
        h('button', { class: 'btn ghost block', onclick: changePassword }, t('changePassword')),
        h('button', { class: 'btn ghost block', onclick: async () => { await vault.lock(); start(); } }, t('lockNow'))),
      h('section', {},
        h('button', { class: 'link danger', onclick: confirmReset }, t('resetLink')),
        h('p', { class: 'muted small' }, t(settings.syncEnabled ? 'footerSynced' : 'footerLocal', { n: accounts.length })))));
  renderSyncSection();
}

// ---------- Sinkron antar laptop ----------

function statusText(s) {
  if (!s) return t('syncNever');
  const by = s.by || t('otherDevice');
  switch (s.state) {
    case 'ok': return t('syncOk', { checked: ago(s.checkedAt), by, at: ago(s.at) });
    case 'pending': return t('syncPending');
    case 'conflict': return t('syncConflict', { by });
    case 'error': return t('syncError', { msg: s.message });
    default: return '';
  }
}

async function renderSyncSection() {
  const box = $('#sync-section');
  if (!box) return;
  const { syncEnabled } = await vault.getSettings();
  const status = await vault.syncStatus();
  const toggle = h('input', { type: 'checkbox', id: 'sync-on', checked: syncEnabled, onchange: async (e) => {
    e.target.disabled = true;
    const res = await vault.setSyncEnabled(e.target.checked);
    if (res?.state === 'conflict') await joinDialog(res);
    renderSyncSection();
  } });
  box.replaceChildren(...[
    h('label', { class: 'switch', for: 'sync-on' }, toggle, h('span', {}, t('syncToggle'))),
    h('p', { class: 'muted small' }, t('syncNote')),
    syncEnabled && h('p', { class: `small ${status?.state === 'ok' ? 'ok-text' : status?.state === 'conflict' || status?.state === 'error' ? 'error' : 'muted'}` }, statusText(status)),
    syncEnabled && h('div', { class: 'row wrap' },
      status?.state === 'conflict' && h('button', { class: 'btn primary', onclick: () => joinDialog(status).then(renderSyncSection) }, t('mergeEllipsis')),
      h('button', { class: 'btn ghost', onclick: async (e) => {
        e.target.disabled = true;
        e.target.textContent = t('syncing');
        await vault.syncNow();
        renderSyncSection();
      } }, t('syncNow'))),
    syncEnabled && h('button', { class: 'link danger small', onclick: clearRemoteDialog }, t('clearRemote')),
  ].filter(Boolean)); // false dari `syncEnabled && …` jangan jadi teks "false"
}

async function joinDialog(info) {
  const pw = h('input', { type: 'password', id: 'join-pw', autocomplete: 'off' });
  let overwrite = false;
  const ok = await dialog({
    heading: t('joinTitle'),
    body: h('div', { class: 'stack' },
      h('p', { class: 'muted' }, t('joinBody', { by: info.by || t('otherDevice') })),
      h('label', { for: 'join-pw' }, t('syncVaultPassword')), pw,
      h('button', { type: 'button', class: 'link danger small', onclick: (e) => {
        overwrite = true;
        e.target.closest('dialog').querySelector('.btn.ghost').click();
      } }, t('joinForgot'))),
    ok: t('merge'),
  });
  if (overwrite) {
    const sure = await dialog({
      heading: t('overwriteTitle'),
      body: t('overwriteBody'),
      ok: t('overwrite'), danger: true,
    });
    if (sure) {
      await vault.overwriteRemote();
      toast(t('overwritten'));
    }
    return;
  }
  if (!ok) return;
  toast(t('merging'));
  try {
    if (await vault.joinRemote(pw.value)) toast(t('merged'));
    else toast(t('wrongPasswordShort'), 'warn');
  } catch (e) {
    toast(e.message, 'warn');
  }
}

async function clearRemoteDialog() {
  const ok = await dialog({
    heading: t('clearRemoteTitle'),
    body: t('clearRemoteBody'),
    ok: t('clearRemoteOk'), danger: true,
  });
  if (!ok) return;
  await vault.clearRemote();
  toast(t('clearedRemote'));
  renderSyncSection();
}

function renderBanner(s) {
  const b = $('#sync-banner');
  if (!b) return;
  const bad = s && (s.state === 'conflict' || s.state === 'error');
  b.hidden = !bad;
  if (!bad) return;
  b.replaceChildren(
    h('span', {}, s.state === 'conflict' ? t('bannerConflict') : t('syncError', { msg: s.message })),
    h('button', { class: 'link', onclick: showSettings }, t('manage')));
}

async function changePassword() {
  const oldPw = h('input', { type: 'password', id: 'old-pw', autocomplete: 'current-password' });
  const newPw = h('input', { type: 'password', id: 'new-pw', autocomplete: 'new-password' });
  const newPw2 = h('input', { type: 'password', id: 'new-pw2', autocomplete: 'new-password' });
  const ok = await dialog({
    heading: t('changePassword'),
    body: h('div', { class: 'stack' },
      h('label', { for: 'old-pw' }, t('oldPassword')), oldPw,
      h('label', { for: 'new-pw' }, t('newPasswordMin')), newPw,
      h('label', { for: 'new-pw2' }, t('repeatNewPassword')), newPw2),
    ok: t('save'),
  });
  if (!ok) return;
  if (newPw.value.length < 8) return toast(t('newPwMin'), 'warn');
  if (newPw.value !== newPw2.value) return toast(t('newPwMismatch'), 'warn');
  toast(t('saving'));
  if (await vault.changePassword(oldPw.value, newPw.value)) toast(t('pwChanged'));
  else toast(t('oldPwWrong'), 'warn');
}

// ---------- Sinkron dengan halaman import / tab lain ----------

let syncTimer;
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'session' && 'vaultKey' in changes && !changes.vaultKey.newValue) return start();
  if (area === 'sync') {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => vault.syncNow(), 400);
    return;
  }
  if (area !== 'local') return;
  if (changes.syncStatus) {
    renderBanner(changes.syncStatus.newValue);
    if (view === 'settings') renderSyncSection();
  }
  if (changes.vault) await reloadAccounts();
});

start();
