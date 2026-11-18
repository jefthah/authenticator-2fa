// Translation checks: both dictionaries have the same keys and placeholders,
// and every key used in the extension exists. Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ext = new URL('../authenticator-extension/', import.meta.url);
const id = (await import(new URL('src/locales/id.js', ext))).default;
const en = (await import(new URL('src/locales/en.js', ext))).default;
const i18n = await import(new URL('src/i18n.js', ext));

const params = (v) => (typeof v === 'string' ? [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join() : null);

test('id and en have the same keys', () => {
  assert.deepEqual(Object.keys(id).sort(), Object.keys(en).sort());
});

test('string placeholders match between languages', () => {
  for (const k of Object.keys(id)) {
    const a = params(id[k]);
    const b = params(en[k]);
    if (a !== null && b !== null) assert.equal(a, b, k);
  }
});

test('every key used in code and HTML exists', () => {
  const used = new Set();
  for (const f of ['src/core.js', 'src/vault.js', 'src/ui.js', 'src/popup.js', 'src/import.js']) {
    const src = readFileSync(new URL(f, ext), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*['"]([A-Za-z0-9_]+)['"]/g)) used.add(m[1]);
  }
  const html = readFileSync(new URL('import.html', ext), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-html|-title)?="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(';')) used.add(pair.split(':')[1].trim());
  const missing = [...used].filter((k) => !(k in id) || !(k in en));
  assert.deepEqual(missing, []);
});

test('t() interpolates and pluralizes', () => {
  i18n.setLang('en');
  assert.equal(i18n.t('addedN', { n: 1 }), '1 account added');
  assert.equal(i18n.t('addedN', { n: 3 }), '3 accounts added');
  assert.equal(i18n.t('copied', { name: 'GitHub' }), 'GitHub code copied');
  i18n.setLang('id');
  assert.equal(i18n.t('addedN', { n: 3 }), '3 akun ditambahkan');
  assert.equal(i18n.t('newCount', { n: 0 }), 'tidak ada yang baru');
  i18n.setLang('en');
});

test('manifest strings are localized', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', ext), 'utf8'));
  for (const lang of ['en', 'id']) {
    const msgs = JSON.parse(readFileSync(new URL(`_locales/${lang}/messages.json`, ext), 'utf8'));
    for (const field of [manifest.name, manifest.description, manifest.action.default_title]) {
      const key = /^__MSG_(\w+)__$/.exec(field)?.[1];
      if (key) assert.ok(msgs[key]?.message, `${lang}: ${key}`);
    }
  }
});
