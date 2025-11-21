import {
  WasmCmaes,
  CmaesOptions,
  FminResult,
  wasm_cmaes_from_state,
} from "./pkg/cmaes_wasm";

export interface RunnerEvents {
  onIteration?: (res: FminResult) => void;
  onImprovement?: (res: FminResult) => void;
  onTermination?: (res: FminResult) => void;
}

export class CmaesRunner {
  es: WasmCmaes;
  objective: (x: Float64Array) => number;
  dim: number;
  lambda: number;
  events: RunnerEvents;
  private bestF: number;

  constructor(
    es: WasmCmaes,
    objective: (x: Float64Array) => number,
    events: RunnerEvents = {},
  ) {
    this.es = es;
    this.objective = objective;
    this.dim = es.dimension;
    this.lambda = es.lambda;
    this.events = events;
    this.bestF = Number.POSITIVE_INFINITY;
  }

  /**
   * Run as many CMA-ES iterations as possible within timeBudgetMs,
   * calling the objective from JS and emitting events.
   */
  async step(timeBudgetMs: number = 16): Promise<void> {
    const start = performance.now();
    const dim = this.dim;
    const lambda = this.lambda;

    while (!this.es.stop_status().stopped) {
      const candFlat = this.es.ask_flat();
      const fit = new Float64Array(lambda);
      for (let k = 0; k < lambda; k++) {
        const offset = k * dim;
        const xk = candFlat.subarray(offset, offset + dim);
        fit[k] = this.objective(xk);
      }
      this.es.tell_flat(fit);

      const res = this.es.result();
      if (this.events.onIteration) this.events.onIteration(res);
      if (res.best_f < this.bestF) {
        this.bestF = res.best_f;
        if (this.events.onImprovement) this.events.onImprovement(res);
      }

      if (performance.now() - start >= timeBudgetMs) break;
    }

    if (this.es.stop_status().stopped && this.events.onTermination) {
      this.events.onTermination(this.es.result());
    }
  }

  /**
   * Convenience async loop that keeps calling step() until termination
   * (or maxSteps if provided), yielding to the browser between steps.
   */
  async run(
    maxSteps: number = Infinity,
    timeBudgetMs: number = 16,
  ): Promise<FminResult> {
    let steps = 0;
    while (!this.es.stop_status().stopped && steps < maxSteps) {
      await this.step(timeBudgetMs);
      steps++;
      await new Promise(requestAnimationFrame);
    }
    return this.es.result();
  }

  /**
   * Serialize the current optimizer state. The returned value is
   * JSON-serializable.
   */
  serializeState(): any {
    return this.es.to_json_state();
  }

  /**
   * Restore a runner from a serialized state; the caller must provide
   * a fresh objective function and optional event handlers.
   */
  static fromState(
    state: any,
    objective: (x: Float64Array) => number,
    events: RunnerEvents = {},
  ): CmaesRunner {
    const es = wasm_cmaes_from_state(state);
    return new CmaesRunner(es, objective, events);
  }
}

/**
 * Simple helper to construct and run CMA-ES in one shot using the
 * high-level runner. This uses the batch API and async stepping.
 */
export async function runCmaes(
  xstart: Float64Array,
  sigma: number,
  objective: (x: Float64Array) => number,
  options?: CmaesOptions,
  events: RunnerEvents = {},
): Promise<FminResult> {
  const es = new WasmCmaes(xstart, sigma, options);
  const runner = new CmaesRunner(es, objective, events);
  return runner.run();
}
