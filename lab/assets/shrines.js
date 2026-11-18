import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SHRINES } from "./shrines-data.js?v=31";

/* ───────────── constants ───────────── */
const TERRAIN = "https://raw.githubusercontent.com/SonicAether/beta.webpage/7bbd5d00601ecdca491e0c734647f04b2c39fa5a/assets/terrain/";   // test copy: the map data of Pull Request 7   // terrain images (overview, fine chunks, shrines)
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
// start view: the whole map, seen from 45° above the ground
const START = { angle: 30, dist: innerWidth < 720 ? 2500 : 1040, target: new THREE.Vector3(0, 0, 51) };
const startPos = () => { const a = START.angle * Math.PI / 180; return START.target.clone().add(new THREE.Vector3(0, Math.sin(a) * START.dist, Math.cos(a) * START.dist)); };
camera.position.copy(startPos());

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
  uDim: { value: 0.74 },
  uIce: { value: new THREE.Color(0xa9dbe8) },
  uBg: { value: BG },
  uSolid: { value: 0 },
  uDrop: { value: 0.04 },
  uTemp: { value: null },
  uTempOn: { value: 0 },
};

const pointMat = new THREE.ShaderMaterial({
  uniforms,
  transparent: false,
  vertexShader: /* glsl */ `
    attribute float aShade;
    attribute float aRand;
    attribute float aWater;
    uniform float uTime, uSize, uPx, uLevel, uListen, uSpan, uDrift, uFar, uForm, uScale, uRise, uSoft, uLogMin, uJit, uSolid, uDrop;
    uniform vec2 uHalf;
    uniform float uHoleA, uHoleR, uCovOn;
    uniform vec4 uHole;
    uniform vec2 uCovN, uEuSize;
    uniform sampler2D uCov, uTemp;
    uniform float uTempOn;
    uniform vec3 uFocus;
    varying float vShade, vFog, vSweep, vRing, vWater, vTemp;
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
        p.xz += vec2(cos(ang), sin(ang)) * (ph - 0.5) * uDrift * (aWater > 0.9 ? 1.0 : aWater > 0.7 ? 0.08 : 0.5);
        life = smoothstep(0.0, 0.18, ph) * (1.0 - smoothstep(0.82, 1.0, ph));
        // lakes hardly move: their points stay and sparkle, each at its own pace
        if (aWater > 0.7 && aWater < 0.9) life = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * (0.6 + 2.2 * aRand) + aRand * 40.0), 6.0);
      }
      if (aWater > 0.5) {
        float swell = aWater > 0.9 ? 1.0 : (aWater > 0.7 ? 0.04 : 0.12);
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
      if (uSoft > 0.0) p.xz += (vec2(fract(aRand * 91.7), fract(aRand * 57.3)) - 0.5) * uJit * pow(uSoft, 1.25);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float depth = -mv.z / uScale;   // a terrain docked small into the overview keeps its own point size and haze
      // a terrain that is just appearing inside the overview starts as coarse as the overview around it:
      // only as many points as the overview has on the same ground, just as large, scattered a little,
      // and fading out over a wide, ragged margin. On the way in it fills up to the whole scan.
      float soft = 1.0;
      float depthS = depth;
      if (uSoft > 0.0) {
        float sc = pow(uSoft, 1.25);           // coarse while far, filling in steadily on the way down
        float keep = exp(uLogMin * sc);
        float few = step(fract(aRand * 13.7), keep);
        float se = pow(uSoft, 0.5);            // the margin stays round and blurred longer than the points stay sparse
        float band = 0.8 * se * min(uHalf.x, uHalf.y) + 1e-4;
        // round and blurred at first, the rectangle of the scan appears only at the end
        float eRect = min(uHalf.x - abs(position.x), uHalf.y - abs(position.z));
        float eRound = (1.0 - length(position.xz / uHalf)) * min(uHalf.x, uHalf.y);
        float e = mix(eRect, eRound, smoothstep(0.0, 0.6, se)) / band;
        float edge = smoothstep(0.0, 1.0, e + (fract(aRand * 5.31) - 0.5) * 1.1 * se);
        soft = few * edge;
        depthS = exp(mix(log(depth), log(-mv.z), sc));   // point size of the overview at this distance
      }
      gl_PointSize = clamp(uSize * uPx * (230.0 / depthS), 0.9, 8.0 * uPx);
      vShade = aShade;
      vTemp = 0.5;
      if (uTempOn > 0.0) vTemp = texture2D(uTemp, (modelMatrix * vec4(position, 1.0)).xz / uEuSize + 0.5).r;
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
      vFog *= step(uDrop, fract(aRand + uTime * 0.013 * aRand));
      // a solid scan: once the surface has formed, the land points give way to it (water stays)
      if (aWater < 0.5) soft *= 1.0 - uSolid;
      if (form * soft < 0.03) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // not there yet: don't cover what lies behind
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uInk, uIce, uBg;
    uniform float uDim;
    uniform float uListen;
    uniform float uTime, uTempOn;
    varying float vShade, vFog, vSweep, vRing, vWater, vTemp;
    // 2 m temperature as a quiet tint of the land, in the colours of the site:
    // ice blue in the cold, the plain ink when mild, a dusk violet and a faded rose in the warmth
    vec3 tempTint(float t) {
      vec3 c0 = vec3(0.22, 0.56, 0.9), c1 = vec3(0.45, 0.78, 0.9), c2 = vec3(0.84, 0.88, 0.86), c3 = vec3(0.66, 0.46, 0.86), c4 = vec3(0.9, 0.42, 0.52);
      if (t < 0.375) return mix(c0, c1, smoothstep(0.0, 0.375, t));
      if (t < 0.6) return mix(c1, c2, smoothstep(0.375, 0.6, t));
      if (t < 0.8) return mix(c2, c3, smoothstep(0.6, 0.8, t));
      return mix(c3, c4, smoothstep(0.8, 1.0, t));
    }
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
      if (vWater < 0.5 && uTempOn > 0.0) {
        // the tint keeps the relief: same brightness, other hue
        vec3 tc = tempTint(vTemp), w = vec3(0.3, 0.59, 0.11);
        col = mix(col, tc * dot(col, w) / dot(tc, w) * 1.12, uTempOn * 0.95);
      }
      col *= mix(1.0, 0.72, uListen);
      col += uInk * vSweep * 0.35;
      col = mix(col, uIce, clamp(vRing, 0.0, 1.0) * 0.8);
      gl_FragColor = vec4(mix(uBg, col * uDim, vFog), 1.0);
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
    W[i] = r < 3 ? (opt.asSea && r === 1 ? 1 : r + 1) : 0;
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

  const stride = opt.stride ?? (isSmall ? 2 : 1);
  const keepLand = opt.keepLand;
  const keepWater = 0.11;
  const keepLake = opt.keepLake ?? 0.3;
  const KEEP = [keepLand, opt.keepSea ?? keepWater, keepLake, 0.5], WAT = [0, 1, 0.75, 0.6];
  const cap = Math.ceil((NX * NZ) / (stride * stride) * (opt.capShare ?? 0.56)) + 1000;   // room for the points that will be kept
  let pos = new Float32Array(cap * 3), shade = new Float32Array(cap), rnd = new Float32Array(cap), wat = new Float32Array(cap);
  let n = 0;
  const cell = W_ / NX;
  // detail scans share one brightness: the land's mean shade is brought gently towards a common value
  let gain = 1;
  if (opt.norm) {
    let sum = 0, cnt = 0;
    for (let k = 0; k < NX * NZ; k += 7) { const r = px[k * 4]; if (r > 3) { sum += r / 255; cnt++; } }
    if (cnt) gain = THREE.MathUtils.clamp(opt.norm / (sum / cnt), 0.72, 1.3);
  }
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
      if (px[k * 4] === 3) continue;   // outside a scan's own outline: no ground at all
      // the scan thins out toward its limits instead of ending in a wall
      const edge = opt.hard ? 1 : Math.min(i, j, NX - 1 - i, NZ - 1 - j) / 40;   // detail maps end in a clean cut
      if (edge <= 0) continue;
      if (rand() > KEEP[isW] * (edge >= 1 ? 1 : edge * edge * (3 - 2 * edge))) continue;
      const x = (i / (NX - 1) - 0.5) * W_ + (rand() - 0.5) * cell * stride;
      const z = (j / (NZ - 1) - 0.5) * D_ + (rand() - 0.5) * cell * stride;
      if (n >= cap) continue;
      pos[n * 3] = x; pos[n * 3 + 1] = H[k] * opt.relief; pos[n * 3 + 2] = z;
      shade[n] = isW ? rand() : Math.min(1, px[k * 4] / 255 * gain);
      rnd[n] = rand(); wat[n] = WAT[isW]; n++;
    }
   }
  }
  // walls (opt.walls): where land meets water, the cliff face is drawn down to the water, so that
  // seen from the side no gap opens between the sea and the ground
  if (opt.walls) {
    const wp = [], ws = [], step = cell * stride * 0.9;
    for (let j = 1; j < NZ - 1; j += stride) for (let i = 1; i < NX - 1; i += stride) {
      const k = j * NX + i;
      if (W[k] || px[k * 4] === 3) continue;
      let lo = Infinity;
      for (const q of [k - 1, k + 1, k - NX, k + NX]) if (W[q]) lo = Math.min(lo, H[q]);
      if (lo === Infinity) continue;
      const top = H[k] * opt.relief, bot = lo * opt.relief - 0.4;
      const m = Math.floor((top - bot) / step);
      const x = (i / (NX - 1) - 0.5) * W_, z = (j / (NZ - 1) - 0.5) * D_;
      for (let t = 1; t <= m; t++) {
        if (rand() > 0.85) continue;
        wp.push(x + (rand() - 0.5) * cell, top - t * step + (rand() - 0.5) * step * 0.6, z + (rand() - 0.5) * cell);
        ws.push((px[k * 4] / 255) * (0.45 + 0.35 * rand()));
      }
    }
    const tot = n + ws.length;
    const P2 = new Float32Array(tot * 3); P2.set(pos.subarray(0, n * 3)); P2.set(wp, n * 3);
    const S2 = new Float32Array(tot); S2.set(shade.subarray(0, n)); S2.set(ws, n);
    const R2 = new Float32Array(tot); R2.set(rnd.subarray(0, n)); for (let q = n; q < tot; q++) R2[q] = rand();
    const A2 = new Float32Array(tot); A2.set(wat.subarray(0, n));
    pos = P2; shade = S2; rnd = R2; wat = A2; n = tot;
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

/* A solid surface for a scan (shrine option solid: true): a mesh whose heights come from the same
   terrain PNG, coloured per pixel from the scan's own shading and lit from its normals, so it reads
   as a cast of the ground and nothing behind shows through. Vertices on a coarser grid; the full
   detail comes from the texture. */
function makeSurface(img, opt) {
  const NX = img.width, NZ = img.height, W_ = opt.world, D_ = W_ * NZ / NX;
  const cv = document.createElement("canvas"); cv.width = NX; cv.height = NZ;
  const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, NX, NZ).data;
  const st = opt.stride, nx = Math.floor((NX - 1) / st) + 1, nz = Math.floor((NZ - 1) / st) + 1;
  const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  for (let j = 0, n = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++, n++) {
      const I = Math.min(i * st, NX - 1), J = Math.min(j * st, NZ - 1), k = (J * NX + I) * 4;
      pos[n * 3] = (I / (NX - 1) - 0.5) * W_;
      pos[n * 3 + 1] = (px[k + 1] * 16 + (px[k + 2] >> 4)) / 4095 * opt.relief;
      pos[n * 3 + 2] = (J / (NZ - 1) - 0.5) * D_;
      uv[n * 2] = (I + 0.5) / NX; uv[n * 2 + 1] = (J + 0.5) / NZ;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  for (let j = 0, m = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[m++] = a; idx[m++] = c; idx[m++] = b; idx[m++] = b; idx[m++] = c; idx[m++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.NoColorSpace; tex.flipY = false; tex.premultiplyAlpha = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); tex.needsUpdate = true;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: tex }, uTexel: { value: new THREE.Vector2(1 / NX, 1 / NZ) }, uCell: { value: new THREE.Vector2(W_ / NX, D_ / NZ) },
      uRelief: { value: opt.relief }, uSolid: detUniforms.uSolid, uTime: uniforms.uTime, uLevel: uniforms.uLevel, uListen: uniforms.uListen,
      uFocus: detUniforms.uFocus, uInk: uniforms.uInk, uIce: uniforms.uIce, uBg: uniforms.uBg, uDim: detUniforms.uDim, uSpan: detUniforms.uSpan,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vP;
      void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex; uniform vec2 uTexel, uCell; uniform float uRelief, uSolid, uTime, uLevel, uListen, uDim, uSpan;
      uniform vec3 uFocus, uInk, uIce, uBg;
      varying vec2 vUv; varying vec3 vP;
      float h(vec2 q){ vec4 t = texture2D(uTex, q); return (floor(t.g * 255.0 + 0.5) * 16.0 + floor(t.b * 255.0 / 16.0 + 0.03)) / 4095.0 * uRelief; }
      void main(){
        vec4 t = texture2D(uTex, vUv);
        float r = t.r * 255.0;
        // the form from the heights, sampled two pixels apart (the 12-bit steps would show at one)
        vec2 e = uTexel * 2.0;
        float dx = (h(vUv + vec2(e.x, 0.0)) - h(vUv - vec2(e.x, 0.0))) / (4.0 * uCell.x);
        float dz = (h(vUv + vec2(0.0, e.y)) - h(vUv - vec2(0.0, e.y))) / (4.0 * uCell.y);
        vec3 n = normalize(vec3(-dx, 1.0, -dz));
        float lam = max(dot(n, normalize(vec3(-0.55, 0.75, -0.45))), 0.0);   // light from the north-west, as in the scan
        float sky = 0.5 + 0.5 * n.y;
        float s = pow(clamp(r / 250.0, 0.0, 1.0), 1.35);
        vec3 col = uInk * (0.08 + s * 0.92) * (0.62 + 0.3 * lam + 0.18 * sky);
        if (r < 1.5) col = vec3(0.035, 0.06, 0.075) + vec3(0.02, 0.05, 0.06) * lam;   // lakes: dark water under the shimmer
        // the slow sweep and the listening rings, as on the points
        float sweepX = mod(uTime * uSpan * 0.03, uSpan * 2.0) - uSpan;
        col += uInk * exp(-pow((vP.x + vP.z * 0.25 - sweepX) / (uSpan * 0.006), 2.0)) * 0.25;
        float d = distance(vP.xz, uFocus.xz), rr = mod(uTime * 11.0, 60.0);
        float ring = (exp(-pow((d - rr) / 1.6, 2.0)) * (1.0 - rr / 60.0) * (0.25 + uLevel * 2.2) + smoothstep(14.0, 0.0, d) * uLevel * 1.4) * uListen;
        col *= mix(1.0, 0.72, uListen);
        col = mix(col, uIce, clamp(ring, 0.0, 1.0) * 0.8);
        gl_FragColor = vec4(mix(uBg, col * uDim, uSolid), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.userData.own = true;
  return mesh;
}

/* ───────────── the prayer: German original, English version on request ───────────── */
let prayerOf = null, prayerEn = false;
try { prayerEn = localStorage.getItem("shrines-prayer-lang") === "en"; } catch (e) {}
const prayerBtn = $("#prayer-lang");
function renderPrayer() {
  const s = prayerOf; if (!s) return;
  const en = prayerEn && (s.prayerEn || []).length, lines = en ? s.prayerEn : (s.prayer || []);
  const el = $("#p-prayer");
  el.lang = en ? "en" : "de";
  el.innerHTML = lines.map((l) => `<p>${l}</p>`).join("") + (s.prayerBy ? `<p class="by">${s.prayerBy}${en ? ", translated" : ""}</p>` : "");
  prayerBtn.hidden = !(s.prayerEn || []).length;
  prayerBtn.innerHTML = `<span class="${en ? "" : "on"}">DE</span> · <span class="${en ? "on" : ""}">EN</span>`;
  prayerBtn.setAttribute("aria-label", en ? "Show the German original" : "Show the English version");
  prayerBtn.setAttribute("aria-pressed", en ? "true" : "false");
}
prayerBtn.addEventListener("click", () => {
  prayerEn = !prayerEn;
  try { localStorage.setItem("shrines-prayer-lang", prayerEn ? "en" : "de"); } catch (e) {}
  const el = $("#p-prayer");
  el.classList.add("swap");
  setTimeout(() => { renderPrayer(); el.classList.remove("swap"); }, 450);
});

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
backBtn.textContent = "← Back to the map";
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
const CH = { size: 0.5, dim: 0.92 };
const EU_SEA = 0.02;    // share of sea cells drawn on the overview: a sparse, dark sea   // point size and brightness of fine chunks relative to the coarse overview
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
  const img = Object.assign(new Image(), { crossOrigin: "anonymous" });
  img.onload = () => {
    if (LOD.chunks.get(key) !== c) return;
    const [ci, cj] = key.split("_").map(Number), b = chunkBox(ci, cj);
    const mat = pointMat.clone();
    mat.uniforms = { ...uniforms, uForm: { value: 0 }, uSize: { value: uniforms.uSize.value * CH.size }, uDim: { value: uniforms.uDim.value * CH.dim }, uCovOn: { value: 0 } };
    const cl = makeCloud(img, { world: b.w, depth: b.d, relief: EU.relief, keepLand: 0.86, keepSea: EU_SEA / 9, hard: true, mat });
    cl.points.position.set(b.x, 0, b.z);
    c.points = cl.points; c.mat = mat;
    euGroup.add(cl.points);
  };
  img.src = TERRAIN + "eu/" + key + ".png";
}
function stepLOD(dt) {
  if (!LOD.index || !eu) return;
  const force = DEBUG && DEBUG.lod;
  if (DEBUG && DEBUG.nolod) LOD.off = true;
  const active = (force && !LOD.off || (!LOD.off && eu.thinned !== true)) && mode === "europe" && euGroup.visible;
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
    c.fade = goal > f ? Math.min(1, f + dt / 2.8) : Math.max(0, f - dt / 1.2);
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
// at the stop above a shrine that shares an area marker: a marker at its exact place
const stopMark = document.createElement("div");
stopMark.className = "shrine active off";
stopMark.innerHTML = `<span class="shrine-mark" aria-hidden="true"></span><span class="shrine-label"></span>`;
const detMark = document.createElement("div");
detMark.className = "shrine active off";
detMark.innerHTML = `<span class="shrine-mark" aria-hidden="true"></span><span class="shrine-label"></span>`;

// Aether radio: a marker at the place it is tuned to (see aether-radio.js)
const radio = { on: false, base: null, top: null };
const radioMark = document.createElement("div");
radioMark.className = "shrine radio-mark off";
radioMark.innerHTML = `<span class="shrine-mark" aria-hidden="true"></span><span class="shrine-label"></span>`;

function buildShrines() {
  const list = $("#index-list");
  $("#shrine-count").textContent = SHRINES.length;
  const W = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
  $("#intro-count").textContent = W[SHRINES.length] || SHRINES.length;
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
    li.addEventListener("pointerenter", () => hoverShrine(idx, true));
    li.addEventListener("pointerleave", () => hoverShrine(idx, false));
    list.appendChild(li);
    shrineObjs.push({ s, base: bases[idx], own: bases[idx], li, el: null, inArea: false });
  });

  for (const [area, members] of areas) {
    const base = new THREE.Vector3();
    members.forEach((i) => base.add(bases[i]));
    base.divideScalar(members.length);
    base.y = eu.heightAt(base.x, base.z);
    const top = base.clone().setY(base.y + STEM);
    const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([base, top]), lineMat);
    const ring = ringLine(base.x, base.z, 3.2, eu.heightAt);   // an area looks like a single shrine
    euGroup.add(stem, ring);

    const el = document.createElement("div");
    el.className = "shrine";
    if (members.length === 1) {
      const s = SHRINES[members[0]];
      el.innerHTML = `<button type="button" class="shrine-btn" aria-label="${s.id} ${s.name}, open shrine"><span class="shrine-mark" aria-hidden="true"></span><span class="shrine-label"><b>${s.id}</b></span></button>`;
      el.querySelector("button").addEventListener("click", () => openShrine(members[0]));
      el.addEventListener("pointerenter", () => hoverShrine(members[0], true));
      el.addEventListener("pointerleave", () => hoverShrine(members[0], false));
    } else {
      // several recordings close together: from afar one marker listing them all; close by,
      // each stands at its own place (see placeLabels)
      el.classList.add("cluster", "open");
      el.innerHTML = `<button type="button" class="shrine-btn area-btn" aria-label="${area}: ${members.length} shrines, move closer"><span class="shrine-mark" aria-hidden="true"></span></button><ul class="cluster-list" aria-label="${area}"></ul>`;
      el.querySelector(".area-btn").addEventListener("click", () => zoomToArea(base));
      const ul = el.querySelector("ul");
      members.forEach((i) => {
        const s = SHRINES[i], item = document.createElement("li");
        item.innerHTML = `<button type="button" aria-label="${s.id} ${s.name}, open shrine"><span>${s.id}</span></button>`;
        item.querySelector("button").addEventListener("click", () => openShrine(i));
        item.addEventListener("pointerenter", () => hoverShrine(i, true));
        item.addEventListener("pointerleave", () => hoverShrine(i, false));
        ul.appendChild(item);
      });
    }
    shrineLayer.appendChild(el);
    const own = [];
    if (members.length > 1) for (const i of members) {
      const s = SHRINES[i], b = bases[i], t = b.clone().setY(b.y + STEM), e = document.createElement("div");
      e.className = "shrine solo off";
      e.innerHTML = `<button type="button" class="shrine-btn" aria-label="${s.id} ${s.name}, open shrine"><span class="shrine-mark" aria-hidden="true"></span><span class="shrine-label"><b>${s.id}</b></span></button>`;
      e.querySelector("button").addEventListener("click", () => openShrine(i));
      e.addEventListener("pointerenter", () => hoverShrine(i, true));
      e.addEventListener("pointerleave", () => hoverShrine(i, false));
      shrineLayer.appendChild(e);
      const st = new THREE.Line(new THREE.BufferGeometry().setFromPoints([b, t]), lineMat), rg = ringLine(b.x, b.z, 3.2, eu.heightAt);
      st.visible = rg.visible = false; euGroup.add(st, rg);
      own.push({ el: e, top: t, i, geo: [st, rg] });
    }
    markers.push({ el, top, own, geo: [stem, ring] });
    members.forEach((i) => { shrineObjs[i].el = el; shrineObjs[i].base = base; shrineObjs[i].inArea = members.length > 1; });
  }
  shrineLayer.appendChild(detMark);
  shrineLayer.appendChild(stopMark);
  shrineLayer.appendChild(radioMark);

}
function closeCluster() {}   // area lists stay open now
// the mark of an area: a click descends toward it until its recordings stand apart, each at its place
async function zoomToArea(base) {
  if (busy || mode !== "europe") return;
  busy = true;
  if (!euCam) euCam = { p: camera.position.clone(), t: controls.target.clone() };
  stopIdx = -1; showLinks();
  const g = base.clone().setY(base.y * VMIN), AREA_DIST = 150;
  const d0 = camera.position.distanceTo(controls.target), travel = controls.target.distanceTo(g);
  await zoomTo(g.clone().add(STEEP.clone().multiplyScalar(AREA_DIST)), g, 2600 + 1500 * Math.abs(Math.log(d0 / AREA_DIST)) + Math.min(2600, travel * 6));
  busy = false; showLinks();
}
const indexBox = $(".hud-index");
indexBox.querySelector("h2").addEventListener("click", () => indexBox.classList.toggle("open"));
function hoverShrine(idx, on) {
  const o = shrineObjs[idx]; if (!o) return;
  o.li.classList.toggle("hover", on);
  for (const m of markers) {
    if (m.el === o.el) {
      m.el.classList.toggle("hover", on);
      m.el.querySelectorAll(".cluster-list li").forEach((li, k) => li.classList.toggle("hover", on && m.own[k] && m.own[k].i === idx));
    }
    for (const x of m.own) if (x.i === idx) x.el.classList.toggle("hover", on);
  }
}
function markActive(idx) {
  for (const m of markers) {
    m.el.classList.toggle("active", idx >= 0 && shrineObjs[idx].el === m.el);
    for (const o of m.own) o.el.classList.toggle("active", o.i === idx);
    m.el.querySelectorAll(".cluster-list li").forEach((li, k) => li.classList.toggle("active", m.own[k] && m.own[k].i === idx));
  }
  shrineObjs.forEach((x, i) => x.li.classList.toggle("active", i === idx));
}

const tmp = new THREE.Vector3();
const STEM = 52;   // how high a shrine's marker stands above the ground of the overview
// an area splits into its recordings as soon as they would stand this far apart on screen
const SPLIT_PX = 24;
const scr = new THREE.Vector3();
function apart(own) {
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  const pts = own.map((o) => { scr.copy(o.top); scr.y *= euGroup.scale.y; scr.project(camera); return [scr.x * w / 2, scr.y * h / 2]; });
  let d = Infinity;
  for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) d = Math.min(d, Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]));
  return d;
}
// The overview's relief is strongly exaggerated, which reads well from afar but turns hills into
// spikes close up. Near the ground it eases off, down to the scale of the detail terrains.
const VMIN = 0.06;
const VMAX = 0.5;   // relief at the start view, as a share of the stored exaggeration
const vertAt = (d) => VMIN + (VMAX - VMIN) * sstep(Math.log(76), Math.log(700), Math.log(Math.max(d, 1)));
const groundOf = (o) => o.own.clone().setY(o.own.y * VMIN);     // a shrine's own place (not its area's) as seen from close by
function place(el, p, far) {
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  tmp.copy(p);
  if (mode === "europe" && el !== detMark) tmp.y *= euGroup.scale.y;
  tmp.project(camera);
  const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
  el.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px)`;
  el.classList.toggle("off", !vis);
  el.classList.toggle("far", far);
}
function placeLabels() {
  if (mode === "detail") {
    for (const m of markers) { m.el.classList.add("off"); for (const o of m.own) o.el.classList.add("off"); }
    scanLink.classList.add("off"); radioMark.classList.add("off"); stopMark.classList.add("off");
    for (const l of WX.labels) l.el.classList.add("off");
    if (detTop) place(detMark, detTop, false);
    return;
  }
  detMark.classList.add("off");
  stopMark.classList.add("off");
  if (stopIdx >= 0 && !scanLink.hidden) { place(scanLink, shrineObjs[stopIdx].own, false); if (camera.position.distanceTo(controls.target) > 240) scanLink.classList.add("off"); }
  else scanLink.classList.add("off");
  for (const m of markers) {
    const split = m.own.length > 0 && apart(m.own) > SPLIT_PX;
    if (split) m.el.classList.add("off"); else place(m.el, m.top, false);
    for (const o of m.own) { if (split) place(o.el, o.top, false); else o.el.classList.add("off"); o.geo.forEach((g) => (g.visible = split)); }
    m.geo.forEach((g) => (g.visible = !split));
  }
  if (radio.on && radio.top) place(radioMark, radio.top, false); else radioMark.classList.add("off");
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

/* ───────────── arriving at a shrine, entering its scan, and back ─────────────
   Two deliberate steps. Opening a shrine flies down to a stop above its place on the overview,
   as close as the overview's finest data carries; the recording can be heard from there. A link
   then leads into the LIDAR scan of the ground itself: the overview dissolves into points and the
   scan forms. No attempt is made to blend the two, their scales are too far apart. */
// camera at a stop: 45° above the ground, far enough to see roughly 80 km around the shrine
const STEEP = new THREE.Vector3(0, 0.7071, 0.7071).normalize()   // north up;
const STOP = STEEP.clone().multiplyScalar(84);
const detUniforms = {
  uSpan: { value: DETAIL.world }, uDrift: { value: 6 }, uFar: { value: 6000 }, uForm: { value: 0 },
  uDim: { value: 1 }, uScale: { value: 1 }, uRise: { value: 0 }, uSoft: { value: 0 }, uHoleA: { value: 0 }, uCovOn: { value: 0 },
  uFocus: { value: new THREE.Vector3(9999, 0, 9999) }, uSolid: { value: 0 }, uSize: { value: 1 }, uDrop: { value: 0.04 }, uTempOn: { value: 0 },
};
const detMat = pointMat.clone();
detMat.uniforms = { ...uniforms, ...detUniforms };   // time, level and size are shared with the overview
const detLineMat = lineMat.clone();
const detFaintMat = lineMat.clone();
let detBase = null, detSpin = [], detSurface = null;
let stopIdx = -1;                      // the shrine the overview has stopped above, or -1

function clearDetail() {
  for (const c of [...detGroup.children]) {
    detGroup.remove(c); c.geometry.dispose();
    if (c.userData.own) { c.material.uniforms.uTex.value.dispose(); c.material.dispose(); }
  }
  det = null; detSurface = null; detTop = null; detBase = null; detSpin = [];
}

// The shrine inside its scan: a beam of light rising from the place of the recording.
const beamUniforms = { uA: { value: 0 }, uTime: uniforms.uTime, uLevel: uniforms.uLevel, uListen: uniforms.uListen };
const beamMat = new THREE.ShaderMaterial({
  uniforms: beamUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    attribute float aGain;
    varying float vH, vGain, vEdge;
    void main(){
      vH = uv.y; vGain = aGain;
      vec3 n = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vEdge = abs(dot(n, normalize(-mv.xyz)));        // brightest where the shaft is seen through its middle
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uA, uTime, uLevel, uListen;
    varying float vH, vGain, vEdge;
    void main(){
      float fall = pow(1.0 - vH, 1.7);
      float breathe = 0.86 + 0.14 * sin(uTime * 0.7 - vH * 5.0) + uLevel * uListen * 1.6;
      float a = vGain * fall * pow(vEdge, 1.4) * breathe * uA;
      gl_FragColor = vec4(vec3(0.66, 0.86, 0.91) * a, a);
    }`,
});
const BEAM_H = 120;
function shrineGlyph(b, hAt) {
  const out = [];
  // three nested shafts: a bright core, a body, a wide faint halo
  for (const [r0, r1, gain] of [[0.5, 0.9, 1.3], [1.4, 3.4, 0.55], [3.2, 10, 0.2]]) {
    const g = new THREE.CylinderGeometry(r1, r0, BEAM_H, 40, 1, true);
    g.translate(0, BEAM_H / 2, 0);
    g.setAttribute("aGain", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(gain), 1));
    const m = new THREE.Mesh(g, beamMat);
    m.position.copy(b); m.renderOrder = 5;
    out.push(m);
  }
  // where it stands: one firm ring and a pool of light on the ground
  const ring = [];
  for (let a = 0; a <= 64; a++) { const t = (a / 64) * Math.PI * 2, x = b.x + Math.cos(t) * 3.4, z = b.z + Math.sin(t) * 3.4; ring.push(new THREE.Vector3(x, hAt(x, z) + 0.35, z)); }
  out.push(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), detLineMat));
  const pool = new THREE.CircleGeometry(6.5, 48);
  pool.rotateX(-Math.PI / 2);
  const uvp = pool.attributes.uv, gp = new Float32Array(uvp.count), np = pool.attributes.normal;
  for (let i = 0; i < uvp.count; i++) { const d = Math.hypot(uvp.getX(i) - 0.5, uvp.getY(i) - 0.5) * 2; gp[i] = 0.5 * (1 - d) * (1 - d); uvp.setY(i, 0); }
  pool.setAttribute("aGain", new THREE.BufferAttribute(gp, 1));
  const pm = new THREE.Mesh(pool, beamMat);
  pm.position.set(b.x, b.y + 0.5, b.z); pm.renderOrder = 4;
  out.push(pm);
  return out;
}

function buildDetail(idx, img) {
  const s = SHRINES[idx];
  clearDetail();
  const rel = DETAIL.relief * (s.relief ?? 1);
  // a solid scan keeps a thinner cloud: it only shows while the ground assembles, and for the water
  // dense: every pixel of the scan becomes a point (on phones every second one)
  // water "still": lakes that only sparkle, instead of water that drifts like the sea
  const still = s.water === "still";
  det = makeCloud(img, { world: DETAIL.world, relief: rel, keepLand: s.solid ? 0.7 : s.dense ? 0.72 : 0.92, keepSea: 0.085, keepLake: s.solid ? 0.9 : still ? 0.22 : undefined,
    asSea: !still, hard: true, walls: !!s.walls, norm: 0.5, mat: detMat, stride: s.solid ? (isSmall ? 4 : 3) : s.dense ? (isSmall ? 2 : 1) : undefined, capShare: s.dense ? 1 : undefined });
  detSurface = s.solid ? makeSurface(img, { world: DETAIL.world, relief: rel, stride: isSmall ? 4 : 2 }) : null;
  detUniforms.uSolid.value = 0;
  // dense scans: finer points and a little dimmer, so the ground stays airy rather than a white sheet
  detUniforms.uSize.value = uniforms.uSize.value * (s.dense ? 0.95 : 1);
  detUniforms.uDrop.value = s.dense ? 0.03 : 0.04;
  detUniforms.uDim.value = s.dense ? 0.82 : 1;
  // the recording spot inside the scan (spot: [u, v] from the north-west corner; centre by default)
  const [su, sv] = s.spot || [0.5, 0.5];
  const sx = (su - 0.5) * det.W, sz = (sv - 0.5) * det.D;
  const y = det.heightAt(sx, sz);
  detBase = new THREE.Vector3(sx, y, sz);
  detTop = new THREE.Vector3(sx, y + 9, sz);
  detGroup.add(det.points, ...shrineGlyph(detBase, det.heightAt));
  if (detSurface) { detSurface.renderOrder = -1; detGroup.add(detSurface); }
  detUniforms.uFocus.value.copy(detBase);
  fillDetailFoot(idx);
}
// where the camera rests in a scan: the same steep view, looking toward `heading`
// (degrees, 0 = north, 270 = west), so that for example a coast can lie at the bottom of the picture
const SCAN_VIEW = { angle: 45, dist: 210 };   // camera in a scan: degrees above the ground, distance
const homeCam = (b, heading = 0) => {
  const h = heading * Math.PI / 180, a = SCAN_VIEW.angle * Math.PI / 180, r = SCAN_VIEW.dist;
  return new THREE.Vector3(b.x - Math.sin(h) * Math.cos(a) * r, b.y + Math.sin(a) * r, b.z + Math.cos(h) * Math.cos(a) * r);
};
function setEuForm(v) {
  uniforms.uForm.value = v;
  lineMat.opacity = 0.55 * v; isoMat.opacity = 0.34 * v; isoMatBold.opacity = 0.62 * v;
  shrineLayer.style.opacity = mode === "europe" ? (v < 0.6 ? 0 : (v - 0.6) / 0.4) : 1;
}
function setDetForm(v) {
  detUniforms.uForm.value = v; detLineMat.opacity = 0.8 * v; beamUniforms.uA.value = v;
  detUniforms.uSolid.value = detSurface ? sstep(0.5, 1, v) : 0;   // a solid scan sets after its points have gathered
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

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

// scans are fetched once and kept
const scans = new Map();
function scanOf(idx) {
  if (!scans.has(idx)) {
    const s = SHRINES[idx], img = Object.assign(new Image(), { crossOrigin: "anonymous" });
    const ready = new Promise((res) => { img.onload = () => res(true); img.onerror = () => res(false); });
    img.src = TERRAIN + (s.terrain || s.id.toLowerCase() + ".png");
    scans.set(idx, { img, ready });
  }
  return scans.get(idx);
}

// the two links into the scan: one in the panel, one at the shrine's place on the map
const scanBtn = document.createElement("button");
scanBtn.id = "scan-btn"; scanBtn.type = "button"; scanBtn.className = "u"; scanBtn.hidden = true;
const scanLink = document.createElement("button");
scanLink.type = "button"; scanLink.className = "scan-link u off"; scanLink.textContent = "Detailed LIDAR view ↓";
// a shrine without a LIDAR scan (scan: false) has no detail view: the overview is its map
const hasScan = (idx) => idx >= 0 && SHRINES[idx].scan !== false;
function showLinks() {
  const atStop = mode === "europe" && stopIdx >= 0 && !busy && hasScan(stopIdx);
  scanBtn.hidden = !(atStop || mode === "detail");
  scanBtn.textContent = mode === "detail" ? "← Back to the map" : "Detailed LIDAR view ↓";
  scanLink.hidden = !atStop;
  backBtn.hidden = mode !== "detail";
}

// step one: down to the stop above a shrine
async function flyToStop(idx) {
  const o = shrineObjs[idx], g = groundOf(o);
  if (stopIdx < 0 && !euCam) euCam = { p: camera.position.clone(), t: controls.target.clone() };
  stopIdx = -1; showLinks();
  if (hasScan(idx)) scanOf(idx);                          // the scan loads during the flight
  const d0 = camera.position.distanceTo(controls.target), travel = controls.target.distanceTo(g);
  await zoomTo(g.clone().add(STOP), g, 2600 + 1700 * Math.abs(Math.log(d0 / STOP.length())) + Math.min(2600, travel * 9));
  stopIdx = idx;
}

// step two: into the scan
async function enterScan() {
  if (busy || mode !== "europe" || stopIdx < 0) return;
  busy = true; showLinks();
  if (!hasScan(stopIdx)) { busy = false; showLinks(); return; }
  const idx = stopIdx, sc = scanOf(idx);
  if (await sc.ready) {
    buildDetail(idx, sc.img);
    euGroup.visible = false; detGroup.visible = true;
    mode = "detail"; detIdx = idx;
    useView(det);
    controls.minDistance = 7; controls.maxDistance = 520;
    // look at a point between the shrine and the middle of the scan, so the land fills the picture
    const vt = detBase.clone().lerp(new THREE.Vector3(0, detBase.y, 0), 0.55);
    controls.target.copy(vt); camera.position.copy(homeCam(vt, SHRINES[idx].view));
    document.body.classList.add("detail");
    // the scan assembles point by point where it lies; the camera does not move
    setEuForm(0); setDetForm(0);
    await tween(SHRINES[idx].solid ? 2600 : 1500, (k) => setDetForm(k));
  }
  busy = false; showLinks();
}

// out of the scan: back to the stop above the shrine, or all the way up
async function leaveScan(up) {
  if (busy || mode !== "detail") return;
  busy = true;
  const idx = detIdx, g = groundOf(shrineObjs[idx]);
  clearDetail();
  detGroup.visible = false; euGroup.visible = true;
  mode = "europe"; detIdx = -1; stopIdx = idx;
  useView(eu);
  controls.minDistance = 10; controls.maxDistance = 3500;
  controls.target.copy(g); camera.position.copy(g).add(STOP);
  document.body.classList.remove("detail");
  setEuForm(1);
  showLinks();
  if (up) await riseFromStop();
  busy = false; showLinks();
}
async function riseFromStop() {
  const home = euCam || { p: startPos(), t: START.target.clone() };
  stopIdx = -1; euCam = null; showLinks();
  await zoomTo(home.p, home.t, 7500, true);
}

// from one scan straight to another: the ground dissolves and forms again
async function exchange(idx) {
  const sc = scanOf(idx);
  if (await sc.ready) {
    buildDetail(idx, sc.img);
    detIdx = idx;
    useView(det);
    // look at a point between the shrine and the middle of the scan, so the land fills the picture
    const vt = detBase.clone().lerp(new THREE.Vector3(0, detBase.y, 0), 0.55);
    controls.target.copy(vt); camera.position.copy(homeCam(vt, SHRINES[idx].view));
    setDetForm(0);
    await tween(SHRINES[idx].solid ? 2600 : 1500, (k) => setDetForm(k));
  }
}

/* ───────────── panel + player ───────────── */
const panel = $("#panel");
const audio = $("#audio");
let current = -1;

function openShrine(idx) {
  if (busy || (mode === "detail" && idx === detIdx)) return;
  if (window.AetherRadio && window.AetherRadio.on()) window.AetherRadio.stop(true);
  const o = shrineObjs[idx];
  const s = o.s;
  current = idx; busy = true;
  markActive(idx);
  indexBox.classList.remove("open");
  for (const m of markers) closeCluster(m.el);
  detMark.querySelector(".shrine-label").innerHTML = `<b>${s.id}</b>`;

  const go = mode === "europe" ? flyToStop(idx)
    : hasScan(idx) ? exchange(idx)
    : (async () => { busy = false; await leaveScan(false); busy = true; await flyToStop(idx); })();   // from a scan to a shrine without one
  go.then(() => { busy = false; showLinks(); });

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
  prayerOf = s; renderPrayer();
  $(".prayer").hidden = !(s.prayer || []).length;
  for (const [dt, dd] of [["#d-rig-label", "#d-rig"], ["#d-temp-label", "#d-temp"], ["#d-weather-label", "#d-weather"], ["#d-wind-label", "#d-wind"]])
    $(dt).hidden = $(dd).hidden = !$(dd).textContent || $(dd).textContent === "—";

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
  if (mode === "detail") leaveScan(true);
  else if (stopIdx >= 0) { busy = true; riseFromStop().then(() => { busy = false; showLinks(); }); }
  showLinks();
}
$("#close").addEventListener("click", closePanel);
backBtn.addEventListener("click", () => leaveScan(false));
scanBtn.addEventListener("click", () => (mode === "detail" ? leaveScan(false) : enterScan()));
scanLink.addEventListener("click", enterScan);
panel.querySelector(".player").after(scanBtn);
shrineLayer.appendChild(scanLink);


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
  return { load, toggle, play, pause, render, level, spectrum, isPlaying, now, duration, get ctx() { return ctx; } };
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
  for (const lat of WX.lats) for (const lon of WX.lons) { p.push(f(lat, lon)); t.push(16 - (lat - 50) * 1.1 - Math.max(0, lon - 5) * 0.25); }
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

// the map rests quiet; ATMOSPHERE lays the air over it: isobars, pressure, the instrument readout
// the temperature field: the weather grid, read in world space over the overview (−15 °C … +25 °C → 0 … 1)
const TEMP = { lo: -15, hi: 25, on: false, ready: false };
function buildTempTexture(d) {
  const nx = WX.lons.length, ny = WX.lats.length, N = 256, data = new Uint8Array(N * N * 4);
  const T = (i, j) => d.t[Math.max(0, Math.min(ny - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
  if (!d.t || d.t.slice(0, nx * ny).some((v) => v == null)) return;
  for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) {
    const [lon, lat] = worldToLonLat((u / (N - 1) - 0.5) * eu.W, (v / (N - 1) - 0.5) * eu.D);
    const fi = (lon - WX.lons[0]) / 2, fj = (lat - WX.lats[0]) / 1.5, i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j;
    const t = T(i, j) * (1 - a) * (1 - b) + T(i + 1, j) * a * (1 - b) + T(i, j + 1) * (1 - a) * b + T(i + 1, j + 1) * a * b;
    const k = (v * N + u) * 4, x = Math.round(255 * Math.min(1, Math.max(0, (t - TEMP.lo) / (TEMP.hi - TEMP.lo))));
    data[k] = data[k + 1] = data[k + 2] = x; data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  uniforms.uTemp.value = tex; TEMP.ready = true;
  $("#temp-btn").hidden = false;
}
function setTemp(on) {
  TEMP.on = on && TEMP.ready;
  document.body.classList.toggle("temp", TEMP.on);
  $("#temp-btn").setAttribute("aria-pressed", TEMP.on);
}
function setAtmo(on) {
  WX.on = on; WX.group.visible = on;
  document.body.classList.toggle("atmo", on);
  $("#atmo-btn").setAttribute("aria-pressed", on);
}
function initWeather() {
  euGroup.add(WX.group);
  const btn = $("#atmo-btn"), src = $("#wx-source");
  setAtmo(false);
  const show = (d) => {
    const n = WX.lons.length * WX.lats.length;
    WX.shrines = SHRINES.map((_, i) => ({ p: d.p[n + i], t: d.t[n + i], time: d.time }));
    buildIsobars(d);
    buildTempTexture(d);
    $("#atmo-stamp").textContent = WX.sample ? "sample" : (WX.stamp || "now");
    if (current >= 0) fillNow(current);
  };
  btn.addEventListener("click", () => setAtmo(!WX.on));
  $("#temp-btn").addEventListener("click", () => setTemp(!TEMP.on));
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

/* ───────────── north ───────────── */
const compass = document.createElement("div");
compass.id = "compass"; compass.setAttribute("aria-hidden", "true");
compass.innerHTML = `<svg viewBox="-24 -24 48 48"><circle r="15.5"/><g id="needle"><path d="M0 -15.5 L3.2 -6 L-3.2 -6 Z"/><line y1="-6" y2="10"/><text y="-18.5">N</text></g></svg>`;
document.body.appendChild(compass);
const needle = compass.querySelector("#needle");
function stepCompass() {
  const dx = controls.target.x - camera.position.x, dz = controls.target.z - camera.position.z;
  needle.setAttribute("transform", `rotate(${(-Math.atan2(dx, -dz) * 180 / Math.PI).toFixed(1)})`);
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
    // a straight zoom: the point looked at shifts in step with the distance, so the destination
    // travels in a straight line to the middle of the picture, without a detour
    const d0 = Math.exp(f.l0), d1 = Math.exp(f.l1), d = Math.exp(f.l0 + (f.l1 - f.l0) * e);
    controls.target.lerpVectors(f.c0, f.c1, Math.abs(d1 - d0) > 1e-3 ? (d - d0) / (d1 - d0) : e);
    tmp.copy(f.n0).lerp(f.n1, e).normalize();
    camera.position.copy(controls.target).addScaledVector(tmp, d);
    if (k >= 1) { flight = null; f.res(); }
  } else if (flight) {
    const k = Math.min(1, (performance.now() - flight.t0) / flight.dur), e = ease(k);
    camera.position.lerpVectors(flight.p0, flight.p1, e);
    controls.target.lerpVectors(flight.c0, flight.c1, e);
    if (k >= 1) flight = null;
  }
  if (mode === "europe") euGroup.scale.y = vertAt(camera.position.distanceTo(controls.target));
  stepLOD(dt);
  stepCompass();
  for (const m of detSpin) m.rotation.y += dt * 0.22 * m.userData.spin;
  // slow orbit around the shrine while listening
  const playing = player.isPlaying() || radio.on;
  // both maps turn slowly while nothing else moves; the overview more slowly
  controls.autoRotate = !reduceMotion && !flight && !busy && entered;
  controls.autoRotateSpeed = (playing ? 0.35 : 0.18) * (mode === "detail" ? 1 : 0.45);
  controls.update();

  listen += ((uniforms._listenTarget || 0) - listen) * Math.min(1, dt * 2);
  uniforms.uListen.value = listen;
  lvl += (Math.max(player.level(), window.AetherRadio ? window.AetherRadio.level() : 0) - lvl) * Math.min(1, dt * 8);
  uniforms.uLevel.value = lvl;
  uniforms.uTempOn.value += ((TEMP.on && mode === "europe" ? 1 : 0) - uniforms.uTempOn.value) * Math.min(1, dt * 1.2);

  renderer.render(scene, camera);
  placeLabels();
  if (!panel.hidden) { player.render(); drawSpectro(); }
  stepScale();

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

/* ───────────── in a scan: scale, where the data comes from, the next shrine ───────────── */
const scaleEl = $("#scale-bar"), scaleTxt = $("#scale-txt");
const sA = new THREE.Vector3(), sB = new THREE.Vector3(), right = new THREE.Vector3();
function stepScale() {
  if (mode !== "detail" || detIdx < 0) return;
  const km = SHRINES[detIdx].km; if (!km) { $("#scale").hidden = true; return; }
  $("#scale").hidden = false;
  const unitsPerM = det.W / (km * 1000), w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  right.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
  sA.copy(controls.target); sB.copy(controls.target).addScaledVector(right, unitsPerM * 1000);
  sA.project(camera); sB.project(camera);
  const pxPerKm = Math.hypot((sB.x - sA.x) * w / 2, (sB.y - sA.y) * h / 2);
  const nice = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
  let m = nice[0]; for (const v of nice) if (pxPerKm * v / 1000 <= 140) m = v;
  scaleEl.style.width = (pxPerKm * m / 1000).toFixed(1) + "px";
  scaleTxt.textContent = m >= 1000 ? `${m / 1000} km` : `${m} m`;
}
const hav = (a, b) => {
  const r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
};
function fillDetailFoot(idx) {
  const s = SHRINES[idx];
  $("#scan-source").textContent = s.source || "";
  let best = -1, bd = Infinity;
  SHRINES.forEach((o, i) => { if (i !== idx) { const d = hav(s.geo, o.geo); if (d < bd) { bd = d; best = i; } } });
  const nx = $("#next-shrine");
  if (best < 0) { nx.hidden = true; return; }
  nx.hidden = false; nx.dataset.i = best;
  nx.innerHTML = `<span>→ ${SHRINES[best].id}</span> ${SHRINES[best].name} · ${bd < 10 ? bd.toFixed(1) : Math.round(bd)} km`;
}
$("#next-shrine").addEventListener("click", (e) => openShrine(+e.currentTarget.dataset.i));

/* ───────────── Aether radio: the map side ─────────────
   The radio picks a place and calls radioAt; the overview flies to a regional view of it, a marker
   stands there and the listening rings spread from it. radioOff rises back to where the visitor was. */
const RADIO_DIST = 300;
const waitIdle = async () => { while (busy) await new Promise((r) => setTimeout(r, 120)); };
let radioFlight = 0;
async function radioAt(lat, lon, label) {
  if (!eu) return;
  const my = ++radioFlight;
  const [x, z] = geoToWorld(lat, lon), y = eu.heightAt(x, z);
  radio.on = true; radio.base = new THREE.Vector3(x, y, z); radio.top = radio.base.clone().setY(y + STEM);
  radioMark.querySelector(".shrine-label").innerHTML = `<b>◉</b> ${label}`;
  if (!panel.hidden) {                         // a shrine was open: it gives way without flying home
    player.pause();
    panel.classList.remove("open"); panel.hidden = true;
    document.body.classList.remove("has-panel", "listening");
    markActive(-1); current = -1;
  }
  uniforms.uFocus.value.set(x, 0, z); uniforms._listenTarget = 1;
  await waitIdle();
  if (my !== radioFlight || !radio.on) return;
  if (mode === "detail") { await leaveScan(false); await waitIdle(); }
  if (my !== radioFlight || !radio.on || !entered) return;
  busy = true;
  if (!euCam) euCam = { p: camera.position.clone(), t: controls.target.clone() };
  stopIdx = -1; showLinks();
  const g = radio.base.clone().setY(y * VMIN);
  const d0 = camera.position.distanceTo(controls.target), travel = controls.target.distanceTo(g);
  await zoomTo(g.clone().add(STEEP.clone().multiplyScalar(RADIO_DIST)), g, 2600 + 1400 * Math.abs(Math.log(d0 / RADIO_DIST)) + Math.min(2600, travel * 5));
  busy = false; showLinks();
}
async function radioOff(keepView) {
  radio.on = false; radioFlight++;
  radioMark.classList.add("off");
  uniforms.uFocus.value.set(9999, 0, 9999);
  if (!player.isPlaying()) uniforms._listenTarget = 0;
  if (keepView) return;
  await waitIdle();
  if (radio.on || mode !== "europe" || stopIdx >= 0 || !panel.hidden) return;
  busy = true; await riseFromStop(); busy = false; showLinks();
}
window.SA_MAP = { radioAt, radioOff };

/* ───────────── keyboard ───────────── */
addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea")) return;
  if (e.key === "Escape" && !panel.hidden) closePanel();
  if (e.code === "Space" && !panel.hidden && !e.target.matches("button")) { e.preventDefault(); player.toggle(); }
  if (/^[1-9]$/.test(e.key) && SHRINES[+e.key - 1]) openShrine(+e.key - 1);
});

/* ───────────── boot ───────────── */
const enter = $("#enter");
const img = Object.assign(new Image(), { crossOrigin: "anonymous" });
img.onload = () => {
  eu = makeCloud(img, { world: EU.world, relief: EU.relief, keepLand: isSmall ? 0.9 : 0.86, keepSea: EU_SEA });
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
  document.body.classList.add("entered");
  // the scans of all shrines are fetched quietly in the background, so a descent never waits for one
  SHRINES.forEach((s, i) => setTimeout(() => { Object.assign(new Image(), { crossOrigin: "anonymous" }).src = TERRAIN + (s.terrain || s.id.toLowerCase() + ".png"); }, 1500 + i * 700));
  enter.classList.add("gone");
  setTimeout(() => (enter.hidden = true), 900);
});
