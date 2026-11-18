"""Musik latar + efek suara untuk ad.html (disintesis sendiri, bebas lisensi).

python music.py out.wav
Waktu efek suara mengikuti linimasa di ad.html (100 BPM, 1 ketuk = 0,6 detik).
"""
import sys
import wave

import numpy as np

SR = 48000
DUR = 26.0
N = int(SR * DUR)
rng = np.random.default_rng(7)

dry = np.zeros((2, N))
send = np.zeros((2, N))  # ke reverb


def hz(note):
    return 440.0 * 2 ** ((note - 69) / 12)


def add(sig, start, gain=1.0, pan=0.0, rev=0.0):
    i0 = int(round(start * SR))
    if i0 >= N or i0 + len(sig) <= 0:
        return
    s = sig[: N - i0] * gain
    lg = np.cos((pan + 1) * np.pi / 4) * np.sqrt(2)
    rg = np.sin((pan + 1) * np.pi / 4) * np.sqrt(2)
    dry[0, i0:i0 + len(s)] += s * lg
    dry[1, i0:i0 + len(s)] += s * rg
    if rev:
        send[0, i0:i0 + len(s)] += s * lg * rev
        send[1, i0:i0 + len(s)] += s * rg * rev


def tt(dur):
    return np.arange(int(dur * SR)) / SR


# ---------- Instrumen ----------
def pad(f, dur, a=0.45, r=1.0):
    t = tt(dur + r)
    s = np.zeros_like(t)
    for det, ph in ((-0.003, 0.0), (0.003, 1.3)):
        ff = f * (1 + det)
        s += np.sin(2 * np.pi * ff * t + ph) + 0.22 * np.sin(4 * np.pi * ff * t + ph) + 0.07 * np.sin(6 * np.pi * ff * t)
    env = np.minimum(1, t / a) * np.where(t < dur, 1.0, np.clip((dur + r - t) / r, 0, 1))
    env *= 0.88 + 0.12 * np.sin(2 * np.pi * 0.25 * t)
    return s * env / 2


def pluck(f, dur=0.7, tau=0.16):
    t = tt(dur)
    s = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) * np.exp(-t / 0.05)
         + 0.12 * np.sin(6 * np.pi * f * t) * np.exp(-t / 0.03))
    return s * np.exp(-t / tau) * np.minimum(1, t / 0.004)


def bass(f, dur, tau=0.4):
    t = tt(dur)
    s = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t) + 0.08 * np.sin(6 * np.pi * f * t)
    return s * np.minimum(1, t / 0.008) * np.exp(-t / tau) * np.clip((dur - t) / 0.04, 0, 1)


def kick():
    t = tt(0.4)
    f = 46 + 75 * np.exp(-t / 0.035)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.13) * np.minimum(1, t / 0.002)


def hat():
    n = int(0.06 * SR)
    x = rng.standard_normal(n)
    x = np.diff(np.diff(x, prepend=0), prepend=0)
    return x * np.exp(-np.arange(n) / SR / 0.014) * 0.2


def click():
    t = tt(0.04)
    x = np.diff(rng.standard_normal(len(t)), prepend=0)
    return np.sin(2 * np.pi * 2300 * t) * np.exp(-t / 0.005) + 0.45 * x * np.exp(-t / 0.0025)


def tick(f=1500):
    t = tt(0.08)
    return np.sin(2 * np.pi * f * t) * np.exp(-t / 0.018) * np.minimum(1, t / 0.001)


def bell(f, dur=2.2):
    t = tt(dur)
    parts = [(1.0, 1.0, 0.9), (2.0, 0.32, 0.5), (2.76, 0.22, 0.32), (5.4, 0.1, 0.16)]
    s = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / d) for r, a, d in parts)
    return s * np.minimum(1, t / 0.003)


def band_noise(n, fine=6, coarse=48):
    x = rng.standard_normal(n)
    return np.convolve(x, np.ones(fine) / fine, 'same') - np.convolve(x, np.ones(coarse) / coarse, 'same')


def whoosh(dur=0.55, peak=0.72):
    t = tt(dur)
    env = np.where(t < dur * peak, (t / (dur * peak)) ** 2.2, np.exp(-(t - dur * peak) / 0.07))
    return band_noise(len(t)) * env


def riser(dur):
    t = tt(dur)
    f = 180 + 700 * (t / dur) ** 2
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25
    return (band_noise(len(t), 4, 30) + tone) * (t / dur) ** 2.5


def impact():
    t = tt(1.8)
    x = band_noise(len(t), 10, 120)
    return x * np.exp(-t / 0.45) * np.minimum(1, t / 0.003)


def glide(f0, f1, dur):
    t = tt(dur)
    f = f0 + (f1 - f0) * (t / dur)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / dur) * (0.8 + 0.2 * np.sin(2 * np.pi * 18 * t))


# ---------- Akor ----------
CH = {  # suara pad, nada dasar bas, nada arpeggio (oktaf 5)
    'C': ([52, 55, 60, 64, 67], 48, [72, 76, 79, 84]),
    'G': ([50, 55, 59, 62, 67], 43, [67, 71, 74, 79]),
    'Am': ([52, 57, 60, 64, 67], 45, [69, 72, 76, 81]),
    'F': ([53, 57, 60, 65, 69], 41, [65, 69, 72, 77]),
}
BARS = [(0.0, 'Am', 2.4), (2.4, 'G', 1.2), (3.6, 'C', 2.4), (6.0, 'G', 2.4), (8.4, 'Am', 2.4), (10.8, 'F', 2.4),
        (13.2, 'C', 2.4), (15.6, 'G', 2.4), (18.0, 'Am', 2.4), (20.4, 'F', 2.4), (22.8, 'C', 3.2)]
BEAT = 0.6

for start, name, length in BARS:
    voices, root, arp = CH[name]
    hook = start < 3.6
    g = 0.05 if hook else 0.075
    for i, n in enumerate(voices):
        add(pad(hz(n), length if start < 22.8 else 2.2, r=1.6 if start >= 22.8 else 1.0), start, g, pan=(i - 2) * 0.25, rev=0.5)
    # Bas: detak pelan di hook, setengah ketuk di adegan logo, tiap ketuk sesudahnya.
    beats = int(round(length / BEAT))
    for b in range(beats):
        bt = start + b * BEAT
        if bt >= 22.8 and b > 0:
            break
        if hook:
            add(bass(hz(root - 12 if name == 'Am' else root), 0.5, 0.18), bt, 0.32 if b % 2 == 0 else 0.18)
        elif bt < 6.6:
            if b % 2 == 0:
                add(bass(hz(root), 1.2, 0.6), bt, 0.3)
        else:
            add(bass(hz(root), 0.58, 0.32), bt, 0.27 if b % 2 == 0 else 0.2)
    # Arpeggio seperdelapan dari 6,6 sampai 22,8.
    for k in range(int(round(length / 0.3))):
        at = start + k * 0.3
        if 6.6 <= at < 22.8:
            note = arp[[0, 1, 2, 3, 2, 1, 2, 1][k % 8]]
            add(pluck(hz(note)), at, 0.06, pan=-0.35 if k % 2 else 0.35, rev=0.6)

# Drum.
t = 6.6
while t < 22.79:
    add(kick(), t, 0.42)
    if t >= 11.4:
        add(hat(), t + 0.3, 0.5, pan=0.25)
    t = round(t + BEAT, 4)
for t0 in (3.6, 22.8):
    add(kick(), t0, 0.55)
    add(impact(), t0, 0.12, rev=0.7)

# ---------- Efek suara (linimasa ad.html) ----------
for i in range(4):                       # empat baris hook
    add(tick(1100 + i * 140), 0.12 + i * 0.52, 0.16, rev=0.3)
add(riser(1.1), 2.5, 0.08, rev=0.4)
add(tick(1900), 2.72, 0.14, rev=0.4)     # "There's a faster way"
for f, d in ((hz(88), 0.0), (hz(95), 0.09)):  # logo
    add(bell(f), 3.72 + d, 0.11, rev=0.8)
for at in (3.6, 6.6, 11.4, 16.2, 19.2, 22.8):  # pergantian adegan
    add(whoosh(), at - 0.4, 0.07, pan=0.0, rev=0.3)
add(glide(700, 1700, 0.75), 7.45, 0.035, rev=0.5)   # laser pindai
for i in range(7):                                   # partikel
    add(tick(2400 + i * 180), 8.18 + i * 0.06, 0.05, pan=-0.3 + i * 0.12, rev=0.6)
for i in range(5):                                   # baris akun masuk
    add(pluck(hz(84 + [0, 2, 4, 7, 9][i]), 0.4, 0.08), 8.6 + i * 0.13, 0.05, pan=0.4, rev=0.5)
for at in (9.6, 12.0, 12.85, 13.65, 14.65):          # klik mouse
    add(click(), at, 0.1)
for at in (9.72, 14.75):                             # berhasil
    add(bell(hz(84), 1.4), at, 0.07, rev=0.7)
    add(bell(hz(91), 1.4), at + 0.08, 0.07, rev=0.7)
add(pluck(hz(93), 0.4, 0.06), 12.88, 0.06, rev=0.5)  # "Disalin"
for i in range(6):                                   # angka ditempel
    add(tick(1700 + i * 60), 13.95 + i * 0.055, 0.06)
add(click(), 17.05, 0.08)                            # seret: tekan
add(whoosh(0.9, 0.6), 17.2, 0.03, rev=0.2)
add(click(), 18.12, 0.06)                            # lepas
for i in range(3):                                   # paket sinkron
    add(pluck(hz(88 + i * 3), 0.4, 0.07), 20.0 + i * 0.13, 0.045, pan=-0.4, rev=0.6)
    add(pluck(hz(91 + i * 3), 0.4, 0.07), 20.85 + i * 0.13, 0.045, pan=0.4, rev=0.6)
add(kick(), 20.8, 0.18)                              # gembok berdenyut
add(bell(hz(86), 1.6), 21.55, 0.08, pan=0.4, rev=0.7)  # akun tiba
for f, d in ((hz(84), 0.0), (hz(88), 0.07), (hz(91), 0.14)):  # penutup
    add(bell(f, 2.6), 22.86 + d, 0.08, rev=0.8)


# ---------- Reverb + master ----------
def conv(x, h):
    n = len(x) + len(h) - 1
    nfft = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(h, nfft), nfft)[: len(x)]


ir_t = tt(2.2)
out = dry.copy()
for ch in range(2):
    ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / 0.5)
    ir = np.convolve(ir, np.ones(5) / 5, 'same')
    ir[: int(0.012 * SR)] = 0  # pre-delay
    ir /= np.sqrt(np.sum(ir ** 2))
    out[ch] += conv(send[ch], ir) * 0.35

t_all = np.arange(N) / SR
fade = np.clip((DUR - t_all) / 1.6, 0, 1) ** 1.5 * np.minimum(1, t_all / 0.02)
out *= fade
out = np.tanh(out * 1.1) / np.tanh(1.1)
out *= 10 ** (-1 / 20) / np.max(np.abs(out))
rms = 20 * np.log10(np.sqrt(np.mean(out ** 2)))

pcm = (np.clip(out.T, -1, 1) * 32767).astype('<i2')
with wave.open(sys.argv[1] if len(sys.argv) > 1 else 'music.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f'ok {DUR:.1f} s, RMS {rms:.1f} dBFS')
