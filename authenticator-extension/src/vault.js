// Brankas terenkripsi: semua secret disimpan di chrome.storage.local dalam
// bentuk AES-GCM 256-bit. Kunci diturunkan dari password (PBKDF2-SHA256).
// Setelah dibuka, kunci disimpan di chrome.storage.session (hanya di memori,
// hilang saat browser ditutup) supaya tidak perlu mengetik password tiap kali.
//
// Sinkron (opsional): brankas yang SAMA (masih terenkripsi) disalin ke
// chrome.storage.sync, dipecah menjadi potongan ≤7 KB. Perangkat lain dengan
// password yang sama menggabungkannya per akun (lihat mergeVaults di core.js).

import { accountKey, mergeVaults, sameVault, pruneTombstones } from './core.js';

const ITERATIONS = 600000;
const CHUNK = 7000; // batas Chrome 8192 byte per item
const enc = new TextEncoder();
const dec = new TextDecoder();
const local = chrome.storage.local;
const session = chrome.storage.session;
const sync = chrome.storage.sync;

let memKey = null;

const toB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function encryptJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

async function decryptJson(key, iv, ct) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ct));
  return JSON.parse(dec.decode(pt));
}

async function readData(key, v) {
  const d = await decryptJson(key, v.iv, v.ct);
  return { accounts: d.accounts || [], deleted: d.deleted || {} };
}

async function rememberKey(key) {
  memKey = key;
  const raw = await crypto.subtle.exportKey('raw', key);
  await session.set({ vaultKey: toB64(raw), lastActive: Date.now() });
}

async function getVault() {
  return (await local.get('vault')).vault || null;
}

// ---------- Pengaturan ----------

export async function getSettings() {
  return { autoLockMinutes: 0, syncEnabled: false, ...((await local.get('settings')).settings || {}) };
}

export async function setSettings(patch) {
  await local.set({ settings: { ...(await getSettings()), ...patch } });
}

async function deviceName() {
  let { deviceName: name } = await getSettings();
  if (!name) {
    const p = (navigator.userAgentData?.platform || navigator.platform || 'Laptop').replace(/^Win\d*$/, 'Windows');
    name = `${p} ${crypto.getRandomValues(new Uint16Array(1))[0].toString(16).toUpperCase().padStart(4, '0')}`;
    await setSettings({ deviceName: name });
  }
  return name;
}

// ---------- Kunci / buka ----------

async function sessionKey() {
  const s = await session.get(['vaultKey', 'lastActive']);
  if (!s.vaultKey) { memKey = null; return null; }
  const { autoLockMinutes } = await getSettings();
  if (autoLockMinutes > 0 && Date.now() - (s.lastActive || 0) > autoLockMinutes * 60000) {
    await lock();
    return null;
  }
  if (!memKey) {
    memKey = await crypto.subtle.importKey('raw', fromB64(s.vaultKey), 'AES-GCM', true, ['encrypt', 'decrypt']);
  }
  return memKey;
}

async function needKey() {
  const key = await sessionKey();
  if (!key) throw new Error('Brankas terkunci');
  return key;
}

/** 'new' (belum dibuat) | 'locked' | 'unlocked' */
export async function status() {
  if (!(await getVault())) return 'new';
  return (await sessionKey()) ? 'unlocked' : 'locked';
}

export async function touch() {
  if (memKey) await session.set({ lastActive: Date.now() });
}

export async function setup(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, ITERATIONS);
  const body = await encryptJson(key, { accounts: [], deleted: {} });
  await local.set({ vault: { v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toB64(salt) }, ...body } });
  await rememberKey(key);
}

export async function unlock(password) {
  const vault = await getVault();
  if (!vault) throw new Error('Brankas belum dibuat');
  const key = await deriveKey(password, fromB64(vault.kdf.salt), vault.kdf.iterations);
  try {
    await decryptJson(key, vault.iv, vault.ct);
  } catch {
    return false;
  }
  await rememberKey(key);
  return true;
}

export async function lock() {
  memKey = null;
  await session.remove(['vaultKey', 'lastActive']);
}

// ---------- Akun ----------

export async function loadAccounts() {
  const key = await needKey();
  return (await readData(key, await getVault())).accounts;
}

export async function existingKeys() {
  return new Set((await loadAccounts()).map(accountKey));
}

/**
 * Ubah data brankas secara aman: baca data terbaru, jalankan `fn`, simpan.
 * Diulang bila tab lain menyimpan di saat yang sama.
 */
async function mutate(fn) {
  const key = await needKey();
  for (let i = 0; i < 5; i++) {
    const v = await getVault();
    const data = await readData(key, v);
    const result = fn(data);
    data.deleted = pruneTombstones(data.deleted);
    const body = await encryptJson(key, data);
    if ((await getVault()).ct !== v.ct) continue;
    await local.set({ vault: { ...v, ...body } });
    await syncNow().catch(() => {});
    return result;
  }
  throw new Error('Gagal menyimpan, coba lagi');
}

/** Tambah akun baru; akun dengan secret yang sudah ada dilewati. */
export function addAccounts(newAccounts) {
  return mutate((data) => {
    const seen = new Set(data.accounts.map(accountKey));
    const now = Date.now();
    let added = 0;
    for (const a of newAccounts) {
      const k = accountKey(a);
      if (seen.has(k)) continue;
      seen.add(k);
      data.accounts.push({ ...a, createdAt: now + added, updatedAt: now + added });
      added++;
    }
    return { added, skipped: newAccounts.length - added };
  });
}

/** Simpan perubahan satu akun (nama, counter HOTP). */
export function updateAccount(account) {
  return mutate((data) => {
    const i = data.accounts.findIndex((a) => a.id === account.id);
    if (i >= 0) data.accounts[i] = { ...account, updatedAt: Date.now() };
  });
}

export function deleteAccount(id) {
  return mutate((data) => {
    data.accounts = data.accounts.filter((a) => a.id !== id);
    data.deleted[id] = Date.now();
  });
}

export async function changePassword(oldPassword, newPassword) {
  const vault = await getVault();
  const oldKey = await deriveKey(oldPassword, fromB64(vault.kdf.salt), vault.kdf.iterations);
  try {
    await decryptJson(oldKey, vault.iv, vault.ct);
  } catch {
    return false;
  }
  await syncNow().catch(() => {}); // ambil dulu perubahan dari laptop lain
  const cur = await getVault();
  const data = await readData(oldKey, cur);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(newPassword, salt, ITERATIONS);
  const nv = { v: 1, kdf: { ...cur.kdf, iterations: ITERATIONS, salt: toB64(salt) }, ...(await encryptJson(key, data)) };
  await local.set({ vault: nv });
  await rememberKey(key);
  if ((await getSettings()).syncEnabled) await writeRemote(nv).catch(() => {});
  return true;
}

// ---------- Cadangan ----------

/** File cadangan = brankas itu sendiri (tetap terenkripsi dengan password saat ini). */
export async function exportBackup() {
  await loadAccounts(); // pastikan sedang terbuka
  return JSON.stringify({ format: 'authenticator-2fa-backup', v: 1, createdAt: new Date().toISOString(), vault: await getVault() }, null, 2);
}

export async function readBackup(text, password) {
  let file;
  try { file = JSON.parse(text); } catch { throw new Error('File cadangan tidak valid'); }
  const v = file && file.vault;
  if (file.format !== 'authenticator-2fa-backup' || !v?.kdf) throw new Error('Bukan file cadangan ekstensi ini');
  const key = await deriveKey(password, fromB64(v.kdf.salt), v.kdf.iterations);
  try {
    return (await decryptJson(key, v.iv, v.ct)).accounts || [];
  } catch {
    throw new Error('Password file cadangan salah');
  }
}

/** Hapus brankas di laptop ini (salinan sinkron di akun Chrome tidak disentuh). */
export async function resetAll() {
  memKey = null;
  await session.clear();
  await local.clear();
}

// ---------- Sinkron lewat akun Chrome ----------

async function readRemote() {
  const all = await sync.get(null);
  const meta = all.meta;
  if (!meta || meta.v !== 1 || !meta.kdf) return null;
  const parts = [];
  for (let i = 0; i < meta.chunks; i++) {
    if (typeof all[`c${i}`] !== 'string') return { meta, incomplete: true };
    parts.push(all[`c${i}`]);
  }
  return { meta, ct: parts.join('') };
}

async function writeRemote(v) {
  const parts = [];
  for (let i = 0; i < v.ct.length; i += CHUNK) parts.push(v.ct.slice(i, i + CHUNK));
  const prev = (await sync.get('meta')).meta;
  const items = {
    meta: { v: 1, kdf: v.kdf, iv: v.iv, chunks: parts.length, updatedAt: Date.now(), by: await deviceName() },
  };
  parts.forEach((p, i) => { items[`c${i}`] = p; });
  try {
    await sync.set(items);
  } catch (e) {
    throw new Error(/QUOTA/i.test(e.message)
      ? 'Data terlalu besar atau terlalu sering diubah untuk sinkron Chrome. Coba lagi nanti.'
      : e.message);
  }
  if (prev?.chunks > parts.length) {
    await sync.remove(Array.from({ length: prev.chunks - parts.length }, (_, i) => `c${parts.length + i}`));
  }
}

async function setStatus(s) {
  const status = { ...s, checkedAt: Date.now() };
  await local.set({ syncStatus: status });
  return status;
}

export async function syncStatus() {
  return (await local.get('syncStatus')).syncStatus || null;
}

/** Info brankas sinkron (tanpa membuka isinya), atau null. */
export async function remoteInfo() {
  const r = await readRemote();
  return r ? { by: r.meta.by, at: r.meta.updatedAt, incomplete: !!r.incomplete } : null;
}

async function doSync() {
  if (!(await getSettings()).syncEnabled) return { state: 'off' };
  const key = await sessionKey();
  if (!key) return { state: 'locked' };
  for (let attempt = 0; attempt < 4; attempt++) {
    const v = await getVault();
    const remote = await readRemote();
    if (!remote) {
      await writeRemote(v);
      return setStatus({ state: 'ok', by: await deviceName(), at: Date.now() });
    }
    if (remote.incomplete) return setStatus({ state: 'pending' });
    if (remote.meta.kdf.salt !== v.kdf.salt) {
      return setStatus({ state: 'conflict', by: remote.meta.by, at: remote.meta.updatedAt });
    }
    let remoteData;
    try {
      remoteData = await readData(key, { iv: remote.meta.iv, ct: remote.ct });
    } catch {
      return setStatus({ state: 'pending' }); // potongan dari Chrome belum lengkap
    }
    const localData = await readData(key, v);
    const merged = mergeVaults(localData, remoteData);
    let nv = v;
    if (!sameVault(merged, localData)) {
      const body = await encryptJson(key, merged);
      if ((await getVault()).ct !== v.ct) continue; // tab lain baru menyimpan; ulangi
      nv = { ...v, ...body };
      await local.set({ vault: nv });
    }
    if (!sameVault(merged, remoteData)) {
      if ((await sync.get('meta')).meta?.iv !== remote.meta.iv) continue;
      await writeRemote(nv);
      return setStatus({ state: 'ok', by: await deviceName(), at: Date.now() });
    }
    return setStatus({ state: 'ok', by: remote.meta.by, at: remote.meta.updatedAt });
  }
  return setStatus({ state: 'pending' });
}

let chain = Promise.resolve();
/** Gabungkan brankas lokal dengan salinan di akun Chrome (berurutan per halaman). */
export function syncNow() {
  const run = chain.catch(() => {}).then(doSync).catch((e) => setStatus({ state: 'error', message: e.message }));
  chain = run;
  return run;
}

export async function setSyncEnabled(on) {
  await setSettings({ syncEnabled: on });
  if (!on) {
    await local.remove('syncStatus');
    return { state: 'off' };
  }
  return syncNow();
}

/** Laptop baru: pakai brankas dari akun Chrome dengan passwordnya. */
export async function adoptRemote(password) {
  const remote = await readRemote();
  if (!remote || remote.incomplete) throw new Error('Data sinkron belum lengkap. Tunggu sebentar lalu coba lagi.');
  const key = await deriveKey(password, fromB64(remote.meta.kdf.salt), remote.meta.kdf.iterations);
  try {
    await decryptJson(key, remote.meta.iv, remote.ct);
  } catch {
    return false;
  }
  await local.set({ vault: { v: 1, kdf: remote.meta.kdf, iv: remote.meta.iv, ct: remote.ct } });
  await rememberKey(key);
  await setSettings({ syncEnabled: true });
  await setStatus({ state: 'ok', by: remote.meta.by, at: remote.meta.updatedAt });
  return true;
}

/**
 * Brankas di akun Chrome memakai password lain: buka dengan password itu,
 * gabungkan dengan akun di laptop ini, lalu laptop ini ikut memakai password itu.
 */
export async function joinRemote(password) {
  const remote = await readRemote();
  if (!remote || remote.incomplete) throw new Error('Data sinkron belum lengkap. Tunggu sebentar lalu coba lagi.');
  const key2 = await deriveKey(password, fromB64(remote.meta.kdf.salt), remote.meta.kdf.iterations);
  let remoteData;
  try {
    remoteData = await readData(key2, { iv: remote.meta.iv, ct: remote.ct });
  } catch {
    return false;
  }
  const localData = await readData(await needKey(), await getVault());
  const merged = mergeVaults(localData, remoteData);
  const nv = { v: 1, kdf: remote.meta.kdf, ...(await encryptJson(key2, merged)) };
  await local.set({ vault: nv });
  await rememberKey(key2);
  await setSettings({ syncEnabled: true });
  await writeRemote(nv);
  await setStatus({ state: 'ok', by: await deviceName(), at: Date.now() });
  return true;
}

/** Ganti salinan di akun Chrome dengan brankas laptop ini (mis. lupa password laptop lain). */
export async function overwriteRemote() {
  await needKey();
  await writeRemote(await getVault());
  await setSettings({ syncEnabled: true });
  return setStatus({ state: 'ok', by: await deviceName(), at: Date.now() });
}

/** Hapus salinan di akun Chrome (semua laptop). */
export async function clearRemote() {
  await sync.clear();
  await setSettings({ syncEnabled: false });
  await local.remove('syncStatus');
}
