import { isObject } from './is';
import {
  CallEffect,
  Effect,
  Promisify,
  CoFn,
  DelayEffect,
  NextFn,
  AllEffects,
  HiddenCancellablePromise,
} from './types';
import { cancelSymbol } from './symbol';

type Fn = (...args: any[]) => void;

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
) {
  let cancel: () => void = null;
  const promise: HiddenCancellablePromise<any> = new Promise(
    (resolve, reject) => {
      if (Array.isArray(fn)) {
        const [obj, fnName, ...fargs] = fn;
        return resolve(obj[fnName](...fargs));
      }

      const gen = fn.call(this, ...args);

      cancel = () => {
        const msg = 'call has been cancelled';
        if (typeof gen.next === 'function') {
          gen.throws(msg);
        }
        reject(msg);
      };

      if (!gen || typeof gen.next !== 'function') {
        return resolve(gen);
      }

      promisify(gen)
        .then(resolve)
        .catch(reject);
    },
  );

  promise[cancelSymbol] = cancel;
  return promise;
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
    const cancel = () => {
      eff.forEach((e) => e.cancel());
    };
    (eff as any)[cancelSymbol] = cancel;
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
    const cancel = () => {
      Object.keys(eff).forEach((key) => eff[key].cancel());
    };
    (eff as any)[cancelSymbol] = cancel;
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

const SPAWN = 'SPAWN';
const spawn = (fn: CoFn, ...args: any[]) => ({ type: SPAWN, fn, args });
const isSpawn = typeDetector(SPAWN);
function spawnEffect(
  { fn, args }: { fn: CoFn; args: any[] },
  promisify: Promisify,
) {
  let cancel: Fn = null;

  const promise: HiddenCancellablePromise<any> = new Promise(
    (resolve, reject) => {
      promisify(fn.call(this, ...args)).then(noop);
      resolve();
      cancel = () => {
        reject('spawn has been cancelled');
      };
    },
  );

  promise[cancelSymbol] = cancel;
  return promise;
}

const DELAY = 'DELAY';
const delay = (ms: number): DelayEffect => ({ type: DELAY, ms });
const isDelay = typeDetector(DELAY);
function delayEffect({ ms }: { ms: number }) {
  let cancel: Fn = null;

  const promise: HiddenCancellablePromise<any> = new Promise(
    (resolve, reject) => {
      const timerId = setTimeout(() => {
        resolve();
      }, ms);

      cancel = () => {
        clearTimeout(timerId);
        reject('delay has been cancelled.');
      };
    },
  );

  promise[cancelSymbol] = cancel;
  return promise;
}

function effectHandler(effect: Effect, promisify: Promisify) {
  const ctx = this;
  if (isCall(effect)) return callEffect.call(ctx, effect, promisify);
  if (isAll(effect)) return allEffect.call(ctx, effect, promisify);
  if (isRace(effect)) return raceEffect.call(ctx, effect, promisify);
  if (isSpawn(effect)) return spawnEffect.call(ctx, effect, promisify);
  if (isDelay(effect)) return delayEffect.call(ctx, effect);
  return effect;
}

function effectMiddleware(next: NextFn) {
  return (effect: Effect, promisify: Promisify) => {
    const nextEffect = effectHandler(effect, promisify);
    return next(nextEffect);
  };
}

export { effectMiddleware, delay, call, spawn, all, race };
