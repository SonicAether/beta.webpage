/* The generative transmission of the home page as a shared engine: window.createTransmission(ctx, destination, { f0, row, level }).
   Brown-noise carrier, a beating overtone row, sub bass, singing band-passes, an ether hiss and rare artefacts. */
(() => {
  function createTransmission(ctx, destination, opt = {}) {
    // opt.wx: current weather { t °C, p hPa, ws km/h, wd °, rh %, cc % } shapes the sound (all optional)
    const wx = opt.wx || {}, cl = (v, a, b) => Math.min(b, Math.max(a, v));
    const warm = cl(((wx.t ?? 8) + 15) / 40, 0, 1);          // 0 deep frost … 1 warm summer day
    const low = cl((1022 - (wx.p ?? 1013)) / 42, 0, 1);      // 0 settled high … 1 deep low
    const wind = cl((wx.ws ?? 12) / 55, 0, 1);               // 0 calm … 1 gale
    const hum = cl((wx.rh ?? 75) / 100, 0, 1), cloud = cl((wx.cc ?? 50) / 100, 0, 1);
    const side = Math.sin(((wx.wd ?? 240) * Math.PI) / 180);  // where the wind comes from, east (+1) to west (-1)
    const sr = ctx.sampleRate, rnd = Math.random;
    const F0 = opt.f0 || (opt.wx ? 34 + 18 * warm : 54);      // carrier fundamental, Hz: warmer air sounds higher
    const LEVEL = opt.level || 0.42;                          // master level
    const SLOW = opt.slow || 1;                               // stretches every movement in time
    const G = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const pan = (p) => { const n = ctx.createStereoPanner(); n.pan.value = p; return n; };

    const master = G(0), comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.08; comp.release.value = 0.6;
    const analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.85;
    master.connect(comp).connect(analyser).connect(destination);

    // a large, dark synthetic space
    const ir = ctx.createBuffer(2, Math.floor(sr * 7), sr);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c); let lp = 0;
      for (let i = 0; i < d.length; i++) { const t = i / sr; lp += 0.18 * ((rnd() * 2 - 1) - lp); d[i] = lp * Math.exp(-t / 1.9) * (t < 0.03 ? t / 0.03 : 1); }
    }
    const verb = ctx.createConvolver(); verb.buffer = ir;
    // humid air: a larger, softer space; dry air: a closer, clearer one
    const dry = G(0.8), wet = G(opt.wx ? 0.42 + 0.6 * hum : 0.75);
    const wetLp = ctx.createBiquadFilter(); wetLp.type = "lowpass"; wetLp.frequency.value = opt.wx ? 9500 - 7000 * hum : 20000;
    dry.connect(master); verb.connect(wetLp).connect(wet).connect(master);
    // the generated sound has its own bus, so its level can breathe and make room for field recordings
    const genDry = G(1), genWet = G(1), duckD = G(1), duckW = G(1);
    // a gentle cut in the droning register (about 100–350 Hz), so the body of the sound does not dominate
    const eq = (g) => { const f = ctx.createBiquadFilter(); f.type = "peaking"; f.frequency.value = 190; f.Q.value = 0.6; f.gain.value = opt.lowMid ?? -5; return f; };
    genDry.connect(eq()).connect(duckD).connect(dry); genWet.connect(eq()).connect(duckW).connect(verb);
    const send = (node, d = 0.6, w = 0.4) => { node.connect(G(d)).connect(genDry); node.connect(G(w)).connect(genWet); };

    // shared noise buffers
    const brown = ctx.createBuffer(2, sr * 8, sr), white = ctx.createBuffer(1, sr * 2, sr);
    for (let c = 0; c < 2; c++) { const d = brown.getChannelData(c); let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (rnd() * 2 - 1)) / 1.02; d[i] = l * 3.5; } }
    { const d = white.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }
    const lfo = (rate, depth, target, type = "sine") => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = rate / SLOW;
      const g = G(depth); o.connect(g).connect(target); o.start(); return o;
    };
    const live = [];

    // 1 · carrier: brown noise that breathes
    const bed = ctx.createBufferSource(); bed.buffer = brown; bed.loop = true;
    // wind opens the noise and makes it gust
    const bedLp = ctx.createBiquadFilter(); bedLp.type = "lowpass"; bedLp.frequency.value = opt.wx ? 260 + 140 * wind : 340; bedLp.Q.value = 0.4;
    const bedG = G(opt.wx ? 0.3 + 0.16 * wind : 0.36);
    bed.connect(bedLp).connect(pan(side * 0.3 * wind)).connect(bedG); send(bedG, 0.7, 0.35); bed.start();
    live.push(bed, lfo(0.006, 90, bedLp.frequency), lfo(0.004 + 0.02 * wind, 0.12 + 0.08 * wind, bedG.gain));

    // 2 · standing waves: overtone row, each partial a slowly beating L/R pair
    const ROW = opt.row || [1, 1.5, 2, 3, 4, 5, 6, 7, 9, 11];
    const drones = [];
    ROW.forEach((n, i) => {
      // a clear sky lets the upper partials ring; cloud covers them
      const base = 0.075 / Math.pow(n, 0.8) * (n > 6 ? 0.55 : 1) * (opt.wx && n > 3 ? 1.25 - 0.85 * cloud : 1);
      const amp = G(base * 0.5);
      lfo(1 / (60 + rnd() * 140), base * 0.5, amp.gain);         // bloom and recede, 60–200 s
      const beat = (0.015 + rnd() * (opt.wx ? 0.04 + 0.3 * low : 0.09)) / SLOW;   // Hz between the pair: a low makes them restless
      [-1, 1].forEach((side) => {
        const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = F0 * n + side * beat / 2;
        o.connect(pan(side * (0.25 + 0.5 * (i / ROW.length)))).connect(amp);
        o.start(); drones.push(o); live.push(o);
      });
      send(amp, 0.55, 0.5);
    });

    // 2b · sub bass: a slow sine an octave below the carrier, a fifth above it, and a rumble
    const sub = G(0.0);
    [[F0 / 2, 0.075], [F0 * 0.75, 0.025]].forEach(([f, a]) => {
      const o = ctx.createOscillator(); o.frequency.value = f; const g = G(a); o.connect(g).connect(sub); o.start(); live.push(o);
    });
    const rum = ctx.createBufferSource(); rum.buffer = brown; rum.loop = true; rum.loopStart = 5;
    const rumLp = ctx.createBiquadFilter(); rumLp.type = "lowpass"; rumLp.frequency.value = 70; rumLp.Q.value = 0.7;
    rum.connect(rumLp).connect(G(0.35)).connect(sub); rum.start(); live.push(rum);
    sub.gain.value = opt.wx ? 0.5 + 0.6 * low : 0.75; lfo(1 / 140, 0.25, sub.gain);   // swells over ~2½ min; deeper in a low
    sub.connect(genDry);

    // 3 · overtones singing out of the noise (very narrow band-passes that wander)
    const singers = [0, 1].map((k) => {
      const s = ctx.createBufferSource(); s.buffer = brown; s.loop = true; s.loopStart = k * 3;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 60; bp.frequency.value = F0 * (7 + k * 2);
      const g = G(opt.wx ? 0.45 + 0.6 * (1 - cloud) : 0.75); s.connect(bp).connect(pan(k ? 0.6 : -0.6)).connect(g); send(g, 0.25, 0.8); s.start(); live.push(s);
      return bp;
    });

    // 3b · resonant bodies: brown noise through slow, narrow formants, like air in a large pipe
    const bodies = [0, 1, 2].map((k) => {
      const s = ctx.createBufferSource(); s.buffer = brown; s.loop = true; s.loopStart = 1 + k * 2;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 9 + k * 5; bp.frequency.value = F0 * [2.5, 4.2, 6.6][k];
      const g = G(0.22 / (k + 1)); s.connect(bp).connect(pan([-0.4, 0.35, 0][k])).connect(g); send(g, 0.4, 0.6); s.start();
      live.push(s, lfo(1 / (70 + 60 * k), F0 * 0.6 * (k + 1), bp.frequency), lfo(1 / (45 + 30 * k), 0.1 / (k + 1), g.gain));
      return bp;
    });

    // 3c · a warm undertone: two detuned triangles, low-passed, drifting against each other (tape wow)
    const warmLp = ctx.createBiquadFilter(); warmLp.type = "lowpass"; warmLp.frequency.value = 260 + 380 * warm; warmLp.Q.value = 0.8;
    const warmG = G(0.05);
    [[1, -6], [2, 5], [3, 0]].forEach(([n, cents], i) => {
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = F0 * n; o.detune.value = cents;
      lfo(0.07 + i * 0.03, 4 + i * 2, o.detune);                       // a slow, uneven wow
      o.connect(G(1 / (i + 1.5))).connect(warmLp); o.start(); live.push(o);
    });
    warmLp.connect(warmG); send(warmG, 0.5, 0.5);
    live.push(lfo(1 / 95, 0.035, warmG.gain), lfo(1 / 130, 160, warmLp.frequency));

    // 3d · low-end drive: the bass and the bed pushed into a soft saturator; usually almost clean, at times it breaks up
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(3 * x) / Math.tanh(3) + 0.12 * x * x; } // a little even harmonic: warmth
    const shaper = ctx.createWaveShaper(); shaper.curve = curve; shaper.oversample = "4x";
    const driveIn = G(0.4), driveOut = G(0.0);
    const driveLp = ctx.createBiquadFilter(); driveLp.type = "lowpass"; driveLp.frequency.value = 180; driveLp.Q.value = 0.9;
    const driveTone = ctx.createBiquadFilter(); driveTone.type = "lowpass"; driveTone.frequency.value = 6000; driveTone.Q.value = 0.5;
    const driveHp = ctx.createBiquadFilter(); driveHp.type = "highpass"; driveHp.frequency.value = 30;
    bed.connect(driveLp); sub.connect(driveLp);
    driveLp.connect(driveIn).connect(shaper).connect(driveTone).connect(driveHp).connect(driveOut);
    send(driveOut, 0.75, 0.25);
    const grit = G(0.035); shaper.connect(grit); send(grit, 0.8, 0.2);

    // 3e · crackle like coal in a fire: many small ticks of every size and colour, arriving in uneven
    //      clusters, each channel on its own, with now and then a deeper snap; never a steady hiss
    const crk = ctx.createBuffer(2, sr * 16, sr);
    const rate = (10 + 22 * (1 - hum)) / Math.sqrt(SLOW);                                   // drier air, livelier fire
    for (let c = 0; c < 2; c++) {
      const d = crk.getChannelData(c);
      let t = 0, heat = 0.5;
      while (t < d.length) {
        heat = Math.min(1, Math.max(0.05, heat + (rnd() - 0.5) * 0.35));  // the fire flares and settles
        const burst = rnd() < 0.12 ? 3 + Math.floor(rnd() * 9) : 1;      // a little cluster of ticks
        t += Math.floor(sr * (-Math.log(1 - rnd()) / (rate * (0.3 + 1.4 * heat))));
        for (let b = 0; b < burst; b++) {
          const at = t + Math.floor(rnd() * sr * 0.03 * b);
          const kind = rnd();
          const snap = kind < 0.04;                                       // a deeper snap
          const amp = (snap ? 0.5 + rnd() * 0.4 : Math.pow(rnd(), 2.2) * 0.9) * (rnd() < 0.5 ? -1 : 1);
          const tau = snap ? 25 + rnd() * 90 : 1.5 + Math.pow(rnd(), 1.6) * 28;   // samples: from needle-fine to soft
          const len = Math.floor(tau * 6);
          const col = snap ? 0.06 + rnd() * 0.1 : 0.15 + rnd() * 0.8;     // per tick: from dull to bright
          let lp = 0;
          for (let i = 0; i < len && at + i < d.length; i++) {
            lp += col * ((rnd() * 2 - 1) - lp);                           // a one-pole filter gives each tick its own colour
            d[at + i] += amp * Math.exp(-i / tau) * lp * (snap ? 2.2 : 1.6);
          }
        }
      }
    }
    const crackle = ctx.createBufferSource(); crackle.buffer = crk; crackle.loop = true;
    const crHp = ctx.createBiquadFilter(); crHp.type = "highpass"; crHp.frequency.value = 160;
    const crLp = ctx.createBiquadFilter(); crLp.type = "lowpass"; crLp.frequency.value = 9500; crLp.Q.value = 0.3;
    const crG = G(0.0);
    crackle.connect(crHp).connect(crLp).connect(crG); send(crG, 0.7, 0.3); crackle.start();
    live.push(crackle);
    // the crackle comes and goes in long phrases
    let crTimer = 0;
    const crackleWave = () => {
      const t = ctx.currentTime, dur = (20 + rnd() * 40) * SLOW, v = (rnd() < 0.25 ? 0.12 : 0.25 + rnd() * 0.4) * (0.6 + 0.8 * (1 - hum));
      crG.gain.cancelScheduledValues(t); crG.gain.setValueAtTime(crG.gain.value, t); crG.gain.linearRampToValueAtTime(v, t + dur * 0.4);
      crTimer = setTimeout(crackleWave, dur * 1000);
    };
    live.push({ stop() { clearTimeout(crTimer); } });

    // state for the readout
    const state = { drift: 0, event: "" };
    let nextAt = 0, timer = 0;

    // 4 · artefacts, scheduled on the audio clock
    const ARTEFACTS = {
      crack(t) {                                     // a short burst of crackle, closer than the bed
        const s = ctx.createBufferSource(); s.buffer = crk; const g = G(0), d = 0.6 + rnd() * 2.4;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3000 + rnd() * 3000;
        const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 400;
        s.connect(hp).connect(lp).connect(pan(rnd() * 1.4 - 0.7)).connect(g); send(g, 0.7, 0.3);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25 + rnd() * 0.25, t + 0.4); g.gain.setValueAtTime(0.3, t + d); g.gain.linearRampToValueAtTime(0, t + d + 0.4);
        s.start(t, rnd() * 14, d + 0.5);
      },
      drive(t) {                                     // the low end breaks up for a while, then settles
        const peak = 0.35 + rnd() * 0.5 + 0.4 * low, up = (3 + rnd() * 6) * SLOW, hold = (4 + rnd() * 14) * SLOW, down = (6 + rnd() * 10) * SLOW;
        driveIn.gain.cancelScheduledValues(t); driveOut.gain.cancelScheduledValues(t);
        driveIn.gain.setValueAtTime(0.4, t); driveIn.gain.linearRampToValueAtTime(2.2 + 3 * rnd(), t + up); driveIn.gain.setValueAtTime(2.2, t + up + hold); driveIn.gain.linearRampToValueAtTime(0.4, t + up + hold + down);
        driveOut.gain.setValueAtTime(0, t); driveOut.gain.linearRampToValueAtTime(peak * 0.22, t + up); driveOut.gain.setValueAtTime(peak * 0.22, t + up + hold); driveOut.gain.linearRampToValueAtTime(0, t + up + hold + down);
      },
      ping(t) {
        const n = [12, 14, 15, 16, 18, 20, 21, 24][Math.floor(rnd() * 8)];
        const o = ctx.createOscillator(); o.frequency.value = F0 * n;
        const g = G(0), dl = ctx.createDelay(2), fb = G(0.45), lp = ctx.createBiquadFilter();
        lp.type = "lowpass"; lp.frequency.value = 1400; dl.delayTime.value = 0.6 + rnd() * 0.7;
        o.connect(g); g.connect(dl); dl.connect(lp).connect(fb).connect(dl);
        const out = G(1), p = pan(rnd() * 1.6 - 0.8); g.connect(out); lp.connect(out); out.connect(p); send(p, 0.3, 0.7);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.009, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
        o.start(t); o.stop(t + 2);
      },
      pop(t) {                                       // a single warm thump, like dust on a needle
        const o = ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(140 + rnd() * 80, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        const g = G(0); o.connect(g).connect(pan(rnd() * 1.2 - 0.6)); send(g, 0.8, 0.2);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.08 + rnd() * 0.06, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.start(t); o.stop(t + 0.25);
      },
      dropout(t) {
        const g = master.gain, v = LEVEL, depth = 0.25 + rnd() * 0.3;
        g.setValueAtTime(v, t); g.linearRampToValueAtTime(v * depth, t + 0.05); g.setValueAtTime(v * depth, t + 0.3 + rnd() * 0.9); g.linearRampToValueAtTime(v, t + 2.5 + rnd() * 2);
      },
      drift(t) {
        const cents = (rnd() * 2 - 1) * (3 + rnd() * 9), dur = (45 + rnd() * 60) * SLOW;
        drones.forEach((o) => { o.detune.cancelScheduledValues(t); o.detune.setValueAtTime(o.detune.value, t); o.detune.linearRampToValueAtTime(cents, t + dur); });
        state.drift = cents;
      },
      wander(t) {
        singers.forEach((bp) => {
          const n = 6 + Math.floor(rnd() * 7); bp.frequency.cancelScheduledValues(t);
          bp.frequency.setValueAtTime(bp.frequency.value, t); bp.frequency.exponentialRampToValueAtTime(F0 * n, t + (45 + rnd() * 45) * SLOW);
        });
      },
    };
    const WEIGHTS = [["crack", 3], ["pop", 2], ["ping", 1], ["drive", opt.wx ? 1 + 2 * low : 1.5], ["wander", 1], ["drift", 1], ["dropout", 1]];
    const pick = () => { let r = rnd() * WEIGHTS.reduce((a, w) => a + w[1], 0); for (const [k, w] of WEIGHTS) { if ((r -= w) <= 0) return k; } return "glitch"; };
    function schedule(until) {
      while (nextAt < until) {
        const k = pick(); ARTEFACTS[k](nextAt);
        const at = nextAt; setTimeout(() => (state.event = k), Math.max(0, (at - ctx.currentTime) * 1000));
        nextAt += (8 + rnd() * 18) * (opt.wx ? 1.5 - 1.1 * low : 1) * SLOW;   // a falling glass brings more disturbance
      }
    }

    // a slow, irregular swell of the whole drone: new targets every 15–40 s, between about −8 and +1 dB
    let breathTimer = 0;
    function breathe(at) {
      const step = () => {
        const t = ctx.currentTime, dur = (15 + rnd() * 25) * SLOW, v = 0.42 + rnd() * 0.72;
        for (const g of [genDry.gain, genWet.gain]) { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(v, t + dur); }
        breathTimer = setTimeout(step, dur * 1000);
      };
      breathTimer = setTimeout(step, Math.max(0, (at - ctx.currentTime) * 1000));
    }
    return {
      // lower the drone while something else is in front (1 = no ducking); takes effect over `sec`
      duck(v, sec = 6) {
        const t = ctx.currentTime;
        for (const g of [duckD.gain, duckW.gain]) { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(v, t + sec); }
      },
      analyser, state, F0, shape: { warm, low, wind, hum, cloud, side },
      // for outside material (field recordings): a dry input and a send into the space
      input: dry, space: verb,
      start() {
        const t = ctx.currentTime;
        if (opt.breathe) breathe(t + 14);
        crTimer = setTimeout(crackleWave, 8000);
        master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(0, t); master.gain.linearRampToValueAtTime(LEVEL, t + 12 * SLOW);
        nextAt = t + (12 + rnd() * 6) * SLOW;
        schedule(t + 2); timer = setInterval(() => schedule(ctx.currentTime + 2), 1000);
      },
      stop() {
        clearInterval(timer); clearTimeout(breathTimer);
        const t = ctx.currentTime;
        master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(0, t + 5);
        setTimeout(() => { live.forEach((n) => { try { n.stop(); } catch (_) {} }); master.disconnect(); }, 5300);
      },
      // for offline rendering/tests
      scheduleOffline(until) { nextAt = 4; master.gain.setValueAtTime(0, 0); master.gain.linearRampToValueAtTime(LEVEL, 12); schedule(until); },
    };
  }
  window.createTransmission = createTransmission;
})();
