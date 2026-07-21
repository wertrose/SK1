(() => {
  'use strict';

  const MAX_SAMPLE_SECONDS = 1.4;
  const DEFAULT_TEMPO = 120;
  const TEMPO_MIN = 60;
  const TEMPO_MAX = 200;
  const TEMPO_STEP = 5;

  const WHITE_SEMI = [0, 2, 4, 5, 7, 9, 11, 12];
  const WHITE_LABELS = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C'];
  const BLACK_SEMI = [1, 3, 6, 8, 10];
  const BLACK_AFTER_WHITE = [0, 1, 3, 4, 5]; // index of white key each black key sits after

  // Violin I melody from a MuseScore MIDI export of the Toy Symphony (tonic = 0,
  // i.e. C, matching the file's own key signature), quantized to beats:
  // [semitone offset from base key, duration in beats]
  const MELODY = [
    [0, 2], [4, 1], [4, 1], [2, 2], [5, 1], [5, 1], [4, 2], [9, 1],
    [7, 1], [7, 1], [5, 1], [4, 2], [2, 1], [5, 0.5], [4, 0.5], [2, 1],
    [0, 1], [0, 1], [7, 1], [4, 1], [7, 1], [5, 2], [9, 1], [9, 1],
    [7, 1], [5, 1], [4, 2], [2, 1], [5, 0.5], [4, 0.5], [2, 1], [0, 1],
  ];

  const state = {
    hasSample: false,
    isRecording: false,
    isPlayingDemo: false,
    tempo: DEFAULT_TEMPO,
    demoPitch: 0,
    statusText: 'PRESS SAMPLE TO RECORD',
    activeSemi: null,
  };

  let audioCtx = null;
  let sampleBuffer = null;
  let mediaStream = null;
  let recorder = null;
  let chunks = [];
  let recTimer = null;
  let activeTimer = null;
  let demoTimeouts = [];

  function ensureAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---------- Recording ----------

  async function startRecording() {
    if (state.isRecording) return;
    stopDemoPlayback();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      state.statusText = 'MIC NOT SUPPORTED';
      render();
      return;
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      state.statusText = err && err.name === 'NotFoundError' ? 'NO MICROPHONE FOUND' : 'MIC ACCESS DENIED';
      render();
      return;
    }

    ensureAudioCtx();
    chunks = [];

    try {
      recorder = new MediaRecorder(mediaStream);
    } catch (err) {
      mediaStream.getTracks().forEach((t) => t.stop());
      state.statusText = 'RECORDING NOT SUPPORTED';
      render();
      return;
    }

    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = onRecordingStopped;
    recorder.start();

    state.isRecording = true;
    state.statusText = 'RECORDING...';
    render();

    recTimer = setTimeout(() => {
      if (recorder && recorder.state === 'recording') recorder.stop();
    }, MAX_SAMPLE_SECONDS * 1000);
  }

  function stopRecordingEarly() {
    if (recorder && recorder.state === 'recording') recorder.stop();
  }

  // Real hardware samplers trim the recorded buffer down to the actual sound
  // instead of keeping the full recording window, so silent lead-in/lead-out
  // doesn't get pitch-shifted and played back along with every note.
  function trimSilence(buffer, ctx) {
    const numChannels = buffer.numberOfChannels;
    const length = buffer.length;
    const channelsData = [];
    let peak = 0;
    for (let c = 0; c < numChannels; c++) {
      const data = buffer.getChannelData(c);
      channelsData.push(data);
      for (let i = 0; i < length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }
    if (peak === 0) return buffer;

    const threshold = Math.max(0.01, peak * 0.04);

    let start = 0;
    findStart:
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++) {
        if (Math.abs(channelsData[c][i]) > threshold) { start = i; break findStart; }
      }
    }

    let end = length - 1;
    findEnd:
    for (let i = length - 1; i >= 0; i--) {
      for (let c = 0; c < numChannels; c++) {
        if (Math.abs(channelsData[c][i]) > threshold) { end = i; break findEnd; }
      }
    }

    if (end <= start) return buffer;

    const pad = Math.round(0.02 * buffer.sampleRate);
    const trimStart = Math.max(0, start - pad);
    const trimEnd = Math.min(length - 1, end + pad);
    const trimLength = trimEnd - trimStart + 1;

    const trimmed = ctx.createBuffer(numChannels, trimLength, buffer.sampleRate);
    for (let c = 0; c < numChannels; c++) {
      trimmed.getChannelData(c).set(channelsData[c].subarray(trimStart, trimStart + trimLength));
    }
    return trimmed;
  }

  async function onRecordingStopped() {
    clearTimeout(recTimer);
    if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;

    const blob = new Blob(chunks, { type: (recorder && recorder.mimeType) || 'audio/webm' });
    chunks = [];

    try {
      const arrayBuf = await blob.arrayBuffer();
      const ctx = ensureAudioCtx();
      const decoded = await ctx.decodeAudioData(arrayBuf);
      sampleBuffer = trimSilence(decoded, ctx);
      state.isRecording = false;
      state.hasSample = true;
      state.statusText = 'SAMPLE READY';
    } catch (err) {
      state.isRecording = false;
      state.hasSample = false;
      state.statusText = 'RECORD ERROR - TRY AGAIN';
    }
    render();
  }

  function toggleRecord() {
    if (state.isRecording) stopRecordingEarly();
    else startRecording();
  }

  // ---------- Playback ----------

  function playSemitone(semi, durationSeconds) {
    if (!sampleBuffer) return;
    const ctx = ensureAudioCtx();
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = sampleBuffer;
    src.playbackRate.value = Math.pow(2, semi / 12);
    src.connect(gain).connect(ctx.destination);

    const now = ctx.currentTime;
    src.start(now);

    // In the demo song, cut each note off at the end of its own beat slot instead
    // of letting the full (possibly stretched-out) sample bleed into the next note.
    if (durationSeconds) {
      const fadeStart = Math.max(now, now + durationSeconds - 0.03);
      gain.gain.setValueAtTime(1, fadeStart);
      gain.gain.linearRampToValueAtTime(0, fadeStart + 0.03);
      src.stop(fadeStart + 0.03);
    }

    state.activeSemi = semi;
    render();
    clearTimeout(activeTimer);
    activeTimer = setTimeout(() => {
      state.activeSemi = null;
      render();
    }, 180);
  }

  function playSample() { playSemitone(0); }

  function clearSample() {
    sampleBuffer = null;
    stopDemoPlayback();
    state.hasSample = false;
    state.statusText = 'PRESS SAMPLE TO RECORD';
    render();
  }

  // ---------- Demo song ----------

  function stopDemoPlayback() {
    demoTimeouts.forEach(clearTimeout);
    demoTimeouts = [];
    if (state.isPlayingDemo) {
      state.isPlayingDemo = false;
      state.statusText = state.hasSample ? 'SAMPLE READY' : 'PRESS SAMPLE TO RECORD';
      render();
    }
  }

  function scheduleMelodyLoop() {
    const beatMs = 60000 / state.tempo;
    let t = 0;
    MELODY.forEach(([semi, dur]) => {
      const noteSeconds = (dur * beatMs) / 1000;
      const id = setTimeout(() => playSemitone(semi + state.demoPitch, noteSeconds), t);
      demoTimeouts.push(id);
      t += dur * beatMs;
    });
    const loopId = setTimeout(() => {
      if (state.isPlayingDemo) scheduleMelodyLoop();
    }, t + 150);
    demoTimeouts.push(loopId);
  }

  function toggleDemo() {
    if (!state.hasSample) return;
    if (state.isPlayingDemo) { stopDemoPlayback(); return; }

    state.isPlayingDemo = true;
    state.statusText = 'PLAYING DEMO';
    render();

    scheduleMelodyLoop();
  }

  function bumpTempo(delta) {
    state.tempo = clamp(state.tempo + delta, TEMPO_MIN, TEMPO_MAX);
    render();
  }

  function setDemoPitch(value) {
    state.demoPitch = clamp(parseInt(value, 10) || 0, -12, 12);
    render();
  }

  // ---------- Keyboard construction ----------

  function attachKeyEvents(el, semi) {
    const onPress = (e) => { e.preventDefault(); playSemitone(semi); };
    el.addEventListener('pointerdown', onPress);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playSemitone(semi); }
    });
  }

  function buildKeyboard() {
    const whiteContainer = document.querySelector('.white-keys');
    const blackContainer = document.querySelector('.black-keys');

    WHITE_SEMI.forEach((semi, i) => {
      const el = document.createElement('div');
      el.className = 'key key-white';
      el.dataset.semi = String(semi);
      el.textContent = WHITE_LABELS[i];
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      attachKeyEvents(el, semi);
      whiteContainer.appendChild(el);
    });

    BLACK_SEMI.forEach((semi, i) => {
      const el = document.createElement('div');
      el.className = 'key key-black';
      el.dataset.semi = String(semi);
      el.style.left = `${(BLACK_AFTER_WHITE[i] + 1) * 12.5 - 6.5}%`;
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      attachKeyEvents(el, semi);
      blackContainer.appendChild(el);
    });
  }

  // ---------- Render ----------

  function render() {
    document.querySelectorAll('[data-role="lcd"]').forEach((el) => {
      el.textContent = state.statusText;
      el.classList.toggle('blink', state.isRecording);
    });

    document.querySelectorAll('[data-role="sample-label"]').forEach((el) => {
      el.textContent = state.isRecording ? 'STOP' : 'SAMPLE';
    });
    document.querySelectorAll('[data-role="rec-dot"]').forEach((el) => {
      el.classList.toggle('pulse', state.isRecording);
    });

    document.querySelectorAll('[data-role="play-btn"]').forEach((el) => {
      el.disabled = !state.hasSample;
    });

    document.querySelectorAll('[data-role="demo-btn"]').forEach((el) => {
      el.disabled = !state.hasSample;
      el.textContent = state.isPlayingDemo ? '■ STOP' : 'DEMO';
      el.classList.toggle('active', state.isPlayingDemo);
    });

    document.getElementById('clearBtn').disabled = !state.hasSample;
    document.getElementById('tempoValue').textContent = `${state.tempo} BPM`;
    document.getElementById('pitchValue').textContent = (state.demoPitch > 0 ? '+' : '') + state.demoPitch;
    document.getElementById('pitchSlider').value = String(state.demoPitch);

    document.querySelectorAll('[data-semi]').forEach((el) => {
      el.classList.toggle('active', Number(el.dataset.semi) === state.activeSemi);
    });
  }

  // ---------- Wire up ----------

  function init() {
    buildKeyboard();

    document.querySelectorAll('[data-role="sample-btn"]').forEach((el) => {
      el.addEventListener('click', toggleRecord);
    });
    document.querySelectorAll('[data-role="play-btn"]').forEach((el) => {
      el.addEventListener('click', playSample);
    });
    document.querySelectorAll('[data-role="demo-btn"]').forEach((el) => {
      el.addEventListener('click', toggleDemo);
    });

    document.getElementById('clearBtn').addEventListener('click', clearSample);
    document.getElementById('tempoUp').addEventListener('click', () => bumpTempo(TEMPO_STEP));
    document.getElementById('tempoDown').addEventListener('click', () => bumpTempo(-TEMPO_STEP));
    document.getElementById('pitchSlider').addEventListener('input', (e) => setDemoPitch(e.target.value));

    render();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
