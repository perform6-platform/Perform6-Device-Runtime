# Bluefin UI engine

This tool renders the **packaged BrightSign candidate**, not the Vite source tree.
It supplies only a local already-paired/already-cached device fixture, preserves the
candidate's HTML/CSS/JS bytes, and captures the 12 Bluefin states at 1920×1080,
DPR 1.

```sh
node tools/bluefin-ui-engine/render-candidate.mjs \
  --candidate releases/xt2145/perform6-xt2145-1.5.74.zip \
  --version 1.5.74 \
  --out tmp/bluefin-ui-engine/1.5.74
```

Each state produces a PNG and a JSON geometry snapshot. `run.json` records the
candidate path, viewport, state count, and packaged stylesheet SHA-256.

The fixture does not emulate `autorun.brs`, native `roVideoPlayer`, downloads,
encryption, OTA, or BrightSign hardware. It deliberately isolates the HDMI-1 HTML
presentation layer so those systems cannot hide or distort UI regressions.
