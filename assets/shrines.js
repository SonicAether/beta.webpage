import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SHRINES } from "./shrines-data.js";

/* ───────────── constants ───────────── */
const TERRAIN = new URL("./terrain/", import.meta.url).href;   // terrain images (overview, fine chunks, shrines)
// Overview: north-west Europe, Ireland to Sweden, in Web Mercator (zoom-7 tile coordinates of the image corners).
const EU = { world: 930, relief: 32, n: 128, x0: 59.91111111111111, x1: 71.28888888888889, y0: 32.011827186209985, y1: 43.520931152007336, hmax: 2500, gamma: 0.72 };
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
const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 6000);
camera.position.set(0, innerWidth < 720 ? 1890 : 632, innerWidth < 720 ? 1640 : 843);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.screenSpacePanning = false;
controls.minDistance = 10;
controls.maxDistance = 3500;
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
  uDrift: { value: 6 },
  uFar: { value: 3600 },
  uForm: { value: 1 },
  uScale: { value: 1 },
  uRise: { value: 0 },
  uSoft: { value: 0 },
  uLogMin: { value: 0 },
  uJit: { value: 0 },
  uHoleA: { value: 0 },
  uHoleR: { value: 0 },
  uCovOn: { value: 0 },
  uCov: { value: null },
  uCovN: { value: new THREE.Vector2(1, 1) },
  uEuSize: { value: new THREE.Vector2(1, 1) },
  uHole: { value: new THREE.Vector4(0, 0, 1, 1) },
  uHalf: { value: new THREE.Vector2(1, 1) },
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
    uniform float uTime, uSize, uPx, uLevel, uListen, uSpan, uDrift, uFar, uForm, uScale, uRise, uSoft, uLogMin, uJit;
    uniform vec2 uHalf;
    uniform float uHoleA, uHoleR, uCovOn;
    uniform vec4 uHole;
    uniform vec2 uCovN, uEuSize;
    uniform sampler2D uCov;
    uniform vec3 uFocus;
    varying float vShade, vFog, vSweep, vRing, vWater;
    void main(){
      vec3 p = position;
      vWater = aWater;
      // a view forms and dissolves point by point: each point settles from a little above, in its own time
      float form = clamp(uForm * 1.6 - aRand * 0.6, 0.0, 1.0);
      form = form * form * (3.0 - 2.0 * form);
      p.y += (1.0 - form) * (3.0 + 22.0 * aRand) * uRise;
      // water: a slow swell, no lidar returns, so only a sparse shimmer
      // (aWater: 1 = sea, 0.75 = lake, 0.6 = river; inland water barely moves)
      float life = 1.0;
      if (aWater > 0.5) {
        // water drifts: each particle travels a short way along a slowly bending current,
        // fading in at the start of its path and out at the end
        float ph = fract(aRand * 7.31 + uTime * (0.028 + 0.03 * aShade));
        float ang = 2.4 + 0.7 * sin(p.x * 0.031 + p.z * 0.023) + 0.4 * sin(uTime * 0.05 + p.z * 0.05);
        p.xz += vec2(cos(ang), sin(ang)) * (ph - 0.5) * uDrift * (aWater > 0.7 ? 1.0 : 0.5);
        life = smoothstep(0.0, 0.18, ph) * (1.0 - smoothstep(0.82, 1.0, ph));
      }
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
      // while coarse, points leave the scan's grid, like the scattered returns of the overview
      if (uSoft > 0.0) p.xz += (vec2(fract(aRand * 91.7), fract(aRand * 57.3)) - 0.5) * uJit * pow(uSoft, 0.6);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float depth = -mv.z / uScale;   // a terrain docked small into the overview keeps its own point size and haze
      // a terrain that is just appearing inside the overview starts as coarse as the overview around it:
      // only as many points as the overview has on the same ground, just as large, scattered a little,
      // and fading out over a wide, ragged margin. On the way in it fills up to the whole scan.
      float soft = 1.0;
      float depthS = depth;
      if (uSoft > 0.0) {
        float sc = pow(uSoft, 0.6);            // stay coarse for most of the way, sharpen at the end
        float keep = exp(uLogMin * sc);
        float few = step(fract(aRand * 13.7), keep);
        float band = 0.8 * sc * min(uHalf.x, uHalf.y) + 1e-4;
        // round and blurred at first, the rectangle of the scan appears only at the end
        float eRect = min(uHalf.x - abs(position.x), uHalf.y - abs(position.z));
        float eRound = (1.0 - length(position.xz / uHalf)) * min(uHalf.x, uHalf.y);
        float e = mix(eRect, eRound, smoothstep(0.0, 0.7, sc)) / band;
        float edge = smoothstep(0.0, 1.0, e + (fract(aRand * 5.31) - 0.5) * 1.1 * sc);
        soft = few * edge;
        depthS = exp(mix(log(depth), log(-mv.z), sc));   // point size of the overview at this distance
      }
      gl_PointSize = clamp(uSize * uPx * (230.0 / depthS), 0.9, 8.0 * uPx);
      vShade = aShade;
      // the overview makes room for a detail terrain where it lies, as that terrain fills in
      if (uHoleA > 0.0) {
        vec2 q = abs(position.xz - uHole.xy) / uHole.zw;
        float metric = mix(max(q.x, q.y), length(q), uHoleR);
        float inside = 1.0 - smoothstep(0.55, 1.25, metric + (fract(aRand * 3.7) - 0.5) * 0.3);
        soft *= 1.0 - uHoleA * inside;
      }
      // where a finer chunk of the overview has been loaded, the coarse points step aside
      if (uCovOn > 0.0) {
        vec2 cu = (position.xz / uEuSize + 0.5) / uCovN;
        soft *= 1.0 - texture2D(uCov, cu).r;
      }
      vFog = smoothstep(uFar, 220.0, depth) * life * form * soft;
      // scan dropout flicker
      vFog *= step(0.04, fract(aRand + uTime * 0.013 * aRand));
      if (form * soft < 0.03) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // not there yet: don't cover what lies behind
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

/* Builds a point cloud from a terrain PNG. opt: { world, relief, keepLand, hard } */
function makeCloud(img, opt) {
  const NX = img.width, NZ = img.height;
  const W_ = opt.world, D_ = opt.depth ?? opt.world * NZ / NX;
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
  const KEEP = [keepLand, opt.keepSea ?? keepWater, 0.3, 0.5], WAT = [0, 1, 0.75, 0.6];
  const cap = Math.ceil((NX * NZ) / (stride * stride) * 0.56) + 1000;   // room for the points that will be kept
  const pos = new Float32Array(cap * 3), shade = new Float32Array(cap), rnd = new Float32Array(cap), wat = new Float32Array(cap);
  let n = 0;
  const cell = W_ / NX;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // two passes in a checkerboard: the first half alone is an even, thinner cloud,
  // which slow machines draw instead of the whole
  let half = 0;
  for (let pass = 0; pass < 2; pass++) {
   if (pass === 1) half = n;
   for (let j = 0; j < NZ; j += stride) {
    for (let i = 0; i < NX; i += stride) {
      if ((((i + j) / stride) & 1) !== pass) continue;
      const k = j * NX + i, isW = W[k];
      // the scan thins out toward its limits instead of ending in a wall
      const edge = opt.hard ? 1 : Math.min(i, j, NX - 1 - i, NZ - 1 - j) / 40;   // detail maps end in a clean cut
      if (edge <= 0) continue;
      if (rand() > KEEP[isW] * (edge >= 1 ? 1 : edge * edge * (3 - 2 * edge))) continue;
      const x = (i / (NX - 1) - 0.5) * W_ + (rand() - 0.5) * cell * stride;
      const z = (j / (NZ - 1) - 0.5) * D_ + (rand() - 0.5) * cell * stride;
      if (n >= cap) continue;
      pos[n * 3] = x; pos[n * 3 + 1] = H[k] * opt.relief; pos[n * 3 + 2] = z;
      shade[n] = isW ? rand() : px[k * 4] / 255;
      rnd[n] = rand(); wat[n] = WAT[isW]; n++;
    }
   }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos.slice(0, n * 3), 3));
  geo.setAttribute("aShade", new THREE.BufferAttribute(shade.slice(0, n), 1));
  geo.setAttribute("aRand", new THREE.BufferAttribute(rnd.slice(0, n), 1));
  geo.setAttribute("aWater", new THREE.BufferAttribute(wat.slice(0, n), 1));
  const points = new THREE.Points(geo, opt.mat || pointMat);
  points.frustumCulled = false;
  return { points, W: W_, D: D_, heightAt: hAt, count: n, half, nx: NX };
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
  hud.pts.textContent = c.count.toLocaleString("en-US");
}

// latitude / longitude ↔ position on the overview
const geoToWorld = (lat, lon) => {
  const tx = (lon + 180) / 360 * EU.n;
  const ty = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * EU.n;
  return [((tx - EU.x0) / (EU.x1 - EU.x0) - 0.5) * eu.W, ((ty - EU.y0) / (EU.y1 - EU.y0) - 0.5) * eu.D];
};
const worldToLonLat = (x, z) => {
  const tx = EU.x0 + (x / eu.W + 0.5) * (EU.x1 - EU.x0), ty = EU.y0 + (z / eu.D + 0.5) * (EU.y1 - EU.y0);
  return [tx / EU.n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / EU.n))) * 180 / Math.PI];
};

/* ───────────── finer overview near the camera ─────────────
   Close to the ground the overview's points (one every ~600 m) are replaced, chunk by chunk, by
   chunks with three times the resolution. They fade in where the camera looks, and the coarse
   points under them step aside (coverage texture). Off on phones and on machines that are slow. */
// ?debug in the address exposes the camera for testing
const DEBUG = /[?&]debug\b/.test(location.search) ? (window.__shrines = { lod: true, get camera() { return camera; }, get controls() { return controls; }, get LOD() { return LOD; } }) : null;
const LOD = { index: null, chunks: new Map(), cov: null, off: isSmall, slow: { n: 0, sum: 0 } };
fetch(TERRAIN + "eu/index.json").then((r) => r.json()).then((j) => {
  LOD.index = j; LOD.have = new Set(j.chunks.map((c) => c[0] + "_" + c[1]));
  LOD.gx = Math.ceil((j.nx - 1) / j.C); LOD.gz = Math.ceil((j.nz - 1) / j.C);
  LOD.cov = new THREE.DataTexture(new Uint8Array(LOD.gx * LOD.gz * 4), LOD.gx, LOD.gz, THREE.RGBAFormat);
  LOD.cov.magFilter = LOD.cov.minFilter = THREE.NearestFilter;
  LOD.cov.needsUpdate = true;
  uniforms.uCov.value = LOD.cov;
  uniforms.uCovN.value.set(LOD.gx * j.C / (j.nx - 1), LOD.gz * j.C / (j.nz - 1));
}).catch(() => { LOD.off = true; });

function chunkBox(ci, cj) {                     // world rectangle of a chunk, from the overview's grid
  const j = LOD.index, cx = eu.W / (j.nx - 1), cz = eu.D / (j.nz - 1);
  const i0 = ci * j.C, i1 = Math.min(i0 + j.C, j.nx - 1), k0 = cj * j.C, k1 = Math.min(k0 + j.C, j.nz - 1);
  return { x: ((i0 + i1) / 2) * cx - eu.W / 2, z: ((k0 + k1) / 2) * cz - eu.D / 2, w: (i1 - i0) * cx, d: (k1 - k0) * cz };
}
function loadChunk(key) {
  const c = { fade: 0, want: true, points: null };
  LOD.chunks.set(key, c);
  const img = new Image();
  img.onload = () => {
    if (LOD.chunks.get(key) !== c) return;
    const [ci, cj] = key.split("_").map(Number), b = chunkBox(ci, cj);
    const mat = pointMat.clone();
    mat.uniforms = { ...uniforms, uForm: { value: 0 }, uSize: { value: uniforms.uSize.value * 0.62 }, uCovOn: { value: 0 } };
    const cl = makeCloud(img, { world: b.w, depth: b.d, relief: EU.relief, keepLand: 0.86, keepSea: 0.075 / 9, hard: true, mat });
    cl.points.position.set(b.x, 0, b.z);
    c.points = cl.points; c.mat = mat;
    euGroup.add(cl.points);
  };
  img.src = TERRAIN + "eu/" + key + ".png";
}
function stepLOD(dt) {
  if (!LOD.index || !eu) return;
  const force = DEBUG && DEBUG.lod;
  const active = (force || (!LOD.off && eu.thinned !== true)) && mode === "europe" && euGroup.visible;
  // which chunks: the one under the point the camera looks at and its three nearest neighbours
  const want = new Set();
  if (active && camera.position.distanceTo(controls.target) < 170) {
    const j = LOD.index, t = controls.target;
    const u = ((t.x / eu.W + 0.5) * (j.nx - 1)) / j.C, v = ((t.z / eu.D + 0.5) * (j.nz - 1)) / j.C;
    const ci = Math.floor(u), cj = Math.floor(v), di = u - ci < 0.5 ? -1 : 1, dj = v - cj < 0.5 ? -1 : 1;
    for (const [a, b] of [[ci, cj], [ci + di, cj], [ci, cj + dj], [ci + di, cj + dj]]) if (LOD.have.has(a + "_" + b)) want.add(a + "_" + b);
  }
  for (const k of want) if (!LOD.chunks.has(k)) loadChunk(k);
  let dirty = false;
  for (const [k, c] of LOD.chunks) {
    c.want = want.has(k);
    const goal = c.want && c.points ? 1 : 0, f = c.fade;
    c.fade = goal > f ? Math.min(1, f + dt / 1.2) : Math.max(0, f - dt / 0.9);
    if (c.mat) c.mat.uniforms.uForm.value = c.fade * uniforms.uForm.value;
    if (c.fade !== f) dirty = true;
    if (!c.want && c.fade === 0) {
      if (c.points) { euGroup.remove(c.points); c.points.geometry.dispose(); c.mat.dispose(); }
      LOD.chunks.delete(k); dirty = true;
      const [ci, cj] = k.split("_").map(Number);
      LOD.cov.image.data[(cj * LOD.gx + ci) * 4] = 0;
    }
  }
  if (dirty) {
    for (const [k, c] of LOD.chunks) { const [ci, cj] = k.split("_").map(Number); LOD.cov.image.data[(cj * LOD.gx + ci) * 4] = Math.round(c.fade * 255); }
    LOD.cov.needsUpdate = true;
  }
  uniforms.uCovOn.value = LOD.chunks.size ? 1 : 0;
  // a machine that struggles with the extra points gets the plain overview back
  if (LOD.chunks.size && active) {
    const sl = LOD.slow; sl.n++; sl.sum += dt;
    if (sl.n === 60) { if (sl.sum / sl.n > 0.06) LOD.off = true; sl.n = 0; sl.sum = 0; }
  }
}

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

// Recordings of one area share a marker on the overview; it opens a short list.
const markers = [];   // { el, top }
const detMark = document.createElement("div");
detMark.className = "shrine active off";
detMark.innerHTML = `<span class="shrine-mark" aria-hidden="true"></span><span class="shrine-label"></span>`;

function buildShrines() {
  const list = $("#index-list");
  $("#shrine-count").textContent = SHRINES.length;
  const bases = SHRINES.map((s) => {
    const [x, z] = geoToWorld(s.geo[0], s.geo[1]);
    return new THREE.Vector3(x, eu.heightAt(x, z), z);
  });
  const areas = new Map();
  SHRINES.forEach((s, i) => { const k = s.area || s.id; areas.set(k, [...(areas.get(k) || []), i]); });

  SHRINES.forEach((s, idx) => {
    const li = document.createElement("li");
    li.innerHTML = `<button type="button"><span>${s.id}</span>${s.name}</button>`;
    li.querySelector("button").addEventListener("click", () => openShrine(idx));
    list.appendChild(li);
    shrineObjs.push({ s, base: bases[idx], li, el: null });
  });

  for (const [area, members] of areas) {
    const base = new THREE.Vector3();
    members.forEach((i) => base.add(bases[i]));
    base.divideScalar(members.length);
    base.y = eu.heightAt(base.x, base.z);
    const top = base.clone().setY(base.y + 32);
    euGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([base, top]), lineMat));
    euGroup.add(ringLine(base.x, base.z, members.length > 1 ? 5.2 : 3.2, eu.heightAt));

    const el = document.createElement("div");
    el.className = "shrine";
    if (members.length === 1) {
      const s = SHRINES[members[0]];
      el.innerHTML = `<button type="button" class="shrine-btn" aria-label="${s.id} ${s.name}, open shrine"><span class="shrine-mark" aria-hidden="true"></span><span class="shrine-label"><b>${s.id}</b> ${s.name}</span></button>`;
      el.querySelector("button").addEventListener("click", () => openShrine(members[0]));
    } else {
      el.classList.add("cluster");
      el.innerHTML = `<button type="button" class="shrine-btn" aria-expanded="false" aria-label="${area}, ${members.length} shrines"><span class="shrine-mark" aria-hidden="true"></span><span class="shrine-label"><b>${area}</b> · ${members.length}</span></button><ul class="cluster-list"></ul>`;
      const head = el.querySelector(".shrine-btn"), ul = el.querySelector("ul");
      head.addEventListener("click", () => { const open = el.classList.toggle("open"); head.setAttribute("aria-expanded", open); });
      members.forEach((i) => {
        const s = SHRINES[i], item = document.createElement("li");
        item.innerHTML = `<button type="button"><span>${s.id}</span>${s.name}</button>`;
        item.querySelector("button").addEventListener("click", () => openShrine(i));
        ul.appendChild(item);
      });
    }
    shrineLayer.appendChild(el);
    markers.push({ el, top });
    members.forEach((i) => { shrineObjs[i].el = el; shrineObjs[i].base = base; });
  }
  shrineLayer.appendChild(detMark);
  addEventListener("pointerdown", (e) => { for (const m of markers) if (!m.el.contains(e.target)) closeCluster(m.el); });
}
function closeCluster(el) {
  if (!el.classList.contains("open")) return;
  el.classList.remove("open");
  el.querySelector(".shrine-btn").setAttribute("aria-expanded", "false");
}
function markActive(idx) {
  for (const m of markers) m.el.classList.toggle("active", idx >= 0 && shrineObjs[idx].el === m.el);
  shrineObjs.forEach((x, i) => x.li.classList.toggle("active", i === idx));
}

const tmp = new THREE.Vector3();
function place(el, p, far) {
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  tmp.copy(p).project(camera);
  const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
  el.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px)`;
  el.classList.toggle("off", !vis);
  el.classList.toggle("far", far);
}
function placeLabels() {
  if (mode === "detail") {
    for (const m of markers) m.el.classList.add("off");
    for (const l of WX.labels) l.el.classList.add("off");
    if (detTop) place(detMark, detTop, false);
    return;
  }
  detMark.classList.add("off");
  for (const m of markers) place(m.el, m.top, false);
  for (const l of WX.labels) { place(l.el, l.p, false); if (!WX.on) l.el.classList.add("off"); }
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

/* ───────────── descending into a shrine, and back ─────────────
   One continuous zoom: the detail terrain is docked into the overview at the place of the
   recording, at its true small size. The camera keeps descending; the overview thins out, the
   ground of the recording takes its place. When the flight ends the two coordinate systems are
   exchanged, which changes nothing on screen. */
const K = 0.016;                       // size of a detail terrain inside the overview (about 4 units wide)
const detUniforms = {
  uSpan: { value: DETAIL.world }, uDrift: { value: 8 }, uFar: { value: 6000 }, uForm: { value: 0 },
  uScale: { value: 1 }, uRise: { value: 1 }, uSoft: { value: 0 }, uLogMin: { value: 0 }, uJit: { value: 0 }, uHoleA: { value: 0 }, uHoleR: { value: 0 }, uCovOn: { value: 0 }, uHole: { value: new THREE.Vector4(0, 0, 1, 1) }, uHalf: { value: new THREE.Vector2(1, 1) }, uFocus: { value: new THREE.Vector3(9999, 0, 9999) },
};
const detMat = pointMat.clone();
detMat.uniforms = { ...uniforms, ...detUniforms };   // time, level and size are shared with the overview
const detLineMat = lineMat.clone();
let detBase = null;
let link = null;                       // while a zoom is under way: { c: the shrine's place on the overview }

function clearDetail() {
  for (const c of [...detGroup.children]) { detGroup.remove(c); c.geometry.dispose(); }
  det = null; detTop = null; detBase = null;
}
function buildDetail(idx, img) {
  const s = SHRINES[idx];
  clearDetail();
  det = makeCloud(img, { world: DETAIL.world, relief: DETAIL.relief * (s.relief ?? 1), keepLand: 0.92, hard: true, mat: detMat });
  // the recording spot inside the scan (spot: [u, v] from the north-west corner; centre by default)
  const [su, sv] = s.spot || [0.5, 0.5];
  const sx = (su - 0.5) * det.W, sz = (sv - 0.5) * det.D;
  const y = det.heightAt(sx, sz);
  detBase = new THREE.Vector3(sx, y, sz);
  detTop = new THREE.Vector3(sx, y + 16, sz);
  detGroup.add(det.points, new THREE.Line(new THREE.BufferGeometry().setFromPoints([detBase, detTop]), detLineMat), ringLine(sx, sz, 3, det.heightAt));
  detGroup.children[2].material = detLineMat;
  detUniforms.uFocus.value.copy(detBase);
  detUniforms.uHalf.value.set(det.W / 2, det.D / 2);
  // how much coarser the overview is on the same ground: as a share of points, and as a scatter distance
  const cEu = eu.W / eu.nx, cDet = det.W / det.nx;
  detUniforms.uLogMin.value = Math.log(Math.min(1, Math.max(5e-5, ((cDet * K) / cEu) ** 2 * 1.2)));
  detUniforms.uJit.value = 0.5 * cEu / K;
}
const homeCam = (b) => new THREE.Vector3(b.x - 64, b.y + 78, b.z + 150);   // where the camera rests in a detail view
function dock(place) {                 // detail terrain into the overview, its recording spot on the shrine
  detGroup.scale.setScalar(K);
  detGroup.position.copy(place).addScaledVector(detBase, -K);
  detGroup.updateMatrixWorld(true);
  detUniforms.uScale.value = K;
  uniforms.uHole.value.set(detGroup.position.x, detGroup.position.z, det.W / 2 * K, det.D / 2 * K);
}
function undock() {
  detGroup.scale.setScalar(1); detGroup.position.set(0, 0, 0);
  detGroup.updateMatrixWorld(true);
  detUniforms.uScale.value = 1;
}
function setEuForm(v) {
  uniforms.uForm.value = v;
  lineMat.opacity = 0.55 * v; isoMat.opacity = 0.34 * v; isoMatBold.opacity = 0.62 * v;
  shrineLayer.style.opacity = mode === "europe" ? (v < 0.6 ? 0 : (v - 0.6) / 0.4) : 1;
}
function setDetForm(v) { detUniforms.uForm.value = v; detLineMat.opacity = 0.55 * v; }
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// during a zoom both terrains follow the camera's distance to the shrine, not the clock
function stepLink() {
  if (!link) return;
  const d = camera.position.distanceTo(link.c);
  // the two overlap generously, so the picture never goes dark in between
  // around the detail terrain the overview stays until the very end
  setEuForm(sstep(link.near * 1.05, link.near * 2.6, d));
  setDetForm(det ? 1 - sstep(60, 160, d) : 0);
  // coarse and borderless while small, sharpening into the full scan on the last stretch
  const n0 = Math.max(link.near, 0.5) * 1.02;
  const sf = Math.min(1, Math.max(0, Math.log(d / n0) / Math.log(60 / n0)));
  detUniforms.uSoft.value = sf;
  uniforms.uHoleA.value = det ? 1 - Math.pow(sf, 0.6) : 0;
  uniforms.uHoleR.value = Math.pow(sf, 0.6);
}

// zoom at an even pace for the eye: the distance to the target changes exponentially
function zoomTo(p1, c1, dur, late) {
  return new Promise((res) => {
    const c0 = controls.target.clone(), o0 = camera.position.clone().sub(c0), o1 = p1.clone().sub(c1);
    flight = { zoom: true, t0: performance.now(), dur: reduceMotion ? 1 : dur, c0, c1: c1.clone(), late,
               l0: Math.log(o0.length()), l1: Math.log(o1.length()), n0: o0.normalize(), n1: o1.normalize(), res };
  });
}
const tween = (dur, fn) => new Promise((res) => {
  const t0 = performance.now();
  const step = () => { const k = reduceMotion ? 1 : Math.min(1, (performance.now() - t0) / dur); fn(k * k * (3 - 2 * k)); k < 1 ? requestAnimationFrame(step) : res(); };
  step();
});

function arrive(idx) {                  // exchange the coordinate systems: now the detail terrain is the world
  undock();
  euGroup.visible = false; detGroup.visible = true;
  mode = "detail"; detIdx = idx; link = null;
  useView(det);
  controls.minDistance = 7; controls.maxDistance = 420;
  controls.target.copy(detBase);
  camera.position.copy(homeCam(detBase));
  setDetForm(1); setEuForm(0); detUniforms.uSoft.value = 0; uniforms.uHoleA.value = 0;
  document.body.classList.add("detail");
  backBtn.hidden = false;
}

async function descend(idx, img, ready) {
  const o = shrineObjs[idx];
  euCam = { p: camera.position.clone(), t: controls.target.clone() };
  link = { c: o.base.clone(), near: homeCam(new THREE.Vector3()).length() * K };
  controls.minDistance = 0.01;
  setDetForm(0);
  // the flight starts at once; the ground of the recording is built as soon as its scan has arrived
  const built = ready.then((ok) => new Promise((res) => requestAnimationFrame(() => {
    if (ok) { buildDetail(idx, img); dock(o.base); detGroup.visible = true; }
    res(ok);
  })));
  const rest = homeCam(new THREE.Vector3()).multiplyScalar(K);
  await zoomTo(o.base.clone().add(rest), o.base, 13000);
  if (await built) arrive(idx);
  else { link = null; setEuForm(1); controls.minDistance = 10; camera.position.copy(euCam.p); controls.target.copy(euCam.t); }
}

async function ascend() {
  const o = shrineObjs[detIdx];
  // back into the overview's coordinates, the camera exactly where it is
  dock(o.base);
  const toEu = (v) => v.clone().multiplyScalar(K).add(detGroup.position);
  camera.position.copy(toEu(camera.position)); controls.target.copy(toEu(controls.target));
  euGroup.visible = true;
  // start exactly as sharp as the detail view is now, wherever the visitor has moved to
  mode = "europe"; detIdx = -1; link = { c: o.base.clone(), near: camera.position.distanceTo(o.base) / 1.1 };
  useView(eu);
  controls.minDistance = 0.01; controls.maxDistance = 3500;
  document.body.classList.remove("detail");
  backBtn.hidden = true;
  stepLink();
  const home = euCam || { p: new THREE.Vector3(0, 632, 843), t: new THREE.Vector3(0, 0, 51) };
  await zoomTo(home.p, home.t, 10000, true);
  link = null; uniforms.uHoleA.value = 0;
  clearDetail(); detGroup.visible = false; undock();
  controls.minDistance = 10;
  setEuForm(1);
}

// from one shrine straight to another: the ground dissolves and forms again
async function exchange(idx, img, ready) {
  await tween(900, (k) => setDetForm(1 - k));
  if (await ready) {
    buildDetail(idx, img);
    detIdx = idx;
    useView(det);
    controls.target.copy(detBase); camera.position.copy(homeCam(detBase));
  }
  await tween(1600, (k) => setDetForm(k));
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
  markActive(idx);
  for (const m of markers) closeCluster(m.el);
  detMark.querySelector(".shrine-label").innerHTML = `<b>${s.id}</b> ${s.name}`;

  // the detail terrain loads while the camera descends over Europe
  const img = new Image();
  const ready = new Promise((res) => { img.onload = () => res(true); img.onerror = () => res(false); });
  img.src = TERRAIN + (s.terrain || s.id.toLowerCase() + ".png");
  (mode === "europe" ? descend(idx, img, ready) : exchange(idx, img, ready)).then(() => { busy = false; });

  $("#p-id").textContent = s.id;
  $("#p-name").textContent = s.name;
  $("#p-region").textContent = s.region;
  $("#d-date").textContent = s.date;
  $("#d-time").textContent = s.time;
  $("#d-temp").textContent = s.temp;
  $("#d-weather").textContent = s.weather;
  $("#d-wind").textContent = s.wind;
  $("#d-coords").textContent = s.coords;
  fillNow(idx);
  $("#d-rig").textContent = s.rig;
  $("#p-prayer").innerHTML = s.prayer.map((l) => `<p>${l}</p>`).join("");
  $(".prayer").hidden = !s.prayer.length;

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
  markActive(-1);
  current = -1;
  if (mode === "detail") { busy = true; ascend().then(() => { busy = false; }); }
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

/* ───────────── current weather: isobars over the overview, "now" at each shrine ─────────────
   Data: Open-Meteo (open-meteo.com, CC BY 4.0), fetched by the visitor's browser and kept for an hour.
   If the service can't be reached the layer is simply absent. */
const WX = { lons: [], lats: [], P: null, shrines: [], sample: false, group: new THREE.Group(), labels: [], on: true };
for (let lon = -12; lon <= 21; lon += 2) WX.lons.push(lon);
for (let lat = 49.5; lat <= 67; lat += 1.5) WX.lats.push(lat);
const isoMat = new THREE.LineBasicMaterial({ color: 0xa9dbe8, transparent: true, opacity: 0.34, depthWrite: false });
const isoMatBold = new THREE.LineBasicMaterial({ color: 0xa9dbe8, transparent: true, opacity: 0.62, depthWrite: false });

async function loadWeather() {
  const KEY = "sa-weather-v1";
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || "null");
    if (c && Date.now() - c.t < 55 * 60 * 1000) return c.d;
  } catch (_) {}
  const pts = [];
  for (const lat of WX.lats) for (const lon of WX.lons) pts.push([lat, lon]);
  for (const s of SHRINES) pts.push(s.geo);
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + pts.map((p) => p[0].toFixed(2)).join(",") +
    "&longitude=" + pts.map((p) => p[1].toFixed(2)).join(",") + "&current=pressure_msl,temperature_2m";
  const r = await fetch(url);
  if (!r.ok) throw new Error("weather " + r.status);
  const j = await r.json();
  const d = { time: j[0].current.time, p: j.map((x) => x.current.pressure_msl), t: j.map((x) => x.current.temperature_2m) };
  try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), d })); } catch (_) {}
  return d;
}

// only where the real service is out of reach in a preview: an invented pressure field, marked as sample
function sampleWeather() {
  const p = [], t = [];
  const f = (lat, lon) => 1012 + 17 * Math.exp(-(((lon - 14) / 11) ** 2 + ((lat - 54) / 6) ** 2)) - 24 * Math.exp(-(((lon + 9) / 9) ** 2 + ((lat - 62) / 5) ** 2));
  for (const lat of WX.lats) for (const lon of WX.lons) { p.push(f(lat, lon)); t.push(0); }
  for (const s of SHRINES) { p.push(f(s.geo[0], s.geo[1])); t.push(6); }
  return { time: null, p, t };
}

function buildIsobars(d) {
  const nx = WX.lons.length, ny = WX.lats.length, U = 6;
  const NX = (nx - 1) * U + 1, NY = (ny - 1) * U + 1;
  let F = new Float32Array(NX * NY);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const gx = i / U, gy = j / U, i0 = Math.min(nx - 2, Math.floor(gx)), j0 = Math.min(ny - 2, Math.floor(gy)), fx = gx - i0, fy = gy - j0;
    const v = (a, b) => d.p[b * nx + a];
    F[j * NX + i] = v(i0, j0) * (1 - fx) * (1 - fy) + v(i0 + 1, j0) * fx * (1 - fy) + v(i0, j0 + 1) * (1 - fx) * fy + v(i0 + 1, j0 + 1) * fx * fy;
  }
  for (let pass = 0; pass < 4; pass++) {             // soften the grid's corners
    const G = new Float32Array(F);
    for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
      const k = j * NX + i;
      G[k] = (F[k] * 4 + F[k - 1] + F[k + 1] + F[k - NX] + F[k + NX]) / 8;
    }
    F = G;
  }
  const lonAt = (i) => WX.lons[0] + (i / U) * 2, latAt = (j) => WX.lats[0] + (j / U) * 1.5;
  const half = eu.W / 2 - 4, halfD = eu.D / 2 - 4;
  const world = (i, j) => {
    const [x, z] = geoToWorld(latAt(j), lonAt(i));
    return new THREE.Vector3(x, 0, z);
  };
  const inside = (v) => Math.abs(v.x) < half && Math.abs(v.z) < halfD;
  const lift = (v) => { v.y = Math.max(eu.heightAt(v.x, v.z) + 4.6, 9.4); return v; };

  let lo = Infinity, hi = -Infinity;
  for (const v of F) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const thin = [], bold = [], labelAt = new Map();
  const step = hi - lo < 28 ? 2 : 4;                 // calm weather: draw every 2 hPa so the field stays readable
  for (let L = Math.ceil(lo / step) * step; L <= hi; L += step) {
    const out = L % (step * 5) === 0 ? bold : thin;
    for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
      const a = F[j * NX + i], b = F[j * NX + i + 1], c = F[(j + 1) * NX + i + 1], e = F[(j + 1) * NX + i];
      const idx = (a > L) | ((b > L) << 1) | ((c > L) << 2) | ((e > L) << 3);
      if (idx === 0 || idx === 15) continue;
      const P = [
        () => world(i + (L - a) / (b - a), j), () => world(i + 1, j + (L - b) / (c - b)),
        () => world(i + (L - e) / (c - e), j + 1), () => world(i, j + (L - a) / (e - a)),
      ];
      const segs = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 0], [1, 2]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[0, 2]], 10: [[0, 1], [2, 3]], 11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[3, 0]] }[idx];
      for (const [m, n] of segs) {
        const p = P[m](), q = P[n]();
        if (!inside(p) || !inside(q)) continue;
        out.push(lift(p), lift(q));
        // one number per line, where it crosses the North Sea meridian
        const lon = lonAt(i);
        if (Math.abs(lon - 3) < 0.4 && !labelAt.has(L + ":" + Math.round(latAt(j) / 5))) labelAt.set(L + ":" + Math.round(latAt(j) / 5), { p: p.clone().lerp(q, 0.5), text: String(L) });
      }
    }
  }
  // pressure centres
  const centres = [];
  for (let j = U; j < NY - U; j++) for (let i = U; i < NX - U; i++) {
    const v = F[j * NX + i];
    let mx = true, mn = true;
    for (let dj = -U; dj <= U && (mx || mn); dj += 2) for (let di = -U; di <= U; di += 2) {
      const w = F[(j + dj) * NX + i + di];
      if (w > v) mx = false;
      if (w < v) mn = false;
    }
    if (!(mx || mn) || hi - lo < 6) continue;
    const p = world(i, j);
    if (!inside(p) || centres.some((c) => c.distanceTo(p) < 95)) continue;
    centres.push(p);
    labelAt.set((mx ? "H" : "L") + i + ":" + j, { p: lift(p), text: (mx ? "H " : "L ") + Math.round(v), centre: true });
  }

  for (const c of [...WX.group.children]) { WX.group.remove(c); c.geometry.dispose(); }
  WX.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(thin), isoMat));
  WX.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(bold), isoMatBold));
  for (const l of WX.labels) l.el.remove();
  WX.labels = [...labelAt.values()].map((l) => {
    const el = document.createElement("span");
    el.className = "iso-label" + (l.centre ? " centre" : "");
    el.textContent = l.text;
    shrineLayer.appendChild(el);
    return { el, p: l.p.setY(l.p.y + 0.6) };
  });
}

function initWeather() {
  euGroup.add(WX.group);
  const btn = $("#wx-toggle"), src = $("#wx-source");
  const show = (d) => {
    const n = WX.lons.length * WX.lats.length;
    WX.shrines = SHRINES.map((_, i) => ({ p: d.p[n + i], t: d.t[n + i], time: d.time }));
    buildIsobars(d);
    $("#wx-label").hidden = $("#wx-cell").hidden = src.hidden = false;
    btn.textContent = WX.sample ? "sample" : (WX.stamp || "on");
    if (current >= 0) fillNow(current);
  };
  btn.addEventListener("click", () => {
    WX.on = !WX.on;
    WX.group.visible = WX.on;
    btn.textContent = WX.on ? (WX.sample ? "sample" : (WX.stamp || "on")) : "off";
    btn.setAttribute("aria-pressed", WX.on);
  });
  loadWeather().then(show).catch(() => {
    // previews that cannot reach the service may carry a dated snapshot of real data
    const snap = window.SA_WEATHER_SNAPSHOT;
    if (snap) { WX.stamp = snap.time.slice(11, 16) + " utc"; return show(snap); }
    const live = /(^|\.)sonicaether\.com$/.test(location.hostname);
    if (!live) { WX.sample = true; show(sampleWeather()); }
  });
}

function fillNow(idx) {
  const w = WX.shrines[idx], row = $("#d-now"), label = $("#d-now-label");
  const ok = w && !WX.sample && w.t != null;
  row.hidden = label.hidden = !ok;
  if (ok) row.textContent = `${Math.round(w.t)} °C · ${Math.round(w.p)} hPa`;
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
const perf = { n: 0, sum: 0, rounds: 0 };
let entered = false;
function loop() {
  const dt = Math.min(clock.getDelta(), 0.1);
  uniforms.uTime.value += reduceMotion ? 0 : dt;
  // if the full overview is too much for this machine, fall back to the thinner half once
  if (eu && !eu.thinned && mode === "europe" && entered) {
    perf.n++; perf.sum += dt;
    if (perf.n === 50) {
      if (perf.sum / perf.n > 0.05) { eu.thinned = true; eu.count = eu.half; eu.points.geometry.setDrawRange(0, eu.half); hud.pts.textContent = eu.half.toLocaleString("en-US"); }
      else if (++perf.rounds >= 3) eu.thinned = "no";
      perf.n = 0; perf.sum = 0;
    }
  }

  if (flight && flight.zoom) {
    const f = flight, k = Math.min(1, (performance.now() - f.t0) / f.dur), e = 0.5 - 0.5 * Math.cos(Math.PI * k);
    // the target is found early on the way in, and left late on the way out
    const et = f.late ? ease(Math.max(0, (k - 0.45) / 0.55)) : ease(Math.min(1, k / 0.4));
    controls.target.lerpVectors(f.c0, f.c1, et);
    tmp.copy(f.n0).lerp(f.n1, e).normalize();
    camera.position.copy(controls.target).addScaledVector(tmp, Math.exp(f.l0 + (f.l1 - f.l0) * e));
    if (k >= 1) { flight = null; f.res(); }
  } else if (flight) {
    const k = Math.min(1, (performance.now() - flight.t0) / flight.dur), e = ease(k);
    camera.position.lerpVectors(flight.p0, flight.p1, e);
    controls.target.lerpVectors(flight.c0, flight.c1, e);
    if (k >= 1) flight = null;
  }
  stepLink();
  stepLOD(dt);
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
    hud.z.textContent = (Math.pow(heightAt(t.x, t.z) / EU.relief, 1 / EU.gamma) * EU.hmax).toFixed(0);
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
  eu = makeCloud(img, { world: EU.world, relief: EU.relief, keepLand: isSmall ? 0.9 : 0.86, keepSea: 0.075 });
  euGroup.add(eu.points);
  uniforms.uEuSize.value.set(eu.W, eu.D);
  useView(eu);
  controls.target.set(0, 0, 51);
  buildShrines();
  initWeather();
  resize();
  document.body.classList.add("ready");
  loop();
};
img.onerror = () => { $("#boot-status").textContent = "terrain data could not be loaded"; };
img.src = TERRAIN + "europe.png";

$("#enter-btn").addEventListener("click", () => {
  entered = true;
  // the scans of all shrines are fetched quietly in the background, so a descent never waits for one
  SHRINES.forEach((s, i) => setTimeout(() => { new Image().src = TERRAIN + (s.terrain || s.id.toLowerCase() + ".png"); }, 1500 + i * 700));
  enter.classList.add("gone");
  setTimeout(() => (enter.hidden = true), 900);
});
