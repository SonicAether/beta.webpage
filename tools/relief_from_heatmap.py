"""Topographic heatmap -> height field -> recoloured in the palette of the home image.
Input: a hypsometric colour map (cyan valleys .. green .. yellow .. red .. brown .. white peaks)."""
import numpy as np, sys
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree
SRC = sys.argv[1]; OUT = '/home/claude/build/relief/'
a = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float32)
H_, W_ = a.shape[:2]
# legend / scale bar in the lower left corner: fill from the nearest pixel outside it
mask = np.zeros((H_, W_), bool); mask[H_ - 44:, :175] = True
iy, ix = ndimage.distance_transform_edt(mask, return_distances=False, return_indices=True)
a = a[iy, ix]

# the colour scale of the source, low to high
SCALE = [[176, 236, 222], [190, 242, 200], [228, 247, 175], [187, 221, 125], [130, 198, 89], [94, 185, 70], [62, 161, 56],
         [29, 137, 57], [61, 136, 62], [107, 149, 58], [151, 160, 52], [193, 171, 46], [237, 177, 39], [233, 145, 30],
         [217, 115, 24], [201, 88, 19], [185, 65, 15], [169, 44, 12], [155, 27, 9], [140, 12, 7], [124, 3, 5],
         [116, 14, 7], [113, 26, 9], [108, 40, 14], [116, 63, 34], [132, 85, 59], [148, 113, 94], [165, 146, 137],
         [183, 182, 182], [214, 214, 214], [244, 244, 244]]
S = np.array(SCALE, np.float32)
seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(S, axis=0), axis=1))]
n = 3000; tt = np.linspace(0, seg[-1], n)
dense = np.stack([np.interp(tt, seg, S[:, k]) for k in range(3)], 1)
param = np.linspace(0, 1, len(SCALE))
tpar = np.interp(tt, seg, param)                    # equal height steps between the scale's colours
d, idx = cKDTree(dense).query(a.reshape(-1, 3))
h = tpar[idx].reshape(H_, W_)
h = ndimage.median_filter(h, 3)
h = ndimage.gaussian_filter(h, 1.4)
np.save(OUT + 'height.npy', h.astype(np.float32))
print('fit error mean', d.mean().round(1), 'h range', h.min().round(3), h.max().round(3))

# palette of the home image: night violet .. blue .. magenta .. pale pink
P = [(0.00, (10, 6, 24)), (0.10, (39, 17, 73)), (0.26, (39, 26, 124)), (0.40, (57, 73, 175)), (0.50, (50, 108, 202)),
     (0.60, (115, 69, 159)), (0.70, (169, 84, 168)), (0.80, (217, 131, 193)), (0.90, (235, 197, 224)), (1.00, (250, 236, 242))]
pt = np.array([p[0] for p in P]); pc = np.array([p[1] for p in P], np.float32)
def palette(t): return np.stack([np.interp(t, pt, pc[:, k]) for k in range(3)], -1)
# spread the heights evenly over the palette (partial histogram equalisation)
q = np.searchsorted(np.sort(h.ravel()), h.ravel()).reshape(h.shape) / h.size
t = 0.55 * q + 0.45 * (h - h.min()) / (h.max() - h.min())
np.save(OUT + 't.npy', t.astype(np.float32))
gy, gx = np.gradient(ndimage.gaussian_filter(h, 1.0))
shade = np.clip(0.78 + 26 * (gx + gy) / np.sqrt(2), 0.35, 1.25)   # lit from the north-west
col = np.clip(palette(t) * shade[..., None], 0, 255).astype(np.uint8)
Image.fromarray(col).save(OUT + 'heatmap_home.png', optimize=True)
Image.fromarray(col).resize((W_ // 2, H_ // 2), Image.LANCZOS).save(OUT + 'heatmap_home_small.png')
# relief texture for the 3D page: R = palette position t, G+B = 12-bit height
h12 = np.clip(np.round((h - h.min()) / (h.max() - h.min()) * 4095), 0, 4095).astype(np.uint32)
tt8 = np.clip(np.round(t * 255), 0, 255).astype(np.uint8)
sh8 = np.clip(np.round((shade - 0.35) / 0.9 * 255), 0, 255).astype(np.uint8)
im = Image.fromarray(np.dstack([tt8, (h12 >> 4).astype(np.uint8), ((h12 & 15) << 4 | (sh8 >> 4)).astype(np.uint8)]), 'RGB')
im.resize((1245, 647), Image.BILINEAR).save('/home/claude/site/assets/relief.png', optimize=True)
