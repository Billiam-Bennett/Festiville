// Music for camp PA systems, made in the browser: no audio files, nothing to license.
//
//   composeLoop(style, seed)   → a 4-bar loop as plain data (tempo, key, drum hits, bass and chord notes).
//                                Pure and deterministic, so every player hears the same tune from the same
//                                camp, and it's tested in node (test/camp-music.test.js).
//   renderLoop(loop)           → an AudioBuffer of that loop, synthesized once with an OfflineAudioContext.
//   createCampSound(THREE, listener)
//                              → plays each camp's loop from its PA (THREE.PositionalAudio), so it gets
//                                louder as you walk up and fades out ~30 m away. Only camps near you are
//                                rendered and playing, so a full Campground costs nothing far away.
//
// Styles (shared/camps.js → MUSIC_STYLES): house, hip-hop, reggae, chill. The seed (the camp owner's name)
// picks the key, chord progression and small pattern variations, so neighbouring camps sound different.
import { MUSIC_STYLES, DEFAULT_MUSIC, musicById } from "../shared/camps.js";

export const BARS = 4;
export const STEPS_PER_BAR = 16;               // 16th notes
const MINOR = [0, 2, 3, 5, 7, 8, 10];          // natural minor scale
const TONICS = [57, 60, 62, 53, 55];           // A, C, D, F, G (chords sit around midi 53-72)
const PROGRESSIONS = [[0, 5, 2, 6], [0, 3, 6, 2], [0, 5, 3, 4], [0, 6, 5, 6]];   // i–VI–III–VII, i–iv–VII–III, …

// Small deterministic RNG from a string seed (same idea as shared/parts.js → seededRandom).
function rngFrom(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The scale degree `d` above the tonic (wraps into higher octaves).
const degree = (tonic, d) => tonic + MINOR[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
// A chord on scale degree `d`: triad, or a 7th chord with `seventh`.
const chordOn = (tonic, d, seventh = false) => [0, 2, 4, ...(seventh ? [6] : [])].map((k) => degree(tonic, d + k));

// One loop as data: { style, bpm, key, bars, steps, secondsPerStep, duration, events: [...] }.
// An event: { step, kind: "kick" | "snare" | "clap" | "rim" | "hat" | "openhat" | "bass" | "chord" | "pad",
//             vel (0..1), notes? (midi), len? (steps) }. Steps count 16th notes from the loop start.
export function composeLoop(styleId, seed = "") {
  const style = musicById(styleId) ?? musicById(DEFAULT_MUSIC);
  const rnd = rngFrom(`${style.id}|${seed}`);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const tonic = pick(TONICS);
  const prog = pick(PROGRESSIONS);
  const events = [];
  const add = (step, kind, vel, extra = {}) => events.push({ step, kind, vel: Math.round(vel * 100) / 100, ...extra });

  for (let bar = 0; bar < BARS; bar++) {
    const s0 = bar * STEPS_PER_BAR;
    const deg = prog[bar];
    const root = degree(tonic, deg) - 24;            // bass two octaves under the chord
    const fifth = degree(tonic, deg + 4) - 24;
    const fill = bar === BARS - 1;                   // a little variation in the last bar

    if (style.id === "house") {
      for (let b = 0; b < 4; b++) add(s0 + b * 4, "kick", 1);
      add(s0 + 4, "clap", 0.8); add(s0 + 12, "clap", 0.8);
      for (let i = 0; i < 16; i++) if (i % 4 !== 2) add(s0 + i, "hat", i % 2 ? 0.25 : 0.35);
      for (let b = 0; b < 4; b++) add(s0 + b * 4 + 2, "openhat", 0.45);
      for (let b = 0; b < 4; b++) add(s0 + b * 4 + 2, "bass", 0.8, { notes: [b === 3 && fill ? fifth : root], len: 2 });
      const stabs = pick([[6, 14], [3, 10], [6, 11, 14]]);
      for (const st of stabs) add(s0 + st, "chord", 0.5, { notes: chordOn(tonic, deg), len: 2 });
    } else if (style.id === "hiphop") {
      const kicks = pick([[0, 7, 10], [0, 3, 10], [0, 8, 10]]);
      for (const k of kicks) add(s0 + k, "kick", k === 0 ? 1 : 0.85);
      add(s0 + 4, "snare", 0.9); add(s0 + 12, "snare", 0.9);
      if (fill) add(s0 + 15, "snare", 0.45);
      for (let i = 0; i < 16; i += 2) add(s0 + i, "hat", i % 4 ? 0.22 : 0.32);
      add(s0, "bass", 0.85, { notes: [root], len: 6 });
      add(s0 + 10, "bass", 0.75, { notes: [fifth], len: 4 });
      add(s0, "pad", 0.38, { notes: chordOn(tonic, deg, true), len: 15 });
    } else if (style.id === "reggae") {
      add(s0 + 8, "kick", 1); add(s0 + 8, "rim", 0.8);            // the "one drop" on beat 3
      for (let i = 0; i < 16; i += 2) add(s0 + i, "hat", i % 4 ? 0.2 : 0.3);
      add(s0 + 4, "chord", 0.5, { notes: chordOn(tonic, deg), len: 1 });   // skank on 2 and 4
      add(s0 + 12, "chord", 0.5, { notes: chordOn(tonic, deg), len: 1 });
      const third = degree(tonic, deg + 2) - 24;
      for (const [st, n, len] of [[0, root, 3], [4, third, 2], [6, fifth, 2], [10, root, 4]]) add(s0 + st, "bass", 0.85, { notes: [n], len });
    } else {   // chill
      add(s0, "kick", 0.75); add(s0 + 10, "kick", 0.6);
      add(s0 + 4, "rim", 0.55); add(s0 + 12, "rim", 0.55);
      for (let i = 0; i < 16; i += 2) add(s0 + i, "hat", 0.15);
      add(s0, "pad", 0.42, { notes: chordOn(tonic, deg, true), len: 16 });
      add(s0, "bass", 0.7, { notes: [root], len: 7 });
      add(s0 + 8, "bass", 0.6, { notes: [root], len: 7 });
    }
  }
  events.sort((a, b) => a.step - b.step);
  const secondsPerStep = 60 / style.bpm / 4;
  return { style: style.id, bpm: style.bpm, key: tonic % 12, bars: BARS, steps: BARS * STEPS_PER_BAR, secondsPerStep, duration: BARS * STEPS_PER_BAR * secondsPerStep, events };
}

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// Synthesize a loop into an AudioBuffer (mono; the PA's position does the stereo). Browser only.
export async function renderLoop(loop, sampleRate = 32000) {
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const ctx = new OAC(1, Math.ceil(loop.duration * sampleRate), sampleRate);
  const master = ctx.createGain();
  master.gain.value = 0.5;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  const noise = ctx.createBuffer(1, sampleRate, sampleRate);
  const nd = noise.getChannelData(0);
  const r = rngFrom("noise");
  for (let i = 0; i < nd.length; i++) nd[i] = r() * 2 - 1;
  const swing = loop.style === "hiphop" || loop.style === "reggae" ? 0.18 : 0;
  const end = loop.duration - 0.01;   // nothing rings past the loop point (so it loops without a click)

  // A gain envelope: quick attack, exponential decay to silence by `until`.
  const env = (vol, t, until, attack = 0.004) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, Math.max(t + attack + 0.01, Math.min(until, end)));
    g.connect(master);
    return g;
  };
  const noiseHit = (t, vel, type, freq, q, decay) => {
    const src = ctx.createBufferSource(); src.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    src.connect(f).connect(env(vel, t, t + decay));
    src.start(t); src.stop(Math.min(t + decay + 0.02, end));
  };
  const tone = (t, vel, type, freq, decay, slideTo) => {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + Math.min(0.12, decay));
    o.connect(env(vel, t, t + decay));
    o.start(t); o.stop(Math.min(t + decay + 0.02, end));
  };

  for (const e of loop.events) {
    let t = e.step * loop.secondsPerStep;
    if (swing && e.step % 2 === 1) t += swing * loop.secondsPerStep;   // lay back the off 16ths
    const len = (e.len ?? 1) * loop.secondsPerStep;
    if (t >= end) continue;
    switch (e.kind) {
      case "kick": tone(t, e.vel * 1.1, "sine", 150, 0.38, 42); break;
      case "snare": noiseHit(t, e.vel * 0.55, "bandpass", 1800, 0.7, 0.18); tone(t, e.vel * 0.35, "triangle", 190, 0.09); break;
      case "clap": for (const d of [0, 0.012, 0.024]) noiseHit(t + d, e.vel * 0.45, "bandpass", 1200, 1.2, 0.12); break;
      case "rim": tone(t, e.vel * 0.35, "triangle", 820, 0.04); noiseHit(t, e.vel * 0.2, "highpass", 3000, 0.5, 0.03); break;
      case "hat": noiseHit(t, e.vel * 0.35, "highpass", 7500, 0.6, 0.045); break;
      case "openhat": noiseHit(t, e.vel * 0.3, "highpass", 7000, 0.6, 0.22); break;
      case "bass": {
        const o = ctx.createOscillator(); o.type = loop.style === "house" ? "sawtooth" : "triangle";
        o.frequency.value = hz(e.notes[0]);
        const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = loop.style === "house" ? 520 : 380;
        o.connect(f).connect(env(e.vel * 0.55, t, t + len * 0.95, 0.01));
        o.start(t); o.stop(Math.min(t + len, end));
        break;
      }
      case "chord":
      case "pad": {
        const soft = e.kind === "pad";
        const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = soft ? 1400 : 2600;
        f.connect(env(e.vel * (soft ? 0.22 : 0.18), t, t + len * (soft ? 1 : 0.8), soft ? 0.12 : 0.006));
        for (const n of e.notes) {
          for (const detune of soft ? [0] : [-7, 7]) {
            const o = ctx.createOscillator(); o.type = soft ? "triangle" : "sawtooth";
            o.frequency.value = hz(n); o.detune.value = detune;
            o.connect(f); o.start(t); o.stop(Math.min(t + len, end));
          }
        }
        break;
      }
    }
  }
  const buf = await ctx.startRendering();
  // Even out loudness between styles: scale so the loudest sample sits at 0.9.
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < d.length; i++) d[i] *= 0.9 / peak;
  return buf;
}

// ---------- Playing camp music in the world ----------
const HEAR = 32;          // meters: silent beyond this (linear fade from REF to HEAR)
const REF = 4;            // meters: full volume within this
const START = 36, STOP = 42;   // start/stop playing (a little past HEAR, so walking in fades up smoothly)

export function createCampSound(THREE, listener) {
  const ctx = listener.context;
  const loops = new Map();     // "style|seed" -> { loop, buffer: Promise<AudioBuffer|null> }
  const emitters = new Map();  // camp id -> { obj, audio, key, x, z, playing }
  let enabled = true;
  const root = new THREE.Group();

  function loopFor(style, seed) {
    const key = `${style}|${seed}`;
    if (!loops.has(key)) {
      const loop = composeLoop(style, seed);
      loops.set(key, { loop, buffer: null });
    }
    return loops.get(key);
  }
  function bufferFor(entry) {
    entry.buffer ??= renderLoop(entry.loop).catch((err) => { console.warn("Couldn't make camp music:", err); return null; });
    return entry.buffer;
  }

  // Make the camp's PA play `style` from (x, z), or stop it (style null). Cheap to call on every camp change.
  function set(id, pa) {
    const em = emitters.get(id);
    if (!pa) { if (em) remove(id); return; }
    const key = `${pa.style}|${pa.seed}`;
    if (em && em.key === key) { em.obj.position.set(pa.x, 1, pa.z); em.x = pa.x; em.z = pa.z; return; }
    if (em) remove(id);
    const obj = new THREE.Object3D();
    obj.position.set(pa.x, 1, pa.z);
    root.add(obj);
    emitters.set(id, { obj, audio: null, key, entry: loopFor(pa.style, pa.seed), x: pa.x, z: pa.z, playing: false, loading: false });
  }
  function remove(id) {
    const em = emitters.get(id);
    if (!em) return;
    stop(em);
    em.removed = true;
    root.remove(em.obj);
    emitters.delete(id);
  }
  function stop(em) {
    if (em.audio) { if (em.audio.isPlaying) em.audio.stop(); em.audio.disconnect?.(); em.obj.remove(em.audio); em.audio = null; }
    em.playing = false;
  }
  async function start(em) {
    if (em.loading || em.playing) return;
    em.loading = true;
    const buffer = await bufferFor(em.entry);
    em.loading = false;
    if (!buffer || em.removed || !enabled) return;
    const audio = new THREE.PositionalAudio(listener);
    audio.setBuffer(buffer);
    audio.setLoop(true);
    audio.setDistanceModel("linear");
    audio.setRefDistance(REF);
    audio.setMaxDistance(HEAR);
    audio.setRolloffFactor(1);
    audio.setVolume(0.7);
    // Start where a shared clock says the loop is, so the speakers' thump (beat()) matches what you hear.
    audio.offset = ctx.currentTime % buffer.duration;
    em.obj.add(audio);
    em.audio = audio;
    if (ctx.state === "running") audio.play();
    em.playing = true;
  }

  // Called every frame with where you are: start camps that came into earshot, stop ones you left.
  function update(here) {
    for (const em of emitters.values()) {
      const d = Math.hypot(em.x - here.x, em.z - here.z);
      if (enabled && !em.playing && d < START) start(em);
      else if (em.playing && (d > STOP || !enabled)) stop(em);
      else if (em.playing && em.audio && !em.audio.isPlaying && ctx.state === "running") { em.audio.offset = ctx.currentTime % em.audio.buffer.duration; em.audio.play(); }
    }
  }

  // How hard the speakers should thump right now (0..1): a pulse on every beat of that camp's music.
  function pulse(id, fallbackT) {
    const em = emitters.get(id);
    const loop = em?.entry.loop;
    if (!loop) return 0;
    const t = ctx.state === "running" ? ctx.currentTime : fallbackT;
    const beat = (t % loop.duration) / (loop.secondsPerStep * 4);
    return Math.exp(-(beat % 1) * 7);
  }

  function setEnabled(on) {
    enabled = on;
    if (!on) for (const em of emitters.values()) stop(em);
  }

  return {
    root, set, remove, update, pulse, setEnabled,
    styles: MUSIC_STYLES,
    // For tests and ?debug: what's playing and how loud it would be from `here`.
    debug: (here) => [...emitters].map(([id, em]) => ({ id, style: em.entry.loop.style, playing: em.playing, distance: here ? Math.hypot(em.x - here.x, em.z - here.z) : null })),
  };
}
