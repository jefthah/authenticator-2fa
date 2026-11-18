// Logika inti tanpa API Chrome: Base32, HOTP/TOTP, dan parser link
// otpauth:// serta otpauth-migration:// (ekspor Google Authenticator).
import { t } from './i18n.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const HASH = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };
const utf8 = new TextDecoder();

// ---------- Base32 / Base64 ----------

export function normalizeSecret(s) {
  return String(s || '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
}

export function base32Decode(input) {
  const s = normalizeSecret(input);
  if (!s) throw new Error(t('errSecretEmpty'));
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error(t('errSecretChar', { ch }));
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (!out.length) throw new Error(t('errSecretShort'));
  return new Uint8Array(out);
}

export function base32Encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base64ToBytes(s) {
  // '+' bisa berubah jadi spasi kalau link sempat di-decode; kembalikan.
  let b64 = String(s).replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/]/g, '');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- HOTP / TOTP ----------

const keyCache = new Map();

async function hmacKey(secret, algorithm) {
  const id = `${algorithm}:${secret}`;
  let key = keyCache.get(id);
  if (!key) {
    key = await crypto.subtle.importKey(
      'raw', base32Decode(secret), { name: 'HMAC', hash: HASH[algorithm] }, false, ['sign']);
    keyCache.set(id, key);
  }
  return key;
}

export async function hotp(secret, counter, { algorithm = 'SHA1', digits = 6 } = {}) {
  if (!HASH[algorithm]) throw new Error(t('errAlgo', { alg: algorithm }));
  const key = await hmacKey(normalizeSecret(secret), algorithm);
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totpStep(account, nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / (account.period || 30));
}

export function secondsRemaining(account, nowMs = Date.now()) {
  const p = (account.period || 30) * 1000;
  return (p - (nowMs % p)) / 1000;
}

export async function generateCode(account, nowMs = Date.now()) {
  const counter = account.type === 'hotp' ? account.counter || 0 : totpStep(account, nowMs);
  return hotp(account.secret, counter, account);
}

export function formatCode(code) {
  const half = Math.floor(code.length / 2);
  return `${code.slice(0, half)} ${code.slice(half)}`;
}

// ---------- Akun ----------

function splitLabel(issuer, name) {
  issuer = (issuer || '').trim();
  name = (name || '').trim();
  const i = name.indexOf(':');
  if (i > 0) {
    const prefix = name.slice(0, i).trim();
    if (!issuer) return { issuer: prefix, name: name.slice(i + 1).trim() };
    if (prefix.toLowerCase() === issuer.toLowerCase()) return { issuer, name: name.slice(i + 1).trim() };
  }
  return { issuer, name };
}

export function makeAccount(f) {
  const secret = normalizeSecret(f.secret);
  base32Decode(secret); // validasi
  const algorithm = String(f.algorithm || 'SHA1').toUpperCase().replace('-', '');
  if (!HASH[algorithm]) throw new Error(t('errAlgo', { alg: algorithm }));
  const digits = Number(f.digits) || 6;
  if (digits < 6 || digits > 8) throw new Error(t('errDigits'));
  const period = Number(f.period) || 30;
  if (period < 1 || period > 300) throw new Error(t('errPeriod'));
  const type = f.type === 'hotp' ? 'hotp' : 'totp';
  const { issuer, name } = splitLabel(f.issuer, f.name);
  return {
    id: f.id || crypto.randomUUID(),
    issuer, name: name || (issuer ? '' : 'Akun tanpa nama'), secret, algorithm, digits, period, type,
    counter: Number(f.counter) || 0,
    createdAt: f.createdAt || Date.now(),
  };
}

export function accountKey(a) {
  return `${a.type}|${normalizeSecret(a.secret)}`;
}

// ---------- Penggabungan brankas antar perangkat ----------
// Data brankas: { accounts: [...], deleted: { [id]: waktuHapus } }.
// Aturan: per akun, versi dengan updatedAt terbaru menang; akun mati jika
// waktu hapusnya >= updatedAt-nya. Duplikat (secret sama, id beda) disatukan
// ke akun tertua dan sisanya diberi tanda hapus yang deterministik.

// Tanda hapus disimpan secukupnya agar muat di kuota sinkron Chrome (±100 KB).
const TOMBSTONE_TTL = 180 * 24 * 3600 * 1000;
const TOMBSTONE_MAX = 400;
const stamp = (a) => a.updatedAt || a.createdAt || 0;

export function pruneTombstones(deleted, now = Date.now()) {
  const fresh = Object.entries(deleted || {}).filter(([, ts]) => ts > now - TOMBSTONE_TTL)
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    .slice(0, TOMBSTONE_MAX);
  return Object.fromEntries(fresh);
}

export function mergeVaults(local, remote) {
  const deleted = { ...(local.deleted || {}) };
  for (const [id, ts] of Object.entries(remote.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, ts);

  const pick = new Map();
  const order = [];
  for (const a of [...(local.accounts || []), ...(remote.accounts || [])]) {
    const cur = pick.get(a.id);
    if (!cur) order.push(a.id);
    if (!cur || stamp(a) > stamp(cur) || (stamp(a) === stamp(cur) && JSON.stringify(a) > JSON.stringify(cur))) {
      pick.set(a.id, a);
    }
  }
  const alive = order.map((id) => pick.get(id)).filter((a) => !(deleted[a.id] >= stamp(a)));

  const best = new Map();
  for (const a of alive) {
    const k = accountKey(a);
    const b = best.get(k);
    const older = b && ((a.createdAt || 0) < (b.createdAt || 0) || ((a.createdAt || 0) === (b.createdAt || 0) && a.id < b.id));
    if (!b || older) best.set(k, a);
  }
  const keep = new Set([...best.values()].map((a) => a.id));
  for (const a of alive) if (!keep.has(a.id)) deleted[a.id] = Math.max(deleted[a.id] || 0, stamp(a));
  return { accounts: alive.filter((a) => keep.has(a.id)), deleted: pruneTombstones(deleted) };
}

function canonical(d) {
  const acc = [...(d.accounts || [])].sort((x, y) => (x.id < y.id ? -1 : 1))
    .map((a) => Object.keys(a).sort().map((k) => [k, a[k]]));
  const del = Object.keys(d.deleted || {}).sort().map((k) => [k, d.deleted[k]]);
  return JSON.stringify([acc, del]);
}

/** Isi sama (urutan akun diabaikan). */
export function sameVault(a, b) {
  return canonical(a) === canonical(b);
}

// ---------- otpauth:// ----------

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function parseOtpauthUri(uri) {
  const m = String(uri).trim().match(/^otpauth:\/\/(totp|hotp)\/([^?#]*)(?:\?([^#]*))?/i);
  if (!m) throw new Error(t('errOtpauth'));
  const q = new URLSearchParams(m[3] || '');
  const secret = q.get('secret');
  if (!secret) throw new Error(t('errOtpauthNoSecret'));
  return makeAccount({
    type: m[1].toLowerCase(),
    name: safeDecode(m[2]),
    issuer: q.get('issuer') || '',
    secret,
    algorithm: q.get('algorithm') || 'SHA1',
    digits: q.get('digits'),
    period: q.get('period'),
    counter: q.get('counter'),
  });
}

// ---------- otpauth-migration:// (Google Authenticator) ----------

class PbReader {
  constructor(bytes) { this.b = bytes; this.p = 0; }
  eof() { return this.p >= this.b.length; }
  varint() {
    let result = 0n, shift = 0n;
    for (;;) {
      if (this.p >= this.b.length) throw new Error(t('errQrTruncated'));
      const byte = this.b[this.p++];
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return result;
      shift += 7n;
      if (shift > 70n) throw new Error(t('errQrCorrupt'));
    }
  }
  bytes() {
    const len = Number(this.varint());
    if (this.p + len > this.b.length) throw new Error(t('errQrTruncated'));
    const out = this.b.subarray(this.p, this.p + len);
    this.p += len;
    return out;
  }
  skip(wireType) {
    if (wireType === 0) this.varint();
    else if (wireType === 1) this.p += 8;
    else if (wireType === 2) this.bytes();
    else if (wireType === 5) this.p += 4;
    else throw new Error(t('errQrFormat'));
  }
}

const MIG_ALGO = { 0: 'SHA1', 1: 'SHA1', 2: 'SHA256', 3: 'SHA512', 4: 'MD5' };
const MIG_DIGITS = { 0: 6, 1: 6, 2: 8 };
const MIG_TYPE = { 0: 'totp', 1: 'hotp', 2: 'totp' };

function parseOtpParameters(bytes) {
  const r = new PbReader(bytes);
  const p = { secret: new Uint8Array(), name: '', issuer: '', algorithm: 0, digits: 0, type: 0, counter: 0 };
  while (!r.eof()) {
    const tag = Number(r.varint());
    const field = tag >>> 3, wt = tag & 7;
    if (field === 1 && wt === 2) p.secret = r.bytes();
    else if (field === 2 && wt === 2) p.name = utf8.decode(r.bytes());
    else if (field === 3 && wt === 2) p.issuer = utf8.decode(r.bytes());
    else if (field === 4 && wt === 0) p.algorithm = Number(r.varint());
    else if (field === 5 && wt === 0) p.digits = Number(r.varint());
    else if (field === 6 && wt === 0) p.type = Number(r.varint());
    else if (field === 7 && wt === 0) p.counter = Number(BigInt.asIntN(64, r.varint()));
    else r.skip(wt);
  }
  return p;
}

export function parseMigrationUri(uri) {
  const m = String(uri).trim().match(/^otpauth-migration:\/\/offline\/?\?(.*)$/i);
  if (!m) throw new Error(t('errMigration'));
  const data = new URLSearchParams(m[1]).get('data');
  if (!data) throw new Error(t('errMigrationNoData'));
  const r = new PbReader(base64ToBytes(data));
  const out = { accounts: [], skipped: [], version: 0, batchSize: 1, batchIndex: 0, batchId: 0 };
  while (!r.eof()) {
    const tag = Number(r.varint());
    const field = tag >>> 3, wt = tag & 7;
    if (field === 1 && wt === 2) {
      const p = parseOtpParameters(r.bytes());
      const label = p.issuer ? `${p.issuer} (${p.name})` : p.name;
      const algorithm = MIG_ALGO[p.algorithm] || 'SHA1';
      if (algorithm === 'MD5') { out.skipped.push(t('errMd5', { label })); continue; }
      try {
        out.accounts.push(makeAccount({
          secret: base32Encode(p.secret), name: p.name, issuer: p.issuer, algorithm,
          digits: MIG_DIGITS[p.digits] || 6, type: MIG_TYPE[p.type] || 'totp', counter: p.counter,
        }));
      } catch (e) {
        out.skipped.push(`${label}: ${e.message}`);
      }
    } else if (field === 2 && wt === 0) out.version = Number(r.varint());
    else if (field === 3 && wt === 0) out.batchSize = Number(BigInt.asIntN(32, r.varint()));
    else if (field === 4 && wt === 0) out.batchIndex = Number(BigInt.asIntN(32, r.varint()));
    else if (field === 5 && wt === 0) out.batchId = Number(BigInt.asIntN(32, r.varint()));
    else r.skip(wt);
  }
  return out;
}

// Teks bebas (satu atau banyak link, dipisah spasi/baris baru).
export function parseAnyText(text) {
  const result = { accounts: [], batches: [], errors: [] };
  const tokens = String(text).split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    try {
      if (/^otpauth-migration:/i.test(tok)) {
        const mig = parseMigrationUri(tok);
        result.accounts.push(...mig.accounts);
        result.errors.push(...mig.skipped);
        result.batches.push({ id: mig.batchId, index: mig.batchIndex, size: mig.batchSize, count: mig.accounts.length });
      } else if (/^otpauth:/i.test(tok)) {
        result.accounts.push(parseOtpauthUri(tok));
      }
    } catch (e) {
      result.errors.push(e.message);
    }
  }
  if (!result.accounts.length && !result.errors.length) {
    result.errors.push(t('errNoLinks'));
  }
  return result;
}
