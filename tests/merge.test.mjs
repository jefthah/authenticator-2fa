// Tests for mergeVaults (sync between laptops): parallel adds, deletes,
// edits, duplicates and convergence. Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { mergeVaults, sameVault } = await import(new URL('../authenticator-extension/src/core.js', import.meta.url));

const T = Date.now() - 1e7; // realistic timestamps (old tombstones are pruned)
const acc = (id, secret, t, extra = {}) => ({
  id, issuer: 'S' + id, name: 'n', secret, algorithm: 'SHA1', digits: 6, period: 30, type: 'totp', counter: 0,
  createdAt: T + t, updatedAt: T + t, ...extra, ...(extra.updatedAt ? { updatedAt: T + extra.updatedAt } : {}),
});
const ids = (d) => d.accounts.map((a) => a.id).join(',');

const base = { accounts: [acc('a1', 'AAAA', 1)], deleted: {} };
const A = { accounts: [...base.accounts, acc('a2', 'BBBB', 10)], deleted: {} };
const B = { accounts: [...base.accounts, acc('a3', 'CCCC', 11)], deleted: {} };
const mAB = mergeVaults(A, B);
const mBA = mergeVaults(B, A);

test('accounts added offline on two devices are both kept', () => {
  assert.equal(ids(mAB), 'a1,a2,a3');
  assert.ok(sameVault(mAB, mBA), 'commutative');
  assert.ok(sameVault(mergeVaults(mAB, mAB), mAB), 'idempotent');
});

test('deletes propagate and stay deleted', () => {
  const Adel = { accounts: mAB.accounts.filter((a) => a.id !== 'a2'), deleted: { a2: T + 20 } };
  const m = mergeVaults(mBA, Adel);
  assert.ok(!ids(m).includes('a2'));
  assert.equal(m.deleted.a2, T + 20);
  assert.ok(!ids(mergeVaults(Adel, mBA)).includes('a2'));
});

test('newest edit wins in both directions', () => {
  const Bren = { accounts: mBA.accounts.map((a) => (a.id === 'a1' ? { ...a, issuer: 'New', updatedAt: T + 30 } : a)), deleted: {} };
  assert.equal(mergeVaults(mAB, Bren).accounts.find((a) => a.id === 'a1').issuer, 'New');
  assert.equal(mergeVaults(Bren, mAB).accounts.find((a) => a.id === 'a1').issuer, 'New');
});

test('edit after delete revives, edit before delete does not', () => {
  const del35 = { accounts: [], deleted: { a1: T + 35 } };
  assert.equal(ids(mergeVaults(del35, { accounts: [acc('a1', 'AAAA', 1, { updatedAt: 40 })], deleted: {} })), 'a1');
  assert.equal(ids(mergeVaults(del35, { accounts: [acc('a1', 'AAAA', 1, { updatedAt: 30 })], deleted: {} })), '');
});

test('same secret imported separately on two devices is de-duplicated', () => {
  const Ad = { accounts: [acc('x1', 'DDDD', 50)], deleted: {} };
  const Bd = { accounts: [acc('y9', 'DDDD', 60)], deleted: {} };
  const md = mergeVaults(Ad, Bd);
  const md2 = mergeVaults(Bd, Ad);
  assert.equal(ids(md), 'x1', 'oldest copy wins');
  assert.equal(ids(md2), 'x1');
  assert.ok(sameVault(md, md2), 'same tombstones both ways');
  assert.equal(ids(mergeVaults(md, Bd)), 'x1', 'stale duplicate does not come back');
});

test('local order is kept, remote-only accounts go last', () => {
  const L = { accounts: [acc('k3', 'K3K3', 3), acc('k1', 'K1K1', 1)], deleted: {} };
  const R = { accounts: [acc('k1', 'K1K1', 1), acc('k9', 'K9K9', 9)], deleted: {} };
  assert.equal(ids(mergeVaults(L, R)), 'k3,k1,k9');
});

test('legacy data without updatedAt/deleted still merges', () => {
  const legacy = { accounts: [{ ...acc('old', 'OOOO', 5), updatedAt: undefined }] };
  assert.equal(ids(mergeVaults(legacy, { accounts: [], deleted: {} })), 'old');
});

test('random 3-device simulation converges without duplicates', () => {
  let seed = 7;
  const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
  const dev = [0, 1, 2].map(() => ({ accounts: [], deleted: {} }));
  let remote = { accounts: [], deleted: {} };
  let clock = 100;
  let next = 0;
  for (let step = 0; step < 400; step++) {
    const d = rnd(3);
    const op = rnd(10);
    clock += 1;
    const v = dev[d];
    if (op < 4) v.accounts.push(acc('id' + next, 'S' + ((next++ % 25) + 10), clock));
    else if (op < 6 && v.accounts.length) {
      const i = rnd(v.accounts.length);
      v.deleted[v.accounts[i].id] = T + clock;
      v.accounts.splice(i, 1);
    } else if (op < 8 && v.accounts.length) {
      const i = rnd(v.accounts.length);
      v.accounts[i] = { ...v.accounts[i], issuer: 'e' + clock, updatedAt: T + clock };
    }
    if (rnd(3) === 0) dev[d] = remote = mergeVaults(dev[d], remote);
  }
  for (let r = 0; r < 2; r++) for (let d = 0; d < 3; d++) dev[d] = remote = mergeVaults(dev[d], remote);
  assert.ok(sameVault(dev[0], dev[1]) && sameVault(dev[1], dev[2]) && sameVault(dev[2], remote));
  const secrets = remote.accounts.map((a) => a.secret);
  assert.equal(new Set(secrets).size, secrets.length);
});

// ---------- Display order (drag to reorder) ----------
const { applyOrder } = await import(new URL('../authenticator-extension/src/core.js', import.meta.url));

test('newest order wins on every device; accounts added later go last', () => {
  const list = [acc('p1', 'P1P1', 1), acc('p2', 'P2P2', 2), acc('p3', 'P3P3', 3)];
  const A = { accounts: list, deleted: {}, order: { ids: ['p3', 'p1', 'p2'], at: T + 50 } };
  const B = { accounts: [...list, acc('p4', 'P4P4', 60)], deleted: {}, order: { ids: ['p2', 'p1', 'p3'], at: T + 40 } };
  const m1 = mergeVaults(A, B);
  const m2 = mergeVaults(B, A);
  assert.equal(ids(m1), 'p3,p1,p2,p4');
  assert.equal(ids(m2), 'p3,p1,p2,p4');
  assert.ok(sameVault(m1, m2));
});

test('an order change alone counts as a change to sync', () => {
  const v = { accounts: [acc('q1', 'Q1Q1', 1), acc('q2', 'Q2Q2', 2)], deleted: {} };
  assert.ok(!sameVault(v, { ...v, order: { ids: ['q2', 'q1'], at: T + 5 } }));
  assert.ok(sameVault({ ...v, order: { ids: ['q2', 'q1'], at: T + 5 } }, { ...v, order: { ids: ['q2', 'q1'], at: T + 5 } }));
});

test('order is kept when only one side has it, and deleted ids are ignored', () => {
  const v = { accounts: [acc('r1', 'R1R1', 1), acc('r2', 'R2R2', 2)], deleted: {} };
  const ordered = { ...v, order: { ids: ['gone', 'r2', 'r1'], at: T + 9 } };
  assert.equal(ids(mergeVaults(v, ordered)), 'r2,r1');
  assert.equal(ids(mergeVaults(ordered, v)), 'r2,r1');
  assert.deepEqual(applyOrder(v.accounts, undefined).map((a) => a.id), ['r1', 'r2']);
});

test('reorders mixed with edits on 3 devices still converge', () => {
  let seed = 11;
  const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
  const start = Array.from({ length: 6 }, (_, i) => acc('s' + i, 'S' + i + 'SS', i));
  const dev = [0, 1, 2].map(() => ({ accounts: [...start], deleted: {} }));
  let remote = { accounts: [...start], deleted: {} };
  let clock = 200;
  for (let step = 0; step < 300; step++) {
    const d = rnd(3);
    clock += 1;
    const v = dev[d];
    const op = rnd(4);
    if (op === 0 && v.accounts.length > 1) {
      const order = [...v.accounts.map((a) => a.id)].sort(() => rnd(3) - 1);
      dev[d] = { ...v, order: { ids: order, at: T + clock }, accounts: applyOrder(v.accounts, { ids: order }) };
    } else if (op === 1) v.accounts.push(acc('n' + step, 'N' + step + 'NN', clock));
    else if (op === 2 && v.accounts.length) {
      const i = rnd(v.accounts.length);
      v.deleted[v.accounts[i].id] = T + clock;
      v.accounts.splice(i, 1);
    }
    if (rnd(3) === 0) dev[d] = remote = mergeVaults(dev[d], remote);
  }
  for (let r = 0; r < 2; r++) for (let d = 0; d < 3; d++) dev[d] = remote = mergeVaults(dev[d], remote);
  assert.ok(sameVault(dev[0], dev[1]) && sameVault(dev[1], dev[2]));
  assert.equal(ids(dev[0]), ids(dev[1]));
  assert.equal(ids(dev[1]), ids(dev[2]));
});
