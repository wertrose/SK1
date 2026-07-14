# SampleBox — SK-1 Style Sampler

A browser-based homage to the sampling function of the Casio SK-1: record up to 1.4
seconds of any sound from your microphone, then play it back across a 1-octave
keyboard with classic hardware-sampler pitch-shifting (the recorded key plays at
original pitch/speed, every other key transposes it up or down). Includes a
"Toy Symphony" style demo song that plays a little melody using your sample, with
independent tempo and pitch controls.

Built as a **static site with no backend** — recording, pitch-shifting, and playback
all happen client-side via the Web Audio API. Nothing is ever uploaded anywhere;
closing or reloading the tab clears the sample, just like powering off the real
hardware.

## Live site

The `site/` folder deploys automatically to GitHub Pages on every push to `main`
(see `.github/workflows/deploy.yml`). Enable it once under
**Settings → Pages → Source → GitHub Actions**, then push — no build step required.

## Running locally

Microphone access requires a "secure context," so opening `index.html` directly
(`file://`) may not work in every browser. Serve it locally instead:

```
cd site
python3 -m http.server 8000
# open http://localhost:8000
```

(`localhost` counts as secure, so mic access works there too.)

## How it works

- **Portrait phone** — shows the control panel (SAMPLE / PLAY / CLEAR, plus the
  demo song's tempo and pitch controls) with a hint to rotate for the keyboard.
- **Landscape phone** — shows a full-width 1-octave keyboard with a compact
  transport strip up top.
- **Desktop / wide window** — shows the control panel and keyboard together, no
  rotation needed.
- **SAMPLE** — records from the mic, auto-stopping at 1.4 seconds (tap again to
  stop early).
- **PLAY** — plays the sample back at its original pitch (the leftmost C key).
- Every other key plays the same sample pitch-shifted by semitone, using
  `playbackRate` — exactly how the SK-1's sampler works (pitch and speed move
  together).
- **DEMO** — plays a short original toy-tune melody using your sample, driven by
  the TEMPO (▲▼, 60–200 BPM) and PITCH (±12 semitones) controls.

## Project structure

```
site/                   the deployed static site (index.html, style.css, app.js)
.github/workflows/      GitHub Pages deploy workflow
project/, chats/        original Claude Design handoff bundle (design source, not deployed)
```

`project/` and `chats/` are kept for provenance — they're the original design
prototype and the conversation that shaped it — but are not part of the published
site.
