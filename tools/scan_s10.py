"""S-10 Jadebusen at the Vareler Schleuse, from real survey data.

Watt and Priele: EMODnet Bathymetry, "1850 HRDTM Jade approach" (1 m composite DTM of the
Wasserstraßen- und Schifffahrtsverwaltung, 2016–2018, CC BY 4.0), part 9, binned to ~4 m
(cut on the author's computer: tools/scan_s10_cut.py). Elevation = -depth (m, chart datum).
The survey ends at the shore; the land behind it is filled in: level marsh and polder with
faint ditches, no dike. The river Jade (OpenStreetMap, ODbL) and the Vareler Hafen run through
it to the Watt. At flood tide the Priele are filled; the water's edge fades instead of cutting.
"""
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

h = np.load('jade_cut_s10.npz')['h'].astype(np.float64)
LON0, LAT1, DX, DY = 8.150, 53.450, 0.00006, 0.00004             # grid of the cut (rows from the north)
C_LON0, C_LON1, C_LAT0, C_LAT1 = 8.165, 8.250, 53.388, 53.440     # the window shown
i0, i1 = int((LAT1 - C_LAT1) / DY), int((LAT1 - C_LAT0) / DY)
j0, j1 = int((C_LON0 - LON0) / DX), int((C_LON1 - LON0) / DX)
H = h[i0:i1, j0:j1]; NY, NX = H.shape
mx = DX * 111320 * math.cos(math.radians(53.41)); my = DY * 111320    # metres per cell (~4.0 × 4.5)
px = lambda lon, lat: ((lon - C_LON0) / DX, (C_LAT1 - lat) / DY)
osm = json.load(open('jade_osm2.json'))
rng = np.random.default_rng(3)

surv = np.isfinite(H)
surv = ndimage.binary_opening(surv, iterations=2)
H[~surv] = np.nan
land = ~surv
# heights near the survey's edge carried onto the land, then a gentle rise: no dike
dist = ndimage.distance_transform_edt(land, sampling=(my, mx))
# the level of the upper Watt along the shore: one value, so nothing streaks out of the survey's edge
rim = surv & (ndimage.distance_transform_edt(surv, sampling=(my, mx)) < 80)
shore = float(np.nanpercentile(H[rim], 60))
edge = np.where(land, shore, H)
edge = np.where(surv, H, edge)
edge = np.nan_to_num(edge, nan=shore)
def fbm(scales, seed):
    r = np.random.default_rng(seed); out = np.zeros((NY, NX))
    for s, a in scales: out += a * ndimage.gaussian_filter(r.standard_normal((NY, NX)), s) * s
    return out / np.abs(out).max()
marsh = shore + 1.1 * (1 - np.exp(-dist / 220)) + 0.12 * fbm([(30, 1), (6, 0.3)], 5)
# fields: faint ditches on a skewed grid, a few lanes
rot = math.radians(24)
u = (np.arange(NX)[None, :] * mx * math.cos(rot) + np.arange(NY)[:, None] * my * math.sin(rot))
v = (-np.arange(NX)[None, :] * mx * math.sin(rot) + np.arange(NY)[:, None] * my * math.cos(rot))
wob = 40 * fbm([(60, 1), (15, 0.3)], 8)
cell = np.floor((v + wob) / 420); jit = (np.sin(cell * 12.9898) * 43758.5453) % 1
ditch = ((np.abs(((u + wob + jit * 200) % (150 + 110 * jit)) - 75) < 2.0) | (np.abs(((v + wob) % 420) - 210) < 2.0)) & (dist > 120)
marsh = np.where(ditch, marsh - 0.14, marsh)
lane = (np.abs(((v + 2 * wob) % 1700) - 850) < 4) & (dist > 150)
marsh = np.where(lane, marsh + 0.35, marsh)
# blend: across the first ~60 m from the survey edge the land eases into the Watt (no step)
w = np.clip(dist / 60, 0, 1)
H = np.where(land, edge * (1 - w) + marsh * w, H)
# soften the survey's own outline (its edge row carries a seam)
seam = ndimage.binary_dilation(land, iterations=3) & ndimage.binary_dilation(surv, iterations=3)
H = np.where(seam, ndimage.gaussian_filter(H, 2.0), H)

# the Vareler Hafen and the river Jade, cut into the land down to the Watt's channel depth
im = Image.new('L', (NX, NY), 0); dr = ImageDraw.Draw(im)
dr.polygon([px(*c) for c in osm['hafen']], fill=1)
for line in osm['jade']:
    dr.line([px(*c) for c in line], fill=1, width=int(round(22 / mx)))
cut = (np.asarray(im) > 0) & land
cut = ndimage.binary_dilation(cut, iterations=1) & land
bed = ndimage.gaussian_filter(cut.astype(float), 1.5)
H = np.where(land, H - bed * (H - 0.6) , H)

# flood tide: Priele, harbour and river hold water; the flats are still dry
LEVEL = 1.55
sea = (H < LEVEL) | (cut & (H < LEVEL + 1.0))
sea = ndimage.binary_opening(sea, iterations=1)
H = np.where(sea, np.minimum(H, LEVEL), H)

# shade: hillshade lit from the north-west, flat ground mid-grey; wet ground darker,
# darkening gradually towards the water so the edge fades
Hs = ndimage.gaussian_filter(H, 0.7)
gy, gx = np.gradient(Hs, my, mx)
a = math.radians(315); lx, ly = math.sin(a), -math.cos(a)
shade = np.clip(0.5 + 0.62 * np.tanh((gx * lx + gy * ly) * 14), 0.03, 1)
dsea = ndimage.distance_transform_edt(~sea, sampling=(my, mx))
wet = surv & ~sea
shade = np.where(wet, shade * (0.55 + 0.17 * np.clip(dsea / 120, 0, 1)), shade * 0.8)
hmin, hmax = float(H.min()), float(H.max())
Hn = (H - hmin) / (hmax - hmin)
h12 = np.clip(np.round(Hn * 4095), 1, 4095).astype(np.uint32)
R = (np.clip(np.round(shade * 125), 2, 127) * 2).astype(np.uint8); R[sea] = 0
Image.fromarray(np.dstack([R, (h12 >> 4).astype(np.uint8), ((h12 & 15) << 4).astype(np.uint8)]), 'RGB').save('s-10.png', optimize=True)
prev = np.dstack([(shade * 255).astype(np.uint8)] * 3); prev[sea] = (30, 80, 110)
# the shrine: on the dry Watt nearest to the recorded spot, where the Jade leaves the sluice
rx, ry = px(8.196192, 53.410385)
flat = wet
_, (fy, fx) = ndimage.distance_transform_edt(~flat, return_indices=True)
sx, sy = fx[int(ry), int(rx)], fy[int(ry), int(rx)]
dd = ImageDraw.Draw(im2 := Image.fromarray(prev)); dd.ellipse((sx - 8, sy - 8, sx + 8, sy + 8), outline=(255, 60, 40), width=2)
im2.save('prev.png')
print(json.dumps({'nx': NX, 'ny': NY, 'm_per_px': [mx, my], 'km': [NX * mx / 1000, NY * my / 1000], 'range': [hmin, hmax],
                  'sea_%': float(sea.mean() * 100), 'spot': [(sx + 0.5) / NX, (sy + 0.5) / NY], 'rec_px': [rx, ry]}))
