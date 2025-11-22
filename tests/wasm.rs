#![cfg(target_arch = "wasm32")]

use js_sys::Float64Array;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

use cmaes_wasm::{fmin_builtin_js, WasmCmaes};

wasm_bindgen_test_configure!(run_in_browser);

fn number_from_display(v: &Float64Array) -> Vec<f64> {
    let mut tmp = vec![0.0; v.length() as usize];
    v.copy_to(&mut tmp);
    tmp
}

#[wasm_bindgen_test]
fn sphere_builtin_converges() {
    let x0 = Float64Array::from(vec![3.0, -2.0].as_slice());
    let res = fmin_builtin_js(1, &x0, 0.8, None).expect("fmin_builtin_js failed");
    assert!(res.best_f() < 1e-4, "best_f too high: {}", res.best_f());
    assert!(res.evals() > 0);
}

#[wasm_bindgen_test]
fn batch_api_round_trip() {
    let dim = 2;
    let x0 = Float64Array::from(vec![0.5, -1.5].as_slice());
    let mut opts_obj = js_sys::Object::new();
    js_sys::Reflect::set(
        &opts_obj,
        &JsValue::from_str("popsize"),
        &JsValue::from_f64(12.0),
    )
    .unwrap();
    let opts = Some(JsValue::from(opts_obj));

    let mut es = WasmCmaes::new(&x0, 1.2, opts);
    let lambda = es.lambda() as usize;

    // one ask/tell step using batch API
    let cand_flat = es.ask_flat();
    let mut fits = vec![0.0; lambda];
    for k in 0..lambda {
        let offset = k * dim;
        let mut point = vec![0.0; dim];
        cand_flat
            .subarray(offset as u32, (offset + dim) as u32)
            .copy_to(&mut point);
        let f = point.iter().map(|v| v * v).sum::<f64>();
        fits[k] = f;
    }
    let fits_js = Float64Array::from(fits.as_slice());
    es.tell_flat(&fits_js);

    let res = es.result();
    assert!(res.evals() > 0);
    let best = number_from_display(&res.best_x());
    assert_eq!(best.len(), dim);
}
