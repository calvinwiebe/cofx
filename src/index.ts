import {
  effectMiddleware,
  call,
  all,
  spawn,
  delay,
  race,
  cancel,
  fork,
} from './effect';
import factoryBase from './factory';
import { Middleware } from './types';

const task = factoryBase(effectMiddleware);
const factory = (...middleware: Middleware[]) =>
  factoryBase.apply(this, [...middleware, effectMiddleware]);

export {
  fork,
  all,
  call,
  delay,
  factory,
  factoryBase,
  spawn,
  task,
  race,
  cancel,
};
export * from './types';
