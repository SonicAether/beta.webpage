"""Cut the window around the Vareler Schleuse out of EMODnet Bathymetry "1850 HRDTM Jade approach",
part 9 (1850_jade_v2_9.emo.zip, CC BY 4.0) and bin it to ~4 m; elevation = -depth.
usage: python3 scan_s10_cut.py 1850_jade_v2_9.emo.zip out.npy"""
import sys, zipfile, time, numpy as np, pandas as pd
ZIP, OUT = sys.argv[1], sys.argv[2]
LON0, LON1, LAT0, LAT1 = 8.150, 8.265, 53.380, 53.450
DX, DY = 0.00006, 0.00004
NX = int((LON1 - LON0) / DX) + 1; NY = int((LAT1 - LAT0) / DY) + 1
S = np.zeros(NY * NX); C = np.zeros(NY * NX)
z = zipfile.ZipFile(ZIP); name = [n for n in z.namelist() if n.endswith('.emo')][0]
for df in pd.read_csv(z.open(name), sep=';', header=None, usecols=[0, 1, 4], names=['x', 'y', 'd'], dtype=np.float64, chunksize=4_000_000, engine='c'):
    y = df['y'].values; x = df['x'].values
    m = (y < LAT1) & (y >= LAT0) & (x >= LON0) & (x < LON1)
    if m.any():
        k = ((LAT1 - y[m]) / DY).astype(np.int64) * NX + ((x[m] - LON0) / DX).astype(np.int64)
        S += np.bincount(k, weights=-df['d'].values[m], minlength=NY * NX); C += np.bincount(k, minlength=NY * NX)
    if y[-1] < LAT0 - 0.001: break
np.save(OUT, np.where(C > 0, S / np.maximum(C, 1), np.nan).astype(np.float32).reshape(NY, NX))
