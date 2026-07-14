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

  // Melody transcribed from a clean reference recording of the Toy Symphony
  // (tonic = 0, i.e. G), quantized to beats: [semitone offset from base key, duration in beats]
  const MELODY = [
    [0, 1.5], [4, 0.75], [2, 0.25], [2, 2.75], [4, 1.25], [9, 2],
    [5, 0.25], [4, 1], [2, 0.75], [3, 0.5], [7, 0.5], [11, 1.75],
    [4, 0.5], [2, 3], [4, 1.25], [9, 0.5], [9, 0.5], [7, 0.75],
    [5, 0.25], [4, 1.25], [2, 0.75], [2, 0.75], [0, 0.75], [7, 1],
    [9, 0.75], [6, 0.25], [7, 0.5], [9, 1], [8, 0.75], [9, 1.75],
    [5, 0.5], [9, 1], [2, 0.5], [4, 0.25], [3, 0.25], [7, 0.5],
    [5, 0.5], [4, 1.75],
  ];

  // Backing parts inspired by the reference recording's own texture: the Toy
  // Symphony is built on a continuous two-octave tonic drone (found by isolating
  // the piece's two loudest, most sustained pitches), plus a light original
  // percussion layer for "drums, etc." that keeps going while the sample leads.
  const DRONE_PATTERN = [[0, 2], [0, 2], [0, 2], [0, 2]];
  const DRONE_BEATS_PER_LOOP = 8;
  const BASS_BASE_HZ = 98.0; // G2 (drone root, one octave below the recording's G3)

  const KICK_BEATS = [0, 2];
  const SNARE_BEATS = [1, 3];
  const HIHAT_BEATS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
  const DRUM_BEATS_PER_LOOP = 4;

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

  let noiseBuffer = null;

  function ensureAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---------- Backing synth (bass + drums) ----------

  function getNoiseBuffer(ctx) {
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
  }

  function playDroneNote(semi, seconds) {
    const ctx = ensureAudioCtx();
    const now = ctx.currentTime;
    const releaseAt = now + seconds;
    // two octaves together, like the sustained drone in the reference recording
    [0, 12].forEach((octave) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = BASS_BASE_HZ * Math.pow(2, (semi + octave) / 12);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(octave === 0 ? 0.16 : 0.1, now + 0.08);
      gain.gain.setValueAtTime(octave === 0 ? 0.16 : 0.1, releaseAt - 0.1);
      gain.gain.exponentialRampToValueAtTime(0.0001, releaseAt);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(releaseAt + 0.02);
    });
  }

  function playKick() {
    const ctx = ensureAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.15);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  function playHihat() {
    const ctx = ensureAudioCtx();
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.06);
  }

  function playSnare() {
    const ctx = ensureAudioCtx();
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.13);
  }

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

  async function onRecordingStopped() {
    clearTimeout(recTimer);
    if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;

    const blob = new Blob(chunks, { type: (recorder && recorder.mimeType) || 'audio/webm' });
    chunks = [];

    try {
      const arrayBuf = await blob.arrayBuffer();
      sampleBuffer = await ensureAudioCtx().decodeAudioData(arrayBuf);
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

  function playSemitone(semi) {
    if (!sampleBuffer) return;
    const ctx = ensureAudioCtx();
    const src = ctx.createBufferSource();
    src.buffer = sampleBuffer;
    src.playbackRate.value = Math.pow(2, semi / 12);
    src.connect(ctx.destination);
    src.start();

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
      const id = setTimeout(() => playSemitone(semi + state.demoPitch), t);
      demoTimeouts.push(id);
      t += dur * beatMs;
    });
    const loopId = setTimeout(() => {
      if (state.isPlayingDemo) scheduleMelodyLoop();
    }, t + 150);
    demoTimeouts.push(loopId);
  }

  function scheduleDroneLoop() {
    const beatMs = 60000 / state.tempo;
    let t = 0;
    DRONE_PATTERN.forEach(([semi, dur]) => {
      const id = setTimeout(() => playDroneNote(semi, (dur * beatMs) / 1000), t);
      demoTimeouts.push(id);
      t += dur * beatMs;
    });
    const loopId = setTimeout(() => {
      if (state.isPlayingDemo) scheduleDroneLoop();
    }, DRONE_BEATS_PER_LOOP * beatMs);
    demoTimeouts.push(loopId);
  }

  function scheduleDrumLoop() {
    const beatMs = 60000 / state.tempo;
    const schedule = (beats, fn) => beats.forEach((b) => {
      const id = setTimeout(fn, b * beatMs);
      demoTimeouts.push(id);
    });
    schedule(KICK_BEATS, playKick);
    schedule(SNARE_BEATS, playSnare);
    schedule(HIHAT_BEATS, playHihat);
    const loopId = setTimeout(() => {
      if (state.isPlayingDemo) scheduleDrumLoop();
    }, DRUM_BEATS_PER_LOOP * beatMs);
    demoTimeouts.push(loopId);
  }

  function toggleDemo() {
    if (!state.hasSample) return;
    if (state.isPlayingDemo) { stopDemoPlayback(); return; }

    state.isPlayingDemo = true;
    state.statusText = 'PLAYING DEMO';
    render();

    scheduleMelodyLoop();
    scheduleDroneLoop();
    scheduleDrumLoop();
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
      el.textContent = state.isPlayingDemo ? '■ STOP' : '▶ DEMO';
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
