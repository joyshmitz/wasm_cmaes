use wasm_bindgen::prelude::*;
use js_sys::{Array, Float64Array, Function, Object, Reflect};
use std::cmp::Ordering;
use std::f64;
use nalgebra::DMatrix;
use nalgebra::linalg::SymmetricEigen;
use serde::{Serialize, Deserialize};
use serde_wasm_bindgen::{to_value, from_value};

#[cfg(target_arch = "wasm32")]
use core::arch::wasm32::*;

#[cfg(feature = "parallel")]
use rayon::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

// -------------------------------------------------------------------
// RNG
// -------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
struct LcgRng {
    state: u64,
}

impl LcgRng {
    fn new(seed: u64) -> Self {
        let s = if seed == 0 { 0xdead_beef_cafe_babe } else { seed };
        Self { state: s }
    }

    #[inline]
    fn next_u64(&mut self) -> u64 {
        self.state = self
            .state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1);
        self.state
    }

    #[inline]
    fn next_f64(&mut self) -> f64 {
        const SCALE: f64 = 1.0 / ((1u64 << 53) as f64);
        ((self.next_u64() >> 11) as f64) * SCALE
    }

    #[inline]
    fn next_normal(&mut self) -> f64 {
        let u1 = (1.0 - self.next_f64()).max(f64::MIN_POSITIVE);
        let u2 = 1.0 - self.next_f64();
        let r = (-2.0 * u1.ln()).sqrt();
        let theta = 2.0 * std::f64::consts::PI * u2;
        r * theta.cos()
    }
}

// -------------------------------------------------------------------
// SIMD-accelerated vector ops (with scalar fallback)
// -------------------------------------------------------------------

#[cfg_attr(target_arch = "wasm32", allow(dead_code))]
#[inline]
fn norm_sq_scalar(a: &[f64]) -> f64 {
    a.iter().map(|v| v * v).sum()
}

#[cfg(target_arch = "wasm32")]
#[inline]
unsafe fn norm_sq_wasm32_simd(a: &[f64]) -> f64 {
    let len = a.len();
    let mut i = 0usize;
    let mut acc = f64x2_splat(0.0);
    while i + 1 < len {
        let pa = a.as_ptr().add(i) as *const v128;
        let va = v128_load(pa);
        let prod = f64x2_mul(va, va);
        acc = f64x2_add(acc, prod);
        i += 2;
    }
    let mut s =
        f64x2_extract_lane::<0>(acc) + f64x2_extract_lane::<1>(acc);
    while i < len {
        s += a[i] * a[i];
        i += 1;
    }
    s
}

#[inline]
fn norm_sq(a: &[f64]) -> f64 {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        return norm_sq_wasm32_simd(a);
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        norm_sq_scalar(a)
    }
}

#[inline]
fn vec_sub(a: &[f64], b: &[f64]) -> Vec<f64> {
    a.iter().zip(b.iter()).map(|(ai, bi)| ai - bi).collect()
}

// -------------------------------------------------------------------
// Best solution container
// -------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
struct BestSolution {
    x: Vec<f64>,
    f: f64,
    evals: u64,
}

impl BestSolution {
    fn new(dim: usize) -> Self {
        Self {
            x: vec![0.0; dim],
            f: f64::INFINITY,
            evals: 0,
        }
    }

    fn update(&mut self, x: &[f64], f: f64, evals: u64) {
        if f < self.f {
            self.x = x.to_vec();
            self.f = f;
            self.evals = evals;
        }
    }
}

// -------------------------------------------------------------------
// Strategy / options
// -------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Copy)]
enum CovarianceModelOpt {
    Auto,
    Full,
    Sep,
    Lm,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
enum StrategyMode {
    Auto,
    Classic,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq)]
enum RestartStrategyOpt {
    None,
    Ipop,
    Bipop,
}

#[derive(Serialize, Deserialize, Clone)]
struct RestartOptions {
    strategy: RestartStrategyOpt,
    max_restarts: usize,
    max_total_evals: Option<u64>,
}

impl Default for RestartOptions {
    fn default() -> Self {
        Self {
            strategy: RestartStrategyOpt::None,
            max_restarts: 0,
            max_total_evals: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct NoiseOptions {
    base_samples: u32,
    adaptive: bool,
    max_samples: u32,
}

impl Default for NoiseOptions {
    fn default() -> Self {
        Self {
            base_samples: 1,
            adaptive: false,
            max_samples: 8,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct Options {
    popsize: Option<usize>,
    max_evals: Option<u64>,
    ftarget: Option<f64>,
    seed: u64,
    verb_disp: u32,
    covar_model: CovarianceModelOpt,
    strategy: StrategyMode,
    restart: RestartOptions,
    bounds_lower: Option<Vec<f64>>,
    bounds_upper: Option<Vec<f64>>,
    constraint_penalty: f64,
    noise: NoiseOptions,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            popsize: None,
            max_evals: None,
            ftarget: None,
            seed: 42,
            verb_disp: 0,
            covar_model: CovarianceModelOpt::Auto,
            strategy: StrategyMode::Auto,
            restart: RestartOptions::default(),
            bounds_lower: None,
            bounds_upper: None,
            constraint_penalty: 1e6,
            noise: NoiseOptions::default(),
        }
    }
}

fn default_popsize(n: usize) -> usize {
    let ln_n = (n as f64).ln();
    let v = 4.0 + (3.0 * ln_n).floor();
    if v < 2.0 {
        2
    } else {
        v as usize
    }
}

fn choose_covar_model(n: usize, opt: CovarianceModelOpt) -> CovarianceModelOpt {
    match opt {
        CovarianceModelOpt::Full
        | CovarianceModelOpt::Sep
        | CovarianceModelOpt::Lm => opt,
        CovarianceModelOpt::Auto => {
            if n <= 20 {
                CovarianceModelOpt::Full
            } else if n <= 80 {
                CovarianceModelOpt::Lm
            } else {
                CovarianceModelOpt::Sep
            }
        }
    }
}

fn compute_num_samples(idx: usize, lambda: usize, noise: &NoiseOptions) -> u32 {
    let mut s = if noise.base_samples == 0 {
        1
    } else {
        noise.base_samples
    };
    if noise.adaptive && idx < lambda / 2 {
        let doubled = s.saturating_mul(2);
        s = doubled.min(noise.max_samples.max(1));
    }
    if s == 0 {
        1
    } else {
        s
    }
}

fn parse_options(options: Option<JsValue>, dim: usize) -> Options {
    let mut opts = Options::default();
    if let Some(val) = options {
        if val.is_undefined() || val.is_null() {
            return opts;
        }
        let obj = Object::from(val);

        // simple numeric fields
        if let Ok(v) = Reflect::get(&obj, &JsValue::from_str("popsize")) {
            if let Some(f) = v.as_f64() {
                if f > 0.0 {
                    opts.popsize = Some(f as usize);
                }
            }
        }
        if let Ok(v) = Reflect::get(&obj, &JsValue::from_str("maxEvals")) {
            if let Some(f) = v.as_f64() {
                if f > 0.0 {
                    opts.max_evals = Some(f as u64);
                }
            }
        }
        if let Ok(v) = Reflect::get(&obj, &JsValue::from_str("ftarget")) {
            if let Some(f) = v.as_f64() {
                opts.ftarget = Some(f);
            }
        }
        if let Ok(v) = Reflect::get(&obj, &JsValue::from_str("seed")) {
            if let Some(f) = v.as_f64() {
                if f >= 0.0 {
                    opts.seed = f as u64;
                }
            }
        }
        if let Ok(v) = Reflect::get(&obj, &JsValue::from_str("verbDisp")) {
            if let Some(f) = v.as_f64() {
                if f >= 0.0 {
                    opts.verb_disp = f as u32;
                }
            }
        }

        // covar model
        if let Ok(v) = Reflect::get(&obj, &JsValue::from_str("covarModel")) {
            if let Some(s) = v.as_string() {
                opts.covar_model = match s.as_str() {
                    "full" => CovarianceModelOpt::Full,
                    "sep" => CovarianceModelOpt::Sep,
                    "lm" => CovarianceModelOpt::Lm,
                    _ => CovarianceModelOpt::Auto,
                };
            }
        }

        // strategy
        if let Ok(v) = Reflect::get(&obj, &JsValue::from_str("strategy")) {
            if let Some(s) = v.as_string() {
                opts.strategy = match s.as_str() {
                    "classic" => StrategyMode::Classic,
                    _ => StrategyMode::Auto,
                };
            }
        }

        // restart
        if let Ok(v) =
            Reflect::get(&obj, &JsValue::from_str("restartStrategy"))
        {
            if let Some(s) = v.as_string() {
                opts.restart.strategy = match s.as_str() {
                    "ipop" => RestartStrategyOpt::Ipop,
                    "bipop" => RestartStrategyOpt::Bipop,
                    _ => RestartStrategyOpt::None,
                };
            }
        }
        if let Ok(v) = Reflect::get(&obj, &JsValue::from_str("maxRestarts")) {
            if let Some(f) = v.as_f64() {
                if f >= 0.0 {
                    opts.restart.max_restarts = f as usize;
                }
            }
        }
        if let Ok(v) =
            Reflect::get(&obj, &JsValue::from_str("maxTotalEvals"))
        {
            if let Some(f) = v.as_f64() {
                if f > 0.0 {
                    opts.restart.max_total_evals = Some(f as u64);
                }
            }
        }

        // bounds
        if let Ok(v) = Reflect::get(&obj, &JsValue::from_str("bounds")) {
            if !v.is_undefined() && !v.is_null() {
                let bobj = Object::from(v);
                if let Ok(lo) =
                    Reflect::get(&bobj, &JsValue::from_str("lower"))
                {
                    if lo.is_instance_of::<Float64Array>() {
                        let arr = Float64Array::from(lo);
                        if arr.length() as usize == dim {
                            let mut tmp = vec![0.0; dim];
                            arr.copy_to(&mut tmp);
                            opts.bounds_lower = Some(tmp);
                        }
                    }
                }
                if let Ok(hi) =
                    Reflect::get(&bobj, &JsValue::from_str("upper"))
                {
                    if hi.is_instance_of::<Float64Array>() {
                        let arr = Float64Array::from(hi);
                        if arr.length() as usize == dim {
                            let mut tmp = vec![0.0; dim];
                            arr.copy_to(&mut tmp);
                            opts.bounds_upper = Some(tmp);
                        }
                    }
                }
            }
        }

        if let Ok(v) =
            Reflect::get(&obj, &JsValue::from_str("constraintPenalty"))
        {
            if let Some(f) = v.as_f64() {
                if f > 0.0 {
                    opts.constraint_penalty = f;
                }
            }
        }

        // noise
        if let Ok(v) = Reflect::get(&obj, &JsValue::from_str("noise")) {
            if !v.is_undefined() && !v.is_null() {
                let nobj = Object::from(v);
                if let Ok(sv) =
                    Reflect::get(&nobj, &JsValue::from_str("samplesPerPoint"))
                {
                    if let Some(f) = sv.as_f64() {
                        if f >= 1.0 {
                            opts.noise.base_samples = f as u32;
                        }
                    }
                }
                if let Ok(av) =
                    Reflect::get(&nobj, &JsValue::from_str("adaptive"))
                {
                    if let Some(b) = av.as_bool() {
                        opts.noise.adaptive = b;
                    }
                }
                if let Ok(mv) = Reflect::get(
                    &nobj,
                    &JsValue::from_str("maxSamplesPerPoint"),
                ) {
                    if let Some(f) = mv.as_f64() {
                        if f >= 1.0 {
                            opts.noise.max_samples = f as u32;
                        }
                    }
                }
            }
        }
    }
    opts
}

// -------------------------------------------------------------------
// CMA-ES parameters
// -------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
struct CmaesParams {
    n: usize,
    lambda: usize,
    mu: usize,
    weights: Vec<f64>,
    mueff: f64,
    cc: f64,
    cs: f64,
    c1: f64,
    cmu: f64,
    damps: f64,
    lazy_gap_evals: f64,
}

impl CmaesParams {
    fn new(n: usize, popsize: Option<usize>, strategy: StrategyMode) -> Self {
        let base_lambda = default_popsize(n);
        let lambda = match popsize {
            Some(v) => v,
            None => match strategy {
                StrategyMode::Classic => base_lambda,
                StrategyMode::Auto => {
                    if n <= 20 {
                        base_lambda
                    } else if n <= 80 {
                        (base_lambda as f64 * 1.5).ceil() as usize
                    } else {
                        (base_lambda as f64 * 2.0).ceil() as usize
                    }
                }
            },
        };
        let mu = lambda / 2;

        let mut raw_weights = vec![0.0; lambda];
        for i in 0..lambda {
            if i < mu {
                raw_weights[i] =
                    ((lambda as f64) / 2.0 + 0.5).ln() - ((i + 1) as f64).ln();
            } else {
                raw_weights[i] = 0.0;
            }
        }
        let w_sum: f64 = raw_weights[..mu].iter().sum();
        let mut weights = vec![0.0; lambda];
        for i in 0..lambda {
            weights[i] = raw_weights[i] / w_sum;
        }
        let mut tmp = 0.0;
        for i in 0..mu {
            tmp += weights[i] * weights[i];
        }
        let mueff = weights[..mu].iter().sum::<f64>().powi(2) / tmp;

        let cc = (4.0 + mueff / n as f64)
            / (n as f64 + 4.0 + 2.0 * mueff / n as f64);
        let cs = (mueff + 2.0) / (n as f64 + mueff + 5.0);
        let c1 = 2.0 / (((n as f64 + 1.3).powi(2)) + mueff);
        let cmu = {
            let num = 2.0 * (mueff - 2.0 + 1.0 / mueff);
            let den = ((n as f64 + 2.0).powi(2)) + mueff;
            let cmu_raw = num / den;
            let cap = 1.0 - c1;
            if cmu_raw < cap { cmu_raw } else { cap }
        };
        let damps = 2.0 * mueff / lambda as f64 + 0.3 + cs;
        let lazy_gap_scale = match strategy {
            StrategyMode::Classic => 0.5,
            StrategyMode::Auto => 0.8,
        };
        let lazy_gap_evals =
            lazy_gap_scale * n as f64 * lambda as f64
                * (1.0 / (c1 + cmu))
                / (n as f64 * n as f64);

        Self {
            n,
            lambda,
            mu,
            weights,
            mueff,
            cc,
            cs,
            c1,
            cmu,
            damps,
            lazy_gap_evals,
        }
    }
}

// -------------------------------------------------------------------
// Full covariance matrix with eigendecomposition
// -------------------------------------------------------------------

fn idx(n: usize, i: usize, j: usize) -> usize {
    i * n + j
}

#[derive(Serialize, Deserialize, Clone)]
struct DecomposingPositiveMatrix {
    n: usize,
    data: Vec<f64>,
    eigenbasis: Vec<f64>,
    eigenvalues: Vec<f64>,
    condition_number: f64,
    invsqrt: Vec<f64>,
    updated_eval: f64,
}

impl DecomposingPositiveMatrix {
    fn new(n: usize) -> Self {
        let mut data = vec![0.0; n * n];
        let mut eigenbasis = vec![0.0; n * n];
        let mut invsqrt = vec![0.0; n * n];
        for i in 0..n {
            data[idx(n, i, i)] = 1.0;
            eigenbasis[idx(n, i, i)] = 1.0;
            invsqrt[idx(n, i, i)] = 1.0;
        }
        let eigenvalues = vec![1.0; n];
        Self {
            n,
            data,
            eigenbasis,
            eigenvalues,
            condition_number: 1.0,
            invsqrt,
            updated_eval: 0.0,
        }
    }

    fn multiply_with(&mut self, factor: f64) {
        #[cfg(feature = "parallel")]
        {
            self.data.par_iter_mut().for_each(|v| *v *= factor);
            return;
        }
        #[cfg(not(feature = "parallel"))]
        {
            for v in &mut self.data {
                *v *= factor;
            }
        }
    }

    fn add_outer(&mut self, b: &[f64], factor: f64) {
        let n = self.n;
        for i in 0..n {
            let bi = b[i];
            for j in 0..n {
                let bj = b[j];
                let ij = idx(n, i, j);
                self.data[ij] += factor * bi * bj;
            }
        }
    }

    fn diag(&self) -> Vec<f64> {
        let mut d = Vec::with_capacity(self.n);
        for i in 0..self.n {
            d.push(self.data[idx(self.n, i, i)]);
        }
        d
    }

    fn update_eigensystem(
        &mut self,
        current_eval: f64,
        lazy_gap_evals: f64,
    ) {
        if current_eval <= self.updated_eval + lazy_gap_evals {
            return;
        }
        let n = self.n;
        let m = DMatrix::from_row_slice(n, n, &self.data);
        let eig = SymmetricEigen::new(m);
        self.eigenvalues = eig.eigenvalues.as_slice().to_vec();
        self.eigenbasis = eig.eigenvectors.as_slice().to_vec();

        let mut min_ev = f64::INFINITY;
        let mut max_ev = 0.0;
        for &v in &self.eigenvalues {
            if v < min_ev {
                min_ev = v;
            }
            if v > max_ev {
                max_ev = v;
            }
        }
        if min_ev <= 0.0 {
            min_ev = 1e-15;
        }
        self.condition_number = max_ev / min_ev;

        self.invsqrt.fill(0.0);
        for i in 0..n {
            for j in 0..=i {
                let mut s = 0.0;
                for k in 0..n {
                    let bik = self.eigenbasis[idx(n, i, k)];
                    let bjk = self.eigenbasis[idx(n, j, k)];
                    let ev = self.eigenvalues[k].abs().sqrt();
                    let inv = if ev > 0.0 { 1.0 / ev } else { 0.0 };
                    s += bik * bjk * inv;
                }
                self.invsqrt[idx(n, i, j)] = s;
                self.invsqrt[idx(n, j, i)] = s;
            }
        }
        self.updated_eval = current_eval;
    }

    fn mul_invsqrt_vec(&self, x: &[f64]) -> Vec<f64> {
        let n = self.n;
        let mut y = vec![0.0; n];
        for i in 0..n {
            let mut s = 0.0;
            for j in 0..n {
                s += self.invsqrt[idx(n, i, j)] * x[j];
            }
            y[i] = s;
        }
        y
    }

    fn mahalanobis_norm(&self, dx: &[f64]) -> f64 {
        let v = self.mul_invsqrt_vec(dx);
        norm_sq(&v).sqrt()
    }
}

// -------------------------------------------------------------------
// Diagonal covariance (sep-CMA) and limited-memory variant
// -------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
struct DiagCovariance {
    diag: Vec<f64>,
    invsqrt_diag: Vec<f64>,
    condition_number: f64,
}

impl DiagCovariance {
    fn new(n: usize) -> Self {
        Self {
            diag: vec![1.0; n],
            invsqrt_diag: vec![1.0; n],
            condition_number: 1.0,
        }
    }

    fn update_invsqrt_and_condition(&mut self) {
        let mut minv = f64::INFINITY;
        let mut maxv = 0.0;
        for &d in &self.diag {
            if d < minv {
                minv = d;
            }
            if d > maxv {
                maxv = d;
            }
        }
        if minv <= 0.0 {
            minv = 1e-15;
        }
        self.condition_number = maxv / minv;
        for (i, d) in self.diag.iter().enumerate() {
            self.invsqrt_diag[i] = if *d > 0.0 { 1.0 / d.sqrt() } else { 0.0 };
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct LmHistory {
    y: Vec<f64>,
    scale: f64,
}

// -------------------------------------------------------------------
// Stop status
// -------------------------------------------------------------------

#[derive(Default, Clone, Copy, Serialize, Deserialize)]
struct StopStatusInternal {
    stopped: bool,
    maxfevals: bool,
    ftarget: bool,
    condition: bool,
    tolfun: bool,
    tolx: bool,
}

// -------------------------------------------------------------------
// CMA-ES engines (full, sep, limited-memory)
// -------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
struct CmaesFull {
    n: usize,
    params: CmaesParams,
    max_evals: u64,
    ftarget: Option<f64>,
    xmean: Vec<f64>,
    sigma: f64,
    pc: Vec<f64>,
    ps: Vec<f64>,
    c: DecomposingPositiveMatrix,
    counteval: u64,
    fitvals: Vec<f64>,
    best: BestSolution,
    rng: LcgRng,
}

impl CmaesFull {
    fn new(xstart: Vec<f64>, sigma: f64, opts: &Options) -> Self {
        let n = xstart.len();
        let params = CmaesParams::new(n, opts.popsize, opts.strategy);
        let lambda = params.lambda as u64;
        let max_evals = opts.max_evals.unwrap_or_else(|| {
            let v = 100.0 * lambda as f64
                + 150.0 * (n as f64 + 3.0).powi(2) * (lambda as f64).sqrt();
            v as u64
        });
        let c = DecomposingPositiveMatrix::new(n);
        let pc = vec![0.0; n];
        let ps = vec![0.0; n];
        let best = BestSolution::new(n);
        Self {
            n,
            params,
            max_evals,
            ftarget: opts.ftarget,
            xmean: xstart,
            sigma,
            pc,
            ps,
            c,
            counteval: 0,
            fitvals: Vec::new(),
            best,
            rng: LcgRng::new(opts.seed),
        }
    }

    fn ask_candidates(&mut self) -> Vec<Vec<f64>> {
        self.c
            .update_eigensystem(self.counteval as f64, self.params.lazy_gap_evals);
        let n = self.n;
        let lambda = self.params.lambda;
        let mut candidates = Vec::with_capacity(lambda);
        let mut z = vec![0.0; n];
        let mut y = vec![0.0; n];
        for _ in 0..lambda {
            for i in 0..n {
                z[i] = self.sigma
                    * self.c.eigenvalues[i].sqrt()
                    * self.rng.next_normal();
            }
            for i in 0..n {
                let mut s = 0.0;
                for j in 0..n {
                    s += self.c.eigenbasis[idx(n, i, j)] * z[j];
                }
                y[i] = s;
            }
            let mut x = vec![0.0; n];
            for i in 0..n {
                x[i] = self.xmean[i] + y[i];
            }
            candidates.push(x);
        }
        candidates
    }

    fn tell(&mut self, arx: Vec<Vec<f64>>, fitvals: Vec<f64>) {
        let lambda = fitvals.len();
        assert_eq!(lambda, arx.len());
        self.counteval += lambda as u64;
        let n = self.n;
        let par = &self.params;
        let xold = self.xmean.clone();

        let mut idx_vec: Vec<usize> = (0..lambda).collect();
        idx_vec.sort_by(|&i, &j| {
            fitvals[i]
                .partial_cmp(&fitvals[j])
                .unwrap_or(Ordering::Equal)
        });

        let mut arx_sorted = Vec::with_capacity(lambda);
        let mut fitvals_sorted = Vec::with_capacity(lambda);
        for &k in &idx_vec {
            arx_sorted.push(arx[k].clone());
            fitvals_sorted.push(fitvals[k]);
        }
        self.fitvals = fitvals_sorted;
        if let Some(first) = self.fitvals.first() {
            self.best
                .update(&arx_sorted[0], *first, self.counteval);
        }

        let mut new_xmean = vec![0.0; n];
        for i in 0..n {
            let mut s = 0.0;
            for k in 0..par.mu {
                s += par.weights[k] * arx_sorted[k][i];
            }
            new_xmean[i] = s;
        }
        self.xmean = new_xmean;

        let mut y = vec![0.0; n];
        for i in 0..n {
            y[i] = self.xmean[i] - xold[i];
        }
        let z = self.c.mul_invsqrt_vec(&y);

        let csn = (par.cs * (2.0 - par.cs) * par.mueff).sqrt() / self.sigma;
        for i in 0..n {
            self.ps[i] = (1.0 - par.cs) * self.ps[i] + csn * z[i];
        }

        let ccn = (par.cc * (2.0 - par.cc) * par.mueff).sqrt() / self.sigma;
        let sum_square_ps = norm_sq(&self.ps);

        let exponent = 2.0 * self.counteval as f64 / par.lambda as f64;
        let denom = 1.0 - (1.0 - par.cs).powf(exponent);
        let left = sum_square_ps / n as f64;
        let hsig_cond = if denom > 0.0 { left / denom } else { left };
        let hsig = if hsig_cond < 2.0 + 4.0 / (n as f64 + 1.0) {
            1.0
        } else {
            0.0
        };

        for i in 0..n {
            self.pc[i] = (1.0 - par.cc) * self.pc[i] + ccn * hsig * y[i];
        }

        let weight_sum: f64 = par.weights.iter().sum();
        let c1a =
            par.c1 * (1.0 - (1.0 - hsig * hsig) * par.cc * (2.0 - par.cc));
        let factor = 1.0 - c1a - par.cmu * weight_sum;
        self.c.multiply_with(factor);
        self.c.add_outer(&self.pc, par.c1);

        for (k, w) in par.weights.iter().enumerate() {
            let mut wk = *w;
            let dx = vec_sub(&arx_sorted[k], &xold);
            if wk < 0.0 {
                let norm = self.c.mahalanobis_norm(&dx);
                if norm > 0.0 {
                    wk *= n as f64 * (self.sigma / norm).powi(2);
                }
            }
            let factor = wk * par.cmu / (self.sigma * self.sigma);
            self.c.add_outer(&dx, factor);
        }

        let cn = par.cs / par.damps;
        let exponent_sigma = cn * (sum_square_ps / n as f64 - 1.0) / 2.0;
        let exponent_clamped = exponent_sigma.clamp(-1.0, 1.0);
        self.sigma *= exponent_clamped.exp();
    }

    fn stop_status(&self) -> StopStatusInternal {
        let mut res = StopStatusInternal::default();
        if self.counteval == 0 {
            return res;
        }
        if self.counteval >= self.max_evals {
            res.stopped = true;
            res.maxfevals = true;
        }
        if let Some(ftarget) = self.ftarget {
            if !self.fitvals.is_empty() && self.fitvals[0] <= ftarget {
                res.stopped = true;
                res.ftarget = true;
            }
        }
        if self.c.condition_number > 1e14 {
            res.stopped = true;
            res.condition = true;
        }
        if self.fitvals.len() > 1 {
            let last = *self.fitvals.last().unwrap();
            let first = self.fitvals[0];
            if (last - first).abs() < 1e-12 {
                res.stopped = true;
                res.tolfun = true;
            }
        }
        if !self.c.eigenvalues.is_empty() {
            let max_eig = self
                .c
                .eigenvalues
                .iter()
                .cloned()
                .fold(0.0_f64, f64::max);
            if self.sigma * max_eig.sqrt() < 1e-11 {
                res.stopped = true;
                res.tolx = true;
            }
        }
        res
    }

    fn result(
        &self,
    ) -> (
        Vec<f64>,
        f64,
        u64,
        u64,
        u64,
        Vec<f64>,
        Vec<f64>,
    ) {
        let stds_diag = self.c.diag();
        let stds: Vec<f64> = stds_diag
            .iter()
            .map(|v| self.sigma * v.sqrt())
            .collect();
        let iterations = self.counteval / self.params.lambda as u64;
        (
            self.best.x.clone(),
            self.best.f,
            self.best.evals,
            self.counteval,
            iterations,
            self.xmean.clone(),
            stds,
        )
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct CmaesSep {
    n: usize,
    params: CmaesParams,
    max_evals: u64,
    ftarget: Option<f64>,
    xmean: Vec<f64>,
    sigma: f64,
    pc: Vec<f64>,
    ps: Vec<f64>,
    cov: DiagCovariance,
    counteval: u64,
    fitvals: Vec<f64>,
    best: BestSolution,
    rng: LcgRng,
}

impl CmaesSep {
    fn new(xstart: Vec<f64>, sigma: f64, opts: &Options) -> Self {
        let n = xstart.len();
        let params = CmaesParams::new(n, opts.popsize, opts.strategy);
        let lambda = params.lambda as u64;
        let max_evals = opts.max_evals.unwrap_or_else(|| {
            let v = 100.0 * lambda as f64
                + 150.0 * (n as f64 + 3.0).powi(2) * (lambda as f64).sqrt();
            v as u64
        });
        let cov = DiagCovariance::new(n);
        let pc = vec![0.0; n];
        let ps = vec![0.0; n];
        let best = BestSolution::new(n);
        Self {
            n,
            params,
            max_evals,
            ftarget: opts.ftarget,
            xmean: xstart,
            sigma,
            pc,
            ps,
            cov,
            counteval: 0,
            fitvals: Vec::new(),
            best,
            rng: LcgRng::new(opts.seed),
        }
    }

    fn ask_candidates(&mut self) -> Vec<Vec<f64>> {
        let n = self.n;
        let lambda = self.params.lambda;
        let mut candidates = Vec::with_capacity(lambda);
        let mut y = vec![0.0; n];
        for _ in 0..lambda {
            for i in 0..n {
                let z = self.rng.next_normal();
                y[i] = self.sigma * self.cov.diag[i].sqrt() * z;
            }
            let mut x = vec![0.0; n];
            for i in 0..n {
                x[i] = self.xmean[i] + y[i];
            }
            candidates.push(x);
        }
        candidates
    }

    fn tell(&mut self, arx: Vec<Vec<f64>>, fitvals: Vec<f64>) {
        let lambda = fitvals.len();
        assert_eq!(lambda, arx.len());
        self.counteval += lambda as u64;
        let n = self.n;
        let par = &self.params;
        let xold = self.xmean.clone();

        let mut idx_vec: Vec<usize> = (0..lambda).collect();
        idx_vec.sort_by(|&i, &j| {
            fitvals[i]
                .partial_cmp(&fitvals[j])
                .unwrap_or(Ordering::Equal)
        });

        let mut arx_sorted = Vec::with_capacity(lambda);
        let mut fitvals_sorted = Vec::with_capacity(lambda);
        for &k in &idx_vec {
            arx_sorted.push(arx[k].clone());
            fitvals_sorted.push(fitvals[k]);
        }
        self.fitvals = fitvals_sorted;
        if let Some(first) = self.fitvals.first() {
            self.best
                .update(&arx_sorted[0], *first, self.counteval);
        }

        let mut new_xmean = vec![0.0; n];
        for i in 0..n {
            let mut s = 0.0;
            for k in 0..par.mu {
                s += par.weights[k] * arx_sorted[k][i];
            }
            new_xmean[i] = s;
        }
        self.xmean = new_xmean;

        let mut y = vec![0.0; n];
        for i in 0..n {
            y[i] = self.xmean[i] - xold[i];
        }
        let mut z = vec![0.0; n];
        for i in 0..n {
            let s = self.sigma * self.cov.diag[i].sqrt();
            z[i] = if s > 0.0 { y[i] / s } else { 0.0 };
        }

        let csn = (par.cs * (2.0 - par.cs) * par.mueff).sqrt() / self.sigma;
        for i in 0..n {
            self.ps[i] = (1.0 - par.cs) * self.ps[i] + csn * z[i];
        }

        let ccn = (par.cc * (2.0 - par.cc) * par.mueff).sqrt() / self.sigma;
        let sum_square_ps = norm_sq(&self.ps);

        let exponent = 2.0 * self.counteval as f64 / par.lambda as f64;
        let denom = 1.0 - (1.0 - par.cs).powf(exponent);
        let left = sum_square_ps / n as f64;
        let hsig_cond = if denom > 0.0 { left / denom } else { left };
        let hsig = if hsig_cond < 2.0 + 4.0 / (n as f64 + 1.0) {
            1.0
        } else {
            0.0
        };

        for i in 0..n {
            self.pc[i] = (1.0 - par.cc) * self.pc[i] + ccn * hsig * y[i];
        }

        let weight_sum: f64 = par.weights.iter().sum();
        let c1a =
            par.c1 * (1.0 - (1.0 - hsig * hsig) * par.cc * (2.0 - par.cc));
        for i in 0..n {
            self.cov.diag[i] *= 1.0 - c1a - par.cmu * weight_sum;
            self.cov.diag[i] += par.c1 * self.pc[i] * self.pc[i];
        }

        for (k, w) in par.weights.iter().enumerate() {
            let mut wk = *w;
            let dx = vec_sub(&arx_sorted[k], &xold);
            let mut mahal = 0.0;
            for i in 0..n {
                let s = self.sigma * self.cov.diag[i].sqrt();
                let zi = if s > 0.0 { dx[i] / s } else { 0.0 };
                mahal += zi * zi;
            }
            mahal = mahal.sqrt();
            if wk < 0.0 && mahal > 0.0 {
                wk *= n as f64 * (self.sigma / mahal).powi(2);
            }
            for i in 0..n {
                let s = dx[i] / self.sigma;
                self.cov.diag[i] += wk * par.cmu * s * s;
            }
        }

        self.cov.update_invsqrt_and_condition();

        let cn = par.cs / par.damps;
        let exponent_sigma = cn * (sum_square_ps / n as f64 - 1.0) / 2.0;
        let exponent_clamped = exponent_sigma.clamp(-1.0, 1.0);
        self.sigma *= exponent_clamped.exp();
    }

    fn stop_status(&self) -> StopStatusInternal {
        let mut res = StopStatusInternal::default();
        if self.counteval == 0 {
            return res;
        }
        if self.counteval >= self.max_evals {
            res.stopped = true;
            res.maxfevals = true;
        }
        if let Some(ftarget) = self.ftarget {
            if !self.fitvals.is_empty() && self.fitvals[0] <= ftarget {
                res.stopped = true;
                res.ftarget = true;
            }
        }
        if self.cov.condition_number > 1e14 {
            res.stopped = true;
            res.condition = true;
        }
        if self.fitvals.len() > 1 {
            let last = *self.fitvals.last().unwrap();
            let first = self.fitvals[0];
            if (last - first).abs() < 1e-12 {
                res.stopped = true;
                res.tolfun = true;
            }
        }
        let max_eig = self
            .cov
            .diag
            .iter()
            .cloned()
            .fold(0.0_f64, f64::max);
        if self.sigma * max_eig.sqrt() < 1e-11 {
            res.stopped = true;
            res.tolx = true;
        }
        res
    }

    fn result(
        &self,
    ) -> (
        Vec<f64>,
        f64,
        u64,
        u64,
        u64,
        Vec<f64>,
        Vec<f64>,
    ) {
        let stds: Vec<f64> = self
            .cov
            .diag
            .iter()
            .map(|v| self.sigma * v.sqrt())
            .collect();
        let iterations = self.counteval / self.params.lambda as u64;
        (
            self.best.x.clone(),
            self.best.f,
            self.best.evals,
            self.counteval,
            iterations,
            self.xmean.clone(),
            stds,
        )
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct CmaesLm {
    n: usize,
    params: CmaesParams,
    max_evals: u64,
    ftarget: Option<f64>,
    xmean: Vec<f64>,
    sigma: f64,
    pc: Vec<f64>,
    ps: Vec<f64>,
    cov: DiagCovariance,
    history: Vec<LmHistory>,
    history_size: usize,
    counteval: u64,
    fitvals: Vec<f64>,
    best: BestSolution,
    rng: LcgRng,
}

impl CmaesLm {
    fn new(xstart: Vec<f64>, sigma: f64, opts: &Options) -> Self {
        let n = xstart.len();
        let params = CmaesParams::new(n, opts.popsize, opts.strategy);
        let lambda = params.lambda as u64;
        let max_evals = opts.max_evals.unwrap_or_else(|| {
            let v = 100.0 * lambda as f64
                + 150.0 * (n as f64 + 3.0).powi(2) * (lambda as f64).sqrt();
            v as u64
        });
        let cov = DiagCovariance::new(n);
        let pc = vec![0.0; n];
        let ps = vec![0.0; n];
        let best = BestSolution::new(n);
        let history_size = n.min(10);
        Self {
            n,
            params,
            max_evals,
            ftarget: opts.ftarget,
            xmean: xstart,
            sigma,
            pc,
            ps,
            cov,
            history: Vec::new(),
            history_size,
            counteval: 0,
            fitvals: Vec::new(),
            best,
            rng: LcgRng::new(opts.seed),
        }
    }

    fn ask_candidates(&mut self) -> Vec<Vec<f64>> {
        let n = self.n;
        let lambda = self.params.lambda;
        let mut candidates = Vec::with_capacity(lambda);
        let mut y = vec![0.0; n];
        for _ in 0..lambda {
            for i in 0..n {
                let z = self.rng.next_normal();
                y[i] = self.sigma * self.cov.diag[i].sqrt() * z;
            }
            if !self.history.is_empty() {
                for h in &self.history {
                    let coeff = self.rng.next_normal() * h.scale;
                    for i in 0..n {
                        y[i] += coeff * h.y[i];
                    }
                }
            }
            let mut x = vec![0.0; n];
            for i in 0..n {
                x[i] = self.xmean[i] + y[i];
            }
            candidates.push(x);
        }
        candidates
    }

    fn tell(&mut self, arx: Vec<Vec<f64>>, fitvals: Vec<f64>) {
        let lambda = fitvals.len();
        assert_eq!(lambda, arx.len());
        self.counteval += lambda as u64;
        let n = self.n;
        let par = &self.params;
        let xold = self.xmean.clone();

        let mut idx_vec: Vec<usize> = (0..lambda).collect();
        idx_vec.sort_by(|&i, &j| {
            fitvals[i]
                .partial_cmp(&fitvals[j])
                .unwrap_or(Ordering::Equal)
        });

        let mut arx_sorted = Vec::with_capacity(lambda);
        let mut fitvals_sorted = Vec::with_capacity(lambda);
        for &k in &idx_vec {
            arx_sorted.push(arx[k].clone());
            fitvals_sorted.push(fitvals[k]);
        }
        self.fitvals = fitvals_sorted;
        if let Some(first) = self.fitvals.first() {
            self.best
                .update(&arx_sorted[0], *first, self.counteval);
        }

        let mut new_xmean = vec![0.0; n];
        for i in 0..n {
            let mut s = 0.0;
            for k in 0..par.mu {
                s += par.weights[k] * arx_sorted[k][i];
            }
            new_xmean[i] = s;
        }
        self.xmean = new_xmean;

        let mut y = vec![0.0; n];
        for i in 0..n {
            y[i] = self.xmean[i] - xold[i];
        }
        let mut z = vec![0.0; n];
        for i in 0..n {
            let s = self.sigma * self.cov.diag[i].sqrt();
            z[i] = if s > 0.0 { y[i] / s } else { 0.0 };
        }

        let csn = (par.cs * (2.0 - par.cs) * par.mueff).sqrt() / self.sigma;
        for i in 0..n {
            self.ps[i] = (1.0 - par.cs) * self.ps[i] + csn * z[i];
        }

        let ccn = (par.cc * (2.0 - par.cc) * par.mueff).sqrt() / self.sigma;
        let sum_square_ps = norm_sq(&self.ps);

        let exponent = 2.0 * self.counteval as f64 / par.lambda as f64;
        let denom = 1.0 - (1.0 - par.cs).powf(exponent);
        let left = sum_square_ps / n as f64;
        let hsig_cond = if denom > 0.0 { left / denom } else { left };
        let hsig = if hsig_cond < 2.0 + 4.0 / (n as f64 + 1.0) {
            1.0
        } else {
            0.0
        };

        for i in 0..n {
            self.pc[i] = (1.0 - par.cc) * self.pc[i] + ccn * hsig * y[i];
        }

        // limited-memory: store direction history
        let mut norm_y = 0.0;
        for i in 0..n {
            norm_y += y[i] * y[i];
        }
        norm_y = norm_y.sqrt();
        if norm_y > 0.0 {
            let mut y_norm = vec![0.0; n];
            for i in 0..n {
                y_norm[i] = y[i] / norm_y;
            }
            self.history.push(LmHistory {
                y: y_norm,
                scale: 1.0,
            });
            if self.history.len() > self.history_size {
                self.history.remove(0);
            }
        }

        let weight_sum: f64 = par.weights.iter().sum();
        let c1a =
            par.c1 * (1.0 - (1.0 - hsig * hsig) * par.cc * (2.0 - par.cc));
        for i in 0..n {
            self.cov.diag[i] *= 1.0 - c1a - par.cmu * weight_sum;
            self.cov.diag[i] += par.c1 * self.pc[i] * self.pc[i];
        }

        for (k, w) in par.weights.iter().enumerate() {
            let mut wk = *w;
            let dx = vec_sub(&arx_sorted[k], &xold);
            let mut mahal = 0.0;
            for i in 0..n {
                let s = self.sigma * self.cov.diag[i].sqrt();
                let zi = if s > 0.0 { dx[i] / s } else { 0.0 };
                mahal += zi * zi;
            }
            mahal = mahal.sqrt();
            if wk < 0.0 && mahal > 0.0 {
                wk *= n as f64 * (self.sigma / mahal).powi(2);
            }
            for i in 0..n {
                let s = dx[i] / self.sigma;
                self.cov.diag[i] += wk * par.cmu * s * s;
            }
        }

        self.cov.update_invsqrt_and_condition();

        let cn = par.cs / par.damps;
        let exponent_sigma = cn * (sum_square_ps / n as f64 - 1.0) / 2.0;
        let exponent_clamped = exponent_sigma.clamp(-1.0, 1.0);
        self.sigma *= exponent_clamped.exp();
    }

    fn stop_status(&self) -> StopStatusInternal {
        let mut res = StopStatusInternal::default();
        if self.counteval == 0 {
            return res;
        }
        if self.counteval >= self.max_evals {
            res.stopped = true;
            res.maxfevals = true;
        }
        if let Some(ftarget) = self.ftarget {
            if !self.fitvals.is_empty() && self.fitvals[0] <= ftarget {
                res.stopped = true;
                res.ftarget = true;
            }
        }
        if self.cov.condition_number > 1e14 {
            res.stopped = true;
            res.condition = true;
        }
        if self.fitvals.len() > 1 {
            let last = *self.fitvals.last().unwrap();
            let first = self.fitvals[0];
            if (last - first).abs() < 1e-12 {
                res.stopped = true;
                res.tolfun = true;
            }
        }
        let max_eig = self
            .cov
            .diag
            .iter()
            .cloned()
            .fold(0.0_f64, f64::max);
        if self.sigma * max_eig.sqrt() < 1e-11 {
            res.stopped = true;
            res.tolx = true;
        }
        res
    }

    fn result(
        &self,
    ) -> (
        Vec<f64>,
        f64,
        u64,
        u64,
        u64,
        Vec<f64>,
        Vec<f64>,
    ) {
        let stds: Vec<f64> = self
            .cov
            .diag
            .iter()
            .map(|v| self.sigma * v.sqrt())
            .collect();
        let iterations = self.counteval / self.params.lambda as u64;
        (
            self.best.x.clone(),
            self.best.f,
            self.best.evals,
            self.counteval,
            iterations,
            self.xmean.clone(),
            stds,
        )
    }
}

#[derive(Serialize, Deserialize, Clone)]
enum Engine {
    Full(CmaesFull),
    Sep(CmaesSep),
    Lm(CmaesLm),
}

impl Engine {
    fn ask_candidates(&mut self) -> Vec<Vec<f64>> {
        match self {
            Engine::Full(e) => e.ask_candidates(),
            Engine::Sep(e) => e.ask_candidates(),
            Engine::Lm(e) => e.ask_candidates(),
        }
    }

    fn tell(&mut self, arx: Vec<Vec<f64>>, fitvals: Vec<f64>) {
        match self {
            Engine::Full(e) => e.tell(arx, fitvals),
            Engine::Sep(e) => e.tell(arx, fitvals),
            Engine::Lm(e) => e.tell(arx, fitvals),
        }
    }

    fn stop_status(&self) -> StopStatusInternal {
        match self {
            Engine::Full(e) => e.stop_status(),
            Engine::Sep(e) => e.stop_status(),
            Engine::Lm(e) => e.stop_status(),
        }
    }

    fn result(
        &self,
    ) -> (
        Vec<f64>,
        f64,
        u64,
        u64,
        u64,
        Vec<f64>,
        Vec<f64>,
    ) {
        match self {
            Engine::Full(e) => e.result(),
            Engine::Sep(e) => e.result(),
            Engine::Lm(e) => e.result(),
        }
    }

    fn lambda(&self) -> usize {
        match self {
            Engine::Full(e) => e.params.lambda,
            Engine::Sep(e) => e.params.lambda,
            Engine::Lm(e) => e.params.lambda,
        }
    }

    fn n(&self) -> usize {
        match self {
            Engine::Full(e) => e.n,
            Engine::Sep(e) => e.n,
            Engine::Lm(e) => e.n,
        }
    }
}

fn create_engine(
    xstart: Vec<f64>,
    sigma: f64,
    opts: &Options,
    model: CovarianceModelOpt,
) -> Engine {
    match model {
        CovarianceModelOpt::Full => Engine::Full(CmaesFull::new(xstart, sigma, opts)),
        CovarianceModelOpt::Sep => Engine::Sep(CmaesSep::new(xstart, sigma, opts)),
        CovarianceModelOpt::Lm => Engine::Lm(CmaesLm::new(xstart, sigma, opts)),
        CovarianceModelOpt::Auto => unreachable!(),
    }
}

// -------------------------------------------------------------------
// WASM-facing result and stop status
// -------------------------------------------------------------------

#[wasm_bindgen]
pub struct StopStatus {
    stopped: bool,
    maxfevals: bool,
    ftarget: bool,
    condition: bool,
    tolfun: bool,
    tolx: bool,
}

impl From<StopStatusInternal> for StopStatus {
    fn from(s: StopStatusInternal) -> Self {
        Self {
            stopped: s.stopped,
            maxfevals: s.maxfevals,
            ftarget: s.ftarget,
            condition: s.condition,
            tolfun: s.tolfun,
            tolx: s.tolx,
        }
    }
}

#[wasm_bindgen]
impl StopStatus {
    #[wasm_bindgen(getter)]
    pub fn stopped(&self) -> bool {
        self.stopped
    }
    #[wasm_bindgen(getter)]
    pub fn maxfevals(&self) -> bool {
        self.maxfevals
    }
    #[wasm_bindgen(getter)]
    pub fn ftarget(&self) -> bool {
        self.ftarget
    }
    #[wasm_bindgen(getter)]
    pub fn condition(&self) -> bool {
        self.condition
    }
    #[wasm_bindgen(getter)]
    pub fn tolfun(&self) -> bool {
        self.tolfun
    }
    #[wasm_bindgen(getter)]
    pub fn tolx(&self) -> bool {
        self.tolx
    }
}

#[wasm_bindgen]
pub struct FminResult {
    best_x: Vec<f64>,
    best_f: f64,
    evals_best: u64,
    evals: u64,
    iterations: u64,
    xmean: Vec<f64>,
    stds: Vec<f64>,
}

impl FminResult {
    fn new(
        best_x: Vec<f64>,
        best_f: f64,
        evals_best: u64,
        evals: u64,
        iterations: u64,
        xmean: Vec<f64>,
        stds: Vec<f64>,
    ) -> Self {
        Self {
            best_x,
            best_f,
            evals_best,
            evals,
            iterations,
            xmean,
            stds,
        }
    }
}

#[wasm_bindgen]
impl FminResult {
    #[wasm_bindgen(getter)]
    pub fn best_f(&self) -> f64 {
        self.best_f
    }
    #[wasm_bindgen(getter)]
    pub fn evals_best(&self) -> u32 {
        self.evals_best as u32
    }
    #[wasm_bindgen(getter)]
    pub fn evals(&self) -> u32 {
        self.evals as u32
    }
    #[wasm_bindgen(getter)]
    pub fn iterations(&self) -> u32 {
        self.iterations as u32
    }
    pub fn best_x(&self) -> Float64Array {
        Float64Array::from(self.best_x.as_slice())
    }
    pub fn xmean(&self) -> Float64Array {
        Float64Array::from(self.xmean.as_slice())
    }
    pub fn stds(&self) -> Float64Array {
        Float64Array::from(self.stds.as_slice())
    }
}

// -------------------------------------------------------------------
// WASM CMA-ES object with batch interface & serialization
// -------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
struct EngineState {
    engine: Engine,
    opts: Options,
}

#[wasm_bindgen]
pub struct WasmCmaes {
    engine: Engine,
    opts: Options,
    dim: usize,
    lambda: usize,
    batch_candidates: Vec<f64>,
}

#[wasm_bindgen]
impl WasmCmaes {
    #[wasm_bindgen(constructor)]
    pub fn new(
        xstart: &Float64Array,
        sigma: f64,
        options: Option<JsValue>,
    ) -> WasmCmaes {
        let dim = xstart.length() as usize;
        let mut x = vec![0.0; dim];
        xstart.copy_to(&mut x);
        let opts = parse_options(options, dim);
        let model = choose_covar_model(dim, opts.covar_model);
        let engine = create_engine(x, sigma, &opts, model);
        let lambda = engine.lambda();
        let batch_candidates = vec![0.0; dim * lambda];
        WasmCmaes {
            engine,
            opts,
            dim,
            lambda,
            batch_candidates,
        }
    }

    pub fn ask(&mut self) -> Array {
        let candidates = self.engine.ask_candidates();
        let arr = Array::new();
        for x in &candidates {
            arr.push(&Float64Array::from(x.as_slice()));
        }
        arr
    }

    pub fn tell(&mut self, arx: &Array, fitvals: &Float64Array) {
        let lambda = arx.length() as usize;
        let mut candidates: Vec<Vec<f64>> = Vec::with_capacity(lambda);
        for i in 0..lambda {
            let v = arx.get(i as u32);
            let xs = Float64Array::from(v);
            let mut vec = vec![0.0; xs.length() as usize];
            xs.copy_to(&mut vec);
            candidates.push(vec);
        }
        let mut fits = vec![0.0; fitvals.length() as usize];
        fitvals.copy_to(&mut fits);
        self.engine.tell(candidates, fits);
    }

    pub fn ask_flat(&mut self) -> Float64Array {
        let candidates = self.engine.ask_candidates();
        let lambda = candidates.len();
        let dim = self.dim;
        self.lambda = lambda;
        self.batch_candidates.resize(lambda * dim, 0.0);
        for (k, x) in candidates.iter().enumerate() {
            let offset = k * dim;
            self.batch_candidates[offset..offset + dim]
                .copy_from_slice(&x[..]);
        }
        Float64Array::from(self.batch_candidates.as_slice())
    }

    pub fn tell_flat(&mut self, fitvals: &Float64Array) {
        let lambda = self.lambda;
        let dim = self.dim;
        if fitvals.length() as usize != lambda {
            log("tell_flat: fitness length mismatch");
            return;
        }
        let mut fits = vec![0.0; lambda];
        fitvals.copy_to(&mut fits);
        let mut candidates: Vec<Vec<f64>> = Vec::with_capacity(lambda);
        for k in 0..lambda {
            let offset = k * dim;
            let mut x = vec![0.0; dim];
            x.copy_from_slice(&self.batch_candidates[offset..offset + dim]);
            candidates.push(x);
        }
        self.engine.tell(candidates, fits);
    }

    pub fn stop_status(&self) -> StopStatus {
        StopStatus::from(self.engine.stop_status())
    }

    pub fn result(&self) -> FminResult {
        let (best_x, best_f, evals_best, evals, iters, xmean, stds) =
            self.engine.result();
        FminResult::new(best_x, best_f, evals_best, evals, iters, xmean, stds)
    }

    /// Current covariance matrix (sigma^2 * C) flattened row-major.
    /// For sep/lm engines, off-diagonal entries are zero.
    pub fn cov_matrix(&self) -> Float64Array {
        let n = self.dim;
        let mut out = vec![0.0; n * n];
        match &self.engine {
            Engine::Full(e) => {
                let sigma2 = e.sigma * e.sigma;
                for i in 0..n {
                    for j in 0..n {
                        out[idx(n, i, j)] = sigma2 * e.c.data[idx(n, i, j)];
                    }
                }
            }
            Engine::Sep(e) => {
                let sigma2 = e.sigma * e.sigma;
                for i in 0..n {
                    out[idx(n, i, i)] = sigma2 * e.cov.diag[i];
                }
            }
            Engine::Lm(e) => {
                let sigma2 = e.sigma * e.sigma;
                for i in 0..n {
                    out[idx(n, i, i)] = sigma2 * e.cov.diag[i];
                }
            }
        }
        Float64Array::from(out.as_slice())
    }

    #[wasm_bindgen(getter)]
    pub fn dimension(&self) -> u32 {
        self.dim as u32
    }

    #[wasm_bindgen(getter)]
    pub fn lambda(&self) -> u32 {
        self.lambda as u32
    }

    pub fn to_json_state(&self) -> Result<JsValue, JsValue> {
        let st = EngineState {
            engine: self.engine.clone(),
            opts: self.opts.clone(),
        };
        to_value(&st)
            .map_err(|e| JsValue::from_str(&format!("serialize error: {:?}", e)))
    }
}

#[wasm_bindgen]
pub fn wasm_cmaes_from_state(state: &JsValue) -> Result<WasmCmaes, JsValue> {
    let st: EngineState = from_value(state.clone())
        .map_err(|e| JsValue::from_str(&format!("deserialize error: {:?}", e)))?;
    let dim = st.engine.n();
    let lambda = st.engine.lambda();
    let batch_candidates = vec![0.0; dim * lambda];
    Ok(WasmCmaes {
        engine: st.engine,
        opts: st.opts,
        dim,
        lambda,
        batch_candidates,
    })
}

// -------------------------------------------------------------------
// JS Objective runner with constraints & noise
// -------------------------------------------------------------------

fn evaluate_objective_js(
    x: &[f64],
    objective: &Function,
) -> Result<f64, JsValue> {
    let js_x = Float64Array::from(x);
    let v = objective
        .call1(&JsValue::NULL, &js_x)
        .map_err(|e| e)?;
    v.as_f64()
        .ok_or_else(|| JsValue::from_str("objective must return a number"))
}

fn run_cma_js_objective(
    engine: &mut Engine,
    objective: &Function,
    opts: &Options,
    dim: usize,
) -> Result<(), JsValue> {
    let lambda = engine.lambda();
    loop {
        let status = engine.stop_status();
        if status.stopped {
            break;
        }
        let candidates = engine.ask_candidates();
        let mut fits = Vec::with_capacity(lambda);
        for (k, x_candidate) in candidates.iter().enumerate() {
            let mut x_eval = x_candidate.clone();
            let mut penalty = 0.0;
            if let (Some(lower), Some(upper)) =
                (&opts.bounds_lower, &opts.bounds_upper)
            {
                for i in 0..dim {
                    let mut xi = x_eval[i];
                    if xi < lower[i] {
                        let diff = lower[i] - xi;
                        penalty += diff * diff;
                        xi = lower[i];
                    } else if xi > upper[i] {
                        let diff = xi - upper[i];
                        penalty += diff * diff;
                        xi = upper[i];
                    }
                    x_eval[i] = xi;
                }
            }
            let samples =
                compute_num_samples(k, lambda, &opts.noise) as usize;
            let mut sum_f = 0.0;
            for _ in 0..samples {
                let js_x = Float64Array::from(x_eval.as_slice());
                let v = objective
                    .call1(&JsValue::NULL, &js_x)
                    .map_err(|e| e)?;
                let fx = v.as_f64().ok_or_else(|| {
                    JsValue::from_str("objective must return a number")
                })?;
                sum_f += fx;
            }
            let mean_f = sum_f / samples as f64;
            let f_total = mean_f + opts.constraint_penalty * penalty;
            fits.push(f_total);
        }
        engine.tell(candidates, fits);
    }
    Ok(())
}

// -------------------------------------------------------------------
// Builtin test objectives (native path)
// -------------------------------------------------------------------

fn elli(x: &[f64]) -> f64 {
    let n = x.len();
    if n == 0 {
        return 0.0;
    }
    let aratio: f64 = 1e3f64;
    let mut s = 0.0;
    let denom = (n - 1) as f64;
    for i in 0..n {
        let p = if n == 1 {
            0.0
        } else {
            2.0 * (i as f64) / denom
        };
        s += x[i] * x[i] * aratio.powf(p);
    }
    s
}

fn sphere(x: &[f64]) -> f64 {
    norm_sq(x)
}

fn tablet(x: &[f64]) -> f64 {
    if x.is_empty() {
        return 0.0;
    }
    let mut s = 0.0;
    for &xi in x {
        s += xi * xi;
    }
    s + (1e6 - 1.0) * x[0] * x[0]
}

fn rosenbrock(x: &[f64]) -> f64 {
    let n = x.len();
    if n < 2 {
        return 0.0;
    }
    let mut s = 0.0;
    for i in 0..(n - 1) {
        let xi = x[i];
        let xnext = x[i + 1];
        let t1 = xnext - xi * xi;
        let t2 = xi - 1.0;
        s += 100.0 * t1 * t1 + t2 * t2;
    }
    s
}

// -------------------------------------------------------------------
// Exported high-level functions
// -------------------------------------------------------------------

#[wasm_bindgen(js_name = fmin)]
pub fn fmin_js(
    xstart: &Float64Array,
    sigma: f64,
    objective: &Function,
    options: Option<JsValue>,
) -> Result<FminResult, JsValue> {
    let dim = xstart.length() as usize;
    if dim == 0 {
        return Err(JsValue::from_str("xstart must not be empty"));
    }
    let mut x = vec![0.0; dim];
    xstart.copy_to(&mut x);

    let opts = parse_options(options, dim);
    let model = choose_covar_model(dim, opts.covar_model);
    let mut engine = create_engine(x, sigma, &opts, model);

    run_cma_js_objective(&mut engine, objective, &opts, dim)?;

    let (best_x, best_f, evals_best, evals, iters, xmean, stds) =
        engine.result();
    let fxmean = evaluate_objective_js(&xmean, objective)?;
    let (final_x, final_f) = if best_f < fxmean {
        (best_x, best_f)
    } else {
        (xmean.clone(), fxmean)
    };
    Ok(FminResult::new(
        final_x,
        final_f,
        evals_best,
        evals,
        iters,
        xmean,
        stds,
    ))
}

#[wasm_bindgen(js_name = fmin_builtin)]
pub fn fmin_builtin_js(
    objective_id: u32,
    xstart: &Float64Array,
    sigma: f64,
    options: Option<JsValue>,
) -> Result<FminResult, JsValue> {
    let dim = xstart.length() as usize;
    if dim == 0 {
        return Err(JsValue::from_str("xstart must not be empty"));
    }
    let mut x = vec![0.0; dim];
    xstart.copy_to(&mut x);
    let opts = parse_options(options, dim);
    let model = choose_covar_model(dim, opts.covar_model);
    let mut engine = create_engine(x, sigma, &opts, model);

    loop {
        let status = engine.stop_status();
        if status.stopped {
            break;
        }
        let candidates = engine.ask_candidates();
        let mut fits = Vec::with_capacity(candidates.len());
        for x_candidate in &candidates {
            let f = match objective_id {
                0 => elli(x_candidate),
                1 => sphere(x_candidate),
                2 => tablet(x_candidate),
                3 => rosenbrock(x_candidate),
                _ => {
                    return Err(JsValue::from_str(
                        "invalid builtin objective id",
                    ))
                }
            };
            fits.push(f);
        }
        engine.tell(candidates, fits);
    }

    let (best_x, best_f, evals_best, evals, iters, xmean, stds) =
        engine.result();
    let fxmean = match objective_id {
        0 => elli(&xmean),
        1 => sphere(&xmean),
        2 => tablet(&xmean),
        3 => rosenbrock(&xmean),
        _ => {
            return Err(JsValue::from_str(
                "invalid builtin objective id",
            ))
        }
    };
    let (final_x, final_f) = if best_f < fxmean {
        (best_x, best_f)
    } else {
        (xmean.clone(), fxmean)
    };
    Ok(FminResult::new(
        final_x,
        final_f,
        evals_best,
        evals,
        iters,
        xmean,
        stds,
    ))
}

#[wasm_bindgen(js_name = fmin_restarts)]
pub fn fmin_restarts_js(
    xstart: &Float64Array,
    sigma: f64,
    objective: &Function,
    options: Option<JsValue>,
) -> Result<FminResult, JsValue> {
    let dim = xstart.length() as usize;
    if dim == 0 {
        return Err(JsValue::from_str("xstart must not be empty"));
    }
    let mut x0 = vec![0.0; dim];
    xstart.copy_to(&mut x0);
    let mut opts = parse_options(options, dim);
    let model = choose_covar_model(dim, opts.covar_model);
    let restart_opts = opts.restart.clone();

    let base_popsize = opts.popsize;
    let mut global_best_x = x0.clone();
    let mut global_best_f = f64::INFINITY;
    let mut global_evals_best = 0u64;
    let mut global_evals_total = 0u64;
    let mut global_iters_total = 0u64;
    let mut best_xmean = x0.clone();
    let mut best_stds = vec![0.0; dim];

    let mut rng = LcgRng::new(opts.seed);
    let mut restart = 0usize;

    loop {
        if restart > restart_opts.max_restarts {
            break;
        }
        if let Some(max_total) = restart_opts.max_total_evals {
            if global_evals_total >= max_total {
                break;
            }
        }

        let popsize_run = match restart_opts.strategy {
            RestartStrategyOpt::None => base_popsize,
            RestartStrategyOpt::Ipop => {
                let base = base_popsize.unwrap_or(default_popsize(dim));
                Some(base << restart.min(10))
            }
            RestartStrategyOpt::Bipop => {
                let base = base_popsize.unwrap_or(default_popsize(dim));
                if restart == 0 {
                    Some(base)
                } else {
                    let big = base << restart.min(10);
                    let r = rng.next_f64();
                    let size = if r < 0.5 {
                        base + ((big - base) as f64 * r).round() as usize
                    } else {
                        big
                    };
                    Some(size)
                }
            }
        };
        opts.popsize = popsize_run;

        let mut xstart_run = x0.clone();
        if restart > 0 {
            for i in 0..dim {
                xstart_run[i] += rng.next_normal() * sigma;
            }
        }

        let mut engine = create_engine(xstart_run, sigma, &opts, model);
        run_cma_js_objective(&mut engine, objective, &opts, dim)?;
        let (best_x, best_f, evals_best, evals, iters, xmean, stds) =
            engine.result();
        global_evals_total += evals;
        global_iters_total += iters;
        let fxmean = evaluate_objective_js(&xmean, objective)?;
        let (run_x, run_f, run_evals_best) = if best_f < fxmean {
            (best_x, best_f, evals_best)
        } else {
            (xmean.clone(), fxmean, evals_best)
        };
        if run_f < global_best_f {
            global_best_f = run_f;
            global_best_x = run_x.clone();
            global_evals_best = run_evals_best;
            best_xmean = xmean.clone();
            best_stds = stds.clone();
        }
        if let Some(ft) = opts.ftarget {
            if global_best_f <= ft {
                break;
            }
        }
        if restart_opts.strategy == RestartStrategyOpt::None {
            break;
        }
        restart += 1;
    }

    Ok(FminResult::new(
        global_best_x,
        global_best_f,
        global_evals_best,
        global_evals_total,
        global_iters_total,
        best_xmean,
        best_stds,
    ))
}

// -------------------------------------------------------------------
// Native test suite (classic benchmark functions)
// -------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn rastrigin(x: &[f64]) -> f64 {
        // Global optimum at 0^n with f = 0.
        let a = 10.0;
        let n = x.len() as f64;
        let mut s = 0.0;
        for &xi in x {
            s += xi * xi - a * (2.0 * std::f64::consts::PI * xi).cos();
        }
        a * n + s
    }

    fn ackley(x: &[f64]) -> f64 {
        // Standard Ackley parameters.
        let n = x.len() as f64;
        let a = 20.0;
        let b = 0.2;
        let c = 2.0 * std::f64::consts::PI;
        let sum_sq = x.iter().map(|v| v * v).sum::<f64>();
        let sum_cos = x.iter().map(|v| (c * v).cos()).sum::<f64>();
        -a * (-(b) * (1.0 / n * sum_sq).sqrt()).exp()
            - (1.0 / n * sum_cos).exp()
            + a
            + std::f64::consts::E
    }

    fn griewank(x: &[f64]) -> f64 {
        // Global optimum at 0^n with f = 0.
        let sum_sq = x.iter().map(|v| v * v).sum::<f64>() / 4000.0;
        let mut prod = 1.0;
        for (i, &xi) in x.iter().enumerate() {
            let idx = (i + 1) as f64;
            prod *= (xi / idx.sqrt()).cos();
        }
        sum_sq - prod + 1.0
    }

    fn schwefel(x: &[f64]) -> f64 {
        // Schwefel 2.26; global optimum f=0 at xi ~= 420.968746...
        let n = x.len() as f64;
        let bias = 418.9829 * n;
        let mut s = 0.0;
        for &xi in x {
            s += xi * (xi.abs().sqrt()).sin();
        }
        bias - s
    }

    fn run_cma<F>(dim: usize, x0: Vec<f64>, sigma: f64, f: F, ftarget: f64, max_evals: u64) -> f64
    where
        F: Fn(&[f64]) -> f64,
    {
        let mut opts = Options::default();
        opts.ftarget = Some(ftarget);
        opts.max_evals = Some(max_evals);
        opts.verb_disp = 0;
        opts.seed = 42;
        let model = choose_covar_model(dim, opts.covar_model);
        let mut engine = create_engine(x0.clone(), sigma, &opts, model);

        loop {
            let status = engine.stop_status();
            if status.stopped {
                break;
            }
            let candidates = engine.ask_candidates();
            let mut fits = Vec::with_capacity(candidates.len());
            for x in &candidates {
                fits.push(f(x));
            }
            engine.tell(candidates, fits);
        }
        let (best_x, best_f, _, _, _, _, _) = engine.result();
        // Ensure the returned incumbent matches the objective value.
        let fx = f(&best_x);
        fx.min(best_f)
    }

    #[test]
    fn rosenbrock_tough_valley_converges() {
        let x0 = vec![-1.5, 1.2, 0.8];
        let best = run_cma(3, x0, 0.6, rosenbrock, 1e-8, 150_000);
        assert!(best < 1e-4, "best f = {}", best);
    }

    #[test]
    fn rastrigin_multimodal_converges() {
        let x0 = vec![3.0, -2.5, 1.5, -3.0];
        let best = run_cma(4, x0, 0.8, rastrigin, 1e-4, 200_000);
        assert!(best < 1e-2, "best f = {}", best);
    }

    #[test]
    fn ackley_flat_valley_converges() {
        let x0 = vec![2.5, -1.5, 0.5, -2.0, 1.0];
        let best = run_cma(5, x0, 0.9, ackley, 1e-4, 250_000);
        assert!(best < 5e-3, "best f = {}", best);
    }

    #[test]
    fn griewank_converges() {
        let x0 = vec![5.0, -4.0, 3.0, -2.0, 1.5];
        // Griewank is smooth but has many shallow local regions; accept small residual.
        let best = run_cma(5, x0, 1.2, griewank, 5e-2, 200_000);
        assert!(best < 5e-2, "best f = {}", best);
    }

    #[test]
    fn schwefel_converges_close() {
        // Schwefel is harder; accept loose tol near optimum.
        let dim = 3;
        let x0 = vec![200.0, -150.0, 300.0];
        let best = run_cma(dim, x0, 300.0, schwefel, 1e-2, 300_000);
        assert!(best < 5.0, "best f = {}", best);
    }
}
