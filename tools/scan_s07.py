"""Detail terrain for S-07 (Sølen / Engerdal) from two stitched LIDAR hillshade screenshots.
Large forms come from the real elevation model (viewfinderpanoramas 3", ~57 m here), located on the
scans by matching (scan top-left at DEM px X0, Y0; F scan px per DEM px). The fine form comes from
integrating the hillshade itself (Frankot-Chellappa), scaled to metres by regression against the
elevation model in the band both share. Output: same encoding as the other scans
(R = shade, 1 = lake; G + high nibble of B = 12-bit height), plus metadata for the page."""
import json, math, sys
import numpy as np
from PIL import Image
from scipy import ndimage

X0, Y0, F = 2588.0, 1937.0, 6.0           # georeference (see the matching in this folder)
OW = int(sys.argv[1]) if len(sys.argv) > 1 else 1800
OUT = sys.argv[2] if len(sys.argv) > 2 else 's-07.png'
M = np.load('mosaic.npy').mean(-1); LK = np.load('lakes.npy')
SH, SW = M.shape; OH = round(OW * SH / SW); k = SW / OW          # scan px per output px
mpp_scan = 56.718 / F                                             # metres per scan px (~9.6)
mpp = mpp_scan * k                                                # metres per output px

g = np.asarray(Image.fromarray(M.astype(np.float32)).resize((OW, OH), Image.LANCZOS), dtype=np.float64).clip(0, 255)
lake = np.asarray(Image.fromarray(LK.astype(np.float32)).resize((OW, OH), Image.BILINEAR)) > 0.5

# 1 · elevation model, smoothed against its 20 m steps, sampled on the output grid
dem = np.load('dem.npy').astype(np.float64)
dsm = ndimage.gaussian_filter(dem, 1.6)
yy, xx = np.mgrid[0:OH, 0:OW].astype(np.float64)
D = ndimage.map_coordinates(dsm, [Y0 + (yy + 0.5) * k / F, X0 + (xx + 0.5) * k / F], order=3, mode='nearest')

# 2 · the scan integrated. The flat grey (228 of 255) says the light stands ~64° high, so a slope
#     towards the light of s brightens by ~0.44·s: that gives the fine relief in metres directly.
FINE = float(__import__('os').environ.get('FINE', 1.3))     # a little more than real, for a plastic read
flatv = 228.4
S = (g - flatv) / 255.0 / 0.44
S[lake] = 0
S = ndimage.gaussian_filter(S, 0.6)
a = math.radians(315); lx, ly = math.sin(a), -math.cos(a)          # towards the light, y down
P = np.pad(S, ((0, OH), (0, OW)), mode='reflect')
u = np.fft.fftfreq(2 * OW)[None, :]; v = np.fft.fftfreq(2 * OH)[:, None]
den = u ** 2 + v ** 2; den[0, 0] = 1; Fp = np.fft.fft2(P)
Hf = (-1j * (lx * u + ly * v) * Fp) / (2 * np.pi * den); Hf[0, 0] = 0
raw = np.real(np.fft.ifft2(Hf))[:OH, :OW] * mpp                    # metres
cut = 220 / mpp                                                    # above ~220 m the elevation model speaks
fine = (raw - ndimage.gaussian_filter(raw, cut)) * FINE
H = ndimage.gaussian_filter(D, 0.5 * cut) + fine
print('fine relief: std', round(float(fine.std()), 1), 'm, p99', round(float(np.percentile(np.abs(fine), 99)), 1), 'm')

# lakes: level, a little below their shore
lab, n = ndimage.label(lake)
for l in range(1, n + 1):
    m = lab == l; ring = ndimage.binary_dilation(m, iterations=4) & ~m
    lvl = np.percentile(H[ring], 35) - 0.3 if ring.any() else H[m].min(); H[m] = lvl   # level with the shore, not sunk
    dd = ndimage.distance_transform_edt(~m); near = (dd < 6) & ~m
    H = np.where(near, np.maximum(H, lvl + 0.6 * dd), H)

hmin, hmax = float(H.min()), float(H.max())
Hn = (H - hmin) / (hmax - hmin)
# shade: the scan's own light, with a little more depth in the darks
gs = g + 0.7 * (g - ndimage.gaussian_filter(g, 1.3))           # a little crisper: every ridge and runnel
shade = np.clip((gs.clip(0, 255) / 255.0) ** 1.15 * 1.02, 0.03, 1)
h12 = np.clip(np.round(Hn * 4095), 1, 4095).astype(np.uint32)
R = (np.clip(np.round(shade * 125), 2, 127) * 2).astype(np.uint8); R[lake] = 1
Image.fromarray(np.dstack([R, (h12 >> 4).astype(np.uint8), ((h12 & 15) << 4).astype(np.uint8)]), 'RGB').save(OUT, optimize=True)

# where things are: geographic corners of the scan, for placing the recording
Z = 7; T = 2600
lon = lambda x: (67 + x / T) / 2 ** Z * 360 - 180
lat = lambda y: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (35 + y / T) / 2 ** Z))))
meta = {'w': OW, 'h': OH, 'm_per_px': mpp, 'width_km': OW * mpp / 1000, 'height_km': OH * mpp / 1000,
        'hmin': hmin, 'hmax': hmax, 'nw': [lat(Y0), lon(X0)], 'se': [lat(Y0 + SH / F), lon(X0 + SW / F)]}
json.dump(meta, open(OUT.replace('.png', '.json'), 'w'), indent=1)
print(json.dumps(meta))
np.save('H.npy', H)
