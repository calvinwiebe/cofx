export type Fn = (...args: any[]) => void;
export type GenFn<V = any> = (...args: any[]) => IterableIterator<V>;
export type CoFn<V = any> = GenFn<V> | Fn;

export type TaskFn<V> = (fn: CoFn<V>, ...args: any[]) => Promise<any>;
export interface CallEffect {
  type: 'CALL';
  fn: Fn | any[];
  args: any[];
}
export interface SpawnEffect {
  type: 'SPAWN';
  fn: Fn;
  args: any[];
}
export interface DelayEffect {
  type: 'DELAY';
  ms: number;
}
export type AllEffects = Effect[] | { [key: string]: Effect };
export interface AllEffect {
  type: 'ALL';
  effects: AllEffects;
}
export type Effect = { type: string } & { [key: string]: any };
export type NextFn = (...args: any[]) => Middleware;
export type Promisify = (p: any) => Promise<any>;
export type Middleware = (
  next: NextFn,
) => (effect: Effect, promisify: Promisify) => Middleware;
export interface CancellablePromise<T> extends Promise<T> {
  cancel?: (...args: any[]) => void;
}
