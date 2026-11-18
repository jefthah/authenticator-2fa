// Terjemahan UI (Indonesia / English).
// Pilihan pengguna disimpan di settings.language: 'auto' | 'id' | 'en'.
// 'auto' mengikuti bahasa Chrome. Pengguna lama (sudah punya brankas sebelum
// pilihan ini ada) tetap memakai Bahasa Indonesia sampai mengubahnya.
import id from './locales/id.js';
import en from './locales/en.js';

const DICTS = { id, en };
export const LANGUAGES = [['id', 'Bahasa Indonesia'], ['en', 'English']];

let lang = autoLang();

export function autoLang() {
  const ui = String(globalThis.chrome?.i18n?.getUILanguage?.() || globalThis.navigator?.language || 'en').toLowerCase();
  return ui === 'id' || ui.startsWith('id-') || ui === 'in' ? 'id' : 'en';
}

export const getLang = () => lang;
export const dateLocale = () => (lang === 'id' ? 'id-ID' : 'en-US');

/** pref: 'id' | 'en' | 'auto' | undefined */
export function setLang(pref) {
  lang = DICTS[pref] ? pref : autoLang();
  if (globalThis.document) document.documentElement.lang = lang;
  return lang;
}

export function t(key, params = {}) {
  const v = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  if (typeof v === 'function') return v(params);
  return v.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/**
 * Isi teks statis di HTML:
 *   data-i18n="key"            → textContent
 *   data-i18n-html="key"       → innerHTML (hanya teks dari kamus sendiri)
 *   data-i18n-attr="attr:key;…" → atribut, mis. placeholder:issuerPlaceholder
 */
export function applyDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr.trim(), t(key.trim()));
    }
  }
  if (root === document && document.documentElement.dataset.i18nTitle) {
    document.title = t(document.documentElement.dataset.i18nTitle);
  }
}

/**
 * Pilihan bahasa yang berlaku. Saat belum ada setelan, simpan sekali:
 * 'id' untuk pengguna lama (brankas sudah ada sebelum v1.3), 'auto' untuk pemasangan baru.
 */
export async function languagePref() {
  const { settings, vault } = await chrome.storage.local.get(['settings', 'vault']);
  if (settings?.language) return settings.language;
  const language = vault ? 'id' : 'auto';
  await chrome.storage.local.set({ settings: { ...(settings || {}), language } });
  return language;
}

export async function initI18n() {
  try {
    setLang(await languagePref());
  } catch {
    setLang();
  }
  if (globalThis.document) {
    applyDom();
    document.documentElement.classList.remove('i18n-pending');
  }
}
