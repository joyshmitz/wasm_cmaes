# Changelog

All notable changes to [wasm_cmaes](https://github.com/Dicklesworthstone/wasm_cmaes) are documented here, organized by capability rather than diff order.

This project has no tagged releases or GitHub Releases. The crate version has been `0.2.0` since the initial commit ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a)). All work lives on the `main` branch.

Repository: <https://github.com/Dicklesworthstone/wasm_cmaes>
Live demo: <https://dicklesworthstone.github.io/wasm_cmaes/examples/viz-benchmarks.html>

---

## Unreleased (v0.2.0)

**Span:** 2025-11-21 to 2026-02-22 (76 commits)
**HEAD:** [`2802cbe`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/2802cbe785e0c06b0447c890ba1bebb5685417c3)

---

### 1. Optimization engine (Rust core)

The entire CMA-ES engine lives in `src/lib.rs` (2300+ lines) and has been present since the initial commit, with one API addition (`cov_matrix`) and quality improvements afterward.

#### Algorithm implementation

- Full CMA-ES with ask/tell interface, weighted recombination, cumulative step-size adaptation (CSA), and evolution path tracking ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- Three covariance models with automatic selection: **Full** (eigendecomposition via nalgebra, dim < 20), **Separable** (diagonal, dim 20-200), **Limited-memory** (low-rank, dim >= 200) ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- IPOP and BIPOP restart strategies for escaping local minima in multi-modal landscapes ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- Multiple termination criteria: max evaluations, fitness target (`ftarget`), ill-conditioning detection, tolerance thresholds (`tolFun`, `tolX`) ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))

#### Constraint handling

- Penalty method (augmented Lagrangian) for soft constraint enforcement ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- Projection method (clamp to bounds) for hard feasibility ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- Resample method (reject infeasible candidates with retry limit) ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))

#### Noise-aware optimization

- Adaptive multi-sample evaluation for robust fitness estimates under noise ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- Automatic sigma expansion for noisy landscapes ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))

#### Performance

- SIMD acceleration via `wasm32::simd128` for dot products, norms, and matrix-vector operations with automatic scalar fallback on non-SIMD targets ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- Optional Rayon parallelism behind `parallel` feature flag for multi-core candidate generation ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- Deterministic LCG random number generator with configurable seed for reproducible runs ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))

#### State serialization

- Save/restore full optimizer state via `serde` + `serde-wasm-bindgen` for checkpointing, sharing, and resuming long-running optimizations ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))

#### Post-initial API additions

- **`WasmCmaes::cov_matrix() -> Float64Array`**: returns the current covariance matrix (sigma^2 * C) flattened row-major; separable/limited-memory engines return zero off-diagonal entries ([`81f6686`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/81f6686ce3e46f2925cf93966f7943d16c928b9b))

#### Code quality improvements

- Remove unnecessary `.map_err(|e| e)` calls flagged by clippy `map_identity` lint ([`7775614`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/7775614071dcea98eb6c48d0e459ac995e42c7c4))
- Convert indexed loops to iterators where appropriate; add crate-level `#![allow(clippy::needless_range_loop)]` for numerical code clarity ([`7775614`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/7775614071dcea98eb6c48d0e459ac995e42c7c4))
- Harden Rust core with panic-safe DOM rendering paths ([`0c80f22`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/0c80f224a6ed087021e1d726917609a510b02f3e))

---

### 2. JavaScript/TypeScript API

All JS/TS-facing APIs were present from the initial commit.

#### High-level functions

- `fmin(xstart, sigma, objective, options?)` -- convenience function that runs CMA-ES to completion and returns `FminResult` ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- `fmin_restarts(xstart, sigma, objective, options?)` -- runs with IPOP/BIPOP restart strategy, returns best result across restarts ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- `fmin_builtin(benchmarkId, xstart, sigma, options?)` -- runs against built-in benchmark functions (Sphere, Rastrigin, Ackley, etc.) ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))

#### Class API

- `WasmCmaes` class with `ask()`, `tell()`, `ask_flat()`, `tell_flat()`, `stop_status()`, `result()`, `to_json_state()` ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- `cov_matrix()` method added for visualization support ([`81f6686`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/81f6686ce3e46f2925cf93966f7943d16c928b9b))
- `wasm_cmaes_from_state(state)` -- restore optimizer from serialized JSON checkpoint ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))

#### Batch API

- `ask_flat()` returns all lambda candidates in a single `Float64Array` to minimize JS-to-WASM boundary crossings (2-5x faster than individual `ask()` calls for large populations) ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))

#### Supporting files

- TypeScript declarations in `index.d.ts` with full `CmaesOptions`, `FminResult`, `StopStatus`, `WasmCmaes` types ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- `CmaesRunner` helper (`cmaes_runner.ts`) for event-driven optimization with `onIteration`, `onImprovement`, `onTermination` callbacks ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))

---

### 3. WASM build and packaging

#### Dual-bundle strategy

- `pkg/` (sequential): `--target web`, no Rayon, maximum browser compatibility ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- `pkg-par/` (parallel): `--target web` with Rayon, requires SharedArrayBuffer/atomics and COOP/COEP headers ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- Both bundles committed to the repo for zero-build GitHub Pages serving ([`ef95eea`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/ef95eea8666218f38565c0933a3c12f6510aeb62))

#### Target switch: bundler to web

- Switched both bundles from `--target bundler` to `--target web` for direct browser loading without a bundler; sanitized custom objective function loader for the new module format ([`745b3cd`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/745b3cdced7ac65e21f44a98f1e0767ed05df0e1))

#### Build scripts

- `scripts/build-all.sh`: cleans `pkg/` and `pkg-par/`, builds parallel bundle first (with SIMD + Rayon), then sequential ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- `scripts/deploy.sh`: build + stage + commit + push + enable GitHub Pages via `gh` CLI ([`a3214f0`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a3214f0a0f338e776c821cf92834d4a8a8e71b1f))
- WASM package rebuild with updated README embedded in bundles ([`22e3ceb`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/22e3ceb300f53ae5fe521b07c1be4ebc0721b34c))

#### WASM target configuration

- Add `.cargo/config.toml` with `getrandom_backend="wasm_js"` to resolve `getrandom` compilation for wasm32 targets ([`0f89d09`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/0f89d096aaaae81cee963b22d61b05447c074799))

---

### 4. Interactive visualization dashboard

The visualization story has three phases: initial D3 dashboard, an ambitious "CMA-ES Studio" build-up, then a deliberate revert to a leaner "Benchmark Gallery" design with targeted fixes.

#### Phase 1: Foundation (2025-11-21)

- D3.js convergence plot with logarithmic fitness axis and animated candidate scatter ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- Interactive benchmark function selector: Sphere, Rastrigin, Ackley, Griewank, Schwefel, Rosenbrock, Levy, Zakharov, Alpine N1, Bukin N.6, plus custom user-defined functions ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))

#### Phase 2: Three.js 3D visualization (2025-11-21)

- Three.js 3D surface rendering of objective function landscapes with parametric mesh ([`e7070f8`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/e7070f87498242d31f2307482eb381ac29100b55))
- OrbitControls for camera manipulation, timeline scrubber for iteration-by-iteration playback ([`0bbc851`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/0bbc851da1992c65a3f3d9fe3d7f15d2454fb53f))
- Frame storage for playback, fallback covariance ellipse for non-full models ([`2061593`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/2061593b0e794fc015de6f903f947d5bd584467d))
- Wire real covariance data from WASM into visualization for accurate ellipse rendering ([`81f6686`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/81f6686ce3e46f2925cf93966f7943d16c928b9b), [`a73a854`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a73a8548d634fc69e25339445b1e60ae8c4b8ad5))
- GSAP pulse animations and improved color-scale for candidate markers ([`735de50`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/735de50586015a3e2a8458fbc1a48257a3478b34))

#### Phase 3: Rich controls and dashboard features (2025-11-21 -- 2025-11-22)

- Dimension, projection, bounds, and noise controls; race mode (WASM vs vanilla JS baseline); custom objective editor with Monaco; story mode; HUD overlay ([`f392787`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/f3927871570e185cc7ed728837168a1e723e4159))
- Multi-run overlays with comparison statistics ([`e28280f`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/e28280f3f69bfb0ac0990779c822b9d33f8f6c1a))
- High-dimensional PCA scatter and parallel-coordinates plots ([`d402c4d`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/d402c4d0acca76384ece6faa52479ac1d5a8de07))
- Curated presets, recent-runs chips, and shareable config URL generation ([`222337c`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/222337c23c6092c1dc8fc0e79eb556caefef0454))
- Covariance model toggle and HUD performance deltas ([`ce1cc13`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/ce1cc13fbfb239fab5dfdf1719ba15897e1ad04c))
- Quickstart carousel, learn-mode badges, and glossary overlay ([`4ebc38c`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/4ebc38c0ae8095350542697867cffcebbea33686))
- Noisy-mode toggle and onboarding UI ([`0b73739`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/0b7373958aca53522a2a057462111bcc5c55ef6d))
- Constraint strategy controls (penalty/projection/resample) and robust noise toggle ([`938ac29`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/938ac2942d5659a2a7fcf84649fee7f7bd743cfa))
- Benchmark tips and stall suggestions ([`6b568c5`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/6b568c5bf88dec66fa542a49b369ae2762d85247))
- Command palette with wired handler functions ([`a6fb5f7`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a6fb5f7f64a2705d9e397f64d0e71b92a68e5081))

#### Phase 4: "Studio" overhaul and revert (2025-11-22)

The ambitious "CMA-ES Studio" was built with cinematic post-processing, 3D glass hyper-ellipsoid covariance visualization, Cupertino Pane mobile bottom sheet, haptic feedback, and instanced particle systems. It was then deliberately reverted to a leaner "Benchmark Gallery" design.

- **Studio build-up**: cinematic Three.js pipeline (UnrealBloomPass, ReinhardToneMapping), 3D glass hyper-ellipsoid, instanced particle rendering, Viridis heatmap landscape, glowing history trails ([`9a7e4ae`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/9a7e4ae0ca6bf552da0426e3b6d2d301660f5bef))
- **Studio UX**: mobile bottom sheet, haptic feedback, collapsible sidebar, help/tutorial overlays, background particle effect, 3D surface preview ([`9a7e4ae`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/9a7e4ae0ca6bf552da0426e3b6d2d301660f5bef), [`ee435f0`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/ee435f02f22e9b6cb7b286b02be84a5e990a58ff))
- **Revert**: restore "Benchmark Gallery" version of `viz-benchmarks.html`; remove `app.js`, `tailwind.css`, `sw.js`, Playwright E2E tests, and temp files ([`da79ef7`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/da79ef74b58be9b8f0c24f2e6167c9be3359da52))
- Clean up orphaned files from Studio era: `ENHANCEMENTS.md`, `WORKING-STATUS.md`, `enhanced-app.js`, old HTML variants, PWA icons, `temp_app_snippet.js`, `LICENSE-APACHE` ([`65246ba`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/65246ba10a7181d2b4960811733a5e99347d3774))

#### Phase 5: Post-revert stabilization (2025-11-22)

- Fix Three.js variable collisions and memory leaks; add proper `dispose()` calls ([`d1d7110`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/d1d71108f798f10f5bdc3b605dac866b5f262753))
- Fix `cov` variable scope redeclaration causing `SyntaxError` ([`48f6dbf`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/48f6dbfbf34be357ed35e62a1f3a662054c0fe9a))
- Switch Three.js loading to importmap ([`547bce5`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/547bce539ecf099cf2790f08f41ec6038ae07aac))
- Sync viz playback timing and inline SVG icons ([`280f535`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/280f535f316a98883ce6dbfffef1385d67d49e9f))
- Center covariance ellipse on distribution mean and sync best-solution marker ([`c7f9374`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/c7f937486130a6cbbe801ccf0157e5984d1692e1))
- Show per-generation covariance ellipse and projected best point ([`569f6b7`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/569f6b74fee221786b1f56e950c4a6a5c909873b))
- Clamp log-scale plot y-minimum to avoid negative/zero domain errors ([`780f211`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/780f211dad515fa7ccde20f4037e05c9701c9f63))
- JSON import crash fix, safe custom function evaluation guards, PCA fallback ([`5d1be9e`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5d1be9e5332815e445783ac734aceb0c77d7d98b))
- DOM null guards, bounds support in JS baseline, story mode open button ([`e735017`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/e735017d4955d64ce19bf93cfacd740f1bb3369c))

#### UI simplification pass (2025-11-22)

- Simplify controls and clarify JS baseline label ([`ef1bf68`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/ef1bf6871573e757d56383107b147698b4a87413))
- Hide race button to reduce clutter ([`6285b59`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/6285b59f783614de8641f5202f4024c144af7f8c))
- Replace scrub play with single run button and replay toggle ([`f98a35a`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/f98a35a5eace29e22b55e6d9a8a8ff2090dfd682))
- Add bundle toggle between `pkg/` (sequential) and `pkg-par/` (parallel) with page reload ([`c35a6bc`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/c35a6bc199cfaad56a80043e526712d7cd849e2f))
- Replace rendering panel with algorithm summary card ([`d703daf`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/d703dafc44c4790f90eeb8be8b92a1a29475d80b))
- Remove story mode panel and overlay entirely ([`edb734f`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/edb734f31d6d83e1178d94d8036f1099d43d1f6d))
- Typography refresh with single-run focus, story removed ([`6e2a52f`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/6e2a52f12d6be4ade544f88517a73f6ac71ca8c6))

#### Visual polish (2025-11-21)

- Revamp viz demo visuals and harden deploy script ([`a93815f`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a93815f1562ccbc996e627712dac3ad4c8df7edf))
- Holographic Run button with holoPulse keyframe animation ([`eae3607`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/eae3607583de00691b47067ea320c9ba3b982e66), [`2a41aa5`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/2a41aa5582029d060386c48de62dd768383a8185))
- Clamp candidates to 2D surface, cap frame history to prevent memory growth ([`3aff6e6`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/3aff6e6935b5a2f070e9600555a1487f2faf8404))

---

### 5. PWA support (built and later reverted)

These features were built into the app.js-based dashboard that was subsequently reverted. They no longer ship in the current codebase.

- PWA manifest, service worker with offline caching, app icons (192px, 512px) ([`4aa7823`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/4aa78234f6895334649505937710f338eaceeb57))
- Tutorial system and mobile touch controls wired to canonical app ([`a2680b6`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a2680b6150910b159af1cf87fd43ca326e0c5235))
- Service worker registration re-enabled ([`ca0a89c`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/ca0a89c922578d1e97b31b1afcf688740eecc42f))
- Safe DOM rendering, service worker resiliency, panic hardening ([`0c80f22`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/0c80f224a6ed087021e1d726917609a510b02f3e))

---

### 6. Testing

#### Rust unit tests (inline in `src/lib.rs`, since initial commit)

- `rosenbrock_tough_valley_converges` -- 3D, ftarget 1e-8 ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- `rastrigin_multimodal_converges` -- 4D, ftarget 1e-4 ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- `ackley_flat_valley_converges` -- 5D, ftarget 1e-4 ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- `griewank_converges` -- 5D, ftarget 5e-2 ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- `schwefel_converges_close` -- 3D, ftarget 1e-2 ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))

All tests use fixed seed (42) for reproducibility.

#### Additional tests added later

- `wasm-bindgen-test` integration tests: `sphere_builtin_converges`, `batch_api_round_trip` ([`058df8a`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/058df8a93a30abfc5c6ad46234dbcd8d79eed500))
- `proptest` property-based test: `sphere_best_is_nonnegative` with randomized dimension and sigma ([`058df8a`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/058df8a93a30abfc5c6ad46234dbcd8d79eed500))
- Deterministic seed reproducibility test: `deterministic_seed_reproducible_full_model` ([`058df8a`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/058df8a93a30abfc5c6ad46234dbcd8d79eed500))
- Constraint handling test: `respects_bounds_penalty_projection` ([`058df8a`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/058df8a93a30abfc5c6ad46234dbcd8d79eed500))

---

### 7. CI/CD pipeline

#### GitHub Actions

- Initial CI: cargo `fmt --check`, `clippy -D warnings`, `cargo test`, headless Playwright smoke test ([`f703dbb`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/f703dbbbb800a1143e9278227beb6e55e780fe11))
- Fix CI to use CommonJS Playwright config/tests, install `http-server` via bun ([`68c86f7`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/68c86f72b2430ba976f6e22ca62f8c1c7bf211e7))
- Pin `http-server` version in CI for reproducible builds ([`a17cb29`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a17cb29d7974fb018e845fdbeb9b6b5dad3b1127))
- Configure `getrandom` backend for WASM target, remove broken CI jobs referencing deleted test files ([`0f89d09`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/0f89d096aaaae81cee963b22d61b05447c074799))
- Add `wasm-bindgen-cli` installation step, improve CI caching for wasm-pack builds ([`a902bfb`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a902bfbc51397546e34fa6ccee237e04ef2a16e3))

#### GitHub Pages deployment

- Pre-built WASM bundles committed for zero-build Pages serving ([`ef95eea`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/ef95eea8666218f38565c0933a3c12f6510aeb62))
- Root `index.html` redirect to main visualization dashboard ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- Deploy script improvements and hardening ([`a3214f0`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a3214f0a0f338e776c821cf92834d4a8a8e71b1f), [`a93815f`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a93815f1562ccbc996e627712dac3ad4c8df7edf))
- Pages deployment commits ([`018a818`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/018a818c430e934f14d2865f25e4300d3128b7a9), [`547bce5`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/547bce539ecf099cf2790f08f41ec6038ae07aac))

---

### 8. Dependency maintenance

- Update Rust dependencies: remove unused crate from `Cargo.toml`, clean up `Cargo.lock` (-112 lines of outdated deps) ([`ac06db9`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/ac06db91c4edf905c013dcc52f274d23ba2fda46))
- Update Node.js dependencies and add `bun.lock` for dependency tracking ([`d04a48d`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/d04a48df6b90c108170116a3f6abe467b8fea48a))
- Regenerate `package-lock.json` to fix playwright/tailwindcss version mismatch ([`7775614`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/7775614071dcea98eb6c48d0e459ac995e42c7c4))
- Add `package.json` with Playwright and Tailwind as devDependencies ([`058df8a`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/058df8a93a30abfc5c6ad46234dbcd8d79eed500))

---

### 9. Licensing

- Initial dual license: MIT + Apache-2.0 ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- Add standalone MIT license file ([`c70f5f3`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/c70f5f350a774e74b94769109ae677b720ff76f4))
- Update to MIT with OpenAI/Anthropic Rider: restricts use by OpenAI, Anthropic, and their affiliates without express written permission from Jeffrey Emanuel ([`21d749c`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/21d749c6e26cbd2798612c5aef0825bda2d8a05e))
- Update README badge and references to reflect new license terms ([`553fb7a`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/553fb7a13d8240868d950103146c51ba11f5ba49))

---

### 10. Documentation and metadata

- Initial README with architecture overview, quickstart, API reference ([`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a))
- Expand README with deploy instructions, project layout, advanced usage ([`a3214f0`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a3214f0a0f338e776c821cf92834d4a8a8e71b1f))
- Update README: document `cov_matrix`, web target switch, fix architecture diagram ([`c8675f1`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/c8675f190ba7ca5337e61ed50c4c3e5cbc6d88a0))
- Improve README with better styling, badges, and Mermaid diagrams ([`65246ba`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/65246ba10a7181d2b4960811733a5e99347d3774))
- Simplify architecture Mermaid diagram for readability ([`f6fd990`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/f6fd990f1e0d16e65a64716e9c757b01bcba8f14))
- Remove npm package references from README ([`5fb049a`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5fb049ad04ac017cf4d5f9480d49020109ba7ade))
- Restore comprehensive README with full API reference after Studio revert ([`f0eaab4`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/f0eaab438b3311b8b4b4b4a64d4e285dbb67654a))
- Update README for new features during dashboard expansion ([`e1fa5cb`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/e1fa5cbf7d0d725d46c8be2b3a27ef7be08ea56f))
- Add GitHub social preview image (1280x640) for link previews ([`09e5cde`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/09e5cde3695114954cb042ac2d8224ea446806d8))
- Favicon added to silence 404 errors ([`a80f907`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a80f9073ffd835051259a75e0473f01d49972712))
- Three.js module import and favicon path fixes ([`1644eba`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/1644ebae0adacb55850231158f80fc3fa16714af), [`be41520`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/be415202666628621d16fa60093b7a4395b18e83))

---

## Commit index

All 76 commits in chronological order.

| Date | Hash | Summary |
|------|------|---------|
| 2025-11-21 | [`5dfe056`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5dfe056e93f8a59221185fdf8bc76c31464a0c9a) | Initial commit: wasm CMA-ES |
| 2025-11-21 | [`ef95eea`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/ef95eea8666218f38565c0933a3c12f6510aeb62) | Include wasm bundles for GitHub Pages |
| 2025-11-21 | [`a80f907`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a80f9073ffd835051259a75e0473f01d49972712) | Add tiny favicon to silence 404 |
| 2025-11-21 | [`a3214f0`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a3214f0a0f338e776c821cf92834d4a8a8e71b1f) | Improve deploy script and expand README |
| 2025-11-21 | [`a93815f`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a93815f1562ccbc996e627712dac3ad4c8df7edf) | Revamp viz demo visuals and harden deploy |
| 2025-11-21 | [`e7070f8`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/e7070f87498242d31f2307482eb381ac29100b55) | Add 3D surface and richer animations to viz demo |
| 2025-11-21 | [`735de50`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/735de50586015a3e2a8458fbc1a48257a3478b34) | Animate improvements in viz (GSAP pulse, color scale) |
| 2025-11-21 | [`f392787`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/f3927871570e185cc7ed728837168a1e723e4159) | Add dimension/projection/bounds/noise controls, race mode, custom editor, story, HUD |
| 2025-11-21 | [`780f211`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/780f211dad515fa7ccde20f4037e05c9701c9f63) | Clamp log plot y-min to avoid negative/zero values |
| 2025-11-21 | [`e735017`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/e735017d4955d64ce19bf93cfacd740f1bb3369c) | Hardening: DOM guards, PCA fallback, bounds in JS baseline |
| 2025-11-21 | [`5d1be9e`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5d1be9e5332815e445783ac734aceb0c77d7d98b) | Fix JSON import crash, add guards/safe custom fn, PCA fallback |
| 2025-11-21 | [`745b3cd`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/745b3cdced7ac65e21f44a98f1e0767ed05df0e1) | Switch wasm bundles to web target |
| 2025-11-21 | [`1644eba`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/1644ebae0adacb55850231158f80fc3fa16714af) | Import three.js as module; add favicon link |
| 2025-11-21 | [`be41520`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/be415202666628621d16fa60093b7a4395b18e83) | Add global three.js fallback and correct favicon path |
| 2025-11-21 | [`0bbc851`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/0bbc851da1992c65a3f3d9fe3d7f15d2454fb53f) | Three.js scene overhaul: surface, orbit controls, scrub timeline |
| 2025-11-21 | [`2061593`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/2061593b0e794fc015de6f903f947d5bd584467d) | 3D surface viz updates: orbit controls, frame storage, fallback ellipse |
| 2025-11-21 | [`a73a854`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a73a8548d634fc69e25339445b1e60ae8c4b8ad5) | Wire scrub playback, compute covariance from batch |
| 2025-11-21 | [`81f6686`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/81f6686ce3e46f2925cf93966f7943d16c928b9b) | Expose cov_matrix from wasm; use real covariance in viz |
| 2025-11-21 | [`c8675f1`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/c8675f190ba7ca5337e61ed50c4c3e5cbc6d88a0) | Update README: new viz, web target, cov_matrix |
| 2025-11-21 | [`3aff6e6`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/3aff6e6935b5a2f070e9600555a1487f2faf8404) | Clamp to 2D surface, cap frame history |
| 2025-11-21 | [`eae3607`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/eae3607583de00691b47067ea320c9ba3b982e66) | Add holographic Run button |
| 2025-11-21 | [`2a41aa5`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/2a41aa5582029d060386c48de62dd768383a8185) | Add holoPulse keyframes for hero run button |
| 2025-11-21 | [`f703dbb`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/f703dbbbb800a1143e9278227beb6e55e780fe11) | Add CI with cargo checks and Playwright smoke test |
| 2025-11-21 | [`68c86f7`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/68c86f72b2430ba976f6e22ca62f8c1c7bf211e7) | Fix CI: CommonJS Playwright config, bun http-server |
| 2025-11-21 | [`a17cb29`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a17cb29d7974fb018e845fdbeb9b6b5dad3b1127) | Pin http-server in CI; clarify viz helper text |
| 2025-11-22 | [`4aa7823`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/4aa78234f6895334649505937710f338eaceeb57) | Fix viz playback, add PWA assets, redirect prototype |
| 2025-11-22 | [`c4f75b2`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/c4f75b21a836e1c3d3cc04930e4292b3bdc1de0e) | Make enhanced UI canonical, wire functional app.js |
| 2025-11-22 | [`a2680b6`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a2680b6150910b159af1cf87fd43ca326e0c5235) | Hook tutorial + mobile controls to canonical app |
| 2025-11-22 | [`ca0a89c`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/ca0a89c922578d1e97b31b1afcf688740eecc42f) | Re-enable service worker in canonical app |
| 2025-11-22 | [`0c80f22`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/0c80f224a6ed087021e1d726917609a510b02f3e) | Hardening: safe DOM rendering, SW resiliency, no panics |
| 2025-11-22 | [`222337c`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/222337c23c6092c1dc8fc0e79eb556caefef0454) | Add curated presets, recent chips, sharable config links |
| 2025-11-22 | [`e28280f`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/e28280f3f69bfb0ac0990779c822b9d33f8f6c1a) | Add multi-run overlays and comparison stats |
| 2025-11-22 | [`d402c4d`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/d402c4d0acca76384ece6faa52479ac1d5a8de07) | Add high-d PCA scatter and parameter parcoords |
| 2025-11-22 | [`a6fb5f7`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a6fb5f7f64a2705d9e397f64d0e71b92a68e5081) | Wire command palette actions to real handlers |
| 2025-11-22 | [`6b568c5`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/6b568c5bf88dec66fa542a49b369ae2762d85247) | Add benchmark tips and stall suggestions in UI |
| 2025-11-22 | [`ce1cc13`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/ce1cc13fbfb239fab5dfdf1719ba15897e1ad04c) | Expose covariance model toggle and HUD perf deltas |
| 2025-11-22 | [`4ebc38c`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/4ebc38c0ae8095350542697867cffcebbea33686) | Add quickstart carousel, learn mode, and glossary |
| 2025-11-22 | [`0b73739`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/0b7373958aca53522a2a057462111bcc5c55ef6d) | Add noisy-mode toggle and onboarding UI |
| 2025-11-22 | [`938ac29`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/938ac2942d5659a2a7fcf84649fee7f7bd743cfa) | Add constraint strategies and robust noise toggle |
| 2025-11-22 | [`e1fa5cb`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/e1fa5cbf7d0d725d46c8be2b3a27ef7be08ea56f) | Update README with new features |
| 2025-11-22 | [`058df8a`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/058df8a93a30abfc5c6ad46234dbcd8d79eed500) | Add tests and CI infrastructure |
| 2025-11-22 | [`59dc0d6`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/59dc0d6d907e81d660fecf2f9ae0973fdad2f468) | Rebuild WASM packages with test changes |
| 2025-11-22 | [`9a7e4ae`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/9a7e4ae0ca6bf552da0426e3b6d2d301660f5bef) | Studio: overhaul visualization engine and UI/UX |
| 2025-11-22 | [`f4722fb`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/f4722fb81dc705fa395693ee968bbfd812be7512) | Update infrastructure and legacy support files |
| 2025-11-22 | [`ee435f0`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/ee435f02f22e9b6cb7b286b02be84a5e990a58ff) | Enhance visualization and interactivity in Studio |
| 2025-11-22 | [`65246ba`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/65246ba10a7181d2b4960811733a5e99347d3774) | Clean up orphaned files, improve README badges |
| 2025-11-22 | [`f6fd990`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/f6fd990f1e0d16e65a64716e9c757b01bcba8f14) | Simplify architecture diagram in README |
| 2025-11-22 | [`5fb049a`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/5fb049ad04ac017cf4d5f9480d49020109ba7ade) | Remove npm package references from README |
| 2025-11-22 | [`da79ef7`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/da79ef74b58be9b8f0c24f2e6167c9be3359da52) | Revert Studio; restore Benchmark Gallery viz |
| 2025-11-22 | [`d1d7110`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/d1d71108f798f10f5bdc3b605dac866b5f262753) | Fix variable collisions and memory leaks in viz |
| 2025-11-22 | [`48f6dbf`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/48f6dbfbf34be357ed35e62a1f3a662054c0fe9a) | Fix cov variable scope redeclaration |
| 2025-11-22 | [`547bce5`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/547bce539ecf099cf2790f08f41ec6038ae07aac) | Deploy importmap three |
| 2025-11-22 | [`018a818`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/018a818c430e934f14d2865f25e4300d3128b7a9) | Deploy pages |
| 2025-11-22 | [`280f535`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/280f535f316a98883ce6dbfffef1385d67d49e9f) | Sync viz playback and inline icons |
| 2025-11-22 | [`c7f9374`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/c7f937486130a6cbbe801ccf0157e5984d1692e1) | Center ellipse on mean and sync best marker |
| 2025-11-22 | [`569f6b7`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/569f6b74fee221786b1f56e950c4a6a5c909873b) | Show per-generation ellipse and projected best |
| 2025-11-22 | [`ef1bf68`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/ef1bf6871573e757d56383107b147698b4a87413) | Simplify controls and clarify JS baseline |
| 2025-11-22 | [`6285b59`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/6285b59f783614de8641f5202f4024c144af7f8c) | Hide race button |
| 2025-11-22 | [`f98a35a`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/f98a35a5eace29e22b55e6d9a8a8ff2090dfd682) | Single run button with replay toggle |
| 2025-11-22 | [`c35a6bc`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/c35a6bc199cfaad56a80043e526712d7cd849e2f) | Bundle toggle between pkg and pkg-par |
| 2025-11-22 | [`d703daf`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/d703dafc44c4790f90eeb8be8b92a1a29475d80b) | Replace rendering panel with algorithm summary |
| 2025-11-22 | [`1f5e52b`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/1f5e52b20be9b6215e5e6f20218f5957c01d9ade) | Simplify status card text |
| 2025-11-22 | [`edb734f`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/edb734f31d6d83e1178d94d8036f1099d43d1f6d) | Remove story mode panel and overlay |
| 2025-11-22 | [`6e2a52f`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/6e2a52f12d6be4ade544f88517a73f6ac71ca8c6) | Typography refresh and single-run focus |
| 2025-11-22 | [`f0eaab4`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/f0eaab438b3311b8b4b4b4a64d4e285dbb67654a) | Restore comprehensive README |
| 2026-01-09 | [`22e3ceb`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/22e3ceb300f53ae5fe521b07c1be4ebc0721b34c) | Rebuild WASM packages with updated README |
| 2026-01-18 | [`d04a48d`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/d04a48df6b90c108170116a3f6abe467b8fea48a) | Update Node.js dependencies and add bun.lock |
| 2026-01-21 | [`c70f5f3`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/c70f5f350a774e74b94769109ae677b720ff76f4) | Add MIT License file |
| 2026-01-24 | [`7775614`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/7775614071dcea98eb6c48d0e459ac995e42c7c4) | Fix clippy errors and update npm lock file |
| 2026-01-24 | [`0f89d09`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/0f89d096aaaae81cee963b22d61b05447c074799) | Configure getrandom for WASM, remove broken CI jobs |
| 2026-01-25 | [`a902bfb`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/a902bfbc51397546e34fa6ccee237e04ef2a16e3) | Improve CI workflow for WASM target builds |
| 2026-01-25 | [`ac06db9`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/ac06db91c4edf905c013dcc52f274d23ba2fda46) | Update Rust dependencies |
| 2026-02-21 | [`09e5cde`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/09e5cde3695114954cb042ac2d8224ea446806d8) | Add GitHub social preview image |
| 2026-02-21 | [`21d749c`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/21d749c6e26cbd2798612c5aef0825bda2d8a05e) | Update license to MIT + OpenAI/Anthropic Rider |
| 2026-02-22 | [`553fb7a`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/553fb7a13d8240868d950103146c51ba11f5ba49) | Update README license references |
| 2026-03-21 | [`2802cbe`](https://github.com/Dicklesworthstone/wasm_cmaes/commit/2802cbe785e0c06b0447c890ba1bebb5685417c3) | Add comprehensive CHANGELOG.md |
