// Shrine catalogue. One entry per recording.
// area: recordings with the same area share one marker on the overview.
// geo: [latitude, longitude] of the recording; places the shrine on the overview of Europe.
// view: compass heading (degrees) the camera looks toward when the scan opens (default 0 = north).
// spot: [u, v] position of the recording inside its scan, from the north-west corner (default: the centre).
// The ground around each shrine is assets/terrain/<id in lower case>.png (e.g. s-01.png), built from a LIDAR scan.
// Fields marked "~" are estimated from the original blog text; coordinates are approximate.
// prayer: paragraphs of the prayer or poem (German; <br> for line breaks); prayerBy: its author, if any;
// prayerEn: an English version, as close to the German as possible.
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
    source: "LIDAR scan",
    spot: [0.3866, 0.4793],   // on the eastern shore of the lake
    synth: { wind: 0.15, water: 0.9, birds: 0.05, tone: 180 },
    prayer: [
      "Gott, lass schweigen, was du nicht selbst in mir redest,<br>lass still stehen, was du nicht selbst bewegst,<br>nimm die Stelle ganz ein, die jetzt ich bin,<br>und tue in mir und durch mich, was dir gefällt.",
      "Lass dieses Ich untergehen<br>und sei du allein alles in allem.<br>Führe so mich ganz aus mir selbst,<br>und aus dem Meinen heraus in dich,<br>o mein Gott, mein Ursprung und mein Ende.",
    ],
    prayerBy: "nach Gerhard Tersteegen",
    prayerEn: [
      "God, let fall silent what you yourself do not speak in me,<br>let stand still what you yourself do not move,<br>take wholly the place that I now am,<br>and do in me and through me what pleases you.",
      "Let this self go under<br>and be you alone all in all.<br>So lead me wholly out of myself,<br>and out of what is mine into you,<br>O my God, my origin and my end.",
    ],
  },
  {
    id: "S-02",
    name: "Purring moor, pine, birch",
    region: "Spolsener Moor, Uplengen, Lower Saxony, DE",
    coords: "53.3713° N, 7.8738° E · 12 m",
    date: "2026-04-15",
    time: "10:49",
    temp: "15 °C",
    weather: "mainly clear",
    wind: "3 Bft S",   // weather filled in from the Open-Meteo archive (ERA5), the hour nearest the recording
    rig: "—",
    src: "https://res.cloudinary.com/dainslgf8/video/upload/v1794834154/260412005SpolsenerMooramSumpfMoorknisterncutEq24bit_slmnah.mp3",
    area: "Ostfriesland",
    geo: [53.37127037, 7.87380695],   // exactly as in the file's tags
    scan: false,                      // no LIDAR scan yet: the overview is its map
    synth: { wind: 0.3, water: 0.3, birds: 0.5, tone: 700 },
    prayer: [
      "Jesus, liebster Herr Jesus!<br>Ich bitt, dass du mich annimmst<br>zum Docht auf der Lampen,<br>zu der du das Öl gibst.",
      "Geht mir nit darum,<br>ob mein Leib verdorrt wie Gras,<br>aber um dein Bild in mir geht es.<br>Zünd dein Licht an und lass mich sein<br>wie ein heiliges Feuer am Rande der finstern Öde,<br>damit die im Dunkeln wissen, wo du zu finden bist.<br>Aus dir kommt, was gut in mir ist,<br>aus mir das Schwache und Geringe.<br>Erbarm dich meiner, Herr!",
    ],
    prayerBy: "Matthias Nithart (Grünewald)",
    prayerEn: [
      "Jesus, dearest Lord Jesus!<br>I pray that you will take me<br>as the wick in the lamp<br>to which you give the oil.",
      "It matters not to me<br>whether my body withers like grass,<br>but your image in me, that is what matters.<br>Kindle your light and let me be<br>like a holy fire at the edge of the dark wasteland,<br>so that those in the darkness know where you are to be found.<br>From you comes what is good in me,<br>from me the weak and the lowly.<br>Have mercy on me, Lord!",
    ],
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
    source: "LIDAR scan",
    synth: { wind: 0.1, water: 0.2, birds: 0.1, tone: 140, drone: 0.7 },
    prayer: [],   // text to follow
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
    source: "LIDAR scan",
    synth: { wind: 0.7, water: 0.0, birds: 0.5, tone: 1200, bells: 0.6 },
    prayer: [
      "Gottes Lob wandert und Erde darf hören.<br>Einst sang Maria, sie jubelte Antwort.<br>Wir stehn im Echo der Botschaft vom Leben:",
      "Den Herrn preist meine Seele.<br>Ich freue mich, dass er mein Retter ist.<br>Der Hohe schaut die Niedrige an.<br>Halleluja.",
    ],
    prayerBy: "Svein Ellingsen / Jürgen Henkys",
    prayerEn: [
      "God’s praise is wandering, and the earth may hear.<br>Once Mary sang, rejoicing in answer.<br>We stand in the echo of the message of life:",
      "My soul praises the Lord.<br>I rejoice that he is my saviour.<br>The Most High looks upon the lowly.<br>Hallelujah.",
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
    wind: "2 Bft SW",   // weather filled in from the Open-Meteo archive (ERA5), the hour nearest the recording
    rig: "Nevaton MC59 omni · baffled AB · Zoom F3",
    src: "https://res.cloudinary.com/dainslgf8/video/upload/v1794834149/250822WellenschmatzenKiesstrandArklowIrlandSHORT_g0puec.mp3",
    area: "Arklow",
    geo: [52.7817, -6.1457],
    view: 270,            // the scan is first seen looking west, the coast at the bottom
    spot: [0.835, 0.555],   // estimated position of the beach inside the scan
    source: "LIDAR scan",
    synth: { wind: 0.2, water: 1.0, birds: 0.05, tone: 240 },
    prayer: [
      "Gott, ohne dein Wort hat die Seele kein Ohr,<br>ohne dein Ohr hat die Seele kein Wort.",
    ],
    prayerBy: "Rumi",
    prayerEn: [
      "God, without your word the soul has no ear,<br>without your ear the soul has no word.",
    ],
  },
  {
    id: "S-07",
    name: "Northern forest, creek, soft rain",
    region: "Engerdal, Innlandet, NO",
    coords: "61.8759° N, 11.8848° E · 792 m",
    date: "2026-08-26",
    time: "15:31",
    temp: "19 °C",
    weather: "soft rain",
    wind: "2 Bft SW",   // weather filled in from the Open-Meteo archive (ERA5), the hour nearest the recording
    rig: "—",
    src: "https://res.cloudinary.com/dainslgf8/video/upload/v1794834154/260826004BeautifulNorthernForestwithCreekandRain_oz1rbt.mp3",
    area: "Engerdal",
    geo: [61.771, 11.46],   // on the overview: the plateau where the shrine stands in the scan (the recorded coordinates are in `coords`)
    // the scan: two LIDAR views stitched (Sølen in the north), the large forms from an elevation model
    relief: 1.4,
    dense: true,          // every pixel of the scan a point
    water: "still",       // the lakes sparkle rather than drift
    spot: [0.5, 0.88],      // in the middle of the plateau in the south (the recorded coordinates lie about 10 km east of the scan)
    km: 23.1,              // width of the scan, for the scale bar
    source: "two LIDAR scans · large forms from a 3″ elevation model",
    synth: { wind: 0.3, water: 0.8, birds: 0.2, tone: 320 },
    prayer: [
      "Lebe du in mir, heiliger Gott.<br>Ich möchte nichts als dasein<br>und durch dich leben.<br>Ich will mich lassen, mich freigeben.<br>Ich möchte mich öffnen<br>und mich geöffnet in der Hand halten,<br>dir entgegen.",
      "Wirke du in mir so,<br>dass du mein Leben bist.<br>Sei du um mich so,<br>dass du meine Welt bist.<br>Durchdringe mich,<br>dass ich selbst unwichtig werde<br>und du allein bleibst.",
    ],
    prayerBy: "Jörg Zink",
    prayerEn: [
      "Live in me, holy God.<br>I want nothing but to be here<br>and to live through you.<br>I want to let go of myself, to set myself free.<br>I want to open myself<br>and, opened, hold myself in my hand,<br>held out toward you.",
      "Work in me so<br>that you are my life.<br>Be around me so<br>that you are my world.<br>Pervade me,<br>so that I myself become unimportant<br>and you alone remain.",
    ],
  },
  {
    id: "S-08",
    name: "Lonely lake, gurgling water",
    region: "Holmevatten, Bohusleden, Stenungsund, SE",
    coords: "57.9968° N, 11.9803° E · 107 m",
    date: "2026-05-07",
    time: "14:23",
    temp: "14 °C",
    weather: "clear",
    wind: "2 Bft W",   // weather filled in from the Open-Meteo archive (ERA5), the hour nearest the recording
    rig: "—",
    src: "https://res.cloudinary.com/dainslgf8/video/upload/v1794834151/WellengluckernSeeuferniceStereoBohusledenSHORT_zr26u0.mp3",
    area: "Bohuslän",
    geo: [57.99685, 11.98025],
    // the scan was located by fitting the outline of Holmevatten (OpenStreetMap) onto it: 1.8 m per pixel
    relief: 0.9,
    water: "still",
    spot: [0.4966, 0.5383],   // the southern inlet by the shelter (vindskydd)
    km: 4.5,              // width of the scan, for the scale bar
    source: "LIDAR scan · placed by the outline of Holmevatten, OpenStreetMap",
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
    temp: "10 °C",
    weather: "overcast",
    wind: "4 Bft SW",   // weather filled in from the Open-Meteo archive (ERA5), the hour nearest the recording
    rig: "—",
    src: "https://res.cloudinary.com/dainslgf8/video/upload/v1794834151/SingenderzaunGrenorePointIrlandSHORT_mdrrik.mp3",
    area: "Wexford",
    geo: [52.241157637124, -6.3161070557458],   // exactly as in the file's tags
    // the scan shows the coast at Tramore, County Waterford, in its own outline, the sea filled in along the shore
    relief: 0.3,
    walls: true,          // cliff faces drawn down to the sea
    spot: [0.724, 0.905],   // on the cliffs of the eastern headland, above the sea
    km: 6.4,              // width of the scan, for the scale bar
    source: "LIDAR scan of the coast at Tramore · sea filled in",
    synth: { wind: 0.6, water: 0.7, birds: 0.1, tone: 520 },
    prayer: [
      "Müde<br>und einsam.<br>Müde,<br>bis der Verstand schmerzt.<br>Von den Klippen<br>rinnt Salzwasser.<br>Taub die Finger,<br>bebend die Knie.<br>Jetzt gilt es,<br>jetzt darfst du nicht loslassen.",
      "Andrer Weg<br>hat Rastplätze<br>in der Sonne<br>sich zu begegnen.<br>Aber dieser Weg<br>ist der deine,<br>und es gilt jetzt,<br>jetzt darfst du nicht versagen.",
      "Weine,<br>wenn du kannst,<br>weine,<br>doch klage nicht.<br>Dich wählte der Weg –<br>und du sollst danken.",
    ],
    prayerBy: "Dag Hammarskjöld",
    prayerEn: [
      "Tired<br>and lonely.<br>Tired,<br>until the mind aches.<br>Down the cliffs<br>runs salt water.<br>Numb the fingers,<br>trembling the knees.<br>Now is the time,<br>now you must not let go.",
      "Other ways<br>have resting places<br>in the sun<br>to meet one another.<br>But this way<br>is yours,<br>and now is the time,<br>now you must not fail.",
      "Weep<br>if you can,<br>weep,<br>but do not complain.<br>The way chose you –<br>and you shall give thanks.",
    ],
  },
  {
    id: "S-10",
    name: "Incoming flood tide",
    region: "Vareler Schleuse, Jadebusen, Lower Saxony, DE",
    coords: "53.4104° N, 8.1962° E · 1 m",
    date: "2026-07-24",
    time: "21:00",
    temp: "17 °C",
    weather: "overcast",
    wind: "2 Bft SW",   // weather filled in from the Open-Meteo archive (ERA5), the hour nearest the recording
    rig: "—",
    src: "https://res.cloudinary.com/dainslgf8/video/upload/v1794834152/260724003VarelerSchleuseUferbschungWellenschmatzenFlutFellAPE40EQedit_dntubs.mp3",
    area: "Jadebusen",
    geo: [53.410385342996, 8.1961923837662],   // exactly as in the file's tags
    // the Watt from the 1 m survey of the Jade (EMODnet Bathymetry, 1850 HRDTM Jade approach, CC BY 4.0);
    // the land behind it filled in, the river Jade and the Vareler Hafen from OpenStreetMap (tools/scan_s10.py)
    relief: 0.35,
    spot: [0.3666, 0.5696],   // on the Watt at the sluice, where the Jade and the harbour channel reach the bay
    km: 5.64,              // width of the scan, for the scale bar
    source: "survey: EMODnet Bathymetry, 1850 HRDTM Jade, CC BY 4.0 · land modelled · OpenStreetMap",
    synth: { wind: 0.4, water: 0.8, birds: 0.4, tone: 380 },
    prayer: [
      "Nimm mich, lieber Gott. Dir will ich ganz gehören. Alle meine Pläne lege ich dir zu Füßen.",
      "Gebrauche mich heute in deinem Dienst. Bleib an meiner Seite und lass alles, was ich tue und sage, aus deiner Kraft heraus und in deinem Sinn geschehen. Amen.",
    ],
    prayerEn: [
      "Take me, dear God. I want to belong to you wholly. All my plans I lay at your feet.",
      "Use me today in your service. Stay at my side, and let all that I do and say come about out of your strength and in your spirit. Amen.",
    ],
  },
];
