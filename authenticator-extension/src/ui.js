// Helper UI bersama untuk popup dan halaman import.
import * as vault from './vault.js';
import { t, dateLocale } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

let toastTimer;
export function toast(msg, kind = '') {
  let el = $('#toast');
  if (!el) document.body.append((el = h('div', { id: 'toast', role: 'status' })));
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 2200);
}

const PALETTE = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#0891b2', '#4f46e5'];
export function avatar(label) {
  const text = (label || '?').trim();
  let hash = 0;
  for (const ch of text.toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return h('div', { class: 'avatar', style: `--av:${PALETTE[hash % PALETTE.length]}`, 'aria-hidden': 'true' },
    [...text][0]?.toUpperCase() || '?');
}

export const title = (a) => a.issuer || a.name;
export const subtitle = (a) => (a.issuer ? a.name : '');

export function ago(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return t('justNow');
  if (s < 3600) return t('minutesAgo', { n: Math.floor(s / 60) });
  if (s < 86400) return t('hoursAgo', { n: Math.floor(s / 3600) });
  return new Date(ts).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Tampilkan form buat-password / buka-kunci di dalam `root`.
 * Di laptop baru yang sudah punya brankas di akun Chrome, tawarkan memakainya.
 * Resolve setelah brankas terbuka.
 */
export async function authForm(root, state) {
  if (state === 'new') {
    let remote = null;
    try { remote = await vault.remoteInfo(); } catch { /* sinkron tidak tersedia */ }
    if (remote && (await adoptForm(root, remote)) === 'adopted') return;
  }
  return passwordForm(root, state);
}

function adoptForm(root, remote) {
  return new Promise((resolve) => {
    const err = h('p', { class: 'error', role: 'alert' });
    const pw = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, t('adoptUse'));
    const form = h('form', { class: 'auth', onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      btn.disabled = true;
      btn.textContent = t('opening');
      try {
        if (await vault.adoptRemote(pw.value)) return resolve('adopted');
        err.textContent = t('wrongPassword');
        pw.select();
      } catch (e2) {
        err.textContent = e2.message;
      } finally {
        btn.disabled = false;
        btn.textContent = t('adoptUse');
      }
    } },
      h('div', { class: 'auth-icon', 'aria-hidden': 'true' }, icon(ICONS.sync, 28)),
      h('h1', {}, t('adoptTitle')),
      h('p', { class: 'muted' }, t('adoptBody', { by: remote.by || t('otherDevice'), ago: ago(remote.at) })),
      h('label', { for: 'pw' }, t('vaultPassword')), pw,
      err, btn,
      h('button', { type: 'button', class: 'link', onclick: () => resolve('new') }, t('adoptSkip')));
    root.replaceChildren(form);
    pw.focus();
  });
}

function passwordForm(root, state) {
  return new Promise((resolve) => {
    const isNew = state === 'new';
    const err = h('p', { class: 'error', role: 'alert' });
    const pw = h('input', { type: 'password', id: 'pw', autocomplete: isNew ? 'new-password' : 'current-password', required: true, minlength: isNew ? 8 : null });
    const pw2 = isNew ? h('input', { type: 'password', id: 'pw2', autocomplete: 'new-password', required: true }) : null;
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, isNew ? t('createVault') : t('unlock'));

    const form = h('form', { class: 'auth', onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (isNew && pw.value.length < 8) return (err.textContent = t('pwMin'));
      if (isNew && pw.value !== pw2.value) return (err.textContent = t('pwMismatch'));
      btn.disabled = true;
      btn.textContent = isNew ? t('preparing') : t('opening');
      try {
        if (isNew) await vault.setup(pw.value);
        else if (!(await vault.unlock(pw.value))) {
          err.textContent = t('wrongPassword');
          pw.select();
          return;
        }
        resolve();
      } catch (e2) {
        err.textContent = e2.message;
      } finally {
        btn.disabled = false;
        btn.textContent = isNew ? t('createVault') : t('unlock');
      }
    } },
      h('div', { class: 'auth-icon', 'aria-hidden': 'true' }, lockIcon()),
      h('h1', {}, isNew ? t('newVaultTitle') : t('lockedTitle')),
      h('p', { class: 'muted' }, isNew ? t('newVaultBody') : t('lockedBody')),
      h('label', { for: 'pw' }, t('password')), pw,
      isNew && h('label', { for: 'pw2' }, t('repeatPassword')), pw2,
      err, btn,
      !isNew && h('button', { type: 'button', class: 'link danger', onclick: confirmReset }, t('forgotReset')));
    root.replaceChildren(form);
    pw.focus();
  });
}

/** Dialog modal sederhana. `body` boleh berisi elemen. Resolve true jika OK. */
export function dialog({ heading, body, ok = t('ok'), cancel = t('cancel'), danger = false }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog' });
    const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(
      h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); close(true); } },
        h('h2', {}, heading),
        typeof body === 'string' ? h('p', { class: 'muted' }, body) : body,
        h('div', { class: 'row end' },
          cancel && h('button', { type: 'button', class: 'btn ghost', onclick: () => close(false) }, cancel),
          h('button', { type: 'submit', class: `btn ${danger ? 'danger' : 'primary'}` }, ok))));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(false); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export async function confirmReset() {
  const ok = await dialog({
    heading: t('resetTitle'),
    body: t('resetBody'),
    ok: t('resetOk'), danger: true,
  });
  if (ok) {
    await vault.resetAll();
    location.reload();
  }
}

export function icon(path, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = path;
  return svg;
}

export const ICONS = {
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
  gear: '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" stroke="currentColor" stroke-width="1.6" fill="none"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="2" fill="none"/>',
  back: '<path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  more: '<circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  search: '<circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  sync: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7M20 4v4.7h-4.7M20 12a8 8 0 0 1-13.7 5.6L4 15.3M4 20v-4.7h4.7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
};

function lockIcon() {
  return icon(ICONS.lock, 28);
}
