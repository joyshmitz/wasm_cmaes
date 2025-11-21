/* tslint:disable */
/* eslint-disable */
export function fmin(xstart: Float64Array, sigma: number, objective: Function, options?: any | null): FminResult;
export function fmin_builtin(objective_id: number, xstart: Float64Array, sigma: number, options?: any | null): FminResult;
export function fmin_restarts(xstart: Float64Array, sigma: number, objective: Function, options?: any | null): FminResult;
export function wasm_cmaes_from_state(state: any): WasmCmaes;
export class FminResult {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  stds(): Float64Array;
  xmean(): Float64Array;
  best_x(): Float64Array;
  readonly evals_best: number;
  readonly iterations: number;
  readonly evals: number;
  readonly best_f: number;
}
export class StopStatus {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  readonly tolx: boolean;
  readonly tolfun: boolean;
  readonly ftarget: boolean;
  readonly stopped: boolean;
  readonly condition: boolean;
  readonly maxfevals: boolean;
}
export class WasmCmaes {
  free(): void;
  [Symbol.dispose](): void;
  stop_status(): StopStatus;
  to_json_state(): any;
  ask(): Array<any>;
  constructor(xstart: Float64Array, sigma: number, options?: any | null);
  tell(arx: Array<any>, fitvals: Float64Array): void;
  result(): FminResult;
  ask_flat(): Float64Array;
  tell_flat(fitvals: Float64Array): void;
  readonly lambda: number;
  readonly dimension: number;
}
