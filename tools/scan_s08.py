"""Detail terrain for S-08 (Holmevatten, Bohusleden) from one LIDAR hillshade screenshot.
Located by fitting the OpenStreetMap outline of Holmevatten onto the lake in the middle of the scan
(1.8 m per scan px). Large forms from the 3" elevation model, fine relief integrated from the
hillshade (light from the north-west, ~45° high: flat ground is grey 181)."""
import json, math, sys
import numpy as np
from PIL import Image
from scipy import ndimage
SRC = '/mnt/user-data/attachments/fedef7e3-dda8-5218-a993-10271ea187b5/1247953d-image.png'
fit = json.load(open('fit.json')); s_m = fit['s']
OW = int(sys.argv[1]) if len(sys.argv) > 1 else 2497
FINE = float(sys.argv[2]) if len(sys.argv) > 2 else 1.2
g0 = np.asarray(Image.open(SRC).convert('L')).astype(np.float64)
SH, SW = g0.shape; OH = round(OW * SH / SW); k = SW / OW; mpp = s_m * k
g = np.asarray(Image.fromarray(g0.astype(np.float32)).resize((OW, OH), Image.LANCZOS), dtype=np.float64).clip(0, 255)
lake = np.asarray(Image.fromarray(np.load('flat.npy').astype(np.float32)).resize((OW, OH), Image.BILINEAR)) > 0.5

# scan px -> lat/lon
lat0, lon0 = 57.9974, 11.9785; kx = 111320 * math.cos(math.radians(lat0)); ky = 111320
pm = fit['pm']
def ll(x, y):  # scan px
    e = pm[0] + (x - fit['cx']) * s_m; n = pm[1] + (y - fit['cy']) * s_m
    return lat0 - n / ky, lon0 + e / kx
# elevation model (zoom-7 tile 68/38), heavily smoothed: it only gives the broad lie of the land
dem = np.load('dem.npy').astype(np.float64); T = dem.shape[0]; Z = 7
dsm = ndimage.gaussian_filter(dem, 3.0)
yy, xx = np.mgrid[0:OH, 0:OW].astype(np.float64)
la, lo = ll((xx + 0.5) * k, (yy + 0.5) * k)
tx = (lo + 180) / 360 * 2 ** Z; ty = (1 - np.arcsinh(np.tan(np.radians(la))) / math.pi) / 2 * 2 ** Z
D = ndimage.map_coordinates(dsm, [(ty - 38) * T, (tx - 68) * T], order=3, mode='nearest')

S = (g - 181.0) / 255.0 / 0.707
S[lake] = 0
S = ndimage.gaussian_filter(S, 0.6)
a = math.radians(315); lx, ly = math.sin(a), -math.cos(a)
P = np.pad(S, ((0, OH), (0, OW)), mode='reflect')
u = np.fft.fftfreq(2 * OW)[None, :]; v = np.fft.fftfreq(2 * OH)[:, None]
den = u ** 2 + v ** 2; den[0, 0] = 1; Fp = np.fft.fft2(P)
Hf = (-1j * (lx * u + ly * v) * Fp) / (2 * np.pi * den); Hf[0, 0] = 0
raw = np.real(np.fft.ifft2(Hf))[:OH, :OW] * mpp
cut = 300 / mpp
fine = (raw - ndimage.gaussian_filter(raw, cut)) * FINE
H = ndimage.gaussian_filter(D, cut * 0.5) + fine
print('fine std', round(float(fine.std()), 1), 'm  p99', round(float(np.percentile(np.abs(fine), 99)), 1), 'm')
lab, n = ndimage.label(lake)
for l in range(1, n + 1):
    m = lab == l; ring = ndimage.binary_dilation(m, iterations=4) & ~m
    lvl = np.percentile(H[ring], 30) - 0.3 if ring.any() else H[m].min(); H[m] = lvl
    dd = ndimage.distance_transform_edt(~m); near = (dd < 8) & ~m
    H = np.where(near, np.maximum(H, lvl + 0.08 * dd * mpp / 2), H)
hmin, hmax = float(H.min()), float(H.max())
Hn = (H - hmin) / (hmax - hmin)
gs = g + 0.6 * (g - ndimage.gaussian_filter(g, 1.3))
shade = np.clip((gs.clip(0, 255) / 255.0) ** 1.6 * 1.25, 0.03, 1)      # lifted contrast: flat grey 181 sits mid-tone
h12 = np.clip(np.round(Hn * 4095), 1, 4095).astype(np.uint32)
R = (np.clip(np.round(shade * 125), 2, 127) * 2).astype(np.uint8); R[lake] = 1
Image.fromarray(np.dstack([R, (h12 >> 4).astype(np.uint8), ((h12 & 15) << 4).astype(np.uint8)]), 'RGB').save('s-08.png', optimize=True)
nw = ll(0, 0); se = ll(SW, SH)
print(json.dumps({'w': OW, 'h': OH, 'm_per_px': mpp, 'km': [OW * mpp / 1000, OH * mpp / 1000], 'hmin': hmin, 'hmax': hmax, 'nw': nw, 'se': se,
                  'spot': [fit['rec'][0] / SW, fit['rec'][1] / SH]}))
np.save('H.npy', H)
