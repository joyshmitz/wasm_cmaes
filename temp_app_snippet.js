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
}

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
    var runMobileBtn = document.getElementById('run-mobile');
    if (runMobileBtn) runMobileBtn.addEventListener('click', () => {
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
