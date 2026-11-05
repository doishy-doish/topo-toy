# topo-toy

SIMP topology optimization in a single HTML file — no install, no license server, runs in your browser.

**Live:** https://doishy-doish.github.io/topo-toy/

## verified, not vibes

| preset | grid | uniform-density tip | check | optimizer |
|---|---|---|---|---|
| cantilever | 120x20 | FE 880.2 vs Euler-Bernoulli 864.0 → 1.88% off (CG 402 it) | beam theory | 7041 → ~1570 in 12 OC steps |
| bridge | 120x20 | FE 36.44 (CG 328 it) | grown truss is the test | 291.5 → 53.0 in 20 steps |
| mbb | 120x20 | FE 62.94 (CG 578 it) | grown truss is the test | 503.5 → 114.5 in 20 steps |
| lbracket | 60x60, top-right void | FE 49.86 (CG 470 it) | grown truss is the test | 398.8 → 61.9 in 15 steps |

cantilever-3d: 40x12x6 hex mesh, FE tip 26.05 vs beam theory 24.69 → 5.49% off (CG 161 it), compliance 208.8 → 52.8 in 10 steps.

Method: Sigmund SIMP, Q4 plane stress, Jacobi-CG solve, sensitivity filter, Optimality Criteria update. Zero dependencies.

## stages

- [x] Stage 0: 2D SIMP, presets, verified 1.88% vs beam theory.
- [x] Stage 1: paint-your-own problem — walls, loads, holes on the grid. Same solver, same contract.
- [x] Stage 2: arbitrary geometry — STL upload (binary+ASCII) → XY silhouette mask; export .msh (Gmsh) + .vtk (ParaView) alongside SVG/PNG. Verified: 10x4 plate keeps exactly 810/2400 cells.
- [x] Stage 3: 3D hex SIMP (Gauss-derived 24x24 Ke) 40x12x6, slice viewer + max projection, printable STL export.
- [x] Stage 4: validation corpus — cantilever + bridge + MBB + L-bracket locked contracts (`bench/reference*.json`), differential-tested against the C++ lineage on every push; headless Playwright runs every preset on every push.

## engine: one C++ core, two targets

`topo-cpp/wasm/sim.cpp` is the unified SIMP core (2D corpus + 3D cantilever) with a C API.
CI compiles it twice: natively (differential-tested against every bench contract) and with
Emscripten to `build/sim.js` (SINGLE_FILE), smoke-tested in node. That exact binary ships as
`vendor/sim-wasm.js` and runs the in-page solves — the stats line says `engine:wasm` when it
does. If the vendor file is missing (offline single-file use), the page falls back to the
identical built-in JS solver (`engine` tag absent). Same math, same contracts, no drift.
