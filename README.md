# topo-toy

SIMP topology optimization in a single HTML file â no install, no license server, runs in your browser.

**Live:** https://doishy-doish.github.io/topo-toy/

## verified, not vibes

| preset | grid | uniform-density tip | check | optimizer |
|---|---|---|---|---|
| cantilever | 120x20 | FE 880.2 vs Euler-Bernoulli 864.0 â 1.88% off (CG 402 it) | beam theory | 7041 â ~1570 in 12 OC steps |
| bridge | 120x20 | FE 36.44 (CG 328 it) | grown truss is the test | 291.5 â 53.0 in 20 steps |
| mbb | 120x20 | FE 62.94 (CG 578 it) | grown truss is the test | 503.5 â 114.5 in 20 steps |
| lbracket | 60x60, top-right void | FE 49.86 (CG 470 it) | grown truss is the test | 398.8 â 61.9 in 15 steps |

cantilever-3d: 40x12x6 hex mesh, FE tip 26.05 vs beam theory 24.69 â 5.49% off (CG 161 it), compliance 208.8 â 52.8 in 10 steps.

Method: Sigmund SIMP, Q4 plane stress, Jacobi-CG solve, sensitivity filter, Optimality Criteria update. Zero dependencies.

## stages

- [x] Stage 0: 2D SIMP, presets, verified 1.88% vs beam theory.
- [x] Stage 1: paint-your-own problem â walls, loads, holes on the grid. Same solver, same contract.
- [x] Stage 2: arbitrary geometry â STL upload (binary+ASCII) â XY silhouette mask; export .msh (Gmsh) + .vtk (ParaView) alongside SVG/PNG. Verified: 10x4 plate keeps exactly 810/2400 cells.
- [x] Stage 3: 3D hex SIMP (Gauss-derived 24x24 Ke) 40x12x6, slice viewer + max projection, printable STL export.
- [x] Stage 4: validation corpus â cantilever + bridge + MBB + L-bracket locked contracts (`bench/reference*.json`), differential-tested against the C++ lineage on every push; headless Playwright runs every preset on every push.

## engine: one C++ core, two targets

`topo-cpp/wasm/sim.cpp` is the unified SIMP core (2D corpus + 3D cantilever) with a C API.
CI compiles it twice: natively (differential-tested against every bench contract) and with
Emscripten to `build/sim.js` (SINGLE_FILE), smoke-tested in node. That exact binary ships as
`vendor/sim-wasm.js` and runs the in-page solves â the stats line says `engine:wasm` when it
does. If the vendor file is missing (offline single-file use), the page falls back to the
identical built-in JS solver (`engine` tag absent). Same math, same contracts, no drift.

- [x] Stage 5: one C++ core, two targets (below) - the page solves on wasm
  (`engine:wasm` in the stats line) with an identical built-in JS fallback.
- [x] Pro controls (opt-in, default-OFF = legacy path bit-identical): Heaviside
  projection (beta/eta) + density filter (chain-ruled sensitivities), penal
  continuation p=1->3, per-element von Mises stress readout (display-only,
  never feeds the OC update), history sparkline + CSV export.
- [x] Workbench UI: Ansys-style light theme - menu bar, Solve ribbon, outline
  tree, Details-of property grid, Messages pane, probe readout, unit selector.
  Three switchable result fields (density / deformation / von Mises stress),
  each with legend + min/max/average. Jet-contour rendering with faint mesh
  edges. Canvas capped to the viewport.
- [x] Memguard: explicit memory accounting on both layers (C++ memtrash +
  in-page MemTrash, 30 s shed patrol, MEM readout on the stats line).
  Permanent sim buffers are tracked, never patched; over-budget growth trips
  a check and auto-sheds.

## itch.io

Auto-pushed by CI to `doishy-doish/toposys:html5` (butler, bundle =
index.html + vendor/). Dashboard-side settings (not in this repo): embed in
page, auto-start ON, fullscreen button ON, scrollbars OFF, mobile-friendly ON,
portrait frame 800x1000, landscape frame 1000x800, SharedArrayBuffer OFF.
The store page is still a draft - publishing it is a dashboard click.

## lineage

C++ ports and pro reference live in `topo-cpp` (same bench contracts,
differential-tested every push). Pro survey forks: `rodin` (C++20 FEM,
BSL-1.0) and `topopt` (Python, MIT) - read-only references, zero-dep
re-implementations only.
