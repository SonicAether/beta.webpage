/* Relief background: a height model drawn as solid, gently lit ground in the colours of the home image.
   Data: assets/relief.png — R = position on the palette, G + high nibble of B = 12-bit height,
   low nibble of B = hillshade. Put <canvas id="relief-bg"></canvas> on the page and load this module. */
import * as THREE from "three";

const canvas = document.getElementById("relief-bg");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const small = matchMedia("(max-width: 720px)").matches;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
const BG = new THREE.Color(0x07040f);
renderer.setClearColor(BG, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 1, 4000);

const WORLD = 1000, RELIEF = 22;   // a low relief: the ground is read as a surface, not as mountains

const uniforms = { uTime: { value: 0 }, uBg: { value: BG } };
const mat = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: /* glsl */ `
    attribute float aT, aShade;
    varying float vT, vShade, vLight, vFog;
    varying vec3 vW;
    void main() {
      vT = aT; vShade = aShade;
      vec3 n = normalize(normal);
      vLight = clamp(dot(n, normalize(vec3(-0.6, 0.55, -0.5))), 0.0, 1.0);   // low sun from the north-west
      vW = position;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vFog = smoothstep(2400.0, 600.0, -mv.z);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform vec3 uBg;
    varying float vT, vShade, vLight, vFog;
    varying vec3 vW;
    // palette of the home image: night violet, indigo, blue, violet, magenta, pink, pale pink
    vec3 pal(float t) {
      vec3 col = vec3(10.,6.,24.);
      col = mix(col, vec3(39.,17.,73.),   clamp((t - 0.00) / 0.10, 0.0, 1.0));
      col = mix(col, vec3(39.,26.,124.),  clamp((t - 0.10) / 0.16, 0.0, 1.0));
      col = mix(col, vec3(57.,73.,175.),  clamp((t - 0.26) / 0.14, 0.0, 1.0));
      col = mix(col, vec3(50.,108.,202.), clamp((t - 0.40) / 0.10, 0.0, 1.0));
      col = mix(col, vec3(115.,69.,159.), clamp((t - 0.50) / 0.10, 0.0, 1.0));
      col = mix(col, vec3(169.,84.,168.), clamp((t - 0.60) / 0.10, 0.0, 1.0));
      col = mix(col, vec3(217.,131.,193.),clamp((t - 0.70) / 0.10, 0.0, 1.0));
      col = mix(col, vec3(235.,197.,224.),clamp((t - 0.80) / 0.10, 0.0, 1.0));
      col = mix(col, vec3(250.,236.,242.),clamp((t - 0.90) / 0.10, 0.0, 1.0));
      return col / 255.0;
    }
    void main() {
      vec3 col = pal(vT) * (0.42 + 0.78 * vLight);
      // a slow band of light passes over the ground
      float sweep = exp(-pow((vW.x * 0.8 + vW.z * 0.6 - mod(uTime * 22.0, 2400.0) + 1200.0) / 70.0, 2.0));
      col += vec3(0.95, 0.62, 0.86) * sweep * 0.16;
      gl_FragColor = vec4(mix(uBg, col, vFog), 1.0);
    }`,
});

function build(img) {
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const cx = c.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, img.width, img.height).data;
  const stride = small ? 3 : 2;
  const SX = Math.floor((img.width - 1) / stride), SZ = Math.floor((img.height - 1) / stride);
  const D = WORLD * img.height / img.width;
  const g = new THREE.PlaneGeometry(WORLD, D, SX, SZ);
  g.rotateX(-Math.PI / 2);                     // plane lies in x/z, row 0 in the north
  const P = g.attributes.position, n = P.count;
  const t = new Float32Array(n), sh = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const i = (v % (SX + 1)) * stride, j = Math.floor(v / (SX + 1)) * stride;
    const q = (j * img.width + i) * 4;
    P.setY(v, ((px[q + 1] * 16 + (px[q + 2] >> 4)) / 4095) * RELIEF);
    t[v] = px[q] / 255; sh[v] = (px[q + 2] & 15) / 15;
  }
  g.setAttribute("aT", new THREE.BufferAttribute(t, 1));
  g.setAttribute("aShade", new THREE.BufferAttribute(sh, 1));
  g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, mat));
  return { D };
}

// the camera drifts in a slow, wide loop above the ground and always looks a little ahead
let D = 520;
function placeCamera(time) {
  const a = time * 0.012;
  const x = Math.sin(a) * WORLD * 0.18, z = D * 0.42 + Math.cos(a * 0.7) * D * 0.08;
  camera.position.set(x, 520 + Math.sin(a * 1.3) * 30, z + D * 0.05);
  camera.lookAt(Math.sin(a + 0.6) * WORLD * 0.12, 0, D * 0.02);
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
