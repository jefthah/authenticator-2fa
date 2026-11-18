import * as vault from './vault.js';
import { parseAnyText, accountKey, makeAccount } from './core.js';
import { decodeBlob, decodeVideoFrame, warmUp } from './qr.js';
import { $, h, toast, avatar, title, subtitle, authForm } from './ui.js';

const pending = new Map(); // accountKey -> { account, checked, dup }
const batches = new Map(); // batchId -> { size, seen: Set<index> }
let existing = new Set();

// ---------- Mulai ----------

async function start() {
  const st = await vault.status();
  if (st !== 'unlocked') {
    $('#app').hidden = true;
    await authForm($('#auth'), st);
  }
  $('#auth').remove();
  $('#app').hidden = false;
  existing = await vault.existingKeys();
  await vault.touch();
  warmUp();
  setupTabs();
  selectTab(location.hash === '#backup' ? 'backup' : 'camera');
}

function setupTabs() {
  for (const b of document.querySelectorAll('[role=tab]')) b.addEventListener('click', () => selectTab(b.dataset.tab));
}

function selectTab(name) {
  for (const b of document.querySelectorAll('[role=tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== name;
  if (name !== 'camera') stopCamera();
}

// ---------- Daftar tunggu ----------

/** Masukkan hasil baca (teks QR / link) ke daftar. */
function ingest(text) {
  const res = parseAnyText(text);
  let added = 0;
  for (const b of res.batches) {
    if (b.size <= 1) continue;
    const entry = batches.get(b.id) || { size: b.size, seen: new Set() };
    entry.seen.add(b.index);
    batches.set(b.id, entry);
  }
  for (const a of res.accounts) added += addPending(a);
  renderPending();
  return { res, added };
}

/** Kembalikan 1 jika akun baru (belum tersimpan & belum di daftar). */
function addPending(a) {
  const k = accountKey(a);
  if (pending.has(k)) return 0;
  const dup = existing.has(k);
  pending.set(k, { account: a, checked: !dup, dup });
  $('#done').hidden = true;
  return dup ? 0 : 1;
}

const newText = (n) => (n ? `${n} baru` : 'tidak ada yang baru');

function renderPending() {
  const box = $('#pending');
  box.hidden = pending.size === 0;
  const items = [...pending.values()];
  const selected = items.filter((p) => p.checked).length;
  $('#pending-count').textContent = `${selected} dipilih dari ${items.length}`;
  $('#save').textContent = selected ? `Simpan ${selected} akun` : 'Simpan';
  $('#save').disabled = !selected;

  $('#batches').replaceChildren(...[...batches.values()].map((b) => {
    const chips = Array.from({ length: b.size }, (_, i) =>
      h('span', { class: `chip ${b.seen.has(i) ? 'ok' : ''}` }, `QR ${i + 1} ${b.seen.has(i) ? '✓' : '—'}`));
    const missing = b.size - b.seen.size;
    return h('div', { class: 'batch' }, h('span', { class: 'muted small' }, 'Ekspor Google:'), ...chips,
      missing ? h('span', { class: 'muted small' }, `· ${missing} QR belum dipindai`) : h('span', { class: 'small ok-text' }, '· lengkap'));
  }));

  $('#pending-list').replaceChildren(...items.map((p) => {
    const a = p.account;
    const extras = [a.type === 'hotp' && 'HOTP', a.algorithm !== 'SHA1' && a.algorithm, a.digits !== 6 && `${a.digits} digit`,
      a.type === 'totp' && a.period !== 30 && `${a.period} dtk`].filter(Boolean);
    const cb = h('input', { type: 'checkbox', checked: p.checked, disabled: p.dup, 'aria-label': `Pilih ${title(a)}`,
      onchange: (e) => { p.checked = e.target.checked; renderPending(); } });
    return h('li', { class: p.dup ? 'dup' : '' },
      h('label', {}, cb, avatar(title(a)),
        h('div', { class: 'meta' }, h('strong', {}, title(a)), subtitle(a) && h('span', { class: 'muted small' }, subtitle(a))),
        ...extras.map((x) => h('span', { class: 'tag' }, x)),
        p.dup && h('span', { class: 'tag muted' }, 'Sudah ada')));
  }));
}

$('#toggle-all').addEventListener('click', () => {
  const items = [...pending.values()].filter((p) => !p.dup);
  const all = items.every((p) => p.checked);
  for (const p of items) p.checked = !all;
  renderPending();
});

$('#clear').addEventListener('click', () => {
  pending.clear();
  batches.clear();
  renderPending();
});

$('#save').addEventListener('click', async () => {
  const chosen = [...pending.values()].filter((p) => p.checked).map((p) => p.account);
  const incomplete = [...batches.values()].some((b) => b.seen.size < b.size);
  if (incomplete && !confirm('Masih ada QR ekspor yang belum dipindai. Simpan yang sudah ada dulu?')) return;
  const btn = $('#save');
  btn.disabled = true;
  try {
    const { added } = await vault.addAccounts(chosen);
    existing = await vault.existingKeys();
    pending.clear();
    batches.clear();
    renderPending();
    stopCamera();
    const done = $('#done');
    done.replaceChildren(
      h('h2', {}, `${added} akun tersimpan ✓`),
      h('p', {}, 'Klik ikon ekstensi di toolbar Chrome untuk melihat kode. Tips: klik ikon puzzle 🧩 lalu pin ekstensi ini supaya selalu terlihat.'),
      h('button', { class: 'btn ghost', onclick: () => window.close() }, 'Tutup tab ini'));
    done.hidden = false;
    done.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    toast(e.message, 'warn');
  } finally {
    btn.disabled = false;
  }
});

// ---------- Kamera ----------

const video = $('#video');
let stream = null;
let loopTimer = null;
const scanned = new Set();

function cameraStatus(text, kind = '') {
  const el = $('#camera-status');
  el.textContent = text;
  el.className = kind || 'muted';
}

async function startCamera(deviceId) {
  stopCamera();
  cameraStatus('Menyalakan kamera…');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (e) {
    stream = null;
    return cameraStatus(e.name === 'NotAllowedError'
      ? 'Izin kamera ditolak. Klik ikon kamera di address bar untuk mengizinkan, atau pakai tab Gambar QR.'
      : 'Kamera tidak ditemukan / sedang dipakai aplikasi lain. Pakai tab Gambar QR sebagai gantinya.', 'error');
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  $('#camera-idle').hidden = true;
  $('#camera-stop').hidden = false;
  cameraStatus('Arahkan QR di layar HP ke kamera, jarak ±20–30 cm. Naikkan kecerahan layar HP dan tahan diam.');
  await fillCameraList(stream.getVideoTracks()[0]?.getSettings().deviceId);
  const mine = stream;
  const loop = async () => {
    if (stream !== mine) return;
    const text = await decodeVideoFrame(video);
    if (stream !== mine) return;
    if (text) onCameraText(text);
    loopTimer = setTimeout(loop, 100);
  };
  loop();
}

function onCameraText(text) {
  if (scanned.has(text)) return;
  scanned.add(text);
  const { res, added } = ingest(text);
  if (!res.accounts.length) return cameraStatus(`QR terbaca, tapi bukan kode 2FA. ${res.errors[0] || ''}`, 'error');
  const b = res.batches[0];
  const part = b && b.size > 1 ? `QR ${b.index + 1} dari ${b.size}` : 'QR';
  const left = b && b.size > 1 ? b.size - batches.get(b.id).seen.size : 0;
  cameraStatus(`${part} terbaca: ${res.accounts.length} akun (${newText(added)}).${left ? ` Geser ke QR berikutnya (${left} lagi).` : ' Periksa daftar di bawah lalu Simpan.'}`, 'ok-text');
  const frame = $('.camera');
  frame.classList.remove('hit');
  void frame.offsetWidth;
  frame.classList.add('hit');
}

async function fillCameraList(activeId) {
  const sel = $('#camera-select');
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  sel.hidden = cams.length < 2;
  sel.replaceChildren(...cams.map((c, i) => h('option', { value: c.deviceId, selected: c.deviceId === activeId }, c.label || `Kamera ${i + 1}`)));
}

function stopCamera() {
  clearTimeout(loopTimer);
  if (stream) for (const t of stream.getTracks()) t.stop();
  stream = null;
  video.srcObject = null;
  $('#camera-idle').hidden = false;
  $('#camera-stop').hidden = true;
  cameraStatus('Kamera mati.');
}

$('#camera-start').addEventListener('click', () => startCamera());
$('#camera-stop').addEventListener('click', stopCamera);
$('#camera-select').addEventListener('change', (e) => startCamera(e.target.value));
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });

// ---------- Gambar ----------

async function handleImages(files) {
  const list = $('#image-results');
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const li = h('li', {}, h('strong', {}, file.name || 'Gambar dari clipboard'), h('span', { class: 'muted' }, ' — membaca…'));
    list.prepend(li);
    let text = null;
    try {
      text = await decodeBlob(file);
    } catch {
      /* gambar rusak */
    }
    const msg = li.lastChild;
    if (!text) {
      msg.textContent = ' — QR tidak terbaca. Pastikan seluruh QR terlihat utuh (termasuk tepinya), tajam, dan tidak silau.';
      msg.className = 'error';
      continue;
    }
    const { res, added } = ingest(text);
    if (!res.accounts.length) {
      msg.textContent = ` — bukan QR 2FA. ${res.errors[0] || ''}`;
      msg.className = 'error';
    } else {
      const b = res.batches[0];
      msg.textContent = ` — ${b && b.size > 1 ? `QR ${b.index + 1}/${b.size}, ` : ''}${res.accounts.length} akun (${newText(added)})`;
      msg.className = 'ok-text';
    }
  }
}

$('#file').addEventListener('change', (e) => { handleImages([...e.target.files]); e.target.value = ''; });
const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  handleImages([...e.dataTransfer.files]);
});

document.addEventListener('paste', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) {
    e.preventDefault();
    selectTab('image');
    handleImages(files);
    return;
  }
  const text = e.clipboardData?.getData('text') || '';
  if (/otpauth(-migration)?:\/\//i.test(text)) {
    e.preventDefault();
    selectTab('text');
    $('#uri').value = text;
    readUri();
  }
});

// ---------- Link / teks ----------

function readUri() {
  const text = $('#uri').value;
  const status = $('#uri-status');
  if (!text.trim()) return;
  const { res, added } = ingest(text);
  status.textContent = res.accounts.length
    ? `${res.accounts.length} akun terbaca (${newText(added)}).${res.errors.length ? ` Dilewati: ${res.errors.join('; ')}` : ''}`
    : res.errors.join('; ');
  status.className = res.accounts.length ? 'ok-text' : 'error';
  if (res.accounts.length) $('#uri').value = '';
}
$('#uri-read').addEventListener('click', readUri);

// ---------- Manual ----------

$('#manual').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const err = $('#manual-error');
  err.textContent = '';
  if (!f.issuer.trim() && !f.name.trim()) return (err.textContent = 'Isi nama layanan atau nama akun.');
  let a;
  try {
    a = makeAccount(f);
  } catch (e2) {
    return (err.textContent = e2.message);
  }
  if (pending.has(accountKey(a)) || existing.has(accountKey(a))) return (err.textContent = 'Akun dengan secret ini sudah ada.');
  addPending(a);
  renderPending();
  e.target.reset();
  toast(`${title(a)} ditambahkan ke daftar. Klik Simpan di bawah.`);
});

// ---------- Cadangan ----------

$('#export').addEventListener('click', async () => {
  try {
    const json = await vault.exportBackup();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = h('a', { href: url, download: `authenticator-cadangan-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    toast(e.message, 'warn');
  }
});

$('#restore').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const err = $('#restore-error');
  err.textContent = '';
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    const list = await vault.readBackup(await form.file.files[0].text(), form.password.value);
    let added = 0;
    for (const raw of list) {
      try { added += addPending(makeAccount(raw)); } catch { /* lewati akun rusak */ }
    }
    renderPending();
    form.reset();
    toast(`${list.length} akun dibaca dari cadangan (${newText(added)})`);
  } catch (e2) {
    err.textContent = e2.message;
  } finally {
    btn.disabled = false;
  }
});

// Brankas dikunci dari popup → muat ulang halaman supaya minta password lagi.
// Perubahan dari laptop lain / popup → perbarui penanda "Sudah ada".
let syncTimer;
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'session' && 'vaultKey' in changes && !changes.vaultKey.newValue) return location.reload();
  if (area === 'sync') {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => vault.syncNow(), 400);
  }
  if (area === 'local' && changes.vault && $('#auth') === null && (await vault.status()) === 'unlocked') {
    existing = await vault.existingKeys();
    for (const [k, p] of pending) {
      p.dup = existing.has(k);
      if (p.dup) p.checked = false;
    }
    renderPending();
  }
});

start();
