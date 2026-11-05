# topo-toy

SIMP topology optimization in a single HTML file — no install, no license server, runs in your browser.

**Live:** https://doishy-doish.github.io/topo-toy/

## verified, not vibes

- Cantilever benchmark (120x20 Q4 grid, uniform density): FE tip deflection **880.2** vs Euler-Bernoulli **864.0** → **1.88% off** (CG, 402 iters).
- Optimizer: compliance 7041 → ~1570 in 12 OC steps from 50% volume.
- Presets: cantilever + bridge. Exports: SVG contour (laser-cutter strokes) + PNG.

Method: Sigmund SIMP, Q4 plane stress, Jacobi-CG solve, sensitivity filter, Optimality Criteria update. Zero dependencies.
