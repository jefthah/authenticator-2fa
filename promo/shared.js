/* Komponen bersama (skrip biasa, bukan modul, agar jalan dari file://). */
(function () {
  const PALETTE = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#0891b2', '#4f46e5'];

  // Ikon garis yang sama dengan src/ui.js di ekstensi.
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
    gear: '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" stroke="currentColor" stroke-width="1.6" fill="none"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="2" fill="none"/>',
    back: '<path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    reload: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    more: '<circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/>',
    search: '<circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    sync: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7M20 4v4.7h-4.7M20 12a8 8 0 0 1-13.7 5.6L4 15.3M4 20v-4.7h4.7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    check: '<path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/><path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" fill="currentColor"/>',
    code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    shield: '<path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/><path d="M9 12l2.2 2.2L15.5 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M2 19h20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    drag: '<path d="M12 3v18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    globe: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" stroke="currentColor" stroke-width="2" fill="none"/>',
  };
  const icon = (name, size = 20, extra = '') =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ${extra}>${ICONS[name]}</svg>`;

  // Ikon merek: kotak biru bergradasi, cincin putih, dan pai (sudut dalam derajat, default 270).
  let gid = 0;
  function piePath(cx, cy, r, deg) {
    if (deg <= 0.01) return '';
    if (deg >= 359.99) return `M${cx} ${cy - r}A${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r}Z`;
    const a = (deg - 90) * Math.PI / 180;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    return `M${cx} ${cy}L${cx} ${cy - r}A${r} ${r} 0 ${deg > 180 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z`;
  }
  function brandIcon(size, deg = 270) {
    const id = `bi${++gid}`;
    return `<svg class="brand-icon" viewBox="0 0 128 128" width="${size}" height="${size}" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#1f6aeb"/><stop offset="1" stop-color="#1497e9"/></linearGradient></defs>
      <rect x="2" y="2" width="124" height="124" rx="30" fill="url(#${id})"/>
      <circle class="bi-ring" cx="64" cy="64" r="37" fill="none" stroke="#fff" stroke-width="9" stroke-dasharray="232.5" stroke-dashoffset="0" transform="rotate(-90 64 64)"/>
      <path class="bi-pie" d="${piePath(64, 64, 24, deg)}" fill="#fff"/></svg>`;
  }

  function avColor(label) {
    let hash = 0;
    for (const ch of label.toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    return PALETTE[hash % PALETTE.length];
  }
  const RING = 2 * Math.PI * 9;
  const fmt = (c) => `${c.slice(0, 3)} ${c.slice(3)}`;

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  // accounts: [{issuer, name, code}] → {root, rows:[{li, code, fill, secs, badge}]}
  function popup(accounts, { search = 'Search accounts…', copied = 'Copied', foot = '' } = {}) {
    const root = el(`<div class="pm">
      <div class="pm-bar"><div class="pm-brand">${brandIcon(22)}Authenticator</div>
        <div class="pm-actions"><span class="pm-ib">${icon('scan', 18)}</span><span class="pm-ib">${icon('plus', 18)}</span><span class="pm-ib">${icon('gear', 18)}</span></div></div>
      <div class="pm-search">${icon('search', 16)}<span>${search}</span></div>
      <ul class="pm-list"></ul>${foot ? `<div class="pm-foot">${foot}</div>` : ''}</div>`);
    const list = root.querySelector('.pm-list');
    const rows = accounts.map((a) => {
      const li = el(`<li class="pm-item"><span class="grip"></span>
        <div class="pm-av" style="--av:${avColor(a.issuer)}">${a.issuer[0].toUpperCase()}</div>
        <div class="pm-meta"><div class="pm-issuer">${a.issuer}</div><div class="pm-name">${a.name}</div>
          <div class="pm-code">${fmt(a.code)}</div></div>
        <div class="pm-timer"><svg class="pm-ring" viewBox="0 0 24 24"><circle class="tr" cx="12" cy="12" r="9"/><circle class="fl" cx="12" cy="12" r="9" stroke-dasharray="${RING}"/></svg><span class="pm-secs"></span></div>
        <div class="pm-more">${icon('more', 18)}</div><span class="pm-badge">${copied}</span></li>`);
      list.append(li);
      return { li, code: li.querySelector('.pm-code'), fill: li.querySelector('.fl'), secs: li.querySelector('.pm-secs'), badge: li.querySelector('.pm-badge') };
    });
    return { root, list, rows };
  }

  // Sisa detik pada siklus 30 detik → cincin, angka detik, warna merah ≤ 5 detik.
  function setTimer(row, left, period = 30) {
    row.fill.style.strokeDashoffset = (RING * (1 - left / period)).toFixed(2);
    row.secs.textContent = Math.max(1, Math.ceil(left));
    row.li.classList.toggle('warn', left <= 5);
  }

  // QR hiasan (acak tetapi tetap sama tiap render). Bukan QR yang bisa dibaca.
  function fakeQR(size, seed = 7, n = 29, fg = '#111827') {
    let s = seed >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const cell = size / (n + 2);
    let rects = '';
    const finder = (fx, fy) => {
      rects += `<rect x="${(fx + 1) * cell}" y="${(fy + 1) * cell}" width="${7 * cell}" height="${7 * cell}" fill="${fg}"/>`;
      rects += `<rect x="${(fx + 2) * cell}" y="${(fy + 2) * cell}" width="${5 * cell}" height="${5 * cell}" fill="#fff"/>`;
      rects += `<rect x="${(fx + 3) * cell}" y="${(fy + 3) * cell}" width="${3 * cell}" height="${3 * cell}" fill="${fg}"/>`;
    };
    const inFinder = (x, y) => (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (inFinder(x, y)) continue;
      if (rnd() < 0.48) d += `M${((x + 1) * cell).toFixed(2)} ${((y + 1) * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
    }
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="${fg}"/>${rects}</svg>`;
  }

  window.Promo = { ICONS, icon, brandIcon, piePath, avColor, popup, setTimer, fakeQR, fmt, el, RING };
})();
