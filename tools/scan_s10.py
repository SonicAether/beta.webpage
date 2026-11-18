"""S-10 Jadebusen: a LIDAR-style terrain made from map data (no scan exists).

Real geometry: the outline of the Jadebusen and the Vareler Hafen from OpenStreetMap (via
Nominatim, ODbL). Everything finer is modelled from how such ground looks in airborne LIDAR:
  - the Watt: a nearly level sheet, falling gently towards a dendritic network of Priele that
    gather towards the opening to the Jade (flow accumulation on a noisy cost surface),
  - the salt marsh (Groden) along the dike with its parallel drainage ditches (Grüppen),
  - the sea dike, the polder behind it with ditches, roads and a few Warften,
  - the Jade to the north as open water.
Output: same encoding as the scans (R = shade, 0 = sea; G + high nibble of B = 12-bit height).
At flood tide (the recording): the Priele are filled, the flats still dry."""
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage.graph import MCP_Geometric

rng = np.random.default_rng(7)
LON0, LON1, LAT0, LAT1 = 8.035, 8.335, 53.385, 53.535
NX = int(sys.argv[1]) if len(sys.argv) > 1 else 1600
kx = 111320 * math.cos(math.radians((LAT0 + LAT1) / 2)); ky = 111320
NY = round(NX * (LAT1 - LAT0) * ky / ((LON1 - LON0) * kx))
mpp = (LON1 - LON0) * kx / NX
px = lambda lon, lat: ((lon - LON0) / (LON1 - LON0) * NX, (LAT1 - lat) / (LAT1 - LAT0) * NY)
osm = json.load(open('jade_osm.json'))

def poly(ring):
    im = Image.new('L', (NX, NY), 0); ImageDraw.Draw(im).polygon([px(*c) for c in ring], fill=1)
    return np.asarray(im) > 0

bay = poly(osm['bay']); hafen = poly(osm['hafen'])
# the Jade: water north of the bay's closing line, between Wilhelmshaven and Butjadingen
jade = poly([[8.1646, 53.5206], [8.227, 53.5205], [8.2766, 53.5202], [8.297, 53.5257], [8.335, 53.5257], [8.335, 53.535], [8.17, 53.535]])
jade |= poly([[8.2765, 53.52], [8.3165, 53.5114], [8.3165, 53.535], [8.28, 53.535]])
jade &= ~bay
water_open = bay | jade
land = ~water_open & ~hafen

def fbm(shape, scales, seed):
    r = np.random.default_rng(seed); out = np.zeros(shape)
    for s, a in scales:
        out += a * ndimage.gaussian_filter(r.standard_normal(shape), s, mode='wrap') * s
    return out / np.abs(out).max()

dl = ndimage.distance_transform_edt(~land) * mpp          # in the bay: distance from the shore (m)
dw = ndimage.distance_transform_edt(~(bay | jade)) * mpp   # on land: distance from the shore (m); the harbour cuts through

# ── 1 · Priele: flow accumulation towards the opening ──
k = 4                                                      # the network is grown on a coarser grid
bayc = bay[::k, ::k] | jade[::k, ::k]
noise = fbm(bayc.shape, [(18, 1.0), (6, 0.45), (2, 0.15)], 11)
noise = (noise - noise.min()) / (noise.max() - noise.min())
cost = np.where(bayc, 0.3 + 6.0 * noise ** 2, np.inf)   # valleys in the noise become the channels
root = jade[::k, ::k]
mcp = MCP_Geometric(cost, fully_connected=True)
starts = list(zip(*np.nonzero(root)))
mcp.find_costs(starts)
flow = np.zeros(bayc.shape)
bi = np.argwhere(bay[::k, ::k])
dlc = dl[::k, ::k]
# sinks: everywhere in the bay, more near the shore; many at the Vareler Hafen mouth (its Fahrwasser)
w = 0.35 + np.exp(-dlc[bi[:, 0], bi[:, 1]] / 1500)
pick = bi[rng.choice(len(bi), 4000, p=w / w.sum())]
vx, vy = px(8.1905, 53.4112); vx, vy = int(vx / k), int(vy / k)
pick = np.vstack([pick, np.tile([[vy, vx]], (260, 1))])
for (y, x) in pick:
    try: path = mcp.traceback((int(y), int(x)))
    except ValueError: continue
    for (a, b) in path: flow[a, b] += 1
flow = np.array(Image.fromarray(flow.astype(np.float32)).resize((NX, NY), Image.BILINEAR))
# meanders: warp the straight network with smooth displacement at two scales
yy, xx = np.mgrid[0:NY, 0:NX].astype(np.float64)
d1 = [ndimage.gaussian_filter(np.random.default_rng(s_).standard_normal((NY, NX)), 45) for s_ in (41, 42)]
d2 = [ndimage.gaussian_filter(np.random.default_rng(s_).standard_normal((NY, NX)), 9) for s_ in (43, 44)]
n1 = 22 / max(np.abs(d1[0]).max(), 1e-9); n2 = 5 / max(np.abs(d2[0]).max(), 1e-9)
flow = ndimage.map_coordinates(flow, [yy + d1[0] * n1 + d2[0] * n2, xx + d1[1] * n1 + d2[1] * n2], order=1, mode='nearest')
flow = ndimage.gaussian_filter(flow, 0.8)
flow *= bay | jade

# ── 2 · heights (m, NN) ──
H = np.zeros((NY, NX))
# the Watt: ~+0.6 m near the shore, ~0 m in the middle; ripple fields and faint runnels
watt = 0.05 + 0.6 * np.exp(-dl / 1800) + 0.25 * fbm((NY, NX), [(40, 1), (12, 0.4)], 3)
ripple = 0.035 * np.sin((ndimage.gaussian_filter(rng.standard_normal((NY, NX)), 30) * 40 + np.arange(NX)[None, :] * 0.9))
H = np.where(bay, watt + ripple, H)
# carve the Priele: deeper and wider with the flow that gathers in them
f = np.log1p(flow)
for lvl in np.linspace(0.25, f.max(), 22):
    m = f >= lvl
    if not m.any(): continue
    rad = 0.6 + 7.0 * (lvl / f.max()) ** 2.4                   # px
    dep = 0.12 + 6.8 * (lvl / f.max()) ** 1.8                  # m below the flats: small runnels stay dry
    dd = ndimage.distance_transform_edt(~m)
    prof = np.clip(1 - (dd / rad) ** 2, 0, 1)
    H = np.where(bay, np.minimum(H, watt - dep * prof + (prof == 0) * 9), H)
H = np.where(bay, np.minimum(H, watt + ripple), H)
# the Vareler Fahrwasser: the harbour mouth (the sluice) joined to the nearest deep Priel
mx, my = px(8.1886, 53.4097)
deep = bay & (H < -1.5)
_, (iy, ix) = ndimage.distance_transform_edt(~deep, return_indices=True)
tx, ty = ix[int(my), int(mx)], iy[int(my), int(mx)]
im = Image.new('L', (NX, NY), 0); dr = ImageDraw.Draw(im)
pts = [(mx + (tx - mx) * t + 6 * math.sin(t * 5) * (t * (1 - t)) * 4, my + (ty - my) * t) for t in np.linspace(0, 1, 40)]
dr.line(pts, fill=1, width=9)
fw = np.asarray(im) > 0
H = np.where(fw & (bay | land), np.minimum(H, -2.2), H)
land &= ~fw
# the Jade: deep water
H = np.where(jade, -12 + 4 * np.exp(-dl / 600), H)
H = np.where(hafen, -2.5, H)

# land: Groden (salt marsh) band, the dike, the polder
dike_at = 260.0 + 140 * (fbm((NY, NX), [(80, 1)], 5) + 1)    # the dike stands 260–540 m behind the shore line
groden = land & (dw < dike_at - 40)
H = np.where(land, 0.3 + 0.25 * fbm((NY, NX), [(60, 1), (8, 0.3)], 9), H)          # polder ~ sea level
H = np.where(groden, 1.4 + 0.15 * fbm((NY, NX), [(20, 1)], 12), H)               # marsh above mean high water
# Grüppen: parallel ditches across the marsh, perpendicular to the shore
gy, gx = np.gradient(ndimage.gaussian_filter(dw, 6))
ang = np.arctan2(gy, gx)
along = (np.cos(ang) * 0 + 1) * (-np.sin(ang) * np.arange(NX)[None, :] + np.cos(ang) * np.arange(NY)[:, None])
grup = (np.abs(((along * mpp) % 45) - 22.5) < 2.2) & groden & (dw > 25)
H = np.where(grup, H - 0.5, H)
# the dike: a smooth ridge, ~8 m, ~70 m wide
ddk = np.abs(dw - dike_at)
dike = land & (ddk < 45)
H = np.where(land, H + 7.6 * np.exp(-(ddk / 26) ** 2) * (dw > 30), H)
# polder: ditches on a skewed grid, a few roads and Warften
pold = land & (dw > dike_at + 50)
rot = math.radians(28)
u = (np.arange(NX)[None, :] * math.cos(rot) + np.arange(NY)[:, None] * math.sin(rot)) * mpp
v = (-np.arange(NX)[None, :] * math.sin(rot) + np.arange(NY)[:, None] * math.cos(rot)) * mpp
wob = 30 * fbm((NY, NX), [(50, 1)], 21)
cellv = np.floor((v + wob) / 520); jit = (np.sin(cellv * 12.9898) * 43758.5453) % 1
ditch = ((np.abs(((u + wob + jit * 300) % (180 + 140 * jit)) - 0) < 3.0) | (np.abs(((v + wob) % 520) - 260) < 3.0)) & pold
H = np.where(ditch, H - 1.0, H)
road = (np.abs(((v + 2 * wob) % 2080) - 1040) < 5) & pold
H = np.where(road, H + 0.7, H)
for _ in range(26):
    y, x = rng.integers(0, NY), rng.integers(0, NX)
    if not pold[y, x]: continue
    rr = np.hypot(np.arange(NX)[None, :] - x, np.arange(NY)[:, None] - y) * mpp
    H = np.where(pold, H + 2.2 * np.exp(-(rr / 90) ** 4), H)
# trees and farmsteads on the land: fine rough patches
rough = (fbm((NY, NX), [(25, 1)], 31) > 0.55) & pold
H = np.where(rough, H + 1.2 * np.abs(rng.standard_normal((NY, NX))), H)

# ── 3 · water at flood tide: the open Jade, the harbour and the Priele are wet ──
LEVEL = -0.35
sea = jade | hafen | (bay & (H < LEVEL))
sea = ndimage.binary_opening(sea, iterations=1) | jade | hafen
H = np.where(sea, np.minimum(H, LEVEL), H)

# ── 4 · shade: a hillshade of the heights, lit from the north-west, flat ground mid-grey ──
Hs = ndimage.gaussian_filter(H, 0.6)
gy, gx = np.gradient(Hs, mpp)
a = math.radians(315); lx, ly = math.sin(a), -math.cos(a)
slope = (gx * lx + gy * ly) * 8.0                          # exaggerated: the marsh is flat
shade = np.clip(0.5 + 0.62 * np.tanh(slope), 0.03, 1)
shade = np.where(bay & ~sea, shade * 0.62, shade * 0.82)   # wet mud dark, the land a little lighter: the channels and dike stand out

hmin, hmax = float(H.min()), float(H.max())
Hn = (H - hmin) / (hmax - hmin)
h12 = np.clip(np.round(Hn * 4095), 1, 4095).astype(np.uint32)
R = (np.clip(np.round(shade * 125), 2, 127) * 2).astype(np.uint8); R[sea] = 0
Image.fromarray(np.dstack([R, (h12 >> 4).astype(np.uint8), ((h12 & 15) << 4).astype(np.uint8)]), 'RGB').save('s-10.png', optimize=True)
prev = np.dstack([(shade * 255).astype(np.uint8)] * 3); prev[sea] = (30, 80, 110)
Image.fromarray(prev).save('prev.png')
# the shrine: on the dry flat nearest to the recorded spot, beside the mouth of the harbour (the sluice)
flat = bay & ~sea
rx, ry = px(8.1962, 53.4108)
_, (fy, fx) = ndimage.distance_transform_edt(~flat, return_indices=True)
sx, sy = fx[int(ry), int(rx)] + 0.5, fy[int(ry), int(rx)] + 0.5
# step two cells further onto the flat, away from the edge
sx, sy = sx + 2, sy - 3
print(json.dumps({'nx': NX, 'ny': NY, 'm_per_px': mpp, 'range_m': [hmin, hmax], 'sea_%': float(sea.mean() * 100),
                  'spot': [sx / NX, sy / NY], 'spot_is_flat': bool(bay[int(sy), int(sx)] and not sea[int(sy), int(sx)])}))
