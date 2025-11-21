CMA-ES for WebAssembly
======================

Purpose
- Rust implementation of CMA-ES compiled to WebAssembly with a clean JS/TS API, plus a visual playground to compare against a vanilla JS baseline.

Live demo (GitHub Pages): https://dicklesworthstone.github.io/wasm_cmaes/examples/viz-benchmarks.html

Bundles
- `pkg/` — sequential, smallest, name `cmaes_wasm`.
- `pkg-par/` — Rayon + SIMD (`+simd128`), renamed to `cmaes_wasm-par` to avoid npm clashes.

Architecture highlights
- Core optimizer in `src/lib.rs`: full/separable/limited-memory engines, batch API (`WasmCmaes`), single-shot APIs (`fmin`, `fmin_restarts`, `fmin_builtin`).
- TS surface: `index.d.ts` exposes types; `cmaes_runner.ts` wraps batch calls for async browser stepping.
- Visual demos in `examples/` use native ES modules; no bundler needed for local testing.

Performance considerations
- SIMD on wasm32 via `+simd128`; guarded scalar fallback.
- Parallel feature uses Rayon; true multithreading in browsers requires atomics and `wasm-bindgen-rayon` thread-pool init (see below).
- Deterministic RNG (LCG) with configurable seed for repeatable runs.
- Batch API minimizes JS↔WASM calls by exchanging flat arrays.

Building (both bundles)
```bash
scripts/build-all.sh
# Env knobs: TOOLCHAIN=nightly (default), WASM_PACK=wasm-pack, RUSTFLAGS_PAR="-C target-feature=+simd128"
```
Script cleans `pkg/` and `pkg-par/`, builds parallel first, renames its package.json, then builds sequential.

True parallel in browsers (optional)
```bash
export RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals,+simd128"
wasm-pack build --target bundler --features parallel --out-dir pkg-par
# then in JS: await initThreadPool(n); (from wasm-bindgen-rayon)
```
Without atomics+pool, Rayon runs single-threaded even in the parallel bundle.

Using in JS/TS
```ts
// Sequential
import init, { fmin } from "./pkg/cmaes_wasm.js";
// Parallel
import initPar, { fmin as fminPar } from "./pkg-par/cmaes_wasm.js";

await init();
const res = fmin(new Float64Array([3, -2]), 0.8, (x) => x[0]*x[0]+x[1]*x[1]);
```
Batch loop via runner:
```ts
import { runCmaes } from "./cmaes_runner";
const result = await runCmaes(new Float64Array([0,0]), 0.2, (x)=>x[0]*x[0]+x[1]*x[1]);
```

Benchmarks & visualization
- `examples/viz-benchmarks.html`: Tailwind + D3 dashboard (log loss + scatter) with controls for λ, σ, seed, max iters.
- Benchmarks: Sphere, Rastrigin, Ackley, Griewank, Schwefel, Levy, Zakharov, Alpine N1, Bukin N.6.
- Includes a headless baseline vanilla JS (μ+λ)-style ES to compare speed/quality vs WASM CMA-ES; timing displayed inline.
- Other demos: `examples/simple-sequential.html`, `examples/simple-parallel.html`.
Run locally: `python -m http.server 8000` then open the HTML pages.

CMA-ES basics (crash course)
- Samples λ candidates from a multivariate normal around mean; updates mean and covariance using weighted best μ samples.
- Adapts step size (`sigma`) via evolution path; supports full, diagonal, and limited-memory covariance models.
- Stop flags: max evals, ftarget reached, condition number blow-up, tolFun, tolX.

Testing
- Native unit tests (`cargo test --lib -p cmaes_wasm`) cover tough benchmarks: Rosenbrock, Rastrigin, Ackley, Griewank, Schwefel.
- Visual demo provides informal regression via live plots.

Publishing
- `pkg/` → npm `cmaes_wasm`.
- `pkg-par/` → npm `cmaes_wasm-par`.

Project layout
- `src/lib.rs` – optimizer, wasm bindings, tests.
- `index.d.ts` – TS surface.
- `cmaes_runner.ts` – browser-friendly runner.
- `scripts/build-all.sh` – dual-build helper.
- `examples/` – HTML demos & visualizations.
- `pkg/`, `pkg-par/` – generated bundles (not tracked in git typically).

Licensing
- Dual MIT OR Apache-2.0 (`LICENSE-MIT`, `LICENSE-APACHE`).
