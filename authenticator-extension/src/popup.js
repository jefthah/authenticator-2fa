import * as vault from './vault.js';
import { generateCode, formatCode, secondsRemaining, totpStep, parseAnyText, accountKey } from './core.js';
import { decodeDataUrl } from './qr.js';
import { $, h, toast, avatar, title, subtitle, authForm, icon, ICONS, dialog, confirmReset, ago } from './ui.js';

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
    type: 'search', id: 'search', placeholder: 'Cari akun…', value: query, autocomplete: 'off',
    oninput: (e) => { query = e.target.value; renderList(); },
  });
  root.replaceChildren(
    header(
      iconBtn('scan', 'Pindai QR di tab ini', scanTab),
      iconBtn('plus', 'Tambah / import akun', () => openImportPage()),
      iconBtn('gear', 'Pengaturan', showSettings)),
    h('div', { id: 'sync-banner', class: 'banner', hidden: true }),
    accounts.length > 3 ? h('div', { class: 'search' }, icon(ICONS.search, 16), search) : '',
    h('ul', { id: 'list', class: 'list' }),
  );
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
      h('h2', {}, 'Belum ada akun'),
      h('p', { class: 'muted' }, 'Pindahkan semua akun dari Google Authenticator di HP sekaligus lewat QR ekspor.'),
      h('button', { class: 'btn primary block', onclick: () => openImportPage() }, 'Import dari Google Authenticator'),
      h('button', { class: 'btn ghost block', onclick: scanTab }, 'Pindai QR di tab ini')));
    return;
  }
  if (!shown.length) {
    list.replaceChildren(h('li', { class: 'none muted' }, `Tidak ada akun yang cocok dengan “${query}”.`));
    return;
  }
  list.replaceChildren(...shown.map(row));
  tick(true);
}

function row(a) {
  const code = h('div', { class: 'code' }, '••• •••');
  const secs = h('span', { class: 'secs' });
  let ring;
  if (a.type === 'hotp') {
    ring = h('button', { class: 'icon-btn hotp', title: 'Kode berikutnya', 'aria-label': 'Kode berikutnya',
      onclick: (e) => { e.stopPropagation(); nextHotp(a); } }, icon(ICONS.refresh, 18));
  } else {
    ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 24 24');
    ring.setAttribute('class', 'ring');
    ring.innerHTML = `<circle cx="12" cy="12" r="9" class="track"/><circle cx="12" cy="12" r="9" class="fill" stroke-dasharray="${RING}"/>`;
  }
  const li = h('li', {
    class: 'item', tabindex: 0, 'data-id': a.id,
    onclick: () => copy(a),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy(a); } },
  },
  avatar(title(a)),
  h('div', { class: 'meta' },
    h('div', { class: 'issuer' }, title(a)),
    subtitle(a) && h('div', { class: 'name' }, subtitle(a)),
    code),
  h('div', { class: 'timer' }, ring, a.type === 'hotp' ? '' : secs),
  h('button', { class: 'icon-btn more', title: 'Ubah / hapus', 'aria-label': 'Ubah atau hapus akun',
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
    toast(`Kode ${title(a)} disalin`);
    vault.touch();
  } catch {
    toast('Gagal menyalin ke clipboard', 'warn');
  }
}

async function nextHotp(a) {
  await vault.updateAccount({ ...a, counter: (a.counter || 0) + 1 });
}

// ---------- Ubah / hapus ----------

async function editAccount(a) {
  const issuer = h('input', { id: 'e-issuer', value: a.issuer });
  const name = h('input', { id: 'e-name', value: a.name });
  const secret = h('code', { class: 'secret', hidden: true }, a.secret.replace(/(.{4})/g, '$1 ').trim());
  const body = h('div', { class: 'stack' },
    h('label', { for: 'e-issuer' }, 'Layanan'), issuer,
    h('label', { for: 'e-name' }, 'Nama akun'), name,
    h('p', { class: 'muted small' },
      `${a.type.toUpperCase()} · ${a.algorithm} · ${a.digits} digit${a.type === 'totp' ? ` · ${a.period} detik` : ` · counter ${a.counter}`}`),
    h('button', { type: 'button', class: 'link', onclick: (e) => {
      secret.hidden = !secret.hidden;
      e.target.textContent = secret.hidden ? 'Tampilkan secret' : 'Sembunyikan secret';
    } }, 'Tampilkan secret'),
    secret,
    h('button', { type: 'button', class: 'link danger', onclick: (e) => {
      wantDelete = true;
      e.target.closest('dialog').querySelector('.btn.ghost').click();
    } }, 'Hapus akun ini'));
  let wantDelete = false;
  const save = await dialog({ heading: 'Ubah akun', body, ok: 'Simpan' });
  if (wantDelete) {
    const ok = await dialog({
      heading: `Hapus ${title(a)}?`,
      body: 'Pastikan 2FA akun ini masih ada di HP atau sudah dimatikan di situsnya, supaya Anda tidak terkunci.',
      ok: 'Hapus', danger: true,
    });
    if (!ok) return;
    await vault.deleteAccount(a.id);
    return toast('Akun dihapus');
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
    return toast('Halaman ini tidak bisa dipindai', 'warn');
  }
  const text = await decodeDataUrl(url);
  if (!text) return toast('Tidak ada QR yang terlihat di tab ini', 'warn');
  const res = parseAnyText(text);
  if (!res.accounts.length) return toast(res.errors[0] || 'QR ini bukan kode 2FA', 'warn');
  const have = new Set(accounts.map(accountKey));
  const fresh = res.accounts.filter((a) => !have.has(accountKey(a)));
  if (!fresh.length) return toast('Akun di QR ini sudah tersimpan');
  const ok = await dialog({
    heading: `Tambahkan ${fresh.length} akun?`,
    body: h('ul', { class: 'mini-list' }, fresh.map((a) => h('li', {}, avatar(title(a)),
      h('div', {}, h('strong', {}, title(a)), subtitle(a) && h('div', { class: 'muted small' }, subtitle(a)))))),
    ok: 'Tambahkan',
  });
  if (!ok) return;
  const { added } = await vault.addAccounts(fresh);
  toast(`${added} akun ditambahkan`);
}

// ---------- Pengaturan ----------

async function showSettings() {
  view = 'settings';
  clearInterval(timer);
  const settings = await vault.getSettings();
  const lockSel = h('select', { id: 'autolock', onchange: (e) => vault.setSettings({ autoLockMinutes: Number(e.target.value) }) },
    [[0, 'Saat browser ditutup'], [5, 'Setelah 5 menit'], [15, 'Setelah 15 menit'], [60, 'Setelah 1 jam']].map(([v, t]) =>
      h('option', { value: v, selected: settings.autoLockMinutes === v }, t)));

  root.replaceChildren(
    h('header', { class: 'bar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Kembali', onclick: showMain }, icon(ICONS.back)),
      h('div', { class: 'brand' }, 'Pengaturan'), h('div')),
    h('div', { class: 'settings' },
      h('section', {},
        h('label', { for: 'autolock' }, 'Kunci otomatis'), lockSel,
        h('p', { class: 'muted small' }, 'Brankas selalu terkunci lagi saat browser ditutup.')),
      h('section', { id: 'sync-section' }),
      h('section', {},
        h('button', { class: 'btn ghost block', onclick: () => openImportPage() }, 'Tambah / import akun'),
        h('button', { class: 'btn ghost block', onclick: () => openImportPage('#backup') }, 'Cadangan (ekspor / pulihkan)'),
        h('button', { class: 'btn ghost block', onclick: changePassword }, 'Ganti password'),
        h('button', { class: 'btn ghost block', onclick: async () => { await vault.lock(); start(); } }, 'Kunci sekarang')),
      h('section', {},
        h('button', { class: 'link danger', onclick: confirmReset }, 'Reset brankas (hapus semua akun)'),
        h('p', { class: 'muted small' }, `${accounts.length} akun · tersimpan terenkripsi${settings.syncEnabled ? ', disalin ke akun Chrome' : ' hanya di komputer ini'}.`))));
  renderSyncSection();
}

// ---------- Sinkron antar laptop ----------

function statusText(s) {
  if (!s) return 'Belum pernah sinkron.';
  switch (s.state) {
    case 'ok': return `✓ Tersinkron ${ago(s.checkedAt)}. Perubahan terakhir dari ${s.by || 'laptop lain'}, ${ago(s.at)}.`;
    case 'pending': return 'Menunggu data lengkap dari Chrome… Coba "Sinkron sekarang" sebentar lagi.';
    case 'conflict': return `Brankas di akun Chrome (dari ${s.by || 'laptop lain'}) memakai password lain. Klik Gabungkan.`;
    case 'error': return `Gagal sinkron: ${s.message}`;
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
  box.replaceChildren(
    h('label', { class: 'switch', for: 'sync-on' }, toggle, h('span', {}, 'Sinkron antar laptop')),
    h('p', { class: 'muted small' },
      'Lewat akun Google yang login di Chrome (Sinkronisasi → Ekstensi harus aktif). Yang dikirim hanya brankas terenkripsi; laptop lain tetap butuh password brankas.'),
    syncEnabled && h('p', { class: `small ${status?.state === 'ok' ? 'ok-text' : status?.state === 'conflict' || status?.state === 'error' ? 'error' : 'muted'}` }, statusText(status)),
    syncEnabled && h('div', { class: 'row wrap' },
      status?.state === 'conflict' && h('button', { class: 'btn primary', onclick: () => joinDialog(status).then(renderSyncSection) }, 'Gabungkan…'),
      h('button', { class: 'btn ghost', onclick: async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Menyinkron…';
        await vault.syncNow();
        renderSyncSection();
      } }, 'Sinkron sekarang')),
    syncEnabled && h('button', { class: 'link danger small', onclick: clearRemoteDialog }, 'Hapus salinan di akun Chrome'));
}

async function joinDialog(info) {
  const pw = h('input', { type: 'password', id: 'join-pw', autocomplete: 'off' });
  let overwrite = false;
  const ok = await dialog({
    heading: 'Gabungkan brankas',
    body: h('div', { class: 'stack' },
      h('p', { class: 'muted' },
        `Brankas di akun Chrome (dari ${info.by || 'laptop lain'}) memakai password yang berbeda. Masukkan password brankas itu. `
        + 'Akun dari kedua tempat akan digabung, lalu laptop ini ikut memakai password tersebut.'),
      h('label', { for: 'join-pw' }, 'Password brankas sinkron'), pw,
      h('button', { type: 'button', class: 'link danger small', onclick: (e) => {
        overwrite = true;
        e.target.closest('dialog').querySelector('.btn.ghost').click();
      } }, 'Lupa password itu? Timpa salinan sinkron dengan brankas laptop ini')),
    ok: 'Gabungkan',
  });
  if (overwrite) {
    const sure = await dialog({
      heading: 'Timpa salinan sinkron?',
      body: 'Salinan di akun Chrome diganti dengan brankas laptop ini. Akun yang hanya ada di laptop lain tidak ikut, dan laptop lain harus memasukkan password laptop ini untuk bergabung lagi.',
      ok: 'Timpa', danger: true,
    });
    if (sure) {
      await vault.overwriteRemote();
      toast('Salinan sinkron diganti');
    }
    return;
  }
  if (!ok) return;
  toast('Menggabungkan…');
  try {
    if (await vault.joinRemote(pw.value)) toast('Digabung. Mulai sekarang pakai password brankas sinkron.');
    else toast('Password salah', 'warn');
  } catch (e) {
    toast(e.message, 'warn');
  }
}

async function clearRemoteDialog() {
  const ok = await dialog({
    heading: 'Hapus salinan di akun Chrome?',
    body: 'Sinkron dimatikan dan salinan terenkripsi di akun Chrome dihapus. Akun di laptop ini tetap ada. Laptop lain yang sinkronnya masih aktif akan mengunggah salinannya lagi.',
    ok: 'Hapus salinan', danger: true,
  });
  if (!ok) return;
  await vault.clearRemote();
  toast('Salinan sinkron dihapus');
  renderSyncSection();
}

function renderBanner(s) {
  const b = $('#sync-banner');
  if (!b) return;
  const bad = s && (s.state === 'conflict' || s.state === 'error');
  b.hidden = !bad;
  if (!bad) return;
  b.replaceChildren(
    h('span', {}, s.state === 'conflict' ? 'Sinkron tertunda: password brankas berbeda dengan laptop lain.' : `Sinkron gagal: ${s.message}`),
    h('button', { class: 'link', onclick: showSettings }, 'Atur'));
}

async function changePassword() {
  const oldPw = h('input', { type: 'password', id: 'old-pw', autocomplete: 'current-password' });
  const newPw = h('input', { type: 'password', id: 'new-pw', autocomplete: 'new-password' });
  const newPw2 = h('input', { type: 'password', id: 'new-pw2', autocomplete: 'new-password' });
  const ok = await dialog({
    heading: 'Ganti password',
    body: h('div', { class: 'stack' },
      h('label', { for: 'old-pw' }, 'Password lama'), oldPw,
      h('label', { for: 'new-pw' }, 'Password baru (min. 8 karakter)'), newPw,
      h('label', { for: 'new-pw2' }, 'Ulangi password baru'), newPw2),
    ok: 'Simpan',
  });
  if (!ok) return;
  if (newPw.value.length < 8) return toast('Password baru minimal 8 karakter', 'warn');
  if (newPw.value !== newPw2.value) return toast('Password baru tidak sama', 'warn');
  toast('Menyimpan…');
  if (await vault.changePassword(oldPw.value, newPw.value)) toast('Password diganti');
  else toast('Password lama salah', 'warn');
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
  if (changes.vault && (await vault.status()) === 'unlocked') {
    accounts = await vault.loadAccounts();
    if (view === 'main') showMain();
  }
});

start();
