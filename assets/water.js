/* Home: the columns of light reflected in slowly moving water.
   The image is drawn by WebGL over the <img> (which stays, invisible, for the script that places the
   links in the columns). Below a soft horizon the picture is mirrored more and more towards the
   bottom and rippled by gentle waves whose bands widen as they come closer. Without WebGL, or with
   reduced motion, the still image simply stays. */
(() => {
  const img = document.querySelector(".hero img");
  if (!img || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cv = document.createElement("canvas");
  cv.className = "water"; cv.setAttribute("aria-hidden", "true");
  const gl = cv.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false });
  if (!gl) return;

  const VS = `attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; v.y = 1.0 - v.y; gl_Position = vec4(p, 0.0, 1.0); }`;
  const FS = `precision highp float;
  varying vec2 v;
  uniform sampler2D img;
  uniform vec2 scale, offset;      // cover mapping of the canvas onto the square image
  uniform float t, horizon;
  vec3 tex(vec2 q){ return texture2D(img, clamp(q, vec2(0.001), vec2(0.999))).rgb; }
  void main(){
    vec2 q = v * scale + offset;                  // image coordinates, y down
    float d = smoothstep(horizon, 1.0, q.y);      // 0 at the waterline, 1 at the bottom
    float dd = pow(d, 1.2);
    // waves: horizontal bands, finer far away (near the horizon), wider close by;
    // several of them at odd ratios and slants, so the surface never repeats
    float f = mix(220.0, 70.0, d);
    float w1 = sin(q.y * f - t * 1.3 + sin(q.x * 4.0 + t * 0.35) * 1.8);
    float w2 = sin(q.y * f * 1.73 + t * 1.9 + q.x * 7.0 + sin(q.x * 13.0 - t * 0.6));
    float w3 = sin(q.y * f * 0.61 - t * 0.8 - q.x * 3.0);
    float w4 = sin(q.x * 23.0 + q.y * f * 0.37 - t * 1.1);
    float n = (w1 * 0.45 + w2 * 0.25 + w3 * 0.2 + w4 * 0.1);
    vec2 off = vec2(n * 0.0042 * dd, (w1 * 0.5 + w3 * 0.5) * 0.0018 * dd);
    vec3 base = tex(q + off);
    // the mirror: the columns above, reflected at the horizon, taking over towards the bottom
    vec2 m = vec2(q.x + off.x * 1.6, 2.0 * horizon - q.y + off.y * 3.0 - 0.012 * dd);
    vec3 refl = (tex(m) * 0.5 + tex(m + vec2(0.0, 0.006 * dd)) * 0.25 + tex(m - vec2(0.0, 0.006 * dd)) * 0.25) * vec3(0.5, 0.56, 0.95);
    float mix_ = 0.55 * smoothstep(0.0, 0.85, d) * step(0.0, m.y);
    vec3 c = mix(base, max(base, refl), mix_);
    // glints where the light columns meet a wave crest
    float lum = dot(refl, vec3(0.3, 0.5, 0.2));
    c += vec3(0.75, 0.82, 1.0) * pow(max(0.0, w1 * w2), 8.0) * lum * 0.25 * dd;
    gl_FragColor = vec4(c, 1.0);
  }`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) { console.warn("water:", e); return; }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n) => gl.getUniformLocation(prog, n);
  const uScale = U("scale"), uOffset = U("offset"), uT = U("t"), uH = U("horizon");
  gl.uniform1f(uH, 0.47);

  const tex = gl.createTexture();
  function upload() {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  // same box and cover fit as the <img>
  function size() {
    const r = img.getBoundingClientRect(), dpr = Math.min(1.5, devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    gl.viewport(0, 0, cv.width, cv.height);
    const ia = img.naturalWidth / img.naturalHeight, ca = r.width / r.height;
    const sx = ca > ia ? 1 : ca / ia, sy = ca > ia ? ia / ca : 1;
    gl.uniform2f(uScale, sx, sy); gl.uniform2f(uOffset, (1 - sx) / 2, (1 - sy) / 2);
  }
  let t0 = performance.now(), running = false;
  function frame(now) {
    if (document.hidden) { running = false; return; }
    gl.uniform1f(uT, (now - t0) / 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(frame);
  }
  function go() { if (!running && !document.hidden) { running = true; requestAnimationFrame(frame); } }
  function start() {
    upload(); size();
    img.after(cv);
    requestAnimationFrame(() => cv.classList.add("on"));
    addEventListener("resize", size);
    document.addEventListener("visibilitychange", go);
    go();
  }
  if (img.complete && img.naturalWidth) start(); else img.addEventListener("load", start, { once: true });
})();
