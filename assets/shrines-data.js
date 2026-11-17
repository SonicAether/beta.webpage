// Shrine catalogue. One entry per recording.
// area: recordings with the same area share one marker on the overview.
// geo: [latitude, longitude] of the recording; places the shrine on the overview of Europe.
// view: compass heading (degrees) the camera looks toward when the scan opens (default 0 = north).
// spot: [u, v] position of the recording inside its scan, from the north-west corner (default: the centre).
// The ground around each shrine is assets/terrain/<id in lower case>.png (e.g. s-01.png), built from a LIDAR scan.
// Fields marked "~" are estimated from the original blog text; coordinates are approximate.
// prayer: placeholder texts — replace with the final prayers.
export const SHRINES = [
  {
    id: "S-01",
    name: "Skedbrosjön",
    region: "Rogen Nature Reserve, Härjedalen, SE",
    coords: "≈ 62.31° N, 12.38° E",
    date: "2025-08-01",
    time: "22:00",
    temp: "15 °C",
    weather: "clear",
    wind: "calm",
    rig: "Nevaton MC59 omni · AB 55 cm · 90°",
    src: "https://res.cloudinary.com/dainslgf8/video/upload/v1757937528/250801_002_Skedbrosj%C3%B6n_edit_o9juns.mp3",
    area: "Härjedalen",
    geo: [62.31, 12.38],
    synth: { wind: 0.15, water: 0.9, birds: 0.05, tone: 180 },
    prayer: [
      "Let the lake keep its small voice.",
      "Let the stones be counted by water, one by one, until the counting is all that remains.",
      "I ask for nothing but to stay a little longer at the edge of the stillness, and to carry it home unbroken.",
    ],
  },
  {
    id: "S-02",
    name: "Purring moor, pine, birch",
    region: "Spolsener Moor, Uplengen, Lower Saxony, DE",
    coords: "53.3713° N, 7.8738° E · 12 m",
    date: "2026-04-15",
    time: "10:49",
    temp: "—",
    weather: "—",
    wind: "—",
    rig: "—",
    src: "https://res.cloudinary.com/dainslgf8/video/upload/v1794834154/260412005SpolsenerMooramSumpfMoorknisterncutEq24bit_slmnah.mp3",
    area: "Ostfriesland",
    geo: [53.37127037, 7.87380695],   // exactly as in the file's tags
    scan: false,                      // no LIDAR scan yet: the overview is its map
    synth: { wind: 0.3, water: 0.3, birds: 0.5, tone: 700 },
    prayer: [],   // text to follow
  },
  {
    id: "S-03",
    name: "The night of the Billy Witch",
    region: "Bohlenbergerfeld, Lower Saxony, DE",
    coords: "≈ 53.39° N, 7.99° E",
    date: "2025-05-18",
    time: "~21:45",
    temp: "10 °C",
    weather: "clear",
    wind: "calm",
    rig: "Nevaton MC59 omni · baffled AB 35 cm · 90°",
    src: "https://res.cloudinary.com/dainslgf8/video/upload/v1748357450/250518_001_Maik%C3%A4fer_Abend_Reh_am_Teich_bearbeitet_wrnred.mp3",
    area: "Ostfriesland",
    geo: [53.39, 7.99],
    synth: { wind: 0.1, water: 0.2, birds: 0.1, tone: 140, drone: 0.7 },
    prayer: [
      "Blessed be the thousand wings in the oak crowns.",
      "Blessed be the footsteps in the gravel that I did not see.",
      "May the dark keep some of its secrets, and may I be content to only hear them.",
    ],
  },
  {
    id: "S-05",
    name: "Hopelser Wald",
    region: "East Frisia, Lower Saxony, DE",
    coords: "≈ 53.42° N, 7.70° E",
    date: "2025-03-29",
    time: "~18:00",
    temp: "11 °C",
    weather: "sunny",
    wind: "3–4 Bft W",
    rig: "Nevaton MC59 wide cardioid · NOS 35 cm · 90°",
    src: "https://res.cloudinary.com/dainslgf8/video/upload/v1748211069/250329_002_Hopelser_Wald_lmbkap.mp3",
    area: "Ostfriesland",
    geo: [53.42, 7.70],
    synth: { wind: 0.7, water: 0.0, birds: 0.5, tone: 1200, bells: 0.6 },
    prayer: [
      "At six the bells came through the spruces and did not stop.",
      "The wind carried them, let them go, carried them again.",
      "Teach me to ring like that: long, unhurried, until even the birds begin to answer.",
    ],
  },
  {
    id: "S-06",
    name: "Shingle beach, shallow waves",
    region: "South Beach, Arklow, County Wicklow, IE",
    coords: "52.7817° N, 6.1457° W",
    date: "2025-08-22",
    time: "17:20",
    temp: "8 °C",
    weather: "partly cloudy",
    wind: "—",
    rig: "Nevaton MC59 omni · baffled AB · Zoom F3",
    src: "https://res.cloudinary.com/dainslgf8/video/upload/v1794834149/250822WellenschmatzenKiesstrandArklowIrlandSHORT_g0puec.mp3",
    area: "Arklow",
    geo: [52.7817, -6.1457],
    view: 270,            // the scan is first seen looking west, the coast at the bottom
    spot: [0.835, 0.555],   // estimated position of the beach inside the scan
    synth: { wind: 0.2, water: 1.0, birds: 0.05, tone: 240 },
    prayer: [],   // text to follow
  },
  {
    id: "S-07",
    name: "Northern forest, creek, soft rain",
    region: "Engerdal, Innlandet, NO",
    coords: "61.8759° N, 11.8848° E · 792 m",
    date: "2026-08-26",
    time: "15:31",
    temp: "—",
    weather: "soft rain",
    wind: "—",
    rig: "—",
    src: "https://res.cloudinary.com/dainslgf8/video/upload/v1794834154/260826004BeautifulNorthernForestwithCreekandRain_oz1rbt.mp3",
    area: "Engerdal",
    geo: [61.771, 11.46],   // on the overview: the plateau where the shrine stands in the scan (the recorded coordinates are in `coords`)
    // the scan: two LIDAR views stitched (Sølen in the north), the large forms from an elevation model
    relief: 1.4,
    dense: true,          // every pixel of the scan a point
    water: "still",       // the lakes sparkle rather than drift
    spot: [0.5, 0.88],      // in the middle of the plateau in the south (the recorded coordinates lie about 10 km east of the scan)
    synth: { wind: 0.3, water: 0.8, birds: 0.2, tone: 320 },
    prayer: [],   // text to follow
  },
  {
    id: "S-08",
    name: "Lonely lake, gurgling water",
    region: "Holmevatten, Bohusleden, Stenungsund, SE",
    coords: "57.9968° N, 11.9803° E · 107 m",
    date: "2026-05-07",
    time: "14:23",
    temp: "—",
    weather: "—",
    wind: "—",
    rig: "—",
    src: "https://res.cloudinary.com/dainslgf8/video/upload/v1794834151/WellengluckernSeeuferniceStereoBohusledenSHORT_zr26u0.mp3",
    area: "Bohuslän",
    geo: [57.99685, 11.98025],
    // the scan was located by fitting the outline of Holmevatten (OpenStreetMap) onto it: 1.8 m per pixel
    relief: 0.9,
    water: "still",
    spot: [0.4966, 0.5383],   // the southern inlet by the shelter (vindskydd)
    synth: { wind: 0.2, water: 0.8, birds: 0.3, tone: 260 },
    prayer: [],   // text to follow
  },
  {
    id: "S-09",
    name: "Cliff coast, singing fence, distant surf",
    region: "Greenore Point, Rosslare, County Wexford, IE",
    coords: "52.2412° N, 6.3161° W · 12 m",
    date: "2025-11-28",
    time: "17:48",
    temp: "—",
    weather: "—",
    wind: "—",
    rig: "—",
    src: "https://res.cloudinary.com/dainslgf8/video/upload/v1794834151/SingenderzaunGrenorePointIrlandSHORT_mdrrik.mp3",
    area: "Wexford",
    geo: [52.241157637124, -6.3161070557458],   // exactly as in the file's tags
    // the scan shows the coast at Tramore, County Waterford, in its own outline, the sea filled in along the shore
    relief: 0.3,
    spot: [0.724, 0.905],   // on the cliffs of the eastern headland, above the sea
    synth: { wind: 0.6, water: 0.7, birds: 0.1, tone: 520 },
    prayer: [],   // text to follow
  },
];
