    import init, { WasmCmaes } from "../pkg/cmaes_wasm.js";
    import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
    import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js";

    // Load lucide icon paths (fallback-safe)
    let lucideIcons = {};
    try {
      const res = await fetch("https://unpkg.com/lucide-static@0.321.0/icons.json");
      if (res.ok) lucideIcons = await res.json();
    } catch (_) {
      lucideIcons = {};
    }

    // Monaco editor setup
    const defaultCustomCode = `// Return a scalar fitness; lower is better
function f(x) {
  // Example: shifted bowl
  const cx = 1.5, cy = -2.0;
  const dx = x[0] - cx;
  const dy = x[1] - cy;
  return dx*dx + dy*dy + 0.1*Math.sin(3*dx) + 0.1*Math.cos(3*dy);
}`;
    let editor;
    const monacoReady = new Promise((resolve) => {
      window.require.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs" } });
      window.require(["vs/editor/editor.main"], () => {
        editor = monaco.editor.create(document.getElementById("editor"), {
          value: defaultCustomCode,
          language: "javascript",
          theme: "vs-dark",
          fontSize: 13,
          minimap: { enabled: false },
          automaticLayout: true,
        });
        resolve(editor);
      });
    });

    let customFn = (x) => x.reduce((s, v) => s + v * v, 0);

    function safeCustom(x) {
      try {
        const v = customFn(x);
        return Number.isFinite(v) ? v : 1e9;
      } catch (e) {
        console.warn('Custom fn error', e);
        return 1e9;
      }
    }

    function validateCustomCode(code) {
      const banned = /(window|document|globalThis|Function|eval|import|fetch|Worker|XMLHttpRequest)/i;
      if (banned.test(code)) throw new Error('Disallowed identifier detected');
      if (code.length > 4000) throw new Error('Code too long');
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

    // Inject lucide icons
    document.querySelectorAll('.lucide').forEach((el) => {
      const name = el.dataset.icon;
      const path = lucideIcons[name];
      if (!path) return;
      el.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path.join('')}</svg>`;
    });

    const mustGet = (id) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`Missing DOM id: ${id}`);
      return el;
    };

    const benchSelect = mustGet('bench');
    const dimInput = mustGet('dim');
    const dimLabel = mustGet('dim-label');
    const projectionSelect = mustGet('projection');
    const boundsToggle = mustGet('bounds-toggle');
    const boundLo = mustGet('bound-lo');
    const boundHi = mustGet('bound-hi');
    const noiseSamples = mustGet('noise-samples');
    const noiseMax = mustGet('noise-max');
    const noiseAdaptive = mustGet('noise-adaptive');
    const timingEl = mustGet('timing');
    const raceResults = mustGet('race-results');

    const lineSvg = d3.select('#line');
    const scrub = mustGet('scrub');
    const scrubPlay = mustGet('scrub-play');
    const playbackState = { frames: [], playing: false, idx: 0 };

    // Module-level history and metadata for export functions
    let optimizationHistory = [];
    let currentRunMetadata = null;

    const lineMargin = { top: 10, right: 10, bottom: 30, left: 50 };
    const width = 800, height = 320;

    const lineG = lineSvg.append('g').attr('transform', `translate(${lineMargin.left},${lineMargin.top})`);

    const lineX = d3.scaleLinear().range([0, width - lineMargin.left - lineMargin.right]);
    const lineY = d3.scaleLog().clamp(true).range([height - lineMargin.top - lineMargin.bottom, 0]);

    lineG.append('g').attr('class', 'axis axis-x').attr('transform', `translate(0,${height - lineMargin.top - lineMargin.bottom})`);
    lineG.append('g').attr('class', 'axis axis-y');

    const linePath = lineG.append('path').attr('fill', 'none').attr('stroke', '#38bdf8').attr('stroke-width', 2.5);

    const statusEl = document.getElementById('status');
    const bestEl = document.getElementById('best-display');
    const iterEl = document.getElementById('iter-display');
    const hudFps = document.getElementById('hud-fps');
    const hudWasm = document.getElementById('hud-wasm');
    const hudJs = document.getElementById('hud-js');
    const hudIter = document.getElementById('hud-iter');

    let wasmInitialized = false;

    function currentDim(benchKey) {
      dimInput.value = 2;
      dimLabel.textContent = '2D surface view';
      return 2;
    }

    function buildOptions(lambda, maxIter, seed, dim) {
      const opts = { popsize: lambda, seed, maxEvals: lambda * maxIter };
      if (boundsToggle.checked) {
        const lo = Number(boundLo.value) || -5;
        const hi = Number(boundHi.value) || 5;
        opts.bounds = {
          lower: new Float64Array(Array(dim).fill(lo)),
          upper: new Float64Array(Array(dim).fill(hi)),
        };
      }
      const samples = Number(noiseSamples.value) || 1;
      const maxS = Number(noiseMax.value) || 8;
      opts.noise = {
        samplesPerPoint: samples,
        maxSamplesPerPoint: maxS,
        adaptive: noiseAdaptive.checked,
      };
      return opts;
    }

    function projectCandidates(cands, bestVec, dim) {
      const mode = projectionSelect.value === 'auto' ? (dim > 2 ? 'pca' : 'first2') : projectionSelect.value;
      if (dim <= 2 || mode === 'first2') {
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
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 16/9, 0.1, 500);
    camera.position.set(0, 40, 70);
    const controls = new OrbitControls(camera, threeCanvas);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    scene.add(new THREE.AmbientLight(0x666666));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(30, 50, 30);
    scene.add(dir);

    let surfaceMesh = null;
    const surfaceGroup = new THREE.Group();
    scene.add(surfaceGroup);
    let pointsMesh = null;
    let bestSphere = null;
    let ellipseLine = null;

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

    function updatePoints(batch, mean) {
      if (pointsMesh) surfaceGroup.remove(pointsMesh);
      const geom = new THREE.BufferGeometry();
      const arr = new Float32Array(batch.length * 3);
      for (let i = 0; i < batch.length; i++) {
        arr[i*3] = batch[i].x;
        arr[i*3+1] = 0.05;
        arr[i*3+2] = batch[i].y;
      }
      geom.setAttribute('position', new THREE.BufferAttribute(arr,3));
      const mat = new THREE.PointsMaterial({ color: 0x38bdf8, size: 0.6 });
      pointsMesh = new THREE.Points(geom, mat);
      surfaceGroup.add(pointsMesh);

      if (bestSphere) surfaceGroup.remove(bestSphere);
      const sphereGeo = new THREE.SphereGeometry(0.6, 24, 24);
      const sphereMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 0.6 });
      bestSphere = new THREE.Mesh(sphereGeo, sphereMat);
      bestSphere.position.set(mean.x, 0.1, mean.y);
      surfaceGroup.add(bestSphere);
    }

    function updateEllipse(mean, cov2x2) {
      if (ellipseLine) surfaceGroup.remove(ellipseLine);
      // Eigen decomposition of 2x2 covariance
      const a = cov2x2[0], b = cov2x2[1], c = cov2x2[3];
      const trace = a + c;
      const det = a * c - b * b;
      const disc = Math.max(trace*trace/4 - det, 0);
      const l1 = trace/2 + Math.sqrt(disc);
      const l2 = trace/2 - Math.sqrt(disc);
      const rx = Math.sqrt(Math.max(l1, 1e-6));
      const ry = Math.sqrt(Math.max(l2, 1e-6));
      const angle = Math.atan2(b, l1 - a); // eigenvector for l1
      const pts = [];
      for (let i = 0; i <= 64; i++) {
        const t = (i / 64) * Math.PI * 2;
        const x = rx * Math.cos(t);
        const y = ry * Math.sin(t);
        const xr = x * Math.cos(angle) - y * Math.sin(angle);
        const yr = x * Math.sin(angle) + y * Math.cos(angle);
        pts.push(new THREE.Vector3(mean.x + xr, 0.05, mean.y + yr));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 0.5, gapSize: 0.3, transparent: true, opacity: 0.8 });
      ellipseLine = new THREE.LineLoop(geo, mat);
      ellipseLine.computeLineDistances();
      surfaceGroup.add(ellipseLine);
    }

    function resizeRenderer() {
      const w = threeCanvas.clientWidth || 800;
      const h = 380;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resizeRenderer();
    window.addEventListener('resize', resizeRenderer);

    function renderThree() {
      controls.update();
      renderer.render(scene, camera);
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

    async function run() {
      statusEl.textContent = 'Initializing wasm...';
      if (!wasmInitialized) {
        await init();
        wasmInitialized = true;
      }

      const benchKey = benchSelect.value;
      const bench = benchFns[benchKey];
      const lambda = Number(document.getElementById('lambda').value) || 32;
      const sigma = Number(document.getElementById('sigma').value) || 1.2;
      const maxIter = Number(document.getElementById('iters').value) || 250;
      const seed = Number(document.getElementById('seed').value) || 42;
      const dim = currentDim(benchKey);
      dimLabel.textContent = '2D surface view';

      const opts = buildOptions(lambda, maxIter, seed, dim);

      const x0 = new Float64Array(dim);
      for (let i = 0; i < dim; i++) x0[i] = bench.x0[i % bench.x0.length] || 0;
      const es = new WasmCmaes(x0, sigma, opts);

      buildSurface(bench.f);

      // Reset module-level history for new run and capture metadata
      optimizationHistory = [];
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

      const stepOnce = () => {
        const lambda = es.lambda;
        const candFlat = es.ask_flat();
        const fits = new Float64Array(lambda);
        const candidates = [];
        for (let k = 0; k < lambda; k++) {
          const offset = k * dim;
          const v = candFlat.slice(offset, offset + dim);
          candidates.push(Array.from(v));
          fits[k] = bench.f(v);
        }
        es.tell_flat(fits);
        const res = es.result();
        const covArr = Array.from(es.cov_matrix());
        const cov2x2 = [covArr[0], covArr[1], covArr[2], covArr[3]];
        bestF = Math.min(bestF, res.best_f);
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

        iter++;
        const now = performance.now();
        if (now - lastTs > 1000) {
          document.getElementById('hud-iter').textContent = `${iterCounter} iter/s`;
          iterCounter = 0;
          lastTs = now;
        }

        if (!es.stop_status().stopped && iter < maxIter) {
          requestAnimationFrame(stepOnce);
        } else {
          statusEl.textContent = `Done in ${iter} iterations / ${res.evals} evals`;
          document.getElementById('hud-wasm').textContent = `${res.evals} evals`;
        }
      };

      statusEl.textContent = `Running ${bench.title}...`;
      requestAnimationFrame(stepOnce);
    }

    function runJsBaseline(dimOverride) {
      const bench = benchFns[benchSelect.value];
      const lambda = Number(document.getElementById('lambda').value) || 32;
      const sigma0 = Number(document.getElementById('sigma').value) || 1.2;
      const maxIter = Number(document.getElementById('iters').value) || 250;
      const seed = Number(document.getElementById('seed').value) || 42;
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
          const x = sample();
          let f = bench.f(x);
          if (boundsToggle.checked) {
            const lo = Number(boundLo.value) || -5;
            const hi = Number(boundHi.value) || 5;
            let penalty = 0;
            for (let i=0;i<dim;i++) {
              let xi = x[i];
              if (xi < lo) { penalty += (lo - xi) ** 2; xi = lo; }
              else if (xi > hi) { penalty += (xi - hi) ** 2; xi = hi; }
              x[i] = xi;
            }
            f += 1e3 * penalty;
          }
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
      timingEl.textContent = msg;
      hudJs.textContent = msg;
      return { bestF, ms: (t1-t0), bestX };
    }

    function render(hist, batch, res, projBest, cov) {
      if (!hist.length) return;
      const xDomain = [0, d3.max(hist, (d) => d.iter) + 1];
      const yMin = Math.max(1e-9, Math.min(...hist.map((d) => d.best)));
      const yMaxRaw = d3.max(hist, (d) => d.best) || 1;
      const yMax = yMaxRaw <= yMin ? yMin * 1.05 + 1e-9 : yMaxRaw;
      lineX.domain(xDomain);
      lineY.domain([yMin, yMax]);

      lineG.select('.axis-x').call(d3.axisBottom(lineX).ticks(8).tickSizeOuter(0));
      lineG.select('.axis-y').call(d3.axisLeft(lineY).ticks(6, "~g"));

      const lineGen = d3.line()
        .x((d) => lineX(d.iter))
        .y((d) => lineY(d.best))
        .curve(d3.curveCatmullRom.alpha(0.6));
      linePath.attr('d', lineGen(hist));

      const meanPt = projBest || { x: res.best_x()[0], y: res.best_x()[1] };
      updatePoints(batch, meanPt);
      if (cov) updateEllipse(meanPt, cov);

      bestEl.textContent = `best f = ${res.best_f.toExponential(3)}`;
      iterEl.textContent = `Iter ${hist[hist.length - 1].iter}`;
    }

    document.getElementById('run').addEventListener('click', run);
    document.getElementById('run-js').addEventListener('click', () => runJsBaseline());
    const runMobileBtn = document.getElementById('run-mobile');
    if (runMobileBtn) runMobileBtn.addEventListener('click', run);
    document.getElementById('run-race').addEventListener('click', async () => {
      statusEl.textContent = 'Race: running WASM...';
      const benchKey = benchSelect.value;
      const bench = benchFns[benchKey];
      const lambda = Number(document.getElementById('lambda').value) || 32;
      const sigma = Number(document.getElementById('sigma').value) || 1.2;
      const maxIter = Number(document.getElementById('iters').value) || 250;
      const seed = Number(document.getElementById('seed').value) || 42;
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
      const jsRes = runJsBaseline(dim);
      raceResults.innerHTML = `<div class="font-semibold">Race results</div>
        <div>WASM: f=${wasmRes.best_f.toExponential(3)}, ${wasmMs.toFixed(1)} ms</div>
        <div>JS: f=${jsRes.bestF.toExponential(3)}, ${jsRes.ms.toFixed(1)} ms</div>`;
      statusEl.textContent = 'Race complete';
    });

    dimInput.addEventListener('input', () => {
      dimInput.value = 2;
      dimLabel.textContent = '2D surface view';
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
      }
    });

    scrubPlay.addEventListener('click', () => {
      playbackState.playing = !playbackState.playing;
      scrubPlay.textContent = playbackState.playing ? '⏸' : '▶';
      if (playbackState.playing) requestAnimationFrame(playLoop);
    });

    document.getElementById('apply-custom').addEventListener('click', async () => {
      await monacoReady;
      try {
        const code = editor.getValue();
        validateCustomCode(code);
        const fn = new Function(`${code}; return f;`)();
        if (typeof fn !== 'function') throw new Error('f is not a function');
        customFn = fn;
        benchSelect.value = 'custom';
        statusEl.textContent = 'Custom objective applied';
      } catch (e) {
        alert('Invalid function: ' + e.message);
      }
    });

    // Tutorial overlay (uses enhanced layout IDs)
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
    renderTutorial();

    const openTutorial = () => {
      if (tutorialOverlay) tutorialOverlay.classList.remove('hidden');
      renderTutorial();
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
    const sheet = document.getElementById('mobile-sheet');
    const handleBar = sheet?.querySelector('.handle-bar');
    const closeSheet = document.getElementById('close-sheet');
    const toggleAdvanced = document.getElementById('toggle-advanced');
    const advancedOptions = document.getElementById('advanced-options');

    const openSheet = () => sheet?.classList.add('open');
    const closeSheetFn = () => sheet?.classList.remove('open');
    const toggleSheet = () => sheet?.classList.toggle('open');

    if (handleBar) handleBar.addEventListener('click', toggleSheet);
    if (closeSheet) closeSheet.addEventListener('click', closeSheetFn);
    if (toggleAdvanced && advancedOptions) {
      toggleAdvanced.addEventListener('click', () => {
        const hidden = advancedOptions.classList.toggle('hidden');
        const arrow = toggleAdvanced.querySelector('svg');
        if (arrow) arrow.style.transform = hidden ? 'rotate(0deg)' : 'rotate(180deg)';
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
      const d = document.getElementById(desktopId);
      const m = document.getElementById(mobileId);
      if (!d || !m) return;
      const copy = (src, dst) => dst && (dst.value = src.value);
      d.addEventListener('input', () => copy(d, m));
      m.addEventListener('input', () => copy(m, d));
      // initialize mobile with desktop defaults
      copy(d, m);
    });

    // Mobile run button uses the same run pipeline then closes the sheet
    const runMobileBtn = document.getElementById('run-mobile');
    if (runMobileBtn) runMobileBtn.addEventListener('click', () => {
      run();
      closeSheetFn();
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
    const canvas = document.getElementById('bg-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1000);
    camera.position.z = 200;
    const geometry = new THREE.BufferGeometry();
    const COUNT = 800;
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT * 3; i++) positions[i] = (Math.random() - 0.5) * 400;
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0x38bdf8, size: 1.6, transparent: true, opacity: 0.6 });
    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const animateBg = () => {
      points.rotation.y += 0.0008;
      points.rotation.x += 0.0004;
      renderer.render(scene, camera);
      requestAnimationFrame(animateBg);
    };

    // Optional 3D surface of the current benchmark (preview only, not exact scale)
    let surface;
    function buildSurface(fn) {
      if (surface) scene.remove(surface);
      const planeSize = 60;
      const res = 40;
      const geo = new THREE.PlaneGeometry(planeSize, planeSize, res, res);
      const positions = geo.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i) / 5; // shrink input
        const y = positions.getY(i) / 5;
        const z = -fn([x, y]);
        positions.setZ(i, z);
      }
      positions.needsUpdate = true;
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        flatShading: true,
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
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    onResize();
    animateBg();

    // Subtle GSAP float on panels
    gsap.utils.toArray('.panel').forEach((el, i) => {
      gsap.to(el, { y: '+=6', duration: 3 + i * 0.2, repeat: -1, yoyo: true, ease: 'sine.inOut', delay: i * 0.1 });
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/wasm_cmaes/sw.js').catch((err) => {
        console.warn('Service worker registration failed', err);
      });
    }

    // ============================================================================
    // ENHANCEMENTS: Toast notifications, keyboard shortcuts, export, help
    // ============================================================================

    // Toast notification system
    function showToast(message, type = 'info', duration = 3000) {
      const container = document.getElementById('toast-container');
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
      toast.innerHTML = `<span class="mr-2">${icons[type] || icons.info}</span>${message}`;

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
        return `${i + 1},${h.best},${document.getElementById('lambda').value}`;
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
          lambda: Number(document.getElementById('lambda').value),
          sigma: Number(document.getElementById('sigma').value),
          maxIterations: Number(document.getElementById('iters').value),
          seed: Number(document.getElementById('seed').value),
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

    // Share configuration via URL
    function shareConfig() {
      const params = new URLSearchParams({
        bench: benchSelect.value,
        lambda: document.getElementById('lambda').value,
        sigma: document.getElementById('sigma').value,
        iters: document.getElementById('iters').value,
        seed: document.getElementById('seed').value
      });

      const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          showToast('Configuration URL copied to clipboard!', 'success');
        }).catch(() => {
          showToast('Failed to copy URL', 'error');
        });
      } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = url;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
          showToast('Configuration URL copied to clipboard!', 'success');
        } catch (err) {
          showToast('Failed to copy URL', 'error');
        }
        document.body.removeChild(textArea);
      }
    }

    // Load configuration from URL on page load
    function loadConfigFromURL() {
      const params = new URLSearchParams(window.location.search);

      if (params.has('bench')) benchSelect.value = params.get('bench');
      if (params.has('lambda')) document.getElementById('lambda').value = params.get('lambda');
      if (params.has('sigma')) document.getElementById('sigma').value = params.get('sigma');
      if (params.has('iters')) document.getElementById('iters').value = params.get('iters');
      if (params.has('seed')) document.getElementById('seed').value = params.get('seed');

      if (params.size > 0) {
        showToast('Configuration loaded from URL', 'info');
      }
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Don't trigger shortcuts when typing in inputs or Monaco editor
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Don't trigger shortcuts when typing in Monaco editor
      const editorContainer = document.getElementById('editor');
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
        document.getElementById('lambda').value = '32';
        document.getElementById('sigma').value = '1.2';
        document.getElementById('iters').value = '250';
        document.getElementById('seed').value = '42';
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
      if (e.key === 'Escape') {
        const helpOverlay = document.getElementById('help-overlay');
        if (helpOverlay && !helpOverlay.classList.contains('hidden')) {
          toggleHelp();
        }
      }
    });

    // Help overlay toggle with focus management and focus trapping
    let helpTriggerElement = null;

    function toggleHelp() {
      const overlay = document.getElementById('help-overlay');
      if (!overlay) return;

      const isHidden = overlay.classList.contains('hidden');

      if (isHidden) {
        // Opening - store current focus and move to overlay
        helpTriggerElement = document.activeElement;
        overlay.classList.remove('hidden');

        // Focus the close button for keyboard accessibility
        setTimeout(() => {
          const closeBtn = document.getElementById('help-close-btn');
          if (closeBtn) closeBtn.focus();
        }, 50);

        // Add focus trap
        overlay.addEventListener('keydown', trapFocus);
      } else {
        // Closing - return focus to trigger
        overlay.classList.add('hidden');
        overlay.removeEventListener('keydown', trapFocus);

        if (helpTriggerElement && typeof helpTriggerElement.focus === 'function') {
          helpTriggerElement.focus();
          helpTriggerElement = null;
        }
      }
    }

    // Trap focus inside help overlay (accessibility requirement for modals)
    function trapFocus(e) {
      if (e.key !== 'Tab') return;

      const overlay = document.getElementById('help-overlay');
      const focusableElements = overlay.querySelectorAll(
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

    // Add event listeners to export buttons if they exist
    const exportCsvBtn = document.getElementById('export-csv');
    const exportJsonBtn = document.getElementById('export-json');
    const shareBtn = document.getElementById('share-config');
    const helpBtn = document.getElementById('help-btn');
    const helpCloseX = document.getElementById('help-close-x');
    const helpCloseBtn = document.getElementById('help-close-btn');

    if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportCSV);
    if (exportJsonBtn) exportJsonBtn.addEventListener('click', exportJSON);
    if (shareBtn) shareBtn.addEventListener('click', shareConfig);
    if (helpBtn) helpBtn.addEventListener('click', toggleHelp);
    if (helpCloseX) helpCloseX.addEventListener('click', toggleHelp);
    if (helpCloseBtn) helpCloseBtn.addEventListener('click', toggleHelp);

    // Register service worker for PWA/offline support (best-effort)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/wasm_cmaes/sw.js').catch((err) => {
        console.warn('Service worker registration failed', err);
      });
    }
