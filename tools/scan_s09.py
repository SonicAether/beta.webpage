"""Detail terrain for S-09 from the Tramore LIDAR screenshot (County Waterford): the scan's own
outline is kept (outside it: R = 3, no points), the open sea along the south coast is filled in
(R = 0) a good way out from the shore, and the base map with its grid and labels is dropped.
Heights from the hillshade itself (light from the north-west, flat grey ~180), rising gently
inland from the sea."""
import math, json, sys
import numpy as np
from PIL import Image
from scipy import ndimage
SRC = '/mnt/user-data/attachments/fedef7e3-dda8-5218-a993-10271ea187b5/29df8baa-image.png'
NX = int(sys.argv[1]) if len(sys.argv) > 1 else 1015
rgb = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float32)
H0, W0 = rgb.shape[:2]
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
sat = rgb.max(-1) - rgb.min(-1)
grid = ndimage.binary_dilation(sat > 20, iterations=1)                 # purple grid lines and coloured map symbols
sea_bm = (np.abs(r - g) < 1) & (np.abs(g - b) < 1) & (r > 230)                # the neutral light grey of the map's sea
land_bm = (g - r > 1.5) & (r > 225)                                    # the greenish white of the base map's land
# the scan: grey, not base map
scan = ~sea_bm & ~land_bm & ~grid & (sat < 6)
scan = ndimage.binary_opening(scan, iterations=4)                     # drops the map's lettering
# grid lines inside the scan belong to it
scan = ndimage.binary_closing(scan | (grid & ndimage.binary_dilation(scan, iterations=4)), iterations=3)
lab, n = ndimage.label(scan); sz = ndimage.sum(np.ones_like(lab), lab, range(n + 1))
scan = lab == int(np.argmax(sz[1:]) + 1)
scan = ndimage.binary_fill_holes(scan)
# fill grid lines from the nearest scan pixel
gray = rgb.mean(-1)
bad = grid | ~scan
iy, ix = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
gray = gray[iy, ix]
# sea: the open water of the base map, out to ~220 px from the scan
d = ndimage.distance_transform_edt(~scan)
sea = sea_bm & (d < 420)
sea = ndimage.binary_closing(sea, iterations=3) & ~scan
# keep only sea connected to the scan's edge
# keep the open water only: pieces of map-grey inland are left out
lab, n = ndimage.label(sea); sz = ndimage.sum(np.ones_like(lab), lab, range(n + 1))
sea = np.isin(lab, [l for l in range(1, n + 1) if sz[l] > 20000])
foot = scan | sea
# smooth the outline of the added water so it reads as a soft band, not pixels
foot = ndimage.gaussian_filter(foot.astype(np.float32), 3) > 0.5
sea = foot & ~scan

NY = round(NX * H0 / W0); k = W0 / NX
rs = lambda a, m=Image.BILINEAR: np.asarray(Image.fromarray(a.astype(np.float32)).resize((NX, NY), m))
G = rs(gray, Image.LANCZOS).clip(0, 255)
SC = rs(scan) > 0.5; SE = rs(sea) > 0.5; FT = SC | SE
mpp = 3.3 * k                                                          # the grid squares are ~1 km
S = (G - 180.0) / 255.0 / 0.707
S[~SC] = 0
S = ndimage.gaussian_filter(S, 0.6)
a = math.radians(315); lx, ly = math.sin(a), -math.cos(a)
P = np.pad(S, ((0, NY), (0, NX)), mode='reflect')
u = np.fft.fftfreq(2 * NX)[None, :]; v = np.fft.fftfreq(2 * NY)[:, None]
den = u ** 2 + v ** 2; den[0, 0] = 1; Fp = np.fft.fft2(P)
Hf = (-1j * (lx * u + ly * v) * Fp) / (2 * np.pi * den); Hf[0, 0] = 0
raw = np.real(np.fft.ifft2(Hf))[:NY, :NX] * mpp
fine = raw - ndimage.gaussian_filter(raw, 600 / mpp)
# the land rises gently away from the sea (open water of the map and the bay): ~30 m over the first km
dsea = ndimage.distance_transform_edt(~SE) * mpp
ramp = 20 * (1 - np.exp(-dsea / 1200))
H = ramp + fine * 1.0
lvl = float(np.percentile(H[SC & (dsea < 40)], 20)) - 1.5
H[SE] = lvl
H = np.where(SC, np.maximum(H, lvl + 0.3), H)
hmin, hmax = float(H[FT].min()), float(H[FT].max())
Hn = np.clip((H - hmin) / (hmax - hmin), 0, 1)
Sd = (G - 180.0) / 255.0
rms = float(np.sqrt((Sd[SC] ** 2).mean())); gain = float(np.clip(0.15 / (rms + 1e-9), 1.0, 3.5))
shade = np.clip(0.52 + 0.95 * Sd * gain, 0.03, 1)
h12 = np.clip(np.round(Hn * 4095), 1, 4095).astype(np.uint32)
R = (np.clip(np.round(shade * 125), 2, 127) * 2).astype(np.uint8)
R[SE] = 0          # open sea
R[~FT] = 3         # outside the scan: nothing
Image.fromarray(np.dstack([R, (h12 >> 4).astype(np.uint8), ((h12 & 15) << 4).astype(np.uint8)]), 'RGB').save('s-09.png', optimize=True)
prev = np.dstack([(shade * 255).astype(np.uint8)] * 3); prev[SE] = (40, 90, 120); prev[~FT] = (255, 255, 255)
Image.fromarray(prev).save('prev.png')
print(json.dumps({'nx': NX, 'ny': NY, 'm_per_px': mpp, 'range_m': [hmin, hmax], 'sea %': float(SE.mean() * 100), 'void %': float((~FT).mean() * 100)}))
np.save('SC.npy', SC)
