/* Where the Aron Stadler signal comes from: a name for a point between Ireland and Sweden, and the
   field recordings of radio aporee ::: maps nearest to it (through the Internet Archive, where the
   aporee archive is mirrored). Exposes window.SignalSource = { name(lat, lon), recordings(lat, lon) }.
   Names: GeoNames (CC BY 4.0) towns and Natural Earth sea areas, both shipped with the site. */
(() => {
  const BASE = new URL("assets/geo/", document.baseURI).href;
  const COUNTRY = { IE: "Ireland", GB: "United Kingdom", IM: "Isle of Man", JE: "Jersey", GG: "Guernsey", FR: "France", BE: "Belgium",
    NL: "Netherlands", LU: "Luxembourg", DE: "Germany", DK: "Denmark", FO: "Faroe Islands", NO: "Norway", SE: "Sweden", FI: "Finland",
    AX: "Åland", PL: "Poland", CZ: "Czechia", LT: "Lithuania", LV: "Latvia", EE: "Estonia", RU: "Russia", AT: "Austria", CH: "Switzerland", IS: "Iceland" };
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dist = (a, b, c, d) => {
    const x = rad(d - b) * Math.cos(rad((a + c) / 2)), y = rad(c - a);
    return Math.sqrt(x * x + y * y) * R;
  };
  const bearing = (a, b, c, d) => {            // from (a,b) towards (c,d), degrees from north
    const y = Math.sin(rad(d - b)) * Math.cos(rad(c)), x = Math.cos(rad(a)) * Math.sin(rad(c)) - Math.sin(rad(a)) * Math.cos(rad(c)) * Math.cos(rad(d - b));
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  };
  const point8 = (deg) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];

  let places = null, seas = null;
  async function load() {
    if (places) return;
    const G = window.SA_GEO;                       // a page may carry the data inline (previews)
    const [txt, meta] = G ? [G.places, G.seas] : await Promise.all([fetch(BASE + "places.txt").then((r) => r.text()), fetch(BASE + "seas.json").then((r) => r.json())]);
    places = txt.split("\n").map((l) => { const [n, a, b, c] = l.split("|"); return { n, lat: +a, lon: +b, c }; });
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = G ? G.png : BASE + "seas.png"; });
    const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext("2d"); cx.drawImage(img, 0, 0);
    seas = { ...meta, px: cx.getImageData(0, 0, img.width, img.height).data };
  }
  function seaAt(lat, lon) {
    const i = Math.floor((lon - seas.lon0) / seas.step), j = Math.floor((seas.lat1 - lat) / seas.step);
    if (i < 0 || j < 0 || i >= seas.w || j >= seas.h) return null;
    const k = seas.px[(j * seas.w + i) * 4];
    return k ? seas.names[k - 1] : null;
  }

  // "12 km NE of Arklow, Ireland" on land; "North Sea · 85 km W of Esbjerg, Denmark" at sea
  async function name(lat, lon) {
    await load();
    let best = null, bd = Infinity;
    for (const p of places) { const d = dist(lat, lon, p.lat, p.lon); if (d < bd) { bd = d; best = p; } }
    const where = `${best.n}, ${COUNTRY[best.c] || best.c}`;
    const rel = bd < 2.5 ? where : `${Math.round(bd)} km ${point8(bearing(best.lat, best.lon, lat, lon))} of ${where}`;
    const sea = seaAt(lat, lon);
    // far out at sea a town says little: the sea's name is enough
    return { label: sea ? (bd > 120 ? sea : `${sea} · ${rel}`) : rel, sea, town: best, km: bd };
  }

  // licences the page may mix freely: public domain, CC BY, CC BY-NC (no ShareAlike, no NoDerivatives)
  const usable = (u) => /publicdomain|licenses\/by\/|licenses\/by-nc\/\d/.test(u || "");
  const licName = (u) => (/publicdomain/.test(u) ? "public domain" : /by-nc\//.test(u) ? "CC BY-NC" : /licenses\/by\//.test(u) ? "CC BY" : "licensed");
  async function search(lat, half) {
    const q = `collection:radio-aporee-maps AND latitude:[${(lat - half).toFixed(2)} TO ${(lat + half).toFixed(2)}]`;
    const u = `https://archive.org/services/search/v1/scrape?q=${encodeURIComponent(q)}&fields=identifier,latitude,longitude,licenseurl&count=10000`;
    const j = await (await fetch(u)).json();
    return j.items || [];
  }
  // the recordist as aporee lists them; some entries carry an e-mail address or a placeholder instead of a name
  const who = (c) => { c = String(c || "").replace(/<[^>]+>/g, "").trim(); return !c || /@/.test(c) || /^(info|unknown|admin|n\/?a)$/i.test(c) ? "radio aporee contributor" : c; };
  async function details(item) {
    const m = await (await fetch(`https://archive.org/metadata/${item.identifier}`)).json();
    const files = (m.files || []).filter((f) => /\.mp3$/i.test(f.name));
    const mp3 = files.find((f) => /vbr/i.test(f.format || "")) || files[0];
    if (!mp3) return null;
    const [, loc, snd] = item.identifier.split("_");
    const md = m.metadata || {};
    return {
      id: item.identifier, km: item.km, bearing: item.bearing, lat: item.lat, lon: item.lon,
      title: String(md.title || "").replace(/<[^>]+>/g, ""), creator: who(md.creator),
      license: licName(md.licenseurl), licenseurl: md.licenseurl,
      src: `https://archive.org/download/${item.identifier}/${encodeURIComponent(mp3.name)}`,
      length: parseFloat(mp3.length) || 0,
      page: loc && snd ? `https://aporee.org/maps/?loc=${loc}&snd=${snd}` : `https://archive.org/details/${item.identifier}`,
    };
  }
  // the nearest few recordings that may be mixed, at most `maxKm` away
  async function recordings(lat, lon, n = 3, maxKm = 140) {
    let items = [];
    for (const half of [0.4, 1.6]) {
      items = (await search(lat, half))
        .map((x) => ({ ...x, lat: +x.latitude, lon: +x.longitude }))
        .filter((x) => usable(x.licenseurl) && /^aporee_\d+_\d+$/.test(x.identifier) && isFinite(x.lat) && isFinite(x.lon))
        .map((x) => ({ ...x, km: dist(lat, lon, x.lat, x.lon), bearing: bearing(lat, lon, x.lat, x.lon) }))
        .filter((x) => x.km <= maxKm * (half > 1 ? 1.8 : 1))
        .sort((a, b) => a.km - b.km);
      if (items.length >= n) break;
    }
    // one per place: several takes from the same spot sound alike
    const pick = [];
    for (const x of items) { if (pick.every((p) => dist(p.lat, p.lon, x.lat, x.lon) > 1.5)) pick.push(x); if (pick.length >= n) break; }
    const out = await Promise.all(pick.map((x) => details(x).catch(() => null)));
    return out.filter(Boolean);
  }

  window.SignalSource = { name, recordings };
})();
