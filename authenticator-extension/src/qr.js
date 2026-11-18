// Membaca QR dari gambar/video.
// Utama: ZXing (zxing-cpp versi WebAssembly, lib/zxing-reader.js + .wasm) —
// jauh lebih andal untuk QR ekspor Google yang padat.
// Cadangan: jsQR (lib/jsQR.js). Keduanya dimuat sebagai <script> biasa.

const WASM_URL = new URL('../lib/zxing_reader.wasm', import.meta.url).href;
const ZX_OPTS = { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 4 };

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let zxingLoad = null;
function zxingReady() {
  if (!zxingLoad) {
    zxingLoad = window.ZXingWASM
      ? window.ZXingWASM.prepareZXingModule({
        overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? WASM_URL : prefix + path) },
        fireImmediately: true,
      }).then(() => true, (e) => {
        console.warn('ZXing gagal dimuat, memakai jsQR', e);
        return false;
      })
      : Promise.resolve(false);
  }
  return zxingLoad;
}

/** Gambar `source` ke canvas (opsional diberi tepi putih) dan ambil pikselnya. */
function pixels(source, w, h, pad = 0) {
  canvas.width = w + pad * 2;
  canvas.height = h + pad * 2;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, pad, pad, w, h);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

const pick = (texts) => texts.find((t) => /^otpauth/i.test(t)) || texts[0] || null;

async function readZXing(img) {
  if (!(await zxingReady())) return null;
  try {
    const res = await window.ZXingWASM.readBarcodes(img, ZX_OPTS);
    return pick(res.filter((r) => r.isValid !== false && r.text).map((r) => r.text));
  } catch (e) {
    console.warn('ZXing error', e);
    return null;
  }
}

function readJsQR(img, inversion = 'attemptBoth') {
  const hit = window.jsQR?.(img.data, img.width, img.height, { inversionAttempts: inversion });
  return hit ? hit.data : null;
}

/** Gambar diam (foto, screenshot, tempelan clipboard). Mencoba beberapa cara. */
export async function decodeDrawable(source, width, height) {
  const scale = Math.min(1, 3000 / Math.max(width, height));
  const w = Math.round(width * scale), h = Math.round(height * scale);
  // Tepi putih membantu jika gambar dipotong mepet tanpa margin QR.
  const pad = Math.round(Math.max(w, h) * 0.08) + 8;
  for (const p of [0, pad]) {
    const text = await readZXing(pixels(source, w, h, p));
    if (text) return text;
  }
  const tried = new Set();
  for (const max of [1400, 2400, Math.max(width, height)]) {
    const s = Math.min(1, max / Math.max(width, height));
    const sw = Math.round(width * s), sh = Math.round(height * s);
    if (tried.has(sw)) continue;
    tried.add(sw);
    const text = readJsQR(pixels(source, sw, sh, Math.round(Math.max(sw, sh) * 0.08) + 8));
    if (text) return text;
  }
  return null;
}

export async function decodeBlob(blob) {
  const bmp = await createImageBitmap(blob);
  try {
    return await decodeDrawable(bmp, bmp.width, bmp.height);
  } finally {
    bmp.close();
  }
}

export async function decodeDataUrl(url) {
  const blob = await (await fetch(url)).blob();
  return decodeBlob(blob);
}

/** Satu frame video untuk pemindaian kamera berulang. */
export async function decodeVideoFrame(video) {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return null;
  const img = pixels(video, w, h);
  if (await zxingReady()) return readZXing(img);
  return readJsQR(img, 'dontInvert');
}

/** Muat WASM lebih awal supaya pemindaian pertama tidak menunggu. */
export function warmUp() {
  zxingReady();
}
