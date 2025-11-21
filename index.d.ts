export type CovarianceModel = "auto" | "full" | "sep" | "lm";
export type StrategyMode = "auto" | "classic";
export type RestartStrategy = "none" | "ipop" | "bipop";

export interface NoiseOptions {
  samplesPerPoint?: number;
  adaptive?: boolean;
  maxSamplesPerPoint?: number;
}

export interface Bounds {
  lower?: Float64Array;
  upper?: Float64Array;
}

export interface CmaesOptions {
  popsize?: number;
  maxEvals?: number;
  ftarget?: number;
  seed?: number;
  verbDisp?: number;
  covarModel?: CovarianceModel;
  strategy?: StrategyMode;
  bounds?: Bounds;
  constraintPenalty?: number;
  noise?: NoiseOptions;
  restartStrategy?: RestartStrategy;
  maxRestarts?: number;
  maxTotalEvals?: number;
}

export class StopStatus {
  readonly stopped: boolean;
  readonly maxfevals: boolean;
  readonly ftarget: boolean;
  readonly condition: boolean;
  readonly tolfun: boolean;
  readonly tolx: boolean;
}

export class FminResult {
  readonly best_f: number;
  readonly evals_best: number;
  readonly evals: number;
  readonly iterations: number;
  best_x(): Float64Array;
  xmean(): Float64Array;
  stds(): Float64Array;
}

export class WasmCmaes {
  constructor(xstart: Float64Array, sigma: number, options?: CmaesOptions);

  ask(): Array<Float64Array>;
  tell(arx: Array<Float64Array>, fitvals: Float64Array): void;

  /**
   * Batch interface: returns a flat buffer of length lambda * dimension
   * with all candidates concatenated.
   */
  ask_flat(): Float64Array;

  /**
   * Tell corresponding to ask_flat: fitvals.length === lambda.
   */
  tell_flat(fitvals: Float64Array): void;

  readonly dimension: number;
  readonly lambda: number;

  stop_status(): StopStatus;
  result(): FminResult;

  /**
   * Serialize the internal CMA-ES state to a JSON-serializable value.
   */
  to_json_state(): any;
}

export function wasm_cmaes_from_state(state: any): WasmCmaes;

export function fmin(
  xstart: Float64Array,
  sigma: number,
  objective: (x: Float64Array) => number,
  options?: CmaesOptions,
): FminResult;

export function fmin_restarts(
  xstart: Float64Array,
  sigma: number,
  objective: (x: Float64Array) => number,
  options?: CmaesOptions,
): FminResult;

export function fmin_builtin(
  objectiveId: number,
  xstart: Float64Array,
  sigma: number,
  options?: CmaesOptions,
): FminResult;
