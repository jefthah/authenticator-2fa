# Promo material

Every image and video here is rendered from the HTML in this folder. The accounts shown are made up
(`example.com`), and the QR code is a random decorative pattern that does not decode to anything.

| File | What |
| --- | --- |
| `ad-en.mp4`, `ad-id.mp4` | 26-second intro video, 1920×1080, 30 fps, H.264 + AAC |
| `thumbnail-en.png`, `thumbnail-id.png` | 1280×720 thumbnail (YouTube, posts) |
| `social-preview-en.png`, `social-preview-id.png` | 1280×640, for the repository's *Social preview* |

The soundtrack (music and sound effects) is synthesized by `music.py`, so it carries no third-party
license. `music.wav` is not committed; generate it first.

## Re-rendering

Needs Chrome, Node 22+ (built-in WebSocket), ffmpeg, and Python with numpy.

```bash
python music.py music.wav
node render.mjs shot thumbnail.html thumbnail-en.png --w 1280 --h 720 --query "lang=en"
node render.mjs shot thumbnail.html social-preview-en.png --w 1280 --h 640 --query "lang=en&h=640"
node render.mjs video ad.html ad-en.mp4 --query lang=en --audio music.wav
```

Use `lang=id` for the Indonesian version. To check single moments of the video:
`node render.mjs shot ad.html check.png --query lang=en --times 9.9,13.0` writes `check-9.9.png` and `check-13.0.png`.

- `shared.css`, `shared.js`: mock of the extension popup, icons, decorative QR.
- `ad.html`: the video timeline, driven by `window.render(seconds)`. The sound effects in `music.py`
  use the same timings.
- Set `CHROME` and `FFMPEG` environment variables if they are not in the default locations.
