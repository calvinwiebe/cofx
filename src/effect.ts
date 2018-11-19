import { isObject } from './is';
import {
  CallEffect,
  Effect,
  Promisify,
  CoFn,
  DelayEffect,
  NextFn,
  AllEffects,
} from './types';
import speculation from './speculation';

const noop = () => {};
const typeDetector = (type: string) => (value: any) =>
  value && isObject(value) && value.type === type;

const CALL = 'CALL';
const call = (fn: CoFn | any[], ...args: any[]): CallEffect => ({
  type: CALL,
  fn,
  args,
});
const isCall = typeDetector(CALL);
function callEffect(
  { fn, args }: { fn: CoFn; args: any[] },
  promisify: Promisify,
  cancelPromise: Promise<any>,
) {
  return speculation((resolve, reject, onCancel) => {
    if (Array.isArray(fn)) {
      const [obj, fnName, ...fargs] = fn;
      return resolve(obj[fnName](...fargs));
    }

    const gen = fn.call(this, ...args);

    if (!gen || typeof gen.next !== 'function') {
      return resolve(gen);
    }

    promisify(gen)
      .then(resolve)
      .catch(reject);

    onCancel(() => {
      const msg = 'call has been cancelled';
      if (typeof gen.next === 'function') {
        gen.throws(msg);
      }
      reject(msg);
    });
  }, cancelPromise);
}

const ALL = 'ALL';
const all = (effects: AllEffects) => ({
  type: ALL,
  effects,
});
const isAll = typeDetector(ALL);
function allEffect({ effects }: { effects: AllEffects }, promisify: Promisify) {
  const ctx = this;

  if (Array.isArray(effects)) {
    const mapFn = (effect: Effect) =>
      effectHandler.call(ctx, effect, promisify);
    const eff = effects.map(mapFn);
    return eff;
  }

  if (isObject(effects)) {
    const reduceFn = (acc: { [key: string]: Promise<any> }, key: string) => {
      return {
        ...acc,
        [key]: effectHandler.call(ctx, effects[key], promisify),
      };
    };
    const eff: { [key: string]: any } = Object.keys(effects).reduce(
      reduceFn,
      {},
    );
    return eff;
  }
}

const RACE = 'RACE';
const race = (effects: AllEffects) => ({
  type: RACE,
  effects,
});
const isRace = typeDetector(RACE);
function raceEffect(
  { effects }: { effects: AllEffects },
  promisify: Promisify,
) {
  const ctx = this;

  if (Array.isArray(effects)) {
    const mapFn = (effect: Effect) =>
      promisify(effectHandler.call(ctx, effect, promisify));
    const eff = effects.map(mapFn);
    return Promise.race(eff);
  }

  const keys = Object.keys(effects);
  return Promise.race(
    keys.map((key: string) => {
      return promisify(effectHandler.call(ctx, effects[key], promisify)).then(
        (result) => {
          return {
            winner: key,
            result,
          };
        },
      );
    }),
  ).then((result) => {
    return keys.reduce((acc: { [key: string]: any }, key: string) => {
      if (result.winner === key) {
        acc[key] = result.result;
      } else {
        acc[key] = undefined;
      }

      return acc;
    }, {});
  });
}

const FORK = 'FORK';
const fork = (fn: CoFn, ...args: any[]) => ({ type: FORK, fn, args });
const isFork = typeDetector(FORK);
function forkEffect(
  { fn, args }: { fn: CoFn; args: any[] },
  promisify: Promisify,
  cancelPromise: Promise<any>,
) {
  console.log('FORK EFFECT', cancelPromise);
  return speculation((resolve, reject, onCancel) => {
    const gen = fn.call(this, ...args);
    promisify(gen).then(noop);
    console.log('RESOLVE');
    resolve();
    console.log('AFTER RESOLVE');
    onCancel(() => {
      console.log('FORK HAS BEEN CANCELLED');
      reject('fork has been cancelled');
    });
  }, cancelPromise);
}

const SPAWN = 'SPAWN';
const spawn = (fn: CoFn, ...args: any[]) => ({ type: SPAWN, fn, args });
const isSpawn = typeDetector(SPAWN);
function spawnEffect(
  { fn, args }: { fn: CoFn; args: any[] },
  promisify: Promisify,
  cancelMap: Map<Promise<any>, Fn>,
) {
  let cancel: any = (resolve: Fn) => () => resolve('Spawn has been cancelled');
  const cancelPromise = new Promise((resolve) => {
    cancel = cancel(resolve);
  });
  const spec = speculation((resolve, reject, onCancel) => {
    promisify(fn.call(this, ...args)).then(noop);
    resolve();
    onCancel(() => {
      reject('spawn has been cancelled');
    });
  }, cancelPromise);

  cancelMap.set(spec, cancel);
  return spec;
}

const CANCEL = 'CANCEL';
const cancel = (fn: Promise<any>) => ({ type: CANCEL, fn });
const isCancel = typeDetector(CANCEL);
function cancelEffect(
  { fn }: { fn: Promise<any> },
  cancelMap: Map<Promise<any>, Fn>,
) {
  const cancel = cancelMap.get(fn);
  if (cancel) {
    cancel();
    cancelMap.delete(fn);
  }
  return Promise.resolve();
}

const DELAY = 'DELAY';
const delay = (ms: number): DelayEffect => ({ type: DELAY, ms });
const isDelay = typeDetector(DELAY);
function delayEffect({ ms }: { ms: number }, cancelPromise: Promise<any>) {
  return speculation((resolve, reject, onCancel) => {
    const timerId = setTimeout(() => {
      resolve();
    }, ms);

    onCancel(() => {
      clearTimeout(timerId);
      reject('delay has been cancelled.');
    });
  }, cancelPromise);
}

type Fn = (...args: any[]) => void;

function effectHandler(
  effect: Effect,
  promisify: Promisify,
  cancelPromise: Promise<any>,
  cancelMap: Map<Promise<any>, Fn>,
) {
  const ctx = this;
  if (isCall(effect))
    return callEffect.call(ctx, effect, promisify, cancelPromise);
  if (isAll(effect)) return allEffect.call(ctx, effect, promisify);
  if (isRace(effect)) return raceEffect.call(ctx, effect, promisify);
  if (isSpawn(effect))
    return spawnEffect.call(ctx, effect, promisify, cancelMap);
  if (isFork(effect))
    return forkEffect.call(ctx, effect, promisify, cancelPromise);
  if (isDelay(effect)) return delayEffect.call(ctx, effect, cancelPromise);
  if (isCancel(effect)) return cancelEffect.call(ctx, effect, cancelMap);
  return effect;
}

function effectMiddleware(next: NextFn) {
  const cancelMap = new Map();

  return (
    effect: Effect,
    promisify: Promisify,
    cancelPromise: Promise<any>,
  ) => {
    const nextEffect = effectHandler(
      effect,
      promisify,
      cancelPromise,
      cancelMap,
    );
    return next(nextEffect);
  };
}

export { effectMiddleware, delay, call, spawn, all, race, fork, cancel };
