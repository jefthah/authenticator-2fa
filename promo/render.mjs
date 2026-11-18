// Merender halaman HTML promo dengan Chrome headless lewat CDP.
//   node render.mjs shot  <page.html> <out.png> --w 1280 --h 720 [--query lang=en] [--t 0]
//   node render.mjs video <page.html> <out.mp4> --w 1920 --h 1080 [--fps 30] [--query lang=en] [--audio a.wav]
// Halaman video wajib punya window.render(detik) dan window.DURATION.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

const [mode, pagePath, outPath, ...rest] = process.argv.slice(2);
const opt = { w: 1920, h: 1080, fps: 30, query: '', audio: '', t: 0, scale: 1, from: 0, to: Infinity, times: '' };
for (let i = 0; i < rest.length; i += 2) {
  const k = rest[i].replace(/^--/, '');
  opt[k] = typeof opt[k] === 'number' ? Number(rest[i + 1]) : rest[i + 1];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(`${m.error.message} ${m.error.data || ''}`)) : res(m.result);
    } else events.forEach((f) => f(m));
  };
  return {
    open: new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }),
    send: (method, params = {}) => new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    }),
    on: (f) => events.push(f),
    close: () => ws.close(),
  };
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'promo-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
    '--mute-audio', '--force-color-profile=srgb', '--allow-file-access-from-files',
    `--window-size=${opt.w},${opt.h}`, 'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  try {
    let wsUrl;
    for (let i = 0; i < 150 && !wsUrl; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        wsUrl = list.find((x) => x.type === 'page')?.webSocketDebuggerUrl;
      } catch { /* belum siap */ }
      if (!wsUrl) await sleep(100);
    }
    if (!wsUrl) throw new Error('Chrome DevTools tidak bisa dihubungi');
    cdp = client(wsUrl);
    await cdp.open;
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: opt.w, height: opt.h, deviceScaleFactor: opt.scale, mobile: false });
    const loaded = new Promise((r) => cdp.on((m) => m.method === 'Page.loadEventFired' && r()));
    const url = pathToFileURL(resolve(pagePath)).href + (opt.query ? `?${opt.query}` : '');
    await cdp.send('Page.navigate', { url });
    await loaded;
    const ev = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    await ev('document.fonts.ready.then(() => window.ready ? window.ready() : true)');
    const frame = async (t) => {
      await ev(`(window.render && window.render(${t}), new Promise((r) => requestAnimationFrame(() => r(true))))`);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
      return Buffer.from(shot.data, 'base64');
    };

    if (mode === 'shot') {
      if (opt.times) { // beberapa detik sekaligus: out-<detik>.png
        for (const t of String(opt.times).split(',')) writeFileSync(outPath.replace(/\.png$/, `-${t}.png`), await frame(Number(t)));
        const errs = await ev('window.__errors || []');
        if (errs.length) console.log('galat halaman:', errs);
        console.log(`ok ${opt.times}`);
        return;
      }
      writeFileSync(outPath, await frame(opt.t));
      console.log(`ok ${outPath}`);
      return;
    }

    const duration = await ev('window.DURATION');
    const total = Math.round(duration * opt.fps);
    const first = Math.max(0, Math.round(opt.from * opt.fps));
    const last = Math.min(total, Math.round(Math.min(opt.to, duration) * opt.fps));
    const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(opt.fps), '-c:v', 'png', '-i', '-'];
    if (opt.audio) args.push('-ss', String(first / opt.fps), '-i', opt.audio);
    args.push('-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-r', String(opt.fps),
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv');
    if (opt.audio) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    args.push('-movflags', '+faststart', outPath);
    const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error(`ffmpeg keluar dengan kode ${c}`)))));
    const started = Date.now();
    for (let i = first; i < last; i++) {
      const buf = await frame(i / opt.fps);
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (i % 60 === 0) console.log(`frame ${i}/${last} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
    }
    ff.stdin.end();
    await done;
    console.log(`ok ${outPath}: ${last - first} frame dalam ${((Date.now() - started) / 1000).toFixed(0)} s`);
  } finally {
    try { cdp?.close(); } catch { /* abaikan */ }
    chrome.kill();
    await sleep(400);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome kadang masih memegang file */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
