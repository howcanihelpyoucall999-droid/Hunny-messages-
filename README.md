# GoBY.pics — Flat Single-Folder Build

Every file in this folder is at the same level — no subfolders. Upload the folder as-is to any static host (Netlify drag-and-drop, GitHub Pages, Cloudflare Pages, Vercel, S3, or plain nginx/Apache).

## Files
- `index.html` — page markup
- `style.css` — all styles
- `app.js` — main app entry (ES module)
- `crystal.js` — animated WebGL crystal
- `background-removal.js` — MODNet ONNX matting
- `passport-render.js` — cutout, framing, print sheet
- `passport-specs.js` — passport size presets
- `logo.png` — brand logo
- `modnet_fp16.onnx` — AI matting model (~13 MB)
- `favicon.ico` — tab icon
- `manifest.webmanifest` — PWA manifest
- `robots.txt` — crawler policy
- `README.md` — this file

## Run locally
Serve the folder (ES modules require HTTP, not `file://`):
```
python3 -m http.server 8080
```
Then open http://localhost:8080

## Notes
- The Three.js and ONNX Runtime libraries are loaded from a CDN via the `<script type="importmap">` in `index.html`, so nothing to install.
- The AI runs 100% in the browser — WebGPU where available, WASM fallback.
