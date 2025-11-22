    import init, { WasmCmaes } from "../pkg/cmaes_wasm.js";
    import * as THREE from "three";
    import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js";
    import { EffectComposer } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/EffectComposer.js";
    import { RenderPass } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/RenderPass.js";
    import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/UnrealBloomPass.js";

    const mustGet = (id) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`Missing element #${id}`);
      return el;
    };

    const swPath = () => location.pathname.startsWith('/wasm_cmaes/') ? '/wasm_cmaes/sw.js' : '/sw.js';

    // Load lucide icon paths (fallback-safe)
    let lucideIcons = {};
    try {
      const res = await fetch("https://cdn.jsdelivr.net/npm/lucide-static@0.321.0/icons.json");
      if (res.ok) lucideIcons = await res.json();
    } catch (_) {
      lucideIcons = {};
    }

    const benchFns = {
      sphere: {
        title: "Sphere",
        f: (x) => x[0] * x[0] + x[1] * x[1],
        x0: [3, -2],
      },
      rastrigin: {
        title: "Rastrigin",
        f: (x) => {
          const A = 10;
          return 2 * A + x.reduce((s, xi) => s + (xi * xi - A * Math.cos(2 * Math.PI * xi)), 0);
        },
        x0: [3, -3],
      },
      ackley: {
        title: "Ackley",
        f: (x) => {
          const a = 20, b = 0.2, c = 2 * Math.PI;
          const sumSq = x.reduce((s, xi) => s + xi * xi, 0);
          const sumCos = x.reduce((s, xi) => s + Math.cos(c * xi), 0);
          return -a * Math.exp(-b * Math.sqrt(sumSq / x.length)) - Math.exp(sumCos / x.length) + a + Math.E;
        },
        x0: [2.5, -2.5],
      },
      griewank: {
        title: "Griewank",
        f: (x) => {
          const sum = x.reduce((s, xi) => s + (xi * xi) / 4000, 0);
          const prod = x.reduce((p, xi, i) => p * Math.cos(xi / Math.sqrt(i + 1)), 1);
          return sum - prod + 1;
        },
        x0: [4, -3],
      },
      schwefel: {
        title: "Schwefel",
        f: (x) => {
          const bias = 418.9829 * x.length;
          const s = x.reduce((acc, xi) => acc + xi * Math.sin(Math.sqrt(Math.abs(xi))), 0);
          return bias - s;
        },
        x0: [200, -150],
      },
      levy: {
        title: "Levy",
        f: (x) => {
          const w = x.map((xi) => 1 + (xi - 1) / 4);
          const term1 = Math.pow(Math.sin(Math.PI * w[0]), 2);
          let sum = 0;
          for (let i = 0; i < w.length - 1; i++) {
            sum += Math.pow(w[i] - 1, 2) * (1 + 10 * Math.pow(Math.sin(Math.PI * w[i] + 1), 2));
          }
          const term3 = Math.pow(w[w.length - 1] - 1, 2) * (1 + Math.pow(Math.sin(2 * Math.PI * w[w.length - 1]), 2));
          return term1 + sum + term3;
        },
        x0: [1.5, -1.5],
      },
      zakharov: {
        title: "Zakharov",
        f: (x) => {
          const sum1 = x.reduce((s, xi) => s + xi * xi, 0);
          const sum2 = x.reduce((s, xi, i) => s + 0.5 * (i + 1) * xi, 0);
          return sum1 + Math.pow(sum2, 2) + Math.pow(sum2, 4);
        },
        x0: [2.0, -2.0],
      },
      alpine: {
        title: "Alpine N1",
        f: (x) => x.reduce((s, xi) => s + Math.abs(xi * Math.sin(xi) + 0.1 * xi), 0),
        x0: [4.5, -4.0],
      },
      bukin6: {
        title: "Bukin N.6",
        f: (x) => {
          const [x1, x2] = x;
          return 100 * Math.sqrt(Math.abs(x2 - 0.01 * x1 * x1)) + 0.01 * Math.abs(x1 + 10);
        },
        x0: [-12, 2.5],
      },
      custom: {
        title: "Custom",
        f: (x) => safeCustom(x),
        x0: [0, 0],
      },
    };

    const benchTips = {
      sphere: { lambda: '16–32', sigma: '0.8–1.2', tip: 'Smooth convex; smaller σ converges faster.' },
      rastrigin: { lambda: '32–64', sigma: '1.5–2.5', tip: 'Highly multimodal; keep σ high and use higher λ.' },
      ackley: { lambda: '24–48', sigma: '1.2–2.0', tip: 'Flat plateaus; bump σ if stuck.' },
      griewank: { lambda: '32–48', sigma: '1.8–2.2', tip: 'Oscillatory; larger σ helps escape ridges.' },
      schwefel: { lambda: '48–64', sigma: '2.5–3.5', tip: 'Deceptive; bounds help keep search stable.' },
      levy: { lambda: '32–48', sigma: '1.4–2.0', tip: 'Broad ridges; moderate σ and patience.' },
      zakharov: { lambda: '24–40', sigma: '1.0–1.6', tip: 'Ill-conditioned; watch condition number.' },
      alpine: { lambda: '32–48', sigma: '1.5–2.5', tip: 'Many spikes; exploration heavy.' },
      bukin6: { lambda: '24–40', sigma: '1.2–2.0', tip: 'Steep ridge; bounds strongly recommended.' },
      custom: { lambda: 'Depends', sigma: 'Depends', tip: 'Check scaling; start with λ=32, σ=1.2.' }
    };

    const quickstartSlidesData = [
      { title: 'Pick a benchmark', body: 'Choose a test function and keep λ/σ defaults to see convergence behavior.' },
      { title: 'Run & scrub', body: 'Hit Run, then scrub the timeline to replay iterations and inspect candidates.' },
      { title: 'Race WASM vs JS', body: 'Use ⚡ Race to compare WebAssembly vs JS baseline; results show in the corner HUD.' },
      { title: 'Share & presets', body: 'Copy a share link or tap a preset to load tuned λ/σ/bounds for tricky landscapes.' },
      { title: 'Learn mode', body: 'Toggle Learn mode to see annotated hotspots (controls, chart, 3D, HUD).' },
    ];

    const glossaryItemsData = [
      { term: 'λ (lambda)', desc: 'Population size per iteration. Higher = more exploration but more evals.' },
      { term: 'σ (sigma)', desc: 'Step size; scales the search distribution. Increase to escape plateaus.' },
      { term: 'Bounds', desc: 'Optional lower/upper limits; violations are penalized in fitness.' },
      { term: 'Condition number', desc: 'Ratio of largest to smallest eigenvalue of covariance; high values mean the search ellipsoid is elongated/ill-conditioned.' },
    ];

    const curatedPresets = [
      {
        id: 'sphere-quick',
        label: 'Sphere · quick',
        bench: 'sphere',
        lambda: 16,
        sigma: 1.0,
        iters: 200,
        seed: 42,
        bounds: { enabled: false, lo: -5, hi: 5 }
      },
      {
        id: 'rastrigin-explore',
        label: 'Rastrigin · explore',
        bench: 'rastrigin',
        lambda: 48,
        sigma: 1.8,
        iters: 300,
        seed: 7,
        bounds: { enabled: true, lo: -5.12, hi: 5.12 }
      },
      {
        id: 'ackley-fast',
        label: 'Ackley · fast settle',
        bench: 'ackley',
        lambda: 24,
        sigma: 1.4,
        iters: 220,
        seed: 17,
        bounds: { enabled: true, lo: -5, hi: 5 }
      },
      {
        id: 'griewank-wide',
        label: 'Griewank · wide',
        bench: 'griewank',
        lambda: 40,
        sigma: 2.0,
        iters: 320,
        seed: 99,
        bounds: { enabled: true, lo: -10, hi: 10 }
      },
      {
        id: 'schwefel-deep',
        label: 'Schwefel · deep dive',
        bench: 'schwefel',
        lambda: 64,
        sigma: 3.0,
        iters: 350,
        seed: 123,
        bounds: { enabled: true, lo: -500, hi: 500 }
      },
      {
        id: 'bounded',
        label: 'Bounded',
        bench: 'bukin6',
        lambda: 36,
        sigma: 1.6,
        iters: 280,
        seed: 11,
        bounds: { enabled: true, lo: -15, hi: 15 }
      }
    ];
    const presetMap = {};
    curatedPresets.forEach((p) => { presetMap[p.id] = p; });

    const RECENTS_KEY = 'cmaes-recent-presets';
    const MAX_RECENTS = 6;

    function updateBenchRecommendation(benchKey) {
      const tip = benchTips[benchKey] || benchTips.custom;
      paramRecText.textContent = `λ ${tip.lambda}, σ ${tip.sigma}. ${tip.tip}`;
      paramRec.classList.remove('hidden');
    }

    function renderQuickstart() {
      if (!quickstartContent || !quickstartDots) return;
      const slide = quickstartSlidesData[quickstartIdx % quickstartSlidesData.length];
      quickstartContent.innerHTML = `<div class="font-semibold text-sky-100 mb-1">${slide.title}</div><div>${slide.body}</div>`;
      quickstartDots.replaceChildren();
      quickstartSlidesData.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.className = `w-2.5 h-2.5 rounded-full ${i === quickstartIdx ? 'bg-sky-400' : 'bg-slate-700'}`;
        dot.addEventListener('click', () => { quickstartIdx = i; renderQuickstart(); });
        quickstartDots.appendChild(dot);
      });
    }

    function renderGlossary() {
      if (!glossaryList) return;
      glossaryList.replaceChildren();
      glossaryItemsData.forEach((item) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="font-semibold text-sky-200">${item.term}:</span> <span class="text-slate-300">${item.desc}</span>`;
        glossaryList.appendChild(li);
      });
    }

    function clearLearnBadges() {
      learnBadges.forEach((b) => b.remove());
      learnBadges = [];
    }

    function addBadgeFor(el, text) {
      const rect = el.getBoundingClientRect();
      const badge = document.createElement('div');
      badge.className = 'learn-badge';
      badge.textContent = text;
      badge.style.position = 'absolute';
      badge.style.top = `${rect.top + window.scrollY + 4}px`;
      badge.style.left = `${rect.left + window.scrollX + 4}px`;
      badge.style.padding = '6px 8px';
      badge.style.background = 'rgba(14,165,233,0.85)';
      badge.style.color = '#0b1220';
      badge.style.borderRadius = '999px';
      badge.style.fontSize = '11px';
      badge.style.fontWeight = '700';
      badge.style.zIndex = '2000';
      badge.style.pointerEvents = 'none';
      document.body.appendChild(badge);
      learnBadges.push(badge);
    }

    function renderLearnMode() {
      clearLearnBadges();
      if (!learnModeOn) return;
      const targets = [
        { id: 'bench', label: 'Benchmark' },
        { id: 'lambda', label: 'λ (pop size)' },
        { id: 'sigma', label: 'σ (step)' },
        { id: 'run', label: 'Run' },
        { id: 'run-race', label: 'WASM vs JS' },
        { id: 'line', label: 'Convergence' },
        { id: 'three-canvas', label: 'Surface + candidates' },
        { id: 'hud', label: 'HUD' },
      ];
      targets.forEach(({ id, label }) => {
        const el = document.getElementById(id);
        if (el) addBadgeFor(el, label);
      });
    }

    // Inject lucide icons
    const parser = new DOMParser();
    document.querySelectorAll('.lucide').forEach((el) => {
      const name = el.dataset.icon;
      const path = lucideIcons[name];
      if (!path) return;
      const svgString = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path.join('')}</svg>`;
      const doc = parser.parseFromString(svgString, 'image/svg+xml');
      const svgEl = doc.documentElement;
      if (svgEl) {
        el.replaceChildren(el.ownerDocument.importNode(svgEl, true));
      }
    });

    const benchSelect = mustGet('bench');
    // Removed missing inputs: dimInput, projectionSelect, etc.
    const boundsToggle = mustGet('bounds-toggle');
    const boundLo = mustGet('bound-lo');
    const boundHi = mustGet('bound-hi');
    const noiseSamples = document.getElementById('noise-samples');
    const noiseMax = document.getElementById('noise-max');
    const noiseAdaptive = document.getElementById('noise-adaptive');
    const constraintStrategySelect = document.getElementById('constraint-strategy');
    const resampleCapInput = document.getElementById('resample-cap');
    const penaltyWeightInput = document.getElementById('penalty-weight');
    const noisyToggle = mustGet('noisy-toggle');
    // timingEl, raceResults removed
    const lambdaInput = mustGet('lambda');
    const sigmaInput = mustGet('sigma');
    const itersInput = mustGet('iters');
    const seedInput = mustGet('seed');
    const covarModelSelect = mustGet('covar-model');
    const helpOverlay = document.getElementById('help-overlay');
    const helpCloseBtn = document.getElementById('help-close-btn');
    const helpCloseX = document.getElementById('help-close-x');
    const helpBtn = document.getElementById('help-btn');
    const exportCsvBtn = document.getElementById('export-csv');
    const exportJsonBtn = document.getElementById('export-json');
    const shareBtn = document.getElementById('share-config');
    const runBtn = mustGet('run');
    const runJsBtn = document.getElementById('run-js');
    const runRaceBtn = document.getElementById('run-race');
    const toastContainer = mustGet('toast-container');
    const bgCanvas = document.getElementById('bg-canvas');
    const pinRunBtn = document.getElementById('pin-run');
    const compareLastBtn = document.getElementById('compare-last');
    const clearOverlaysBtn = document.getElementById('clear-overlays');
    const comparisonLegend = document.getElementById('comparison-legend');
    const comparisonStats = document.getElementById('comparison-stats');
    const pcaContainer = document.getElementById('pca-container');
    const pcaSvg = document.getElementById('pca-scatter');
    const parcoordsSvg = document.getElementById('param-parcoords');
    const paramRec = document.getElementById('param-recommendation');
    const paramRecText = document.getElementById('param-recommendation-text');
    const hudModel = document.getElementById('hud-model');
    const learnToggle = document.getElementById('learn-mode-toggle');
    const quickstartContent = document.getElementById('quickstart-content');
    const quickstartPrev = document.getElementById('quickstart-prev');
    const quickstartNext = document.getElementById('quickstart-next');
    const quickstartDots = document.getElementById('quickstart-dots');
    const glossaryList = document.getElementById('glossary-list');
    const quickRunBtn = document.getElementById('quick-run');
    const runSampleBtn = document.getElementById('run-sample');
    const chartEmpty = document.getElementById('chart-empty');
    const chartEmptyRun = document.getElementById('chart-empty-run');
    const chartEmptySample = document.getElementById('chart-empty-sample');
    const threeEmpty = document.getElementById('three-empty');
    const threeEmptyRun = document.getElementById('three-empty-run');
    const threeEmptySample = document.getElementById('three-empty-sample');
    const statusChip = document.getElementById('status-chip');
    const bestChip = document.getElementById('best-chip');
    const openMobileControls = document.getElementById('open-mobile-controls');
    const reduceMotionToggle = document.getElementById('reduce-motion-toggle');
    const inlinePresetBtns = Array.from(document.querySelectorAll('.preset-inline'));

    const lineSvg = d3.select('#line');
    const scrub = mustGet('scrub');
    const scrubPlay = mustGet('scrub-play');
    const playbackState = { frames: [], playing: false, idx: 0 };

    // Module-level history and metadata for export functions
    let optimizationHistory = [];
    let currentRunMetadata = null;
    let runCounter = 0;
    const overlayPalette = ['#a855f7', '#22d3ee', '#f97316', '#f43f5e', '#22c55e', '#8b5cf6', '#14b8a6'];
    let pastRuns = [];
    let pinnedRunId = null;
    let lastRunId = null;
    let currentSummary = null;
    const parcoordsAxes = ['lambda', 'sigma', 'cond', 'best'];
    let lastImproveIter = 0;
    let stallNotified = false;
    let hasRun = false;
    let reduceMotionOn = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // quickstartIdx, learnModeOn, learnBadges already declared above

    const setRunState = (ran) => {
      hasRun = ran;
      [chartEmpty, threeEmpty].forEach((el) => {
        if (!el) return;
        el.classList.toggle('hidden', ran);
      });
    };

    const updateChips = () => {
      // statusEl is removed, so skipping status chip update from statusEl
      // Instead we can update direct HUD elements if needed.
      // The "Overlay HUD" has iter-display and best-display which are handled elsewhere.
    };

    let bgRaf = null;
    const stopBg = () => {
      if (bgRaf) cancelAnimationFrame(bgRaf);
      bgRaf = null;
    };
    const applyReduceMotion = () => {
      document.body.classList.toggle('reduce-motion', reduceMotionOn);
      if (reduceMotionToggle) reduceMotionToggle.setAttribute('aria-pressed', reduceMotionOn ? 'true' : 'false');
      if (reduceMotionOn) stopBg(); else startBg();
    };

    function constraintConfig() {
      return {
        strategy: constraintStrategySelect?.value || 'penalty',
        resampleCap: Math.max(1, Number(resampleCapInput?.value || 5)),
        penaltyWeight: Math.max(0, Number(penaltyWeightInput?.value || 1000)),
        lo: Number(boundLo.value) || -5,
        hi: Number(boundHi.value) || 5,
        boundsEnabled: boundsToggle.checked,
      };
    }

    function augmentedPenalty(delta, w) {
      return w * delta + 0.5 * w * delta * delta;
    }

    function applyConstraint(vec) {
      const cfg = constraintConfig();
      if (!cfg.boundsEnabled) return { vec, penalty: 0, ok: true };
      let penalty = 0;
      const clamped = [...vec];
      for (let i = 0; i < clamped.length; i++) {
        if (clamped[i] < cfg.lo) {
          const d = cfg.lo - clamped[i];
          penalty += augmentedPenalty(d, cfg.penaltyWeight);
          clamped[i] = cfg.lo;
        } else if (clamped[i] > cfg.hi) {
          const d = clamped[i] - cfg.hi;
          penalty += augmentedPenalty(d, cfg.penaltyWeight);
          clamped[i] = cfg.hi;
        }
      }
      const within = penalty === 0;
      switch (cfg.strategy) {
        case 'project':
          return { vec: clamped, penalty, ok: true };
        case 'resample':
          return { vec, penalty, ok: within, wantResample: !within, cap: cfg.resampleCap, clamped };
        case 'penalty':
        default:
          return { vec, penalty, ok: true };
      }
    }
    let quickstartIdx = 0;
    let learnModeOn = false;
    let learnBadges = [];

    const lineMargin = { top: 10, right: 10, bottom: 30, left: 50 };
    const width = 800, height = 320;

    const lineG = lineSvg.append('g').attr('transform', `translate(${lineMargin.left},${lineMargin.top})`);

    const lineX = d3.scaleLinear().range([0, width - lineMargin.left - lineMargin.right]);
    const lineY = d3.scaleLog().clamp(true).range([height - lineMargin.top - lineMargin.bottom, 0]);

    lineG.append('g').attr('class', 'axis axis-x').attr('transform', `translate(0,${height - lineMargin.top - lineMargin.bottom})`);
    lineG.append('g').attr('class', 'axis axis-y');

    const linePath = lineG.append('path').attr('fill', 'none').attr('stroke', '#38bdf8').attr('stroke-width', 2.5);
    const overlayGroup = lineG.append('g').attr('class', 'overlay-lines');

    // Removed statusEl, hudFps, hudWasm, hudJs, hudIter mustGets to prevent crash
    const bestEl = mustGet('best-display');
    const iterEl = mustGet('iter-display');
    const hudFps = document.getElementById('hud-fps');
    const hudWasm = document.getElementById('hud-wasm');
    const hudJs = document.getElementById('hud-js');
    const hudIter = document.getElementById('hud-iter');

    setRunState(false);
    updateChips();

    let wasmInitialized = false;

    function currentDim(benchKey) {
      // dimInput and dimLabel removed
      return 2;
    }

    const getMobileEl = (id) => document.getElementById(`${id}-mobile`);

    function buildOptions(lambda, maxIter, seed, dim) {
      const opts = { popsize: lambda, seed, maxEvals: lambda * maxIter, covarModel: covarModelSelect.value };
      if (boundsToggle.checked) {
        const lo = Number(boundLo.value) || -5;
        const hi = Number(boundHi.value) || 5;
        opts.bounds = {
          lower: new Float64Array(Array(dim).fill(lo)),
          upper: new Float64Array(Array(dim).fill(hi)),
        };
      }
      const samples = Number(noiseSamples?.value) || 1;
      const maxS = Number(noiseMax?.value) || 8;
      opts.noise = {
        samplesPerPoint: samples,
        maxSamplesPerPoint: maxS,
        adaptive: noiseAdaptive?.checked ?? false,
      };
      if (noisyToggle.checked) {
        opts.noise.samplesPerPoint = Math.max(opts.noise.samplesPerPoint, 3);
        opts.noise.maxSamplesPerPoint = Math.max(opts.noise.maxSamplesPerPoint, 9);
        opts.noise.adaptive = true;
      }
      if (penaltyWeightInput) {
        opts.constraintPenalty = Number(penaltyWeightInput.value) || 1000;
      }
      return opts;
    }

    // Preset helpers ---------------------------------------------------------
    const mobileRefs = {
      bench: getMobileEl('bench'),
      lambda: getMobileEl('lambda'),
      sigma: getMobileEl('sigma'),
      iters: getMobileEl('iters'),
      seed: getMobileEl('seed'),
      bounds: getMobileEl('bounds-toggle'),
      lo: getMobileEl('bound-lo'),
      hi: getMobileEl('bound-hi'),
      covar: getMobileEl('covar-model'),
      noisy: document.getElementById('noisy-toggle-mobile'),
      constraintStrategy: document.getElementById('constraint-strategy-mobile'),
      resampleCap: document.getElementById('resample-cap-mobile'),
      penaltyWeight: document.getElementById('penalty-weight-mobile'),
    };

    const loadRecentPresets = () => {
      try {
        const raw = localStorage.getItem(RECENTS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    };

    const persistRecentPresets = (items) => {
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(items.slice(0, MAX_RECENTS)));
      } catch (_) {
        /* ignore */
      }
    };

    let recentPresets = loadRecentPresets();

    const presetKey = (p) => [
      p.bench,
      p.lambda,
      p.sigma,
      p.iters,
      p.seed,
      p.bounds?.enabled,
      p.bounds?.lo,
      p.bounds?.hi
    ].join('|');

    function saveRecentPreset(preset) {
      const key = presetKey(preset);
      recentPresets = [
        { ...preset, key, touchedAt: Date.now() },
        ...recentPresets.filter((r) => r.key !== key)
      ].slice(0, MAX_RECENTS);
      persistRecentPresets(recentPresets);
      renderRecentPresets();
      renderRecentPresets(true);
    }

    function applyPreset(preset, { toast = true } = {}) {
      benchSelect.value = preset.bench;
      lambdaInput.value = preset.lambda;
      sigmaInput.value = preset.sigma;
      itersInput.value = preset.iters;
      seedInput.value = preset.seed;
      boundsToggle.checked = !!preset.bounds?.enabled;
      if (preset.bounds) {
        boundLo.value = preset.bounds.lo;
        boundHi.value = preset.bounds.hi;
      }

      // Keep mobile inputs in sync
      if (mobileRefs.bench) mobileRefs.bench.value = preset.bench;
      if (mobileRefs.lambda) mobileRefs.lambda.value = preset.lambda;
      if (mobileRefs.sigma) mobileRefs.sigma.value = preset.sigma;
      if (mobileRefs.iters) mobileRefs.iters.value = preset.iters;
      if (mobileRefs.seed) mobileRefs.seed.value = preset.seed;
      if (mobileRefs.bounds) mobileRefs.bounds.checked = !!preset.bounds?.enabled;
      if (mobileRefs.lo && preset.bounds) mobileRefs.lo.value = preset.bounds.lo;
      if (mobileRefs.hi && preset.bounds) mobileRefs.hi.value = preset.bounds.hi;

      saveRecentPreset(preset);
      if (toast) showToast(`Preset applied: ${preset.label}`, 'success', 1800);
    }

    const applyPresetById = (id, opts = {}) => {
      const preset = presetMap[id];
      if (preset) applyPreset(preset, opts);
    };

    function renderPresetGallery(isMobile = false) {
      const host = document.getElementById(isMobile ? 'preset-gallery-mobile' : 'preset-gallery');
      if (!host) return;
      host.replaceChildren();
      curatedPresets.forEach((preset) => {
        const card = document.createElement('div');
        card.className = 'panel rounded-lg p-3 flex flex-col gap-2 border border-slate-700/60';

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between gap-2';
        const title = document.createElement('div');
        title.className = 'text-sm font-semibold text-slate-100';
        title.textContent = preset.label;
        const bench = document.createElement('span');
        bench.className = 'text-xs text-slate-400';
        bench.textContent = benchFns[preset.bench]?.title || preset.bench;
        header.append(title, bench);

        const badges = document.createElement('div');
        badges.className = 'flex flex-wrap gap-2 text-xs text-slate-200';
        const makeBadge = (text) => {
          const b = document.createElement('span');
          b.className = 'px-2 py-1 rounded-full bg-slate-800 border border-slate-700';
          b.textContent = text;
          return b;
        };
        badges.append(
          makeBadge(`λ ${preset.lambda}`),
          makeBadge(`σ ${preset.sigma}`),
          makeBadge(preset.bounds?.enabled ? `bounds [${preset.bounds.lo}, ${preset.bounds.hi}]` : 'no bounds'),
          makeBadge(`${preset.iters} iters`)
        );

        const actions = document.createElement('div');
        actions.className = 'flex gap-2';
        const applyBtn = document.createElement('button');
        applyBtn.className = 'flex-1 bg-sky-500 hover:bg-sky-400 text-slate-900 font-semibold px-3 py-2 rounded-lg text-sm';
        applyBtn.textContent = 'Apply';
        applyBtn.addEventListener('click', () => applyPreset(preset));

        const linkBtn = document.createElement('button');
        linkBtn.className = 'px-3 py-2 rounded-lg border border-slate-700 text-slate-100 text-sm';
        linkBtn.textContent = 'Copy link';
        linkBtn.addEventListener('click', () => {
          shareConfig({
            bench: preset.bench,
            lambda: preset.lambda,
            sigma: preset.sigma,
            iters: preset.iters,
            seed: preset.seed,
            boundsEnabled: preset.bounds?.enabled ?? false,
            lo: preset.bounds?.lo ?? boundLo.value,
            hi: preset.bounds?.hi ?? boundHi.value
          });
        });
        actions.append(applyBtn, linkBtn);

        card.append(header, badges, actions);
        host.appendChild(card);
      });
    }

    function renderRecentPresets(isMobile = false) {
      const host = document.getElementById(isMobile ? 'recent-presets-mobile' : 'recent-presets');
      if (!host) return;
      host.replaceChildren();
      if (!recentPresets.length) {
        const empty = document.createElement('div');
        empty.className = 'text-xs text-slate-500';
        empty.textContent = 'No recent presets yet';
        host.appendChild(empty);
        return;
      }
      recentPresets.forEach((preset) => {
        const btn = document.createElement('button');
        btn.className = 'px-3 py-1.5 rounded-full border border-slate-700 bg-slate-900 text-slate-100 text-xs hover:border-sky-500';
        btn.textContent = preset.label;
        btn.addEventListener('click', () => applyPreset(preset, { toast: true }));
        host.appendChild(btn);
      });
    }

    function projectCandidates(cands, bestVec, dim) {
      // Always use PCA if > 2D, otherwise direct
      if (dim <= 2) {
        const pts = cands.map((v) => ({ x: v[0], y: v[1] }));
        const b = { x: bestVec[0], y: bestVec[1] };
        return { pts, b };
      }
      const mean = Array(dim).fill(0);
      cands.forEach((v) => v.forEach((val, i) => { mean[i] += val; }));
      mean.forEach((_, i) => { mean[i] /= cands.length; });
      const cov = Array.from({ length: dim }, () => Array(dim).fill(0));
      cands.forEach((v) => {
        for (let i = 0; i < dim; i++) {
          const a = v[i] - mean[i];
          for (let j = 0; j < dim; j++) cov[i][j] += a * (v[j] - mean[j]);
        }
      });
      const denom = Math.max(1, cands.length - 1);
      for (let i = 0; i < dim; i++) for (let j = 0; j < dim; j++) cov[i][j] /= denom;

      const powerVec = (M) => {
        let v = Array.from({ length: dim }, () => Math.random());
        const norm = (arr) => Math.sqrt(arr.reduce((s, x) => s + x * x, 0));
        for (let it = 0; it < 25; it++) {
          const nv = Array(dim).fill(0);
          for (let i = 0; i < dim; i++) {
            for (let j = 0; j < dim; j++) nv[i] += M[i][j] * v[j];
          }
          const n = norm(nv) || 1;
          v = nv.map((x) => x / n);
        }
        let lambda = 0;
        for (let i = 0; i < dim; i++) for (let j = 0; j < dim; j++) lambda += v[i] * M[i][j] * v[j];
        return { v, lambda };
      };

      const { v: v1, lambda: l1 } = powerVec(cov);
      if (!isFinite(l1) || Math.abs(l1) < 1e-12) {
        const pts = cands.map((v) => ({ x: v[0], y: v[1] }));
        const b = { x: bestVec[0], y: bestVec[1] };
        return { pts, b };
      }
      const cov2 = cov.map((row, i) => row.map((val, j) => val - l1 * v1[i] * v1[j]));
      const { v: v2, lambda: l2 } = powerVec(cov2);
      if (!isFinite(l2) || Math.abs(l2) < 1e-12) {
        const pts = cands.map((v) => ({ x: v[0], y: v[1] }));
        const b = { x: bestVec[0], y: bestVec[1] };
        return { pts, b };
      }

      const project = (vec) => {
        const centered = vec.map((x, i) => x - mean[i]);
        const px = centered.reduce((s, x, i) => s + x * v1[i], 0);
        const py = centered.reduce((s, x, i) => s + x * v2[i], 0);
        return { x: px, y: py };
      };

      return { pts: cands.map(project), b: project(bestVec) };
    }

    // Three.js scene
    const threeCanvas = mustGet('three-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true, alpha: true });
    renderer.toneMapping = THREE.ReinhardToneMapping;
    
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 16/9, 0.1, 500);
    camera.position.set(0, 40, 70);
    
    const controls = new OrbitControls(camera, threeCanvas);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    
    // Lighting
    scene.add(new THREE.AmbientLight(0x404040));
    const dir = new THREE.DirectionalLight(0xffffff, 2);
    dir.position.set(30, 50, 30);
    scene.add(dir);
    const blueLight = new THREE.PointLight(0x38bdf8, 5, 100);
    blueLight.position.set(-20, 10, -20);
    scene.add(blueLight);
    const orangeLight = new THREE.PointLight(0xf59e0b, 5, 100);
    orangeLight.position.set(20, 10, 20);
    scene.add(orangeLight);

    // Post-processing
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.2;
    bloomPass.strength = 0.8;
    bloomPass.radius = 0.5;
    composer.addPass(bloomPass);

    let surfaceMesh = null;
    const surfaceGroup = new THREE.Group();
    scene.add(surfaceGroup);
    
    // Visuals Container
    const visuals = {
        points: null,
        best: null,
        ellipsoid: null,
        axes: [],
        historyLine: null,
        historyPoints: []
    };

    function viridis(t) {
      // Simple viridis approximation
      const a = [68, 1, 84], b = [59, 82, 139], c = [33, 145, 140], d = [94, 201, 98], e = [253, 231, 37];
      const lerp = (p, q, s) => p + (q - p) * s;
      const x = t;
      let r, g, b2;
      if (x < 0.25) { const s = x / 0.25; r = lerp(a[0], b[0], s); g = lerp(a[1], b[1], s); b2 = lerp(a[2], b[2], s); }
      else if (x < 0.5) { const s = (x-0.25)/0.25; r = lerp(b[0], c[0], s); g = lerp(b[1], c[1], s); b2 = lerp(b[2], c[2], s); }
      else if (x < 0.75) { const s = (x-0.5)/0.25; r = lerp(c[0], d[0], s); g = lerp(c[1], d[1], s); b2 = lerp(c[2], d[2], s); }
      else { const s = (x-0.75)/0.25; r = lerp(d[0], e[0], s); g = lerp(d[1], e[1], s); b2 = lerp(d[2], e[2], s); }
      return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b2);
    }

    function buildSurfaceGeometry(fn) {
      const size = 40;
      const segments = 80;
      const geom = new THREE.PlaneGeometry(size, size, segments, segments);
      const pos = geom.attributes.position;
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = fn([x / 2, y / 2]);
        pos.setZ(i, z);
        if (z < min) min = z;
        if (z > max) max = z;
      }
      const colors = [];
      for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        const t = (z - min) / (max - min + 1e-9);
        const rgb = viridis(t);
        colors.push(((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255);
      }
      geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geom.rotateX(-Math.PI / 2);
      return geom;
    }

    function updateSurface(fn) {
      if (surfaceMesh) surfaceGroup.remove(surfaceMesh);
      const geom = buildSurfaceGeometry(fn);
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.9, roughness: 0.6, metalness: 0.0 });
      surfaceMesh = new THREE.Mesh(geom, mat);
      surfaceGroup.add(surfaceMesh);
    }

    // Shared resources
    const particleTexture = (() => {
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 32;
      const ctx = canvas.getContext('2d');
      ctx.beginPath();
      ctx.arc(16, 16, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      return new THREE.CanvasTexture(canvas);
    })();

    function updatePoints(batch, mean) {
      // 1. Update Candidate Points
      if (visuals.points) {
        // Attempt to reuse geometry if count matches
        const currentCount = visuals.points.geometry.attributes.position.count;
        if (currentCount === batch.length) {
          const posArr = visuals.points.geometry.attributes.position.array;
          for (let i = 0; i < batch.length; i++) {
            posArr[i*3] = batch[i].x;
            posArr[i*3+1] = 0.2; 
            posArr[i*3+2] = batch[i].y;
          }
          visuals.points.geometry.attributes.position.needsUpdate = true;
        } else {
          surfaceGroup.remove(visuals.points);
          visuals.points = null;
        }
      }

      if (!visuals.points) {
        const geom = new THREE.BufferGeometry();
        const posArr = new Float32Array(batch.length * 3);
        for (let i = 0; i < batch.length; i++) {
          posArr[i*3] = batch[i].x;
          posArr[i*3+1] = 0.2; 
          posArr[i*3+2] = batch[i].y;
        }
        geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
        
        const mat = new THREE.PointsMaterial({
          color: 0x22d3ee,
          map: particleTexture,
          size: 0.8,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        });
        
        visuals.points = new THREE.Points(geom, mat);
        surfaceGroup.add(visuals.points);
      }

      // 2. Update Best Solution Sphere
      if (!visuals.best) {
        const sphereGeo = new THREE.SphereGeometry(0.5, 32, 32);
        const sphereMat = new THREE.MeshStandardMaterial({
          color: 0xfbbf24,
          emissive: 0xf59e0b,
          emissiveIntensity: 2.0,
          toneMapped: false
        });
        visuals.best = new THREE.Mesh(sphereGeo, sphereMat);
        surfaceGroup.add(visuals.best);
      }
      visuals.best.position.set(mean.x, 0.2, mean.y);

      // 3. Update History Trail
      visuals.historyPoints.push(new THREE.Vector3(mean.x, 0.2, mean.y));
      if (visuals.historyPoints.length > 500) visuals.historyPoints.shift();
      
      if (visuals.historyLine) surfaceGroup.remove(visuals.historyLine);
      if (visuals.historyPoints.length > 1) {
        const curve = new THREE.CatmullRomCurve3(visuals.historyPoints);
        const points = curve.getPoints(visuals.historyPoints.length * 2);
        const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
        const lineMat = new THREE.LineBasicMaterial({
          color: 0x6366f1,
          transparent: true,
          opacity: 0.5,
          linewidth: 2
        });
        visuals.historyLine = new THREE.Line(lineGeo, lineMat);
        surfaceGroup.add(visuals.historyLine);
      }
    }

    function updateEllipse(mean, cov2x2) {
      // Eigen decomposition for 2x2 covariance
      // [a b]
      // [b c]
      const a = cov2x2[0], b = cov2x2[1], c = cov2x2[3];
      const trace = a + c;
      const det = a * c - b * b;
      const disc = Math.max(trace*trace/4 - det, 0);
      const l1 = trace/2 + Math.sqrt(disc); // Largest eigenvalue
      const l2 = trace/2 - Math.sqrt(disc); // Smallest
      
      // Radii
      const r1 = Math.sqrt(Math.max(l1, 1e-9));
      const r2 = Math.sqrt(Math.max(l2, 1e-9));
      
      // Angle of first eigenvector
      const angle = Math.atan2(b, l1 - a);

      // 1. Update Ellipsoid Mesh
      if (!visuals.ellipsoid) {
        const geo = new THREE.CylinderGeometry(1, 1, 1, 64);
        const mat = new THREE.MeshPhysicalMaterial({
          color: 0x38bdf8,
          metalness: 0.1,
          roughness: 0.1,
          transmission: 0.6,
          thickness: 0.5,
          transparent: true,
          opacity: 0.4,
          side: THREE.DoubleSide
        });
        visuals.ellipsoid = new THREE.Mesh(geo, mat);
        surfaceGroup.add(visuals.ellipsoid);
      }
      
      visuals.ellipsoid.scale.set(r1, 0.05, r2);
      visuals.ellipsoid.position.set(mean.x, 0.2, mean.y);
      visuals.ellipsoid.rotation.y = -angle;

      // 2. Update Axis Helpers
      // We reuse arrows if they exist
      const ensureAxis = (idx, color) => {
        if (!visuals.axes[idx]) {
           const dir = new THREE.Vector3(1, 0, 0);
           const origin = new THREE.Vector3(0, 0, 0);
           const arrow = new THREE.ArrowHelper(dir, origin, 1, color, 0.5, 0.3);
           surfaceGroup.add(arrow);
           visuals.axes[idx] = arrow;
        }
        return visuals.axes[idx];
      };
      
      const major = ensureAxis(0, 0xff00ff);
      const minor = ensureAxis(1, 0x00ffff);
      
      const updateArrow = (arrow, len, ang) => {
        const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
        arrow.setDirection(dir);
        arrow.setLength(len, 0.5, 0.3); // headLength, headWidth
        arrow.position.set(mean.x, 0.2, mean.y);
      };
      
      updateArrow(major, r1, angle);
      updateArrow(minor, r2, angle + Math.PI/2);
    }

    function resizeRenderer() {
      const w = threeCanvas.clientWidth || 800;
      const h = 380;
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resizeRenderer();
    window.addEventListener('resize', resizeRenderer);

    function renderThree() {
      controls.update();
      composer.render();
      requestAnimationFrame(renderThree);
    }
    renderThree();

    function covFromPoints(batch, mean) {
      if (!batch.length) return [1,0,0,1];
      const n = batch.length;
      let sxx=0, sxy=0, syy=0;
      for (const p of batch) {
        const dx = p.x - mean.x;
        const dy = p.y - mean.y;
        sxx += dx*dx;
        sxy += dx*dy;
        syy += dy*dy;
      }
      const denom = Math.max(1, n-1);
      return [sxx/denom, sxy/denom, sxy/denom, syy/denom];
    }

    function applySamplePreset() {
      benchSelect.value = 'sphere';
      lambdaInput.value = 24;
      sigmaInput.value = 1.1;
      itersInput.value = 180;
      seedInput.value = 7;
      boundsToggle.checked = false;
      noisyToggle.checked = false;
      covarModelSelect.value = 'auto';
      if (mobileRefs.bench) mobileRefs.bench.value = benchSelect.value;
      if (mobileRefs.lambda) mobileRefs.lambda.value = lambdaInput.value;
      if (mobileRefs.sigma) mobileRefs.sigma.value = sigmaInput.value;
      if (mobileRefs.iters) mobileRefs.iters.value = itersInput.value;
      if (mobileRefs.seed) mobileRefs.seed.value = seedInput.value;
      if (mobileRefs.covar) mobileRefs.covar.value = covarModelSelect.value;
      if (mobileRefs.bounds) mobileRefs.bounds.checked = false;
      if (mobileRefs.noisy) mobileRefs.noisy.checked = false;
      updateBenchRecommendation(benchSelect.value);
    }

    function runSample() {
      applySamplePreset();
      setRunState(true);
      run();
    }

    async function run() {
      setRunState(true);
      statusEl.textContent = 'Initializing wasm...';
      updateChips();
      if (!wasmInitialized) {
        await init();
        wasmInitialized = true;
      }

      const benchKey = benchSelect.value;
      const bench = benchFns[benchKey];
      const lambda = Number(lambdaInput.value) || 32;
      const sigma = Number(sigmaInput.value) || 1.2;
      const maxIter = Number(itersInput.value) || 250;
      const seed = Number(seedInput.value) || 42;
      const dim = currentDim(benchKey);

      const opts = buildOptions(lambda, maxIter, seed, dim);

      const x0 = new Float64Array(dim);
      for (let i = 0; i < dim; i++) x0[i] = bench.x0[i % bench.x0.length] || 0;
      const es = new WasmCmaes(x0, sigma, opts);

      buildSurface(bench.f);

      // Reset module-level history for new run and capture metadata
      optimizationHistory = [];
      visuals.historyPoints = [];
      if (visuals.historyLine) {
        surfaceGroup.remove(visuals.historyLine);
        visuals.historyLine = null;
      }
      currentRunMetadata = {
        benchmark: benchKey,
        lambda: lambda,
        sigma: sigma,
        maxIterations: maxIter,
        seed: seed,
        dimensions: dim
      };
      const history = optimizationHistory;  // Local alias for compatibility
      let iter = 0;
      let bestF = Infinity;
      let lastTs = performance.now();
      let iterCounter = 0;
      playbackState.frames = [];
      playbackState.idx = 0;
      scrub.max = 0;
      stallNotified = false;
      lastImproveIter = 0;

      const stepOnce = () => {
        const lambda = es.lambda;
        const candFlat = es.ask_flat();
        const fits = new Float64Array(lambda);
        const candidates = [];
        for (let k = 0; k < lambda; k++) {
          let offset = k * dim;
          let v = candFlat.slice(offset, offset + dim);
          let penalty = 0;
          let attempts = 0;
          while (true) {
            const constraint = applyConstraint(v);
            if (constraint.wantResample && attempts < (constraint.cap || 3)) {
              attempts += 1;
              offset = k * dim; // reuse same slice
              v = candFlat.slice(offset, offset + dim);
              continue;
            }
            if (constraint.wantResample) {
              v = constraint.clamped;
              penalty = constraint.penalty || 0;
            } else {
              v = constraint.vec;
              penalty = constraint.penalty || 0;
            }
            break;
          }
          candidates.push(Array.from(v));
          fits[k] = bench.f(v) + penalty;
        }
        es.tell_flat(fits);
        const res = es.result();
        const covArr = Array.from(es.cov_matrix());
        const cov2x2 = [covArr[0], covArr[1], covArr[2], covArr[3]];
        if (res.best_f < bestF - 1e-12) {
          bestF = res.best_f;
          lastImproveIter = iter;
        }
        history.push({ iter, best: bestF });
        iterCounter++;

        const bestVec = Array.from(res.best_x());
        const proj = projectCandidates(candidates, bestVec, dim);
        render(history, proj.pts, res, proj.b, cov2x2);
        // Store frame for scrub
        const meanPt = { x: res.xmean()[0], y: res.xmean()[1] };
        if (playbackState.frames.length > 1000) playbackState.frames.shift();
        playbackState.frames.push({
          pts: proj.pts,
          mean: meanPt,
          cov: cov2x2,
          best: proj.b,
          bestF: res.best_f,
          iter,
        });
        scrub.max = playbackState.frames.length - 1;

        const delta = history.length > 1 ? history[history.length - 2].best - res.best_f : 0;
        const boost = Math.max(1.0, Math.min(1.25, 1.0 + Math.abs(delta) * 2));
        gsap.fromTo(bestEl, { scale: 1 }, { scale: boost, duration: 0.35, ease: 'sine.out' });

        if (!stallNotified && iter - lastImproveIter >= 50) {
          stallNotified = true;
          showToast('Progress stalled: try increasing σ (e.g., ×1.5) or λ.', 'warning', 4000);
          paramRec.classList.remove('hidden');
          paramRecText.textContent = 'Stall detected: consider σ ×1.5 or higher λ for more exploration.';
        }

        iter++;
        const now = performance.now();
        if (now - lastTs > 1000) {
          hudIter.textContent = `${iterCounter} iter/s`;
          iterCounter = 0;
          lastTs = now;
        }

        if (!es.stop_status().stopped && iter < maxIter) {
          requestAnimationFrame(stepOnce);
        } else {
          statusEl.textContent = `Done in ${iter} iterations / ${res.evals} evals`;
          hudWasm.textContent = `${res.evals} evals`;
          currentSummary = summarizeRun(history, currentRunMetadata, res.best_f);
          const record = addRunRecord(history, res);
          pinnedRunId = pinnedRunId || record.id;
          renderLegend();
          renderStatsPanel(currentSummary);
          updateChips();
        }
      };

      statusEl.textContent = `Running ${bench.title}...`;
      updateChips();
      requestAnimationFrame(stepOnce);
    }

    function runJsBaseline(dimOverride) {
      const bench = benchFns[benchSelect.value];
      const lambda = Number(lambdaInput.value) || 32;
      const sigma0 = Number(sigmaInput.value) || 1.2;
      const maxIter = Number(itersInput.value) || 250;
      const seed = Number(seedInput.value) || 42;
      const dim = dimOverride || 2;

      const rng = (() => {
        let state = BigInt(seed || 1);
        return () => {
          state = (6364136223846793005n * state + 1n) & ((1n << 64n) - 1n);
          return Number(state >> 11n) / 9007199254740992;
        };
      })();

      let mean = Array.from({ length: dim }, (_, i) => bench.x0[i % bench.x0.length] || 0);
      let sigma = sigma0;
      const sample = () => {
        const z = [];
        for (let i=0;i<dim;i++) {
          const u1 = Math.max(1e-12, 1 - rng());
          const u2 = 1 - rng();
          const r = Math.sqrt(-2*Math.log(u1));
          const th = 2*Math.PI*u2;
          z.push(r*Math.cos(th));
        }
        return z.map((zi, i) => mean[i] + sigma * zi);
      };

      let bestF = Infinity;
      let bestX = mean.slice();
      const t0 = performance.now();
      for (let iter=0; iter<maxIter; iter++) {
        const cand = [];
        for (let k=0;k<lambda;k++) {
          let tries = 0;
          let x = sample();
          let constraint;
          while (true) {
            constraint = applyConstraint(x);
            if (constraint.wantResample && tries < (constraint.cap || 3)) {
              tries += 1;
              x = sample();
              continue;
            }
            if (constraint.wantResample) {
              x = constraint.clamped;
            } else {
              x = constraint.vec;
            }
            break;
          }
          let f = bench.f(x) + (constraint.penalty || 0);
          cand.push({x,f});
          if (f < bestF) { bestF = f; bestX = x; }
        }
        cand.sort((a,b)=>a.f-b.f);
        const mu = Math.max(1, Math.floor(lambda/4));
        mean = Array(dim).fill(0);
        for (let i=0;i<mu;i++) {
          for (let d=0; d<dim; d++) mean[d] += cand[i].x[d];
        }
        for (let d=0; d<dim; d++) mean[d] /= mu;
        sigma *= 0.99;
      }
      const t1 = performance.now();
      const msg = `Baseline JS: best f=${bestF.toExponential(3)} in ${(t1-t0).toFixed(1)} ms`;
      if (hudJs) hudJs.textContent = msg;
      return { bestF, ms: (t1-t0), bestX };
    }

    function render(hist, batch, res, projBest, cov) {
      if (!hist.length) return;
      const allHists = [hist, ...pastRuns.map((r) => r.hist)];
      const flatBest = allHists.flatMap((h) => h.map((d) => d.best)).filter(Number.isFinite);
      const yMin = Math.max(1e-9, Math.min(...flatBest));
      const yMaxRaw = Math.max(...flatBest);
      const yMax = yMaxRaw <= yMin ? yMin * 1.05 + 1e-9 : yMaxRaw;
      const maxIterAll = Math.max(...allHists.map((h) => (h.length ? h[h.length - 1].iter : 0)));
      const xDomain = [0, maxIterAll + 1];
      lineX.domain(xDomain);
      lineY.domain([yMin, yMax]);

      lineG.select('.axis-x').call(d3.axisBottom(lineX).ticks(8).tickSizeOuter(0));
      lineG.select('.axis-y').call(d3.axisLeft(lineY).ticks(6, "~g"));

      const lineGen = d3.line()
        .x((d) => lineX(d.iter))
        .y((d) => lineY(d.best))
        .curve(d3.curveCatmullRom.alpha(0.6));
      linePath.attr('d', lineGen(hist));

      // overlay previous runs
      const overlayLine = d3.line()
        .x((d) => lineX(d.iter))
        .y((d) => lineY(d.best))
        .curve(d3.curveCatmullRom.alpha(0.6));

      overlayGroup.selectAll('path.overlay-line')
        .data(pastRuns, (d) => d.id)
        .join(
          (enter) => enter.append('path')
            .attr('class', 'overlay-line')
            .attr('fill', 'none')
            .attr('stroke-width', (d) => d.id === pinnedRunId ? 3 : 1.5)
            .attr('stroke', (d) => d.color)
            .attr('opacity', (d) => d.id === pinnedRunId ? 0.9 : 0.5)
            .attr('d', (d) => overlayLine(d.hist)),
          (update) => update
            .attr('stroke-width', (d) => d.id === pinnedRunId ? 3 : 1.5)
            .attr('opacity', (d) => d.id === pinnedRunId ? 0.9 : 0.5)
            .attr('stroke', (d) => d.color)
            .attr('d', (d) => overlayLine(d.hist)),
          (exit) => exit.remove()
        );

      const meanPt = projBest || { x: res.best_x()[0], y: res.best_x()[1] };
      updatePoints(batch, meanPt);
      if (cov) updateEllipse(meanPt, cov);

      bestEl.textContent = `best f = ${res.best_f.toExponential(3)}`;
      iterEl.textContent = `Iter ${hist[hist.length - 1].iter}`;
      updateChips();

      renderPCAView(batch, dim);
    }

    runBtn.addEventListener('click', run);
    if (quickRunBtn) quickRunBtn.addEventListener('click', run);
    if (runSampleBtn) runSampleBtn.addEventListener('click', runSample);
    [chartEmptyRun, threeEmptyRun].forEach((btn) => btn?.addEventListener('click', run));
    [chartEmptySample, threeEmptySample].forEach((btn) => btn?.addEventListener('click', runSample));

    if (reduceMotionToggle) {
      reduceMotionToggle.addEventListener('click', () => {
        const enabled = document.body.classList.toggle('reduce-motion');
        reduceMotionToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        reduceMotionOn = enabled;
        applyReduceMotion();
      });
    }

    inlinePresetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.presetId;
        applyPresetById(id, { toast: true });
      });
    });

    runJsBtn.addEventListener('click', () => runJsBaseline());
    runRaceBtn.addEventListener('click', async () => {
      statusEl.textContent = 'Race: running WASM...';
      updateChips();
      const benchKey = benchSelect.value;
      const bench = benchFns[benchKey];
      const lambda = Number(lambdaInput.value) || 32;
      const sigma = Number(sigmaInput.value) || 1.2;
      const maxIter = Number(itersInput.value) || 250;
      const seed = Number(seedInput.value) || 42;
      const dim = currentDim(benchKey);
      const opts = buildOptions(lambda, maxIter, seed, dim);
      if (!wasmInitialized) { await init(); wasmInitialized = true; }
      const x0 = new Float64Array(dim);
      for (let i = 0; i < dim; i++) x0[i] = bench.x0[i % bench.x0.length] || 0;
      const es = new WasmCmaes(x0, sigma, opts);
      const t0 = performance.now();
      while (!es.stop_status().stopped) {
        const candFlat = es.ask_flat();
        const fits = new Float64Array(es.lambda);
        for (let k = 0; k < es.lambda; k++) {
          const offset = k * dim;
          fits[k] = bench.f(candFlat.slice(offset, offset + dim));
        }
        es.tell_flat(fits);
        if (es.evals >= opts.maxEvals) break;
      }
      const wasmMs = performance.now() - t0;
      const wasmRes = es.result();
      hudWasm.textContent = `${wasmRes.evals} evals, ${wasmMs.toFixed(1)} ms`;

      statusEl.textContent = 'Race: running JS baseline...';
      updateChips();
      const jsRes = runJsBaseline(dim);
      
      const resultMsg = `Race Complete!\nWASM: ${wasmRes.best_f.toExponential(3)} (${wasmMs.toFixed(1)}ms)\nJS: ${jsRes.bestF.toExponential(3)} (${jsRes.ms.toFixed(1)}ms)`;
      showToast(resultMsg, 'success', 5000);
      updateChips();
    });

    const playLoop = () => {
      if (!playbackState.playing || playbackState.frames.length === 0) return;
      playbackState.idx = (playbackState.idx + 1) % playbackState.frames.length;
      scrub.value = playbackState.idx;
      const frame = playbackState.frames[playbackState.idx];
      updatePoints(frame.pts, frame.mean);
      updateEllipse(frame.mean, frame.cov);
      iterEl.textContent = `Iter ${frame.iter}`;
      bestEl.textContent = `best f = ${frame.bestF?.toExponential?.(3) ?? '–'}`;
      updateChips();
      requestAnimationFrame(playLoop);
    };

    scrub.addEventListener('input', () => {
      const idx = Number(scrub.value) || 0;
      playbackState.idx = idx;
      const frame = playbackState.frames[idx];
      if (frame) {
        updatePoints(frame.pts, frame.mean);
        updateEllipse(frame.mean, frame.cov);
        iterEl.textContent = `Iter ${frame.iter}`;
        bestEl.textContent = `best f = ${frame.bestF?.toExponential?.(3) ?? '–'}`;
        updateChips();
      }
    });

    scrubPlay.addEventListener('click', () => {
      playbackState.playing = !playbackState.playing;
      scrubPlay.textContent = playbackState.playing ? '⏸' : '▶';
      if (playbackState.playing) requestAnimationFrame(playLoop);
    });

    // Register service worker for PWA/offline support (best-effort)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(swPath()).catch((err) => {
        console.warn('Service worker registration failed', err);
      });
    }
    const tutorialSteps = [
      'Sampling: CMA-ES draws λ candidates from a multivariate normal around the mean.',
      'Selection: rank candidates, take top μ with log weights.',
      'Adaptation: update mean, covariance (full/sep/lm), and step size σ.',
      'Stop: ftarget, max evals, TolFun/TolX, or ill-conditioned covariance.',
      'Restarts: optional IPOP/BIPOP strategies to escape local minima.'
    ];
    let tutorialIdx = 0;
    const tutorialOverlay = document.getElementById('tutorial-overlay');
    const tutorialContent = document.getElementById('tutorial-content');
    const tutorialStepCount = document.getElementById('tutorial-step-count');
    const tutorialPrev = document.getElementById('tutorial-prev');
    const tutorialNext = document.getElementById('tutorial-next');
    const tutorialClose = document.getElementById('tutorial-close');
    const tutorialSkip = document.getElementById('tutorial-skip');
    const startTutorialBtn = document.getElementById('start-tutorial');

    const renderTutorial = () => {
      if (!tutorialContent || !tutorialStepCount) return;
      tutorialContent.textContent = tutorialSteps[tutorialIdx];
      tutorialStepCount.textContent = `Step ${tutorialIdx + 1} of ${tutorialSteps.length}`;
    };
    if (tutorialOverlay) renderTutorial();

    const openTutorial = () => {
      if (tutorialOverlay) {
          tutorialOverlay.classList.remove('hidden');
          renderTutorial();
      }
    };
    const closeTutorial = () => {
      if (tutorialOverlay) tutorialOverlay.classList.add('hidden');
    };

    if (tutorialPrev) tutorialPrev.addEventListener('click', () => {
      tutorialIdx = (tutorialIdx - 1 + tutorialSteps.length) % tutorialSteps.length;
      renderTutorial();
    });
    if (tutorialNext) tutorialNext.addEventListener('click', () => {
      tutorialIdx = (tutorialIdx + 1) % tutorialSteps.length;
      renderTutorial();
    });
    if (tutorialClose) tutorialClose.addEventListener('click', closeTutorial);
    if (tutorialSkip) tutorialSkip.addEventListener('click', closeTutorial);
    if (startTutorialBtn) startTutorialBtn.addEventListener('click', openTutorial);

    // Mobile bottom sheet controls + sync with desktop controls
    const toggleAdvanced = document.getElementById('toggle-advanced') || document.getElementById('toggle-advanced-desktop');
    const advancedOptions = document.getElementById('advanced-options');

    if (toggleAdvanced && advancedOptions) {
      toggleAdvanced.addEventListener('click', () => {
        const hidden = advancedOptions.classList.toggle('hidden');
        const arrow = toggleAdvanced.querySelector('svg');
        if (arrow) arrow.style.transform = hidden ? 'rotate(0deg)' : 'rotate(180deg)';
        toggleAdvanced.setAttribute('aria-expanded', hidden ? 'false' : 'true');
      });
    }

    const syncPairs = [
      ['bench', 'bench-mobile'],
      ['lambda', 'lambda-mobile'],
      ['sigma', 'sigma-mobile'],
      ['iters', 'iters-mobile'],
      ['seed', 'seed-mobile'],
    ];
    syncPairs.forEach(([desktopId, mobileId]) => {
      const d = mustGet(desktopId);
      const m = mustGet(mobileId);
      const copy = (src, dst) => dst && (dst.value = src.value);
      d.addEventListener('input', () => copy(d, m));
      m.addEventListener('input', () => copy(m, d));
      // initialize mobile with desktop defaults
      copy(d, m);
    });

    // Mobile run button uses the same run pipeline then closes the sheet
    var mobileRunButton = document.getElementById('run-mobile');
    if (mobileRunButton) mobileRunButton.addEventListener('click', () => {
      run();
      // If we want to close the pane on run:
      // window.pane?.destroy({animate: true}); // No, we want to hide/lower it.
      // window.pane?.moveToBreak('bottom'); 
      // But pane is in the HTML script scope, not module scope.
      // We'll let the user manage the sheet or add a global hook if needed.
      // For now, just run.
    });

    // FPS HUD
    let lastFrame = performance.now();
    let frames = 0;
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - lastFrame > 1000) {
        hudFps.textContent = `${frames} fps`;
        frames = 0;
        lastFrame = now;
      }
      requestAnimationFrame(tick);
    };
    tick();

    // Background Three.js particles
    const canvas = bgCanvas;
    const rendererBg = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    const sceneBg = new THREE.Scene();
    const cameraBg = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1000);
    cameraBg.position.z = 200;
    const geometryBg = new THREE.BufferGeometry();
    const COUNT = 800;
    const positionsBg = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT * 3; i++) positionsBg[i] = (Math.random() - 0.5) * 400;
    geometryBg.setAttribute('position', new THREE.BufferAttribute(positionsBg, 3));
    const materialBg = new THREE.PointsMaterial({ color: 0x38bdf8, size: 1.6, transparent: true, opacity: 0.6 });
    const pointsBg = new THREE.Points(geometryBg, materialBg);
    sceneBg.add(pointsBg);

    function startBg() {
      if (reduceMotionOn || bgRaf) return;
      const loop = () => {
        pointsBg.rotation.y += 0.0008;
        pointsBg.rotation.x += 0.0004;
        rendererBg.render(sceneBg, cameraBg);
        bgRaf = requestAnimationFrame(loop);
      };
      bgRaf = requestAnimationFrame(loop);
    }

    // Optional 3D surface of the current benchmark (preview only, not exact scale)
    let surface;
    function buildSurface(fn) {
      if (surface) scene.remove(surface);
      
      const planeSize = 60;
      const res = 80; // Higher resolution
      const geo = new THREE.PlaneGeometry(planeSize, planeSize, res, res);
      const pos = geo.attributes.position;
      
      let min = Infinity, max = -Infinity;
      
      // 1. Calculate Z values and find range
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) / 5; // shrink input domain
        const y = pos.getY(i) / 5;
        const z = -fn([x, y]); // Invert so peaks are high fitness (actually f is min, so -f is max?)
        // Wait, CMA-ES minimizes f.
        // If we plot -f, then the "valley" becomes a "peak".
        // Usually optimization surfaces show the valley.
        // So z should be f(x,y). But Three.js Y is up.
        // If we want a valley, z should be f(x,y).
        // But the original code used -fn([x,y]).
        // Let's stick to -fn so "better" is "higher" visually?
        // Or maybe "lower" is better.
        // If I use -fn, then minima are maxima (hills).
        // If I use fn, then minima are valleys.
        // Visualizing valleys is more intuitive for "minimization".
        // But let's check what the previous code did: `z = -fn([x,y])`.
        // So it turned valleys into hills.
        // I'll stick to that for consistency, or maybe invert it if I want valleys.
        // Let's keep it as hills (maximization of negative cost).
        pos.setZ(i, z);
        if (z < min) min = z;
        if (z > max) max = z;
      }
      
      // 2. Vertex Colors
      const colors = [];
      const range = max - min + 1e-9;
      for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        const t = (z - min) / range;
        const rgb = viridis(t);
        colors.push(((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      
      geo.computeVertexNormals();
      
      const mat = new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        flatShading: false,
        metalness: 0.1,
        roughness: 0.3,
        transmission: 0.0, // Opaque surface is clearer for colors
        reflectivity: 0.5,
        clearcoat: 0.3,
        clearcoatRoughness: 0.2
      });
      
      surface = new THREE.Mesh(geo, mat);
      surface.rotation.x = -Math.PI / 2;
      scene.add(surface);
    }

    // Lights for the surface
    const light1 = new THREE.PointLight(0x38bdf8, 1, 400);
    light1.position.set(80, 120, 120);
    scene.add(light1);
    const light2 = new THREE.PointLight(0x6366f1, 0.7, 400);
    light2.position.set(-60, 120, -80);
    scene.add(light2);

    const onResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      rendererBg.setSize(w, h);
      cameraBg.aspect = w / h;
      cameraBg.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    onResize();
    applyReduceMotion();
    startBg();

    // Subtle GSAP float on panels
    gsap.utils.toArray('.panel').forEach((el, i) => {
      gsap.to(el, { y: '+=6', duration: 3 + i * 0.2, repeat: -1, yoyo: true, ease: 'sine.inOut', delay: i * 0.1 });
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(swPath()).catch((err) => {
        console.warn('Service worker registration failed', err);
      });
    }

    // ============================================================================
    // ENHANCEMENTS: Toast notifications, keyboard shortcuts, export, help
    // ============================================================================

    // Toast notification system
    function showToast(message, type = 'info', duration = 3000) {
      const container = toastContainer;
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = `toast toast-${type} px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium transform transition-all duration-300 translate-x-full`;

      const colors = {
        info: 'bg-blue-500',
        success: 'bg-green-500',
        warning: 'bg-yellow-500',
        error: 'bg-red-500'
      };
      toast.classList.add(colors[type] || colors.info);

      const icons = {
        info: 'ℹ️',
        success: '✓',
        warning: '⚠️',
        error: '✗'
      };
      const iconSpan = document.createElement('span');
      iconSpan.className = 'mr-2';
      iconSpan.textContent = icons[type] || icons.info;
      const messageSpan = document.createElement('span');
      messageSpan.textContent = message;
      toast.replaceChildren(iconSpan, messageSpan);

      container.appendChild(toast);

      // Animate in
      setTimeout(() => toast.classList.remove('translate-x-full'), 50);

      // Auto-remove
      setTimeout(() => {
        toast.classList.add('translate-x-full', 'opacity-0');
        setTimeout(() => container.removeChild(toast), 300);
      }, duration);
    }

    // Export to CSV
    function exportCSV() {
      if (!optimizationHistory || optimizationHistory.length === 0) {
        showToast('No optimization data to export', 'warning');
        return;
      }

      const headers = 'iteration,best_value,lambda\n';
      const rows = optimizationHistory.map((h, i) => {
        return `${i + 1},${h.best},${lambdaInput.value}`;
      }).join('\n');

      const csv = headers + rows;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cmaes-${currentRunMetadata?.benchmark || benchSelect.value}-${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast('CSV exported successfully', 'success');
    }

    // Export to JSON
    function exportJSON() {
      if (!optimizationHistory || optimizationHistory.length === 0) {
        showToast('No optimization data to export', 'warning');
        return;
      }

      const data = {
        benchmark: currentRunMetadata?.benchmark || benchSelect.value,
        parameters: currentRunMetadata || {
          lambda: Number(lambdaInput.value),
          sigma: Number(sigmaInput.value),
          maxIterations: Number(itersInput.value),
          seed: Number(seedInput.value),
          dimensions: currentDim(benchSelect.value)
        },
        history: optimizationHistory,
        timestamp: new Date().toISOString(),
        finalBest: optimizationHistory[optimizationHistory.length - 1]?.best
      };

      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cmaes-${currentRunMetadata?.benchmark || benchSelect.value}-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast('JSON exported successfully', 'success');
    }

    function summarizeRun(hist, metadata, fallbackBest) {
      const bestValues = hist.map((h) => h.best).filter(Number.isFinite);
      const n = bestValues.length || 1;
      const mean = bestValues.reduce((a, b) => a + b, 0) / n;
      const sorted = [...bestValues].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      const variance = bestValues.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
      const std = Math.sqrt(variance);
      let cond = 1;
      try {
        const stds = Array.from(metadata?.stds ?? []);
        if (stds.length) {
          const mn = Math.max(1e-12, Math.min(...stds));
          const mx = Math.max(...stds);
          cond = (mx / mn) ** 2;
        }
      } catch (_) { /* ignore */ }
      return {
        best: bestValues[bestValues.length - 1] ?? fallbackBest,
        mean,
        median,
        std,
        bench: metadata?.benchmark || benchSelect.value,
        lambda: metadata?.lambda || Number(lambdaInput.value),
        sigma: metadata?.sigma || Number(sigmaInput.value),
        cond,
        model: metadata?.model || covarModelSelect.value,
        evals: metadata?.evals || null,
        noisy: metadata?.noisy || noisyToggle.checked,
      };
    }

    // Share configuration via URL
    function buildConfigURL(overrides = {}) {
      const params = new URLSearchParams({
        bench: overrides.bench ?? benchSelect.value,
        lambda: overrides.lambda ?? lambdaInput.value,
        sigma: overrides.sigma ?? sigmaInput.value,
        iters: overrides.iters ?? itersInput.value,
        seed: overrides.seed ?? seedInput.value,
        model: overrides.model ?? covarModelSelect.value,
        bounds: overrides.boundsEnabled ?? boundsToggle.checked,
        lo: overrides.lo ?? boundLo.value,
        hi: overrides.hi ?? boundHi.value
      });
      if (noisyToggle.checked) params.set('noisy', 'true');
      if (penaltyWeightInput) params.set('penalty', penaltyWeightInput.value);
      if (constraintStrategySelect) params.set('cstrategy', constraintStrategySelect.value);
      if (resampleCapInput) params.set('rescap', resampleCapInput.value);
      return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    }

    function copyTextWithFallback(text, successMsg = 'Copied to clipboard', errorMsg = 'Copy failed') {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          showToast(successMsg, 'success');
        }).catch(() => {
          showToast(errorMsg, 'error');
        });
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
          showToast(successMsg, 'success');
        } catch (err) {
          showToast(errorMsg, 'error');
        }
        document.body.removeChild(textArea);
      }
    }

    function shareConfig(overrides = {}) {
      const url = buildConfigURL(overrides);
      copyTextWithFallback(url, 'Configuration URL copied to clipboard!', 'Failed to copy URL');
    }

    // Load configuration from URL on page load
    function loadConfigFromURL() {
      const params = new URLSearchParams(window.location.search);

      if (params.has('bench')) benchSelect.value = params.get('bench');
      if (params.has('lambda')) lambdaInput.value = params.get('lambda');
      if (params.has('sigma')) sigmaInput.value = params.get('sigma');
      if (params.has('iters')) itersInput.value = params.get('iters');
      if (params.has('seed')) seedInput.value = params.get('seed');
      if (params.has('model')) covarModelSelect.value = params.get('model');
      if (params.has('bounds')) boundsToggle.checked = params.get('bounds') === 'true';
      if (params.has('lo')) boundLo.value = params.get('lo');
      if (params.has('hi')) boundHi.value = params.get('hi');
      if (params.has('noisy')) {
        const isNoisy = params.get('noisy') === 'true';
        noisyToggle.checked = isNoisy;
        if (mobileRefs.noisy) mobileRefs.noisy.checked = isNoisy;
      }
      if (params.has('penalty') && penaltyWeightInput) penaltyWeightInput.value = params.get('penalty');
      if (params.has('cstrategy') && constraintStrategySelect) constraintStrategySelect.value = params.get('cstrategy');
      if (params.has('rescap') && resampleCapInput) resampleCapInput.value = params.get('rescap');

      // Mirror to mobile controls if present
      if (mobileRefs.bench) mobileRefs.bench.value = benchSelect.value;
      if (mobileRefs.lambda) mobileRefs.lambda.value = lambdaInput.value;
      if (mobileRefs.sigma) mobileRefs.sigma.value = sigmaInput.value;
      if (mobileRefs.iters) mobileRefs.iters.value = itersInput.value;
      if (mobileRefs.seed) mobileRefs.seed.value = seedInput.value;
      if (mobileRefs.covar) mobileRefs.covar.value = covarModelSelect.value;
      if (mobileRefs.bounds) mobileRefs.bounds.checked = boundsToggle.checked;
      if (mobileRefs.lo) mobileRefs.lo.value = boundLo.value;
      if (mobileRefs.hi) mobileRefs.hi.value = boundHi.value;
      if (mobileRefs.constraintStrategy && constraintStrategySelect) mobileRefs.constraintStrategy.value = constraintStrategySelect.value;
      if (mobileRefs.resampleCap && resampleCapInput) mobileRefs.resampleCap.value = resampleCapInput.value;
      if (mobileRefs.penaltyWeight && penaltyWeightInput) mobileRefs.penaltyWeight.value = penaltyWeightInput.value;

      if (params.size > 0) {
        showToast('Configuration loaded from URL', 'info');
      }
    }

    function renderStatsPanel(currentSummary) {
      if (!comparisonStats) return;
      const pinned = pastRuns.find((r) => r.id === pinnedRunId);
      const last = lastRunId ? pastRuns.find((r) => r.id === lastRunId) : null;

      const toRow = (label, run) => {
        if (!run || !run.summary) return `${label}: –`;
        const parts = [
          `${label}:`,
          `best ${run.summary.best.toExponential(3)}`,
          `mean ${run.summary.mean.toExponential(3)}`,
          `median ${run.summary.median.toExponential(3)}`,
          `std ${run.summary.std.toExponential(3)}`,
          `model ${run.summary.model || 'auto'}`,
          run.summary.noisy ? 'noisy' : 'clean'
        ];
        return parts.join(' | ');
      };

      const lines = [
        toRow('Current', { summary: currentSummary }),
        toRow('Pinned', pinned),
        toRow('Last', last)
      ];
      comparisonStats.textContent = lines.join('   ');

      const pinnedBest = pinned?.summary?.best;
      const pinnedEvals = pinned?.summary?.evals;
      const deltaBest = pinnedBest != null && currentSummary?.best != null
        ? currentSummary.best - pinnedBest
        : null;
      const deltaEvals = pinnedEvals != null && currentSummary?.evals != null
        ? currentSummary.evals - pinnedEvals
        : null;
      const deltaStr = deltaBest != null ? `Δbest vs pinned: ${deltaBest >= 0 ? '+' : ''}${deltaBest.toExponential(3)}` : 'Δbest: –';
      const evalStr = deltaEvals != null ? `Δevals: ${deltaEvals >= 0 ? '+' : ''}${deltaEvals}` : 'Δevals: –';
      if (hudModel) hudModel.textContent = `Model ${covarModelSelect.value} | ${deltaStr} | ${evalStr}`;
    }

    function renderLegend() {
      if (!comparisonLegend) return;
      comparisonLegend.replaceChildren();
      pastRuns.forEach((run) => {
        const pill = document.createElement('div');
        pill.className = 'px-3 py-1.5 rounded-full text-xs flex items-center gap-2 border border-slate-700';
        const swatch = document.createElement('span');
        swatch.style.backgroundColor = run.color;
        swatch.className = 'w-3 h-3 rounded-full inline-block';
        const text = document.createElement('span');
        text.textContent = `${run.label} (${run.summary.best.toExponential(3)}) [${run.summary.model || 'auto'}${run.summary.noisy ? ', noisy' : ''}]`;
        pill.append(swatch, text);
        comparisonLegend.appendChild(pill);
      });
    }

    function renderParcoords() {
      if (!parcoordsSvg) return;
      const width = parcoordsSvg.clientWidth || parcoordsSvg.getBoundingClientRect().width || 320;
      const height = parcoordsSvg.clientHeight || 180;
      const margin = { top: 10, right: 10, bottom: 20, left: 10 };
      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;
      const svg = d3.select(parcoordsSvg);
      svg.selectAll('*').remove();

      if (!pastRuns.length) {
        svg.append('text')
          .attr('x', width / 2)
          .attr('y', height / 2)
          .attr('text-anchor', 'middle')
          .attr('fill', '#94a3b8')
          .attr('font-size', 12)
          .text('No runs yet');
        return;
      }

      const data = pastRuns.map((r) => ({
        ...r.summary,
        color: r.color,
        label: r.label,
      }));

      const x = d3.scalePoint()
        .domain(parcoordsAxes)
        .range([0, innerW])
        .padding(0.5);

      const yScales = {};
      parcoordsAxes.forEach((axis) => {
        const vals = data.map((d) => d[axis]).filter((v) => Number.isFinite(v));
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const pad = (max - min) * 0.1 + 1e-9;
        yScales[axis] = d3.scaleLinear()
          .domain([min - pad, max + pad])
          .range([innerH, 0]);
      });

      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

      g.selectAll('.axis')
        .data(parcoordsAxes)
        .join('g')
        .attr('class', 'axis')
        .attr('transform', (d) => `translate(${x(d)},0)`)
        .each(function(axis) {
          d3.select(this).call(d3.axisLeft(yScales[axis]).ticks(4).tickSizeOuter(0));
        })
        .append('text')
        .attr('y', -6)
        .attr('fill', '#cbd5e1')
        .attr('text-anchor', 'middle')
        .attr('font-size', 10)
        .text((d) => d);

      const line = d3.line()
        .defined(([, v]) => Number.isFinite(v))
        .x(([axis]) => x(axis))
        .y(([axis, v]) => yScales[axis](v));

      g.selectAll('.par-line')
        .data(data)
        .join('path')
        .attr('class', 'par-line')
        .attr('fill', 'none')
        .attr('stroke', (d) => d.color)
        .attr('stroke-width', 2)
        .attr('opacity', 0.75)
        .attr('d', (d) => line(parcoordsAxes.map((axis) => [axis, d[axis]])));
    }

    function renderPCAView(batch, dim) {
      if (!pcaContainer || !pcaSvg) return;
      if (dim <= 2) {
        pcaContainer.classList.add('hidden');
        return;
      }
      pcaContainer.classList.remove('hidden');
      const width = pcaSvg.clientWidth || pcaSvg.getBoundingClientRect().width || 320;
      const height = pcaSvg.clientHeight || 180;
      const margin = { top: 10, right: 10, bottom: 20, left: 30 };
      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;
      const svg = d3.select(pcaSvg);
      svg.selectAll('*').remove();

      if (!batch.length) {
        svg.append('text')
          .attr('x', width / 2)
          .attr('y', height / 2)
          .attr('text-anchor', 'middle')
          .attr('fill', '#94a3b8')
          .attr('font-size', 12)
          .text('No points');
        return;
      }

      const xs = batch.map((p) => p.x);
      const ys = batch.map((p) => p.y);
      const xScale = d3.scaleLinear().domain(d3.extent(xs)).nice().range([0, innerW]);
      const yScale = d3.scaleLinear().domain(d3.extent(ys)).nice().range([innerH, 0]);

      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
      g.append('g')
        .attr('transform', `translate(0,${innerH})`)
        .call(d3.axisBottom(xScale).ticks(4));
      g.append('g')
        .call(d3.axisLeft(yScale).ticks(4));

      g.selectAll('circle')
        .data(batch)
        .join('circle')
        .attr('cx', (d) => xScale(d.x))
        .attr('cy', (d) => yScale(d.y))
        .attr('r', 3)
        .attr('fill', '#22d3ee')
        .attr('opacity', 0.75);
    }

    function addRunRecord(hist, res) {
      runCounter += 1;
      const color = overlayPalette[(runCounter - 1) % overlayPalette.length];
      const id = `run-${Date.now()}-${runCounter}`;
      const resMeta = {
        benchmark: benchSelect.value,
        lambda: Number(lambdaInput.value),
        sigma: Number(sigmaInput.value),
        model: covarModelSelect.value,
        stds: res?.stds ? Array.from(res.stds()) : undefined,
        evals: res?.evals,
        noisy: noisyToggle.checked,
      };
      const summary = summarizeRun(hist, resMeta, res?.best_f);
      const record = {
        id,
        label: `Run ${runCounter} · ${benchSelect.value}`,
        hist: hist.map((d) => ({ ...d })), // clone
        color,
        summary
      };
      lastRunId = pastRuns.length ? pastRuns[pastRuns.length - 1].id : null;
      pastRuns.push(record);
      renderLegend();
      renderStatsPanel(summary);
      renderParcoords();
      return record;
    }
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Don't trigger shortcuts when typing in inputs or Monaco editor
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Don't trigger shortcuts when typing in Monaco editor
      if (editorContainer && editorContainer.contains(e.target)) return;

      // Space: Run optimization
      if (e.key === ' ') {
        e.preventDefault();
        run();
      }

      // R: Reset to defaults
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        benchSelect.value = 'sphere';
        lambdaInput.value = '32';
        sigmaInput.value = '1.2';
        itersInput.value = '250';
        seedInput.value = '42';
        showToast('Reset to default values', 'info');
      }

      // H or ?: Show help
      if (e.key === 'h' || e.key === 'H' || e.key === '?') {
        e.preventDefault();
        toggleHelp();
      }

      // Ctrl/Cmd + S: Share configuration
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        shareConfig();
      }

      // Ctrl/Cmd + E: Export CSV
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        exportCSV();
      }

      // Ctrl/Cmd + Shift + E: Export JSON
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        exportJSON();
      }

      // Escape: Close help overlay
      if (e.key === 'Escape' && helpOverlay && !helpOverlay.classList.contains('hidden')) {
        toggleHelp();
      }
    });

    // Help overlay toggle with focus management and focus trapping
    let helpTriggerElement = null;

    function toggleHelp() {
      if (!helpOverlay) return;
      const isHidden = helpOverlay.classList.contains('hidden');

      if (isHidden) {
        // Opening - store current focus and move to overlay
        helpTriggerElement = document.activeElement;
        helpOverlay.classList.remove('hidden');

        // Focus the close button for keyboard accessibility
        setTimeout(() => {
          if (helpCloseBtn) helpCloseBtn.focus();
        }, 50);

        // Add focus trap
        helpOverlay.addEventListener('keydown', trapFocus);
      } else {
        // Closing - return focus to trigger
        helpOverlay.classList.add('hidden');
        helpOverlay.removeEventListener('keydown', trapFocus);

        if (helpTriggerElement && typeof helpTriggerElement.focus === 'function') {
          helpTriggerElement.focus();
          helpTriggerElement = null;
        }
      }
    }

    // Trap focus inside help overlay (accessibility requirement for modals)
    function trapFocus(e) {
      if (e.key !== 'Tab') return;

      if (!helpOverlay) return;
      const focusableElements = helpOverlay.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        // Shift+Tab - if on first element, go to last
        if (document.activeElement === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else {
        // Tab - if on last element, go to first
        if (document.activeElement === lastElement) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    }

    // Initialize: Load config from URL if present
    loadConfigFromURL();
    updateBenchRecommendation(benchSelect.value);
    renderPresetGallery();
    renderPresetGallery(true);
    renderRecentPresets();
    renderRecentPresets(true);
    renderQuickstart();
    renderGlossary();

    // Add event listeners to export buttons if they exist
    exportCsvBtn.addEventListener('click', exportCSV);
    exportJsonBtn.addEventListener('click', exportJSON);
    shareBtn.addEventListener('click', shareConfig);
    if (helpBtn) helpBtn.addEventListener('click', toggleHelp);
    if (helpCloseX) helpCloseX.addEventListener('click', toggleHelp);
    if (helpCloseBtn) helpCloseBtn.addEventListener('click', toggleHelp);

    covarModelSelect.addEventListener('change', () => {
      if (mobileRefs.covar) mobileRefs.covar.value = covarModelSelect.value;
      hudModel.textContent = `Model ${covarModelSelect.value}`;
    });
    if (mobileRefs.covar) {
      mobileRefs.covar.addEventListener('change', () => {
        covarModelSelect.value = mobileRefs.covar.value;
        hudModel.textContent = `Model ${covarModelSelect.value}`;
      });
    }

    if (quickstartPrev && quickstartNext) {
      quickstartPrev.addEventListener('click', () => { quickstartIdx = (quickstartIdx - 1 + quickstartSlidesData.length) % quickstartSlidesData.length; renderQuickstart(); });
      quickstartNext.addEventListener('click', () => { quickstartIdx = (quickstartIdx + 1) % quickstartSlidesData.length; renderQuickstart(); });
    }

    if (learnToggle) {
      learnToggle.addEventListener('click', () => {
        learnModeOn = !learnModeOn;
        learnToggle.classList.toggle('bg-amber-500', learnModeOn);
        learnToggle.classList.toggle('text-slate-900', learnModeOn);
        renderLearnMode();
      });
      window.addEventListener('resize', () => { if (learnModeOn) renderLearnMode(); });
    }

    benchSelect.addEventListener('change', () => updateBenchRecommendation(benchSelect.value));
    if (mobileRefs.bench) {
      mobileRefs.bench.addEventListener('change', () => {
        benchSelect.value = mobileRefs.bench.value;
        updateBenchRecommendation(benchSelect.value);
      });
    }

    if (pinRunBtn) {
      pinRunBtn.addEventListener('click', () => {
        if (!pastRuns.length) {
          showToast('No run to pin yet', 'warning');
          return;
        }
        pinnedRunId = pastRuns[pastRuns.length - 1].id;
        renderLegend();
        renderStatsPanel(currentSummary);
        showToast('Pinned latest run', 'info', 1500);
      });
    }

    if (compareLastBtn) {
      compareLastBtn.addEventListener('click', () => {
        if (!lastRunId) {
          showToast('No previous run to compare', 'warning');
          return;
        }
        pinnedRunId = lastRunId;
        renderLegend();
        renderStatsPanel(currentSummary);
        showToast('Comparing against last run', 'info', 1500);
      });
    }

    if (clearOverlaysBtn) {
      clearOverlaysBtn.addEventListener('click', () => {
        pastRuns = [];
        pinnedRunId = null;
        lastRunId = null;
        overlayGroup.selectAll('path').remove();
        if (comparisonLegend) comparisonLegend.replaceChildren();
        if (comparisonStats) comparisonStats.textContent = 'No comparison data yet';
        showToast('Overlays cleared', 'info', 1200);
      });
    }

    // Register service worker for PWA/offline support (best-effort)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(swPath()).catch((err) => {
        console.warn('Service worker registration failed', err);
      });
    }
