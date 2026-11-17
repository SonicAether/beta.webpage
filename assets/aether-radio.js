/* Aether radio — part of Listening Shrines.
   A random place between Ireland and Sweden; the field recordings of radio aporee ::: maps nearest to
   it play one after another, blended slowly. Nothing is added to them: the weather there right now only
   shapes how they are heard.
     cloud cover   → the highs darken (a high shelf down to −6 dB)
     humidity      → damp air softens the very top (a low-pass from 18 kHz down to ~7 kHz)
     wind          → gusts: the sound swells and dulls in uneven breaths, and drifts the way the wind blows
     temperature   → cold air carries: more and brighter space; warm air is close and dry
     air pressure  → low pressure slows the tape a little (up to 6 %, pitch drops with it)
   Exposes window.AetherRadio = { start, next, stop, on(), level() }. The map side is window.SA_MAP
   (set by shrines.js): radioAt(lat, lon, label), radioOff(keepView). */
(() => {
  const AREA = { lon: [-11.5, 20.5], lat: [49.8, 66.5] };
  const XF = 20, LEAD = 26, FIRST = 5;            // crossfade, how early the next one loads, first fade-in (s)
  const REC = 0.95, REC_DIRECT = 0.8;
  const $ = (id) => document.getElementById(id);
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const fmt = (v, d = 0) => (v == null ? "—" : (+v).toFixed(d));
  const compass = (d) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((d % 360) + 360) % 360 / 45) % 8];
  const ll = (lat, lon) => `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"} · ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;

  let ctx = null, B = null, decks = null, direct = false, field = null, live = false, tuneId = 0, rate = 1, gustT = 0, vol = 0.9;

  /* ── the weather chain: one for everything the radio plays ── */
  function chain() {
    if (B) return B;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const f = (type, freq, q = 0.7, gain = 0) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = freq; n.Q.value = q; n.gain.value = gain; return n; };
    const inp = g(1), hp = f("highpass", 35), damp = f("lowpass", 18000, 0.5), cloud = f("highshelf", 3500, 0.7, 0);
    const gustLp = f("lowpass", 20000, 0.5), gust = g(1), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : g(1);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.03; comp.release.value = 0.6;
    const out = g(vol), an = ctx.createAnalyser(); an.fftSize = 2048;
    // a space: a long, soft noise tail; its amount and brightness follow the temperature
    const len = Math.floor(ctx.sampleRate * 4.5), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 200 ? i / 200 : 1); }
    const verb = ctx.createConvolver(); verb.buffer = ir;
    const wetTone = f("lowpass", 4000, 0.5), wet = g(0.1);
    inp.connect(hp).connect(damp).connect(cloud).connect(gustLp).connect(gust).connect(pan).connect(comp);
    pan.connect(verb).connect(wetTone).connect(wet).connect(comp);
    comp.connect(out).connect(an).connect(ctx.destination);
    return (B = { inp, damp, cloud, gustLp, gust, pan, wet, wetTone, out, an, buf: new Float32Array(2048), wind: 0, windTo: 0 });
  }
  const glide = (p, v, sec = 8) => { const t = ctx.currentTime; p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.setTargetAtTime(v, t, sec / 3); };

  // what the weather does to the sound; returns the lines shown under "Heard as"
  function applyWeather(w) {
    chain();
    const heard = [];
    if (!w) { rate = 1; glide(B.cloud.gain, 0); glide(B.damp.frequency, 18000); glide(B.wet.gain, 0.1); B.wind = 0; return ["no weather reached · heard as recorded"]; }
    const cc = clamp(w.cc / 100), rh = clamp((w.rh - 55) / 45), wind = clamp(w.ws / 45), cold = clamp((12 - w.t) / 22), warm = clamp((w.t - 16) / 14), low = clamp((1016 - w.p) / 36);
    glide(B.cloud.gain, -6 * cc);
    if (cc > 0.25) heard.push(`${cc > 0.8 ? "overcast" : "cloud"} · highs darkened ${(6 * cc).toFixed(1)} dB`);
    const dampHz = 18000 * (1 - 0.6 * rh);
    glide(B.damp.frequency, dampHz);
    if (rh > 0.15) heard.push(`damp air · softened above ${(dampHz / 1000).toFixed(1)} kHz`);
    B.wind = wind; B.windTo = Math.sin(((w.wd + 180) * Math.PI) / 180);   // blowing towards: east = right
    if (wind > 0.12) heard.push(`wind ${fmt(w.ws)} km/h · gusting, drifting ${compass(w.wd + 180)}`);
    glide(B.wet.gain, 0.05 + 0.2 * cold - 0.03 * warm);
    glide(B.wetTone.frequency, 2500 + 6000 * cold);
    heard.push(cold > 0.35 ? `${fmt(w.t, 1)} °C · cold air carries further` : warm > 0.3 ? `${fmt(w.t, 1)} °C · warm, close air` : `${fmt(w.t, 1)} °C · mild air`);
    rate = 1 - 0.06 * low;
    if (low > 0.05) heard.push(`${fmt(w.p)} hPa · slowed ${((1 - rate) * 100).toFixed(1)} %`);
    return heard;
  }
  // gusts: uneven breaths of louder, duller sound, leaning the way the wind blows
  function gusts() {
    clearTimeout(gustT);
    if (!live || !B) return;
    const w = B.wind, t = ctx.currentTime, r = Math.random(), next = 0.6 + Math.random() * (2.6 - 1.6 * w);
    const strong = r < w * 0.8;
    B.gust.gain.setTargetAtTime(1 + (strong ? 0.35 : 0.05) * w - 0.12 * w * Math.random(), t, strong ? 0.4 : 1.2);
    B.gustLp.frequency.setTargetAtTime(w < 0.05 ? 20000 : 20000 * (1 - w * (strong ? 0.25 : 0.65) * Math.random()), t, 0.9);
    if (B.pan.pan) B.pan.pan.setTargetAtTime(clamp(B.windTo * 0.3 * w + (Math.random() - 0.5) * 0.5 * w, -0.8, 0.8), t, 2.5);
    gustT = setTimeout(gusts, next * 1000);
  }

  /* ── players: unlocked inside the click, reused for every recording (Safari and iOS demand that) ── */
  function silentUrl() {
    const n = 800, b = new ArrayBuffer(44 + n), v = new DataView(b), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
  }
  function unlock() {
    chain(); ctx.resume();
    if (decks) return;
    const quiet = silentUrl();
    const mk = () => { const a = new Audio(); a.crossOrigin = "anonymous"; a.preload = "auto"; a.src = quiet; const p = a.play(); if (p) p.then(() => a.pause()).catch(() => {}); return a; };
    decks = [0, 1, 2, 3].map(() => {
      const a = mk(), d = mk();                    // a: through the weather; d: plays directly, if a stays silent
      const node = ctx.createMediaElementSource(a), g = ctx.createGain(), probe = ctx.createAnalyser();
      g.gain.value = 0; probe.fftSize = 2048;
      node.connect(g).connect(B.inp); node.connect(probe);
      return { a, d, g, probe, busy: false };
    });
  }
  const tape = (el, r) => { el.preservesPitch = el.mozPreservesPitch = el.webkitPreservesPitch = false; el.defaultPlaybackRate = el.playbackRate = r; };
  function free(el) { el.pause(); el.removeAttribute("src"); try { el.load(); } catch (_) {} }
  function load(r, me) {
    return new Promise((res) => {
      const deck = decks.find((x) => !x.busy);
      if (!deck) return res(null);
      deck.busy = true;
      const el = direct ? deck.d : deck.a;
      el.loop = true; el.volume = direct ? 0 : 1; el.src = r.src; el.load();
      let done = false;
      const fail = () => { if (done) return; done = true; free(el); deck.busy = false; res(null); };
      const to = setTimeout(fail, 25000); me.timers.push(to);
      el.addEventListener("error", fail, { once: true });
      el.addEventListener("loadedmetadata", () => {
        const len = el.duration || r.length || 0;
        if (len > 200) el.currentTime = Math.random() * (len - 200);
        const ok = () => { if (done) return; done = true; clearTimeout(to); tape(el, me.rate); res({ r, deck, el, direct: el === deck.d }); };
        if (el.readyState >= 3 && !el.seeking) ok(); else el.addEventListener("canplay", ok, { once: true });
      }, { once: true });
    });
  }
  const sIn = (x) => Math.sin((x * Math.PI) / 2), sOut = (x) => Math.cos((x * Math.PI) / 2);
  function volFade(v, shape, sec) {
    clearInterval(v.vt);
    const t0 = performance.now(), from = v.el.volume;
    v.vt = setInterval(() => {
      const x = Math.min(1, (performance.now() - t0) / (sec * 1000));
      v.el.volume = clamp(shape ? shape(x) * REC_DIRECT * vol : from * (1 - x));
      if (x >= 1) clearInterval(v.vt);
    }, 80);
  }
  const curve = (shape, k = 1) => new Float32Array(64).map((_, i) => shape(i / 63) * k);
  function retire(v, after) {
    setTimeout(() => { clearInterval(v.vt); free(v.el); v.deck.g.gain.cancelScheduledValues(0); v.deck.g.gain.value = 0; v.deck.busy = false; }, after * 1000);
  }
  function release(v, sec) {
    if (!v) return;
    if (v.direct) volFade(v, null, sec);
    else { const t = ctx.currentTime, g = v.deck.g.gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + sec); }
    retire(v, sec + 0.5);
  }
  // some browsers hand Web Audio only silence for audio from another site: then play it directly
  function checkHeard(v) {
    if (v.direct) return;
    const buf = new Float32Array(2048);
    let n = 0;
    const id = setInterval(() => {
      if (v.gone) return clearInterval(id);
      if (v.el.paused) { if (++n > 60) clearInterval(id); return; }
      v.deck.probe.getFloatTimeDomainData(buf);
      let peak = 0; for (const x of buf) peak = Math.max(peak, Math.abs(x));
      if (peak > 1e-5) return clearInterval(id);
      if (++n < 12 || v.el.currentTime < 1) return;
      clearInterval(id);
      direct = true;
      const d = v.deck.d, at = v.el.currentTime;
      v.el.pause(); d.loop = true; d.volume = 0; d.src = v.el.currentSrc || v.r.src;
      d.addEventListener("loadedmetadata", () => { try { d.currentTime = at; } catch (_) {} tape(d, v.el.playbackRate); d.play().catch(() => {}); }, { once: true });
      d.load();
      free(v.el); v.el = d; v.direct = true; volFade(v, sIn, 4);
    }, 250);
  }
  function crossfade(from, to, sec) {
    const t = ctx.currentTime + 0.05;
    const p = to.el.play(); if (p) p.catch((e) => console.warn("Aether radio: a recording could not start:", e && e.name));
    if (to.direct) volFade(to, sIn, sec);
    else { to.deck.g.gain.cancelScheduledValues(t); to.deck.g.gain.setValueCurveAtTime(curve(sIn, REC), t, sec); checkHeard(to); }
    if (from) {
      from.gone = true;
      if (from.direct) volFade(from, sOut, sec);
      else { const g = from.deck.g.gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.setValueCurveAtTime(curve(sOut, Math.max(g.value, 0.001)), t, sec); }
      retire(from, sec + 1);
    }
  }

  /* ── the sequence at one place ── */
  const sleep = (sec, me) => new Promise((res) => { const id = setTimeout(res, sec * 1000); me.timers.push(id); });
  function playField(recs, prev) {
    const me = { stop: false, timers: [], cur: prev ? prev.cur : null, rate };
    if (prev) prev.handedOver = true;
    field = me;
    (async () => {
      let k = 0;
      const nextVoice = async () => {
        for (let tries = 0; tries < recs.length; tries++) {
          const i = k % recs.length; k++;
          const v = await load(recs[i], me);
          if (me.stop) { if (v) release(v, 0.1); return null; }
          if (v) { v.i = i; return v; }
        }
        return null;
      };
      let v = await nextVoice(), first = true;
      if (!v && !me.stop) { setState("silent"); $("r-recs").textContent = "the recordings could not be loaded from here"; release(me.cur, 6); me.cur = null; }
      while (!me.stop && v) {
        crossfade(me.cur, v, first && !me.cur ? FIRST : XF); me.cur = v; first = false;
        showRecs(recs, v.i); setState("live");
        const hold = 90 + Math.random() * 90;
        await sleep(Math.max(XF, hold - LEAD), me);
        if (me.stop) break;
        if (recs.length < 2) { await sleep(1e6, me); break; }
        const ready = nextVoice();
        await sleep(Math.min(LEAD, hold - XF), me);
        v = await ready;
      }
    })();
  }
  function stopField(sec) {
    if (!field) return;
    field.stop = true; field.timers.forEach(clearTimeout);
    release(field.cur, sec); field.cur = null; field = null;
  }
  function holdField() {
    if (!field) return null;
    const f = field;
    f.stop = true; f.timers.forEach(clearTimeout); field = null;
    setTimeout(() => { if (!f.handedOver) release(f.cur, 8); }, 60000);
    return f;
  }

  /* ── a place ── */
  async function weather(lat, lon) {
    try {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,pressure_msl,wind_speed_10m,wind_direction_10m,relative_humidity_2m,cloud_cover`, { signal: ctl.signal });
      clearTimeout(to);
      const c = (await r.json()).current;
      return { t: c.temperature_2m, p: c.pressure_msl, ws: c.wind_speed_10m, wd: c.wind_direction_10m, rh: c.relative_humidity_2m, cc: c.cloud_cover };
    } catch (_) { return null; }
  }
  async function findPlace(my) {
    for (let i = 0; i < 6; i++) {
      const lat = +(AREA.lat[0] + Math.random() * (AREA.lat[1] - AREA.lat[0])).toFixed(2);
      const lon = +(AREA.lon[0] + Math.random() * (AREA.lon[1] - AREA.lon[0])).toFixed(2);
      let recs;
      try { recs = await window.SignalSource.recordings(lat, lon, 3, 150); } catch (_) { recs = null; }
      if (my !== tuneId) return null;
      if (recs === null && i >= 1) return { error: true };
      if (recs && recs.length) return { lat, lon, recs };
      $("r-place").textContent = `nothing recorded near ${ll(lat, lon)} · listening further…`;
    }
    return { error: true };
  }

  /* ── interface ── */
  const card = $("radio"), btn = $("radio-btn");
  function setState(s) {
    $("r-state").textContent = { tuning: "tuning", live: "on air", silent: "silent" }[s] || s;
    card.dataset.state = s;
  }
  function showRecs(recs, on) {
    $("r-recs").innerHTML = recs.map((r, i) =>
      `<span class="r-rec${i === on ? " on" : ""}"><a href="${r.page}" target="_blank" rel="noopener noreferrer">${r.title || r.id}</a><br><span class="by">${r.creator} · ${r.km < 1 ? "<1" : Math.round(r.km)} km ${compass(r.bearing || 0)} · <a href="${r.licenseurl}" target="_blank" rel="noopener noreferrer">${r.license}</a></span></span>`).join("");
  }
  async function tune() {
    const my = ++tuneId;
    unlock();                                     // still inside the click
    live = true; card.hidden = false; document.body.classList.add("radio-on");
    btn.setAttribute("aria-pressed", "true");
    requestAnimationFrame(() => card.classList.add("open"));
    setState("tuning"); $("r-next").disabled = true;
    $("r-place").textContent = "listening for a place…"; $("r-coords").textContent = ""; $("r-wx").textContent = "—"; $("r-heard").textContent = "—"; $("r-recs").textContent = "searching radio aporee ::: maps…";
    const found = await findPlace(my);
    if (my !== tuneId) return;
    $("r-next").disabled = false;
    if (!found || found.error) { setState("silent"); $("r-place").textContent = "the archive could not be reached from here"; $("r-recs").textContent = "—"; return; }
    const [w, nm] = await Promise.all([weather(found.lat, found.lon), window.SignalSource.name(found.lat, found.lon).catch(() => null)]);
    if (my !== tuneId) return;
    const label = (nm && nm.label) || ll(found.lat, found.lon);
    $("r-place").textContent = label;
    $("r-coords").textContent = ll(found.lat, found.lon);
    $("r-wx").textContent = w ? `${fmt(w.t, 1)} °C · ${fmt(w.p)} hPa · wind ${fmt(w.ws)} km/h from ${compass(w.wd)} · humidity ${fmt(w.rh)} % · cloud ${fmt(w.cc)} %` : "no weather reached from here";
    $("r-heard").innerHTML = applyWeather(w).map((x) => `<span>${x}</span>`).join("");
    showRecs(found.recs, -1);
    gusts();
    if (window.SA_MAP) window.SA_MAP.radioAt(found.lat, found.lon, label);
    playField(found.recs, holdField());
  }
  function stop(keepView) {
    if (!live) return;
    tuneId++; live = false; clearTimeout(gustT);
    stopField(keepView ? 1.5 : 4);
    card.classList.remove("open"); document.body.classList.remove("radio-on");
    btn.setAttribute("aria-pressed", "false");
    setTimeout(() => { if (!card.classList.contains("open")) card.hidden = true; }, 500);
    if (window.SA_MAP) window.SA_MAP.radioOff(keepView);
  }
  function level() {
    if (!live || !B || !field || !field.cur) return 0;
    if (field.cur.direct) return 0.1 + 0.04 * Math.sin(performance.now() / 700);
    B.an.getFloatTimeDomainData(B.buf);
    let s = 0; for (const x of B.buf) s += x * x;
    return Math.min(1, Math.sqrt(s / B.buf.length) * 4);
  }

  btn.addEventListener("click", () => (live ? stop() : tune()));
  $("r-next").addEventListener("click", () => tune());
  $("r-close").addEventListener("click", () => stop());
  $("r-vol").addEventListener("input", (e) => {
    vol = +e.target.value;
    if (B) glide(B.out.gain, vol, 0.2);
    if (field && field.cur && field.cur.direct) field.cur.el.volume = REC_DIRECT * vol;
  });
  window.AetherRadio = { start: tune, next: tune, stop, on: () => live, level };
})();
