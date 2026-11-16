import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SHRINES } from "./shrines-data.js";

/* ───────────── constants ───────────── */
// Overview: Europe in Web Mercator (zoom-6 tile coordinates of the image corners).
const EU = { world: 440, relief: 20, x0: 29.866666666666667, x1: 38.4, y0: 13.457790841581378, y1: 25.565983223523137 };
// Detail: the ground around one recording, built from one LIDAR scan.
const DETAIL = { world: 240, relief: 16 };
let WORLD = EU.world, DEPTH = EU.world;   // extent of the terrain currently shown
const BG = new THREE.Color(0x06080a);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const isSmall = matchMedia("(max-width: 720px)").matches;

const $ = (s) => document.querySelector(s);
const stage = $("#stage");
const hud = { x: $("#hud-x"), y: $("#hud-y"), z: $("#hud-z"), pts: $("#hud-pts"), az: $("#hud-az") };

/* ───────────── renderer / scene ───────────── */
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(BG);
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 2000);
camera.position.set(0, innerWidth < 720 ? 1000 : 430, innerWidth < 720 ? 1150 : 520);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.screenSpacePanning = false;
controls.minDistance = 22;
controls.maxDistance = 1700;
controls.maxPolarAngle = Math.PI * 0.46;
controls.rotateSpeed = 0.45;
controls.zoomSpeed = 0.7;
controls.panSpeed = 0.7;
controls.autoRotate = !reduceMotion;
controls.autoRotateSpeed = 0.18;
controls.listenToKeyEvents(window);
controls.keyPanSpeed = 14;

/* ───────────── terrain point cloud ───────────── */
let heightAt = () => 0;

const uniforms = {
  uTime: { value: 0 },
  uSpan: { value: EU.world },
  uSize: { value: isSmall ? 1.6 : 1.35 },
  uPx: { value: renderer.getPixelRatio() },
  uFocus: { value: new THREE.Vector3(9999, 0, 9999) },
  uLevel: { value: 0 },
  uListen: { value: 0 },
  uInk: { value: new THREE.Color(0xdfe6ea) },
  uIce: { value: new THREE.Color(0xa9dbe8) },
  uBg: { value: BG },
};

const pointMat = new THREE.ShaderMaterial({
  uniforms,
  transparent: false,
  vertexShader: /* glsl */ `
    attribute float aShade;
    attribute float aRand;
    attribute float aWater;
    uniform float uTime, uSize, uPx, uLevel, uListen, uSpan;
    uniform vec3 uFocus;
    varying float vShade, vFog, vSweep, vRing, vWater;
    void main(){
      vec3 p = position;
      vWater = aWater;
      // water: a slow swell, no lidar returns, so only a sparse shimmer
      // (aWater: 1 = sea, 0.75 = lake, 0.6 = river; inland water barely moves)
      if (aWater > 0.5) {
        float swell = aWater > 0.9 ? 1.0 : (aWater > 0.7 ? 0.3 : 0.12);
        p.y += (sin(p.x * 0.11 + uTime * 0.6) * 0.18 + sin(p.z * 0.07 - uTime * 0.45 + p.x * 0.03) * 0.22) * swell;
      }
      // LIDAR sweep: a slow band travelling across the terrain
      float sweepX = mod(uTime * uSpan * 0.03, uSpan * 2.0) - uSpan;
      vSweep = exp(-pow((p.x + p.z * 0.25 - sweepX) / (uSpan * 0.006), 2.0));
      // listening rings around the active shrine, driven by audio level
      float d = distance(p.xz, uFocus.xz);
      float r = mod(uTime * 11.0, 60.0);
      vRing = exp(-pow((d - r) / 1.6, 2.0)) * (1.0 - r / 60.0) * (0.25 + uLevel * 2.2) * uListen;
      vRing += smoothstep(14.0, 0.0, d) * uLevel * 1.4 * uListen;
      p.y += vRing * 0.9;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float depth = -mv.z;
      gl_PointSize = clamp(uSize * uPx * (230.0 / depth), 0.9, 5.0 * uPx);
      vShade = aShade;
      vFog = smoothstep(1700.0, 220.0, depth);
      // scan dropout flicker
      vFog *= step(0.04, fract(aRand + uTime * 0.013 * aRand));
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uInk, uIce, uBg;
    uniform float uListen;
    uniform float uTime;
    varying float vShade, vFog, vSweep, vRing, vWater;
    void main(){
      vec2 c = gl_PointCoord - 0.5;
      if (dot(c,c) > 0.25) discard;
      float s = pow(vShade, 1.35);
      vec3 col = uInk * (0.1 + s * 1.05);
      if (vWater > 0.5) {
        // water: cool tint with a slow, scattered glint
        float glint = pow(0.5 + 0.5 * sin(uTime * 0.9 + vShade * 61.0), 6.0);
        col = vec3(0.42, 0.66, 0.78) * (0.22 + 0.35 * vShade) + uIce * glint * 0.55;
      }
      col *= mix(1.0, 0.72, uListen);
      col += uInk * vSweep * 0.35;
      col = mix(col, uIce, clamp(vRing, 0.0, 1.0) * 0.8);
      gl_FragColor = vec4(mix(uBg, col, vFog), 1.0);
    }`,
});

/* Builds a point cloud from a terrain PNG. opt: { world, relief, keepLand, disc } */
function makeCloud(img, opt) {
  const NX = img.width, NZ = img.height;
  const W_ = opt.world, D_ = opt.world * NZ / NX;
  const cv = document.createElement("canvas");
  cv.width = NX; cv.height = NZ;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, NX, NZ).data;

  // R = shade; 0 marks sea, 1 lake, 2 river. G + high nibble of B = 12-bit height above sea level.
  // (Only the top bits are used so that browser colour handling cannot disturb the heights.)
  const H = new Float32Array(NX * NZ);
  const W = new Uint8Array(NX * NZ);   // 0 land, 1 sea, 2 lake, 3 river
  for (let i = 0; i < NX * NZ; i++) {
    const r = px[i * 4];
    H[i] = (px[i * 4 + 1] * 16 + (px[i * 4 + 2] >> 4)) / 4095;
    W[i] = r < 3 ? r + 1 : 0;
  }

  const hAt = (x, z) => {
    const u = THREE.MathUtils.clamp((x / W_ + 0.5) * (NX - 1), 0, NX - 1);
    const v = THREE.MathUtils.clamp((z / D_ + 0.5) * (NZ - 1), 0, NZ - 1);
    const i0 = Math.floor(u), j0 = Math.floor(v), i1 = Math.min(i0 + 1, NX - 1), j1 = Math.min(j0 + 1, NZ - 1);
    const fu = u - i0, fv = v - j0;
    const h = H[j0 * NX + i0] * (1 - fu) * (1 - fv) + H[j0 * NX + i1] * fu * (1 - fv) +
              H[j1 * NX + i0] * (1 - fu) * fv + H[j1 * NX + i1] * fu * fv;
    return h * opt.relief;
  };

  const stride = isSmall ? 2 : 1;
  const keepLand = opt.keepLand;
  const keepWater = 0.11;
  const KEEP = [keepLand, keepWater, 0.3, 0.5], WAT = [0, 1, 0.75, 0.6];
  const pos = [], shade = [], rnd = [], wat = [];
  const cell = W_ / NX;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let j = 0; j < NZ; j += stride) {
    for (let i = 0; i < NX; i += stride) {
      const k = j * NX + i, isW = W[k];
      // the scan thins out toward its limits instead of ending in a wall
      const edge = opt.disc ? (1 - Math.hypot(i / NX - 0.5, j / NZ - 0.5) * 2) / 0.2 : Math.min(i, j, NX - 1 - i, NZ - 1 - j) / 40;
      if (edge <= 0) continue;
      if (rand() > KEEP[isW] * (edge >= 1 ? 1 : edge * edge * (3 - 2 * edge))) continue;
      const x = (i / (NX - 1) - 0.5) * W_ + (rand() - 0.5) * cell * stride;
      const z = (j / (NZ - 1) - 0.5) * D_ + (rand() - 0.5) * cell * stride;
      pos.push(x, H[k] * opt.relief, z);
      shade.push(isW ? rand() : px[k * 4] / 255);
      rnd.push(rand()); wat.push(WAT[isW]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aShade", new THREE.Float32BufferAttribute(shade, 1));
  geo.setAttribute("aRand", new THREE.Float32BufferAttribute(rnd, 1));
  geo.setAttribute("aWater", new THREE.Float32BufferAttribute(wat, 1));
  return { points: new THREE.Points(geo, pointMat), W: W_, D: D_, heightAt: hAt, count: pos.length / 3 };
}

/* ───────────── two views: Europe overview · one detail terrain ───────────── */
const euGroup = new THREE.Group(), detGroup = new THREE.Group();
scene.add(euGroup, detGroup);
detGroup.visible = false;
let mode = "europe";            // "europe" | "detail"
let eu = null, det = null;      // { points, W, D, heightAt, count }
let detIdx = -1, detTop = null; // the shrine whose ground is shown
let busy = false, euCam = null;

const fadeEl = document.createElement("div");
fadeEl.id = "fade";
stage.after(fadeEl);
const backBtn = document.createElement("button");
backBtn.id = "back"; backBtn.type = "button"; backBtn.className = "u"; backBtn.hidden = true;
backBtn.textContent = "← Europe";
document.body.appendChild(backBtn);

function useView(c) {
  WORLD = c.W; DEPTH = c.D; heightAt = c.heightAt;
  uniforms.uSpan.value = c.W;
  hud.pts.textContent = c.count.toLocaleString("en-US");
}

// latitude / longitude ↔ position on the overview
const geoToWorld = (lat, lon) => {
  const tx = (lon + 180) / 360 * 64;
  const ty = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 64;
  return [((tx - EU.x0) / (EU.x1 - EU.x0) - 0.5) * eu.W, ((ty - EU.y0) / (EU.y1 - EU.y0) - 0.5) * eu.D];
};
const worldToLonLat = (x, z) => {
  const tx = EU.x0 + (x / eu.W + 0.5) * (EU.x1 - EU.x0), ty = EU.y0 + (z / eu.D + 0.5) * (EU.y1 - EU.y0);
  return [tx / 64 * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / 64))) * 180 / Math.PI];
};

/* ───────────── shrines ───────────── */
const shrineLayer = $("#shrine-layer");
const shrineObjs = [];
const lineMat = new THREE.LineBasicMaterial({ color: 0xa9dbe8, transparent: true, opacity: 0.55 });

function ringLine(x, z, r, hAt) {
  const pts = [];
  for (let a = 0; a <= 64; a++) {
    const t = (a / 64) * Math.PI * 2, rx = x + Math.cos(t) * r, rz = z + Math.sin(t) * r;
    pts.push(new THREE.Vector3(rx, hAt(rx, rz) + 0.3, rz));
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
}

function buildShrines() {
  const list = $("#index-list");
  const bases = SHRINES.map((s) => {
    const [x, z] = geoToWorld(s.geo[0], s.geo[1]);
    return new THREE.Vector3(x, eu.heightAt(x, z), z);
  });
  const tops = bases.map((b) => b.clone().setY(b.y + 16));
  // recordings that lie close together on the scale of Europe: fan their markers out
  const done = new Set();
  bases.forEach((b, i) => {
    if (done.has(i)) return;
    const g = [i];
    bases.forEach((c, j) => { if (j > i && !done.has(j) && b.distanceTo(c) < 14) g.push(j); });
    if (g.length < 2) return;
    const c = new THREE.Vector3();
    g.forEach((k) => c.add(bases[k]));
    c.divideScalar(g.length);
    g.forEach((k, n) => { done.add(k); tops[k].set(c.x + (n - (g.length - 1) / 2) * 12, c.y + 15 + (n % 2) * 9, c.z); });
  });

  SHRINES.forEach((s, idx) => {
    const base = bases[idx], top = tops[idx];
    euGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([base, top]), lineMat));
    euGroup.add(ringLine(base.x, base.z, 1.6, eu.heightAt));

    const btn = document.createElement("button");
    btn.className = "shrine";
    btn.type = "button";
    btn.innerHTML = `<span class="shrine-mark" aria-hidden="true"></span><span class="shrine-label"><b>${s.id}</b> ${s.name}</span>`;
    btn.setAttribute("aria-label", `${s.id} ${s.name}, open shrine`);
    btn.addEventListener("click", () => openShrine(idx));
    shrineLayer.appendChild(btn);

    const li = document.createElement("li");
    li.innerHTML = `<button type="button"><span>${s.id}</span>${s.name}</button>`;
    li.querySelector("button").addEventListener("click", () => openShrine(idx));
    list.appendChild(li);

    shrineObjs.push({ s, top, base, btn, li });
  });
}

const tmp = new THREE.Vector3();
function placeLabels() {
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  shrineObjs.forEach((o, i) => {
    const p = mode === "detail" ? (i === detIdx ? detTop : null) : o.top;
    if (!p) { o.btn.classList.add("off"); return; }
    tmp.copy(p).project(camera);
    const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
    o.btn.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px)`;
    o.btn.classList.toggle("off", !vis);
    o.btn.classList.toggle("far", mode === "europe" && camera.position.distanceTo(p) > 330);
  });
}

/* ───────────── camera flights ───────────── */
let flight = null;
function flyTo(target, distance = 86, elev = 0.6, dur = 2200) {
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).setY(0).normalize();
  if (!isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(0, 0, 1);
  const endPos = target.clone().add(dir.multiplyScalar(distance * Math.cos(elev))).setY(target.y + distance * Math.sin(elev));
  flight = {
    t0: performance.now(), dur: reduceMotion ? 1 : dur,
    p0: camera.position.clone(), p1: endPos,
    c0: controls.target.clone(), c1: target.clone(),
  };
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ───────────── descending into a shrine, and back ───────────── */
function clearDetail() {
  for (const c of [...detGroup.children]) { detGroup.remove(c); c.geometry.dispose(); }
  det = null; detTop = null;
}

function showDetail(idx, img) {
  const s = SHRINES[idx];
  flight = null;
  clearDetail();
  det = makeCloud(img, { world: DETAIL.world, relief: DETAIL.relief * (s.relief ?? 1), keepLand: 0.92, disc: true });
  const y = det.heightAt(0, 0);
  const base = new THREE.Vector3(0, y, 0);
  detTop = new THREE.Vector3(0, y + 16, 0);
  detGroup.add(det.points, new THREE.Line(new THREE.BufferGeometry().setFromPoints([base, detTop]), lineMat), ringLine(0, 0, 3, det.heightAt));
  euGroup.visible = false; detGroup.visible = true;
  mode = "detail"; detIdx = idx;
  useView(det);
  uniforms.uFocus.value.copy(base);
  controls.minDistance = 14; controls.maxDistance = 420;
  controls.target.copy(base);
  camera.position.set(-64, y + 78, 150);
  document.body.classList.add("detail");
  backBtn.hidden = false;
}

function showEurope() {
  flight = null;
  clearDetail();
  detGroup.visible = false; euGroup.visible = true;
  mode = "europe"; detIdx = -1;
  useView(eu);
  uniforms.uFocus.value.set(9999, 0, 9999);
  controls.minDistance = 22; controls.maxDistance = 1700;
  if (euCam) { camera.position.copy(euCam.p); controls.target.copy(euCam.t); }
  document.body.classList.remove("detail");
  backBtn.hidden = true;
}

// fade the stage out, run fn while it is dark, fade back in
function throughDark(fn, delay = 0) {
  const T = reduceMotion ? 0 : 720;
  setTimeout(() => {
    fadeEl.classList.add("on");
    setTimeout(() => fn(() => requestAnimationFrame(() => requestAnimationFrame(() => { fadeEl.classList.remove("on"); busy = false; }))), T);
  }, reduceMotion ? 0 : delay);
}

/* ───────────── panel + player ───────────── */
const panel = $("#panel");
const audio = $("#audio");
let current = -1;

function openShrine(idx) {
  if (busy || (mode === "detail" && idx === detIdx)) return;
  const o = shrineObjs[idx];
  const s = o.s;
  current = idx; busy = true;
  shrineObjs.forEach((x, i) => { x.btn.classList.toggle("active", i === idx); x.li.classList.toggle("active", i === idx); });

  // the detail terrain loads while the camera descends over Europe
  const img = new Image();
  const ready = new Promise((res) => { img.onload = () => res(true); img.onerror = () => res(false); });
  img.src = new URL(`./terrain/${s.terrain || s.id.toLowerCase() + ".png"}`, import.meta.url).href;
  let delay = 0;
  if (mode === "europe") {
    euCam = { p: camera.position.clone(), t: controls.target.clone() };
    flyTo(o.base, 46, 0.85, 2400);
    delay = 1500;
  }
  throughDark((done) => ready.then((ok) => {
    if (ok) showDetail(idx, img);
    else { flight = null; if (mode === "europe" && euCam) { camera.position.copy(euCam.p); controls.target.copy(euCam.t); } }
    done();
  }), delay);

  $("#p-id").textContent = s.id;
  $("#p-name").textContent = s.name;
  $("#p-region").textContent = s.region;
  $("#d-date").textContent = s.date;
  $("#d-time").textContent = s.time;
  $("#d-temp").textContent = s.temp;
  $("#d-weather").textContent = s.weather;
  $("#d-wind").textContent = s.wind;
  $("#d-coords").textContent = s.coords;
  $("#d-rig").textContent = s.rig;
  $("#p-prayer").innerHTML = s.prayer.map((l) => `<p>${l}</p>`).join("");

  player.load(s);
  const wasHidden = panel.hidden;
  panel.hidden = false;
  if (wasHidden) sizeSpectro();
  requestAnimationFrame(() => panel.classList.add("open"));
  document.body.classList.add("has-panel");
  $("#play").focus({ preventScroll: true });
}

// closing a shrine leads back up to Europe
function closePanel() {
  if (busy) return;
  player.pause();
  panel.classList.remove("open");
  document.body.classList.remove("has-panel", "listening");
  setTimeout(() => { if (!panel.classList.contains("open")) panel.hidden = true; }, 500);
  shrineObjs.forEach((x) => { x.btn.classList.remove("active"); x.li.classList.remove("active"); });
  current = -1;
  if (mode === "detail") { busy = true; throughDark((done) => { showEurope(); done(); }); }
}
$("#close").addEventListener("click", closePanel);
backBtn.addEventListener("click", closePanel);

/* Audio engine. Real recordings first; if the file can't be reached
   (offline, blocked host) a quiet generated placeholder takes over so the
   interface stays testable. */
const player = (() => {
  let ctx, analyser, master, mediaNode, corsOK = false, mode = "file";
  let synth = null, synthStart = 0, synthOffset = 0, synthPlaying = false;
  const SYNTH_DUR = 360;
  let shrine = null, triedNoCors = false;
  const freq = new Uint8Array(1024);
  const wave = new Uint8Array(2048);

  const ui = {
    play: $("#play"), time: $("#t-now"), dur: $("#t-dur"), seek: $("#seek"),
    vol: $("#vol"), state: $("#p-state"), note: $("#p-note"),
  };

  function ensureCtx() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    master = ctx.createGain();
    master.gain.value = +ui.vol.value;
    analyser.connect(master).connect(ctx.destination);
  }

  function load(s) {
    stopSynth(true);
    shrine = s; mode = "file"; triedNoCors = false; synthOffset = 0;
    audio.pause();
    audio.crossOrigin = "anonymous";
    audio.src = s.src;
    audio.load();
    ui.note.hidden = true;
    setState("ready");
    render();
  }

  audio.addEventListener("error", () => {
    if (!shrine || mode !== "file") return;
    if (!triedNoCors) {
      // Host may not send CORS headers: retry without, spectrum disabled.
      triedNoCors = true;
      audio.removeAttribute("crossorigin");
      audio.src = shrine.src;
      audio.load();
      return;
    }
    mode = "synth";
    ui.note.hidden = false;
    setState("ready");
    render();
  });
  audio.addEventListener("loadedmetadata", () => { corsOK = audio.crossOrigin === "anonymous"; render(); });
  audio.addEventListener("play", () => setState("playing"));
  audio.addEventListener("pause", () => setState("paused"));
  audio.addEventListener("ended", () => setState("ended"));

  function routeFile() {
    if (corsOK && !mediaNode) {
      mediaNode = ctx.createMediaElementSource(audio);
      mediaNode.connect(analyser);
    }
  }

  async function play() {
    ensureCtx();
    if (ctx.state === "suspended") await ctx.resume();
    if (mode === "file") {
      routeFile();
      try { await audio.play(); }
      catch (e) { if (mode === "file" && audio.error) { mode = "synth"; ui.note.hidden = false; startSynth(); } }
    } else startSynth();
  }
  function pause() {
    if (mode === "file") audio.pause(); else stopSynth();
  }
  function toggle() { if (isPlaying()) pause(); else play(); }
  function isPlaying() { return mode === "file" ? !audio.paused : synthPlaying; }
  function now() { return mode === "file" ? audio.currentTime : synthPlaying ? synthOffset + (ctx.currentTime - synthStart) : synthOffset; }
  function duration() { return mode === "file" ? (isFinite(audio.duration) ? audio.duration : 0) : SYNTH_DUR; }
  function seek(t) {
    if (mode === "file") { if (duration()) audio.currentTime = t; }
    else { const was = synthPlaying; stopSynth(); synthOffset = t; if (was) startSynth(); }
  }

  /* placeholder soundscape: wind + water + birds, all generated */
  function noiseBuffer() {
    const len = ctx.sampleRate * 4, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    return b;
  }
  function startSynth() {
    ensureCtx();
    if (synthPlaying) return;
    const p = shrine.synth, out = ctx.createGain();
    out.gain.value = 0; out.connect(analyser);
    out.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 2.5);
    const nodes = [out]; const timers = [];
    const nb = noiseBuffer();
    // wind
    const wn = ctx.createBufferSource(); wn.buffer = nb; wn.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = "bandpass"; wf.frequency.value = 500; wf.Q.value = 0.5;
    const wg = ctx.createGain(); wg.gain.value = 0.25 + p.wind * 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 300;
    lfo.connect(lg).connect(wf.frequency); wn.connect(wf).connect(wg).connect(out); wn.start(); lfo.start();
    nodes.push(wn, lfo);
    // water lapping
    if (p.water > 0) {
      const tick = () => {
        const s = ctx.createBufferSource(); s.buffer = nb; const f = ctx.createBiquadFilter();
        f.type = "bandpass"; f.frequency.value = 600 + Math.random() * 1400; f.Q.value = 3;
        const g = ctx.createGain(); const t = ctx.currentTime;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(p.water * (0.3 + Math.random() * 0.5), t + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.25 + Math.random() * 0.4);
        const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 1.6 - 0.8;
        s.connect(f).connect(g).connect(pan).connect(out); s.start(t, Math.random() * 3, 1);
        timers.push(setTimeout(tick, 250 + Math.random() * 900));
      }; tick();
    }
    // birds
    if (p.birds > 0) {
      const chirp = () => {
        const t = ctx.currentTime, n = 2 + Math.floor(Math.random() * 5), base = p.tone * (1.5 + Math.random() * 2);
        const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1; pan.connect(out);
        for (let k = 0; k < n; k++) {
          const o = ctx.createOscillator(), g = ctx.createGain(), st = t + k * (0.09 + Math.random() * 0.07);
          o.frequency.setValueAtTime(base, st); o.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.8), st + 0.07);
          g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(0.05 * p.birds, st + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.08);
          o.connect(g).connect(pan); o.start(st); o.stop(st + 0.1);
        }
        timers.push(setTimeout(chirp, (1200 + Math.random() * 5000) / (0.3 + p.birds)));
      }; chirp();
    }
    // insect drone
    if (p.drone) {
      [p.tone, p.tone * 1.013, p.tone * 2.01].forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
        const g = ctx.createGain(); g.gain.value = 0.012 * p.drone / (i + 1);
        o.connect(lp).connect(g).connect(out); o.start(); nodes.push(o);
      });
    }
    // bells
    if (p.bells) {
      const bell = () => {
        const t = ctx.currentTime, f0 = [392, 466, 523][Math.floor(Math.random() * 3)];
        [1, 2.0, 2.4, 3.0, 4.2].forEach((m, i) => {
          const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f0 * m;
          g.gain.setValueAtTime(0.03 * p.bells / (i + 1), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 7 - i);
          o.connect(g).connect(out); o.start(t); o.stop(t + 7);
        });
        timers.push(setTimeout(bell, 2600 + Math.random() * 1800));
      }; bell();
    }
    synth = { nodes, timers, out };
    synthStart = ctx.currentTime; synthPlaying = true; setState("playing");
  }
  function stopSynth(silent) {
    if (!synth) { synthPlaying = false; return; }
    synthOffset = now();
    synth.timers.forEach(clearTimeout);
    const { out, nodes } = synth; const t = ctx.currentTime;
    out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(0, t + 0.4);
    setTimeout(() => nodes.forEach((n) => { try { n.stop ? n.stop() : n.disconnect(); } catch (_) {} }), 500);
    synth = null; synthPlaying = false;
    if (!silent) setState("paused");
  }

  function setState(st) {
    document.body.classList.toggle("listening", st === "playing");
    uniforms._listenTarget = st === "playing" ? 1 : 0;
    ui.play.setAttribute("aria-pressed", st === "playing");
    ui.play.setAttribute("aria-label", st === "playing" ? "Pause" : "Listen");
    ui.state.textContent = { ready: "standby", playing: "listening", paused: "paused", ended: "end of recording" }[st];
  }

  const fmt = (t) => {
    if (!isFinite(t) || t <= 0) return "00:00";
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };
  let scrubbing = false;
  function render() {
    const d = duration(), t = now();
    ui.time.textContent = fmt(t);
    ui.dur.textContent = d ? fmt(d) : "--:--";
    if (!scrubbing) ui.seek.value = d ? (t / d) * 1000 : 0;
    ui.seek.style.setProperty("--p", `${d ? (t / d) * 100 : 0}%`);
  }
  ui.play.addEventListener("click", toggle);
  ui.seek.addEventListener("input", () => { scrubbing = true; ui.time.textContent = fmt((ui.seek.value / 1000) * duration()); });
  ui.seek.addEventListener("change", () => { seek((ui.seek.value / 1000) * duration()); scrubbing = false; });
  ui.vol.addEventListener("input", () => { if (master) master.gain.value = +ui.vol.value; audio.volume = mode === "file" && !mediaNode ? +ui.vol.value : 1; });

  function level() {
    if (!analyser || !isPlaying()) return 0;
    if (mode === "file" && !mediaNode) return 0.08 + 0.04 * Math.sin(performance.now() / 600);
    analyser.getByteTimeDomainData(wave);
    let sum = 0; for (let i = 0; i < wave.length; i++) { const v = (wave[i] - 128) / 128; sum += v * v; }
    return Math.min(1, Math.sqrt(sum / wave.length) * 4);
  }
  function spectrum() {
    if (!analyser || !isPlaying() || (mode === "file" && !mediaNode)) return null;
    analyser.getByteFrequencyData(freq);
    return freq;
  }
  return { load, toggle, play, pause, render, level, spectrum, isPlaying, get ctx() { return ctx; } };
})();

/* spectrogram — a scrolling time/frequency image of what is playing */
const spec = $("#spectro");
const sx = spec.getContext("2d");
function sizeSpectro() {
  const r = spec.getBoundingClientRect();
  spec.width = Math.max(1, Math.round(r.width * devicePixelRatio));
  spec.height = Math.max(1, Math.round(r.height * devicePixelRatio));
  sx.fillStyle = "#06080a"; sx.fillRect(0, 0, spec.width, spec.height);
}
function drawSpectro() {
  const data = player.spectrum();
  const W = spec.width, H = spec.height;
  if (!W) return;
  const col = Math.max(1, Math.round(devicePixelRatio));
  sx.drawImage(spec, -col, 0);
  sx.fillStyle = "#06080a"; sx.fillRect(W - col, 0, col, H);
  if (!data) return;
  const sr = (player.ctx && player.ctx.sampleRate) || 48000, bins = data.length, fMin = 40, fMax = 16000;
  for (let y = 0; y < H; y++) {
    const f = fMin * Math.pow(fMax / fMin, 1 - y / H);
    const v = data[Math.min(bins - 1, Math.round((f / (sr / 2)) * bins))] / 255;
    if (v < 0.08) continue;
    const a = Math.pow(v, 1.6);
    sx.fillStyle = v > 0.72 ? `rgba(169,219,232,${a})` : `rgba(223,230,234,${a * 0.85})`;
    sx.fillRect(W - col, y, col, 1);
  }
}

/* ───────────── HUD + loop ───────────── */
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  sizeSpectro();
}
addEventListener("resize", resize);

const clock = new THREE.Clock();
let listen = 0, lvl = 0;
function loop() {
  const dt = Math.min(clock.getDelta(), 0.1);
  uniforms.uTime.value += reduceMotion ? 0 : dt;

  if (flight) {
    const k = Math.min(1, (performance.now() - flight.t0) / flight.dur), e = ease(k);
    camera.position.lerpVectors(flight.p0, flight.p1, e);
    controls.target.lerpVectors(flight.c0, flight.c1, e);
    if (k >= 1) flight = null;
  }
  // slow orbit around the shrine while listening
  const playing = player.isPlaying();
  controls.autoRotate = !reduceMotion && mode === "detail" && !flight;
  controls.autoRotateSpeed = playing ? 0.35 : 0.18;
  controls.update();

  listen += ((uniforms._listenTarget || 0) - listen) * Math.min(1, dt * 2);
  uniforms.uListen.value = listen;
  lvl += (player.level() - lvl) * Math.min(1, dt * 8);
  uniforms.uLevel.value = lvl;

  renderer.render(scene, camera);
  placeLabels();
  if (!panel.hidden) { player.render(); drawSpectro(); }

  const t = controls.target;
  if (mode === "europe") {
    const [lon, lat] = worldToLonLat(t.x, t.z);
    hud.x.textContent = lon.toFixed(2) + "°";
    hud.y.textContent = lat.toFixed(2) + "°";
    hud.z.textContent = (Math.pow(heightAt(t.x, t.z) / EU.relief, 1 / 0.72) * 4300).toFixed(0);
  } else {
    hud.x.textContent = ((t.x + WORLD / 2) * 10).toFixed(0).padStart(4, "0");
    hud.y.textContent = ((DEPTH / 2 - t.z) * 10).toFixed(0).padStart(4, "0");
    hud.z.textContent = (heightAt(t.x, t.z) * 6).toFixed(1);
  }
  hud.az.textContent = ((THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()) + 360) % 360).toFixed(0).padStart(3, "0");
  requestAnimationFrame(loop);
}

/* ───────────── keyboard ───────────── */
addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea")) return;
  if (e.key === "Escape" && !panel.hidden) closePanel();
  if (e.code === "Space" && !panel.hidden && !e.target.matches("button")) { e.preventDefault(); player.toggle(); }
  if (/^[1-9]$/.test(e.key) && SHRINES[+e.key - 1]) openShrine(+e.key - 1);
});

/* ───────────── boot ───────────── */
const enter = $("#enter");
const img = new Image();
img.onload = () => {
  eu = makeCloud(img, { world: EU.world, relief: EU.relief, keepLand: isSmall ? 0.8 : 0.62 });
  euGroup.add(eu.points);
  useView(eu);
  controls.target.set(0, 0, 30);
  buildShrines();
  resize();
  document.body.classList.add("ready");
  loop();
};
img.onerror = () => { $("#boot-status").textContent = "terrain data could not be loaded"; };
img.src = new URL("./terrain/europe.png", import.meta.url).href;

$("#enter-btn").addEventListener("click", () => {
  enter.classList.add("gone");
  setTimeout(() => (enter.hidden = true), 900);
});
