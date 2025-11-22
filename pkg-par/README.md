# CMA-ES for WebAssembly

[![Pages](https://img.shields.io/badge/GitHub%20Pages-live-22c55e)](https://dicklesworthstone.github.io/wasm_cmaes/examples/viz-benchmarks.html)
[![Rust](https://img.shields.io/badge/Rust-✓-dea584)](https://www.rust-lang.org/)
[![wasm-pack](https://img.shields.io/badge/wasm--pack-web-blueviolet)](https://github.com/rustwasm/wasm-pack)
[![License](https://img.shields.io/badge/license-MIT%20%2F%20Apache--2.0-lightgrey)](LICENSE-MIT)

Live demo → https://dicklesworthstone.github.io/wasm_cmaes/examples/viz-benchmarks.html

## What this is
Rust CMA-ES compiled to WebAssembly with a friendly JS/TS API, plus a visual playground (D3 + Tailwind + Three.js) and a vanilla-JS baseline for speed comparisons.

## What’s new (2025-11)
- **Covariance model toggle**: auto / full / separable / limited-memory, with HUD deltas across runs.
- **Noise-aware mode**: robust sampling (adaptive, multi-sample) and noisy-run labeling.
- **Constraint handling**: penalty (augmented), projection, and resample-with-cap strategies.
- **Multi-run comparisons**: overlay prior runs, pin/compare, PCA scatter (dim>2), and parcoords for λ/σ/cond/best.
- **Presets & sharing**: curated + recent presets; config URLs include bounds/noise/model/constraints.
- **Onboarding**: quickstart carousel, learn-mode annotations, glossary of λ/σ/bounds/condition.

## Why CMA-ES (30-sec crash)
- Samples λ candidates from a multivariate normal around a mean.
- Ranks candidates, updates mean + covariance using weighted best μ.
- Adapts step size via evolution path (`sigma`); supports full/diagonal/limited-memory covariance.
- Stops on: max evals, ftarget, ill-conditioning, tolFun, tolX.

### Architecture
```mermaid
flowchart LR
  A[JS/TS] -->|batch API / functions| B[wasm_bindgen glue]
  B --> C[Engines: full / sep / lm]
  C --> D[LCG RNG + SIMD]
  C --> E[Rayon (optional)]
  B --> F[serde_wasm_bindgen (state ser/de)]
```

## Bundles
- `pkg/` — sequential, name `cmaes_wasm`.
- `pkg-par/` — Rayon + SIMD (`+simd128`), name `cmaes_wasm-par` (avoids npm collision).

## Quick start (local, no bundler)
```bash
python -m http.server 8000
# open http://localhost:8000/examples/viz-benchmarks.html
```

Minimal use in JS:
```ts
import init, { fmin } from "./pkg/cmaes_wasm.js";
await init();
const res = fmin(new Float64Array([3, -2]), 0.8, (x) => x[0]*x[0] + x[1]*x[1]);
console.log(res.best_f, res.best_x());
```

## Building both bundles
```bash
scripts/build-all.sh
# Env knobs: TOOLCHAIN=nightly (default), WASM_PACK=wasm-pack, RUSTFLAGS_PAR="-C target-feature=+simd128"
```
Script cleans `pkg/` and `pkg-par/`, builds parallel first (then renames its package.json), then builds sequential.

### True parallel in browsers (optional)
```bash
export RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals,+simd128"
wasm-pack build --target bundler --features parallel --out-dir pkg-par
# In JS: await initThreadPool(n); // from wasm-bindgen-rayon
```
Without atomics+pool, Rayon runs single-threaded even for the parallel build.

## Runner helper (batch API)
```ts
import { runCmaes } from "./cmaes_runner";
const result = await runCmaes(new Float64Array([0,0]), 0.2, (x)=>x[0]*x[0]+x[1]*x[1]);
```

## Visual demos
- `examples/viz-benchmarks.html` — D3 + Tailwind + Three.js dashboard: log-loss plot + 3D surface (orbit controls), animated candidates/ellipse, timeline scrub/playback, PCA scatter (dim > 2), parcoords for run stats. Controls: λ, σ, seed, iters, bounds, noise (samples/adaptive + “noisy objective”), covariance model (auto/full/sep/lm), constraint strategy (penalty/project/resample with cap/weight), race mode (WASM vs JS), custom objective editor, presets & sharing. Benchmarks: Sphere, Rastrigin, Ackley, Griewank, Schwefel, Levy, Zakharov, Alpine N1, Bukin N.6, custom. Onboarding: quickstart carousel, learn-mode overlay badges, glossary, pinned/compare run HUD deltas, mobile sheet + mini HUD.
- `examples/simple-sequential.html` — minimal sphere with `pkg/`.
- `examples/simple-parallel.html` — Rosenbrock with `pkg-par/`.
- Root `index.html` redirects to the viz.

## Benchmarks in Rust tests
`cargo test --lib -p cmaes_wasm` covers: Rosenbrock, Rastrigin, Ackley, Griewank, Schwefel.

## Performance choices
- SIMD (`+simd128`) for wasm32; scalar fallback elsewhere.
- Parallel optional (feature `parallel`).
- Deterministic LCG RNG with seed.
- Batch API minimizes JS↔WASM crossings.
- `cov_matrix()` exported from Rust for fast visualization of full covariance.

## Deployment (GitHub Pages)
- One-shot: `scripts/deploy.sh "chore: deploy"` (builds, stages, commits if needed, pushes to origin main; enables Pages via `gh` if available).
- Pages URL: https://dicklesworthstone.github.io/wasm_cmaes/

## Publishing to npm
- `pkg/` → `cmaes_wasm`.
- `pkg-par/` → `cmaes_wasm-par`.

## Project layout
- `src/lib.rs` – optimizer, wasm bindings, tests.
- `index.d.ts` – TS surface.
- `cmaes_runner.ts` – browser-friendly runner.
- `scripts/build-all.sh` – dual-build helper.
- `scripts/deploy.sh` – build + stage + commit + push + enable Pages (gh CLI required for Pages step; commits all staged changes).
- `examples/` – HTML demos & visualizations.
- `pkg/`, `pkg-par/` – generated bundles (tracked for Pages).

## Contributing & testing
- Run `cargo test --lib -p cmaes_wasm`.
- For visuals, serve locally as above.

## Licensing
Dual MIT OR Apache-2.0 (`LICENSE-MIT`, `LICENSE-APACHE`).
