/* Relief background: a height model drawn as a slow point cloud in the colours of the home image.
   Data: assets/relief.png — R = position on the palette, G + high nibble of B = 12-bit height,
   low nibble of B = hillshade. Put <canvas id="relief-bg"></canvas> on the page and load this module. */
import * as THREE from "three";

const canvas = document.getElementById("relief-bg");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const small = matchMedia("(max-width: 720px)").matches;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
const BG = new THREE.Color(0x07040f);
renderer.setClearColor(BG, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 1, 4000);

const WORLD = 1000, RELIEF = 85;

const uniforms = {
  uTime: { value: 0 }, uPx: { value: renderer.getPixelRatio() }, uSize: { value: small ? 1.6 : 1.25 },
  uBg: { value: BG },
};
const mat = new THREE.ShaderMaterial({
  uniforms, transparent: false, depthWrite: true,
  vertexShader: /* glsl */ `
    attribute float aT, aShade, aRand;
    uniform float uTime, uPx, uSize;
    varying vec3 vCol;
    varying float vFog;
    // palette of the home image: night violet, indigo, blue, violet, magenta, pink, pale pink
    vec3 pal(float t) {
      const int N = 10;
      float s[10]; vec3 c[10];
      s[0]=0.00; c[0]=vec3(10.,6.,24.);   s[1]=0.10; c[1]=vec3(39.,17.,73.);   s[2]=0.26; c[2]=vec3(39.,26.,124.);
      s[3]=0.40; c[3]=vec3(57.,73.,175.); s[4]=0.50; c[4]=vec3(50.,108.,202.); s[5]=0.60; c[5]=vec3(115.,69.,159.);
      s[6]=0.70; c[6]=vec3(169.,84.,168.); s[7]=0.80; c[7]=vec3(217.,131.,193.); s[8]=0.90; c[8]=vec3(235.,197.,224.);
      s[9]=1.00; c[9]=vec3(250.,236.,242.);
      vec3 col = c[0];
      for (int i = 1; i < N; i++) col = mix(col, c[i], clamp((t - s[i-1]) / (s[i] - s[i-1]), 0.0, 1.0));
      return col / 255.0;
    }
    void main() {
      vec3 p = position;
      // a slow band of light sweeps across, the way a scanner passes over the ground
      float sweep = exp(-pow((p.x * 0.8 + p.z * 0.6 - mod(uTime * 26.0, 2200.0) + 1100.0) / 26.0, 2.0));
      vec3 col = pal(aT) * (0.42 + 0.62 * aShade);
      col += vec3(0.95, 0.62, 0.86) * sweep * 0.55;
      // a faint shimmer, point by point
      col *= 0.9 + 0.1 * sin(uTime * 0.8 + aRand * 40.0);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float depth = -mv.z;
      vFog = smoothstep(2300.0, 500.0, depth);
      vCol = col;
      gl_PointSize = clamp(uSize * uPx * (520.0 / depth), 0.8, 4.0 * uPx);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uBg;
    varying vec3 vCol;
    varying float vFog;
    void main() {
      vec2 d = gl_PointCoord - 0.5;
      if (dot(d, d) > 0.25) discard;
      gl_FragColor = vec4(mix(uBg, vCol, vFog), 1.0);
    }`,
});

function build(img) {
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const cx = c.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, img.width, img.height).data;
  const NX = img.width, NZ = img.height, stride = small ? 2 : 1;
  const D = WORLD * NZ / NX, n = Math.ceil(NX / stride) * Math.ceil(NZ / stride);
  const pos = new Float32Array(n * 3), t = new Float32Array(n), sh = new Float32Array(n), rnd = new Float32Array(n);
  let k = 0;
  for (let j = 0; j < NZ; j += stride) for (let i = 0; i < NX; i += stride) {
    const q = (j * NX + i) * 4;
    const h = (px[q + 1] * 16 + (px[q + 2] >> 4)) / 4095;
    pos[k * 3] = (i / (NX - 1) - 0.5) * WORLD + (Math.random() - 0.5) * 0.6;
    pos[k * 3 + 1] = h * RELIEF;
    pos[k * 3 + 2] = (j / (NZ - 1) - 0.5) * D + (Math.random() - 0.5) * 0.6;
    t[k] = px[q] / 255; sh[k] = (px[q + 2] & 15) / 15; rnd[k] = Math.random();
    k++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, k * 3), 3));
  g.setAttribute("aT", new THREE.BufferAttribute(t.subarray(0, k), 1));
  g.setAttribute("aShade", new THREE.BufferAttribute(sh.subarray(0, k), 1));
  g.setAttribute("aRand", new THREE.BufferAttribute(rnd.subarray(0, k), 1));
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return { D };
}

// the camera drifts in a slow, wide loop above the ground and always looks a little ahead
let D = 520;
function placeCamera(time) {
  const a = time * 0.012;
  const x = Math.sin(a) * WORLD * 0.18, z = D * 0.42 + Math.cos(a * 0.7) * D * 0.08;
  camera.position.set(x, 470 + Math.sin(a * 1.3) * 50, z + D * 0.1);
  camera.lookAt(Math.sin(a + 0.6) * WORLD * 0.14, 0, -D * 0.18);
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);

const clock = new THREE.Clock();
let running = true;
document.addEventListener("visibilitychange", () => { running = !document.hidden; if (running) { clock.getDelta(); loop(); } });
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!reduceMotion) uniforms.uTime.value += dt;
  placeCamera(uniforms.uTime.value + 40);
  renderer.render(scene, camera);
}
function loop() {
  if (!running) return;
  frame();
  if (!reduceMotion) requestAnimationFrame(loop);
}

const img = new Image();
img.onload = () => {
  ({ D } = build(img));
  resize();
  canvas.classList.add("on");
  loop();
};
img.src = new URL("./relief.png", import.meta.url).href;
