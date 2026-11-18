"""Naming a point between Ireland and Sweden, offline.
places.txt: towns from GeoNames (via lutangar/cities.json, CC BY 4.0), thinned to one per ~0.1° cell:
  lines "name|lat|lon|country"
seas.png: 0.05° grid over the area; 0 = land, k = index+1 into seas.json (Natural Earth marine areas, public domain)."""
import json, math
import numpy as np
from PIL import Image, ImageDraw
LON0, LON1, LAT0, LAT1 = -11.5, 20.5, 49.8, 66.5
OUT = '/home/claude/site/assets/geo/'
c = json.load(open('/home/claude/vendor/cities/cities.json'))
seen, rows = set(), []
for x in c:
    la, lo = float(x['lat']), float(x['lng'])
    if not (LAT0 - 0.5 <= la <= LAT1 + 0.5 and LON0 - 0.5 <= lo <= LON1 + 0.5): continue
    k = (round(la / 0.09), round(lo / (0.09 / math.cos(math.radians(la)))))
    if k in seen: continue
    seen.add(k); rows.append(f"{x['name']}|{la:.3f}|{lo:.3f}|{x['country']}")
open(OUT + 'places.txt', 'w').write('\n'.join(rows))
print('places', len(rows))

G = 0.05; W = round((LON1 - LON0) / G); H = round((LAT1 - LAT0) / G)
S = 4
def px(lon, lat): return ((lon - LON0) / G * S, (LAT1 - lat) / G * S)
im = Image.new('L', (W * S, H * S), 0); d = ImageDraw.Draw(im)
NE = '/home/claude/vendor/ne/geojson/'
names = []
feats = json.load(open(NE + 'ne_10m_geography_marine_polys.geojson'))['features']
# large water bodies first, small ones (fjords, bays) drawn over them
def area(f):
    g = f['geometry']; polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    return sum(abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(p[0], p[0][1:]))) for p in polys)
feats = [f for f in feats if f['geometry'] and f['properties'].get('name')]
for f in sorted(feats, key=lambda f: -area(f)):
    g = f['geometry']; polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    hit = [p for p in polys if any(LON0 - 3 < q[0] < LON1 + 3 and LAT0 - 3 < q[1] < LAT1 + 3 for q in p[0][::5])]
    if not hit: continue
    names.append(f['properties']['name']); k = len(names)
    for p in hit: d.polygon([px(*q[:2]) for q in p[0]], fill=k)
sea = np.asarray(im)
land = Image.new('L', (W * S, H * S), 0); dl = ImageDraw.Draw(land)
for fn in ['ne_10m_land.geojson', 'ne_10m_minor_islands.geojson']:
    for f in json.load(open(NE + fn))['features']:
        g = f['geometry']; polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        for p in polys:
            if not any(LON0 - 3 < q[0] < LON1 + 3 and LAT0 - 3 < q[1] < LAT1 + 3 for q in p[0][::5]): continue
            dl.polygon([px(*q[:2]) for q in p[0]], fill=255)
            for h in p[1:]: dl.polygon([px(*q[:2]) for q in h], fill=0)
landm = np.asarray(land.resize((W, H), Image.BOX)) > 127
# sea cells without a named area take the nearest named one
from scipy import ndimage
seaS = np.asarray(Image.fromarray(sea).resize((W, H), Image.NEAREST)).copy()
unnamed = (~landm) & (seaS == 0)
if unnamed.any():
    _, (iy, ix) = ndimage.distance_transform_edt(seaS == 0, return_indices=True)
    seaS[unnamed] = seaS[iy, ix][unnamed]
seaS[landm] = 0
Image.fromarray(seaS.astype(np.uint8)).save(OUT + 'seas.png', optimize=True)
json.dump(dict(names=names, lon0=LON0, lat1=LAT1, step=G, w=W, h=H), open(OUT + 'seas.json', 'w'))
print('seas', len(names), W, H, 'land %', round(landm.mean() * 100, 1))
