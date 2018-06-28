const {
  isPromise,
  isGenerator,
  isGeneratorFunction,
  isObject,
} = require('./is');

const slice = Array.prototype.slice;
const TASK = 'TASK';

function applyMiddleware(middlewares, ctx) {
  return (...args) => {
    const n = (effect) => effect;
    const chain = middlewares.reduce((acc, md) => md.call(ctx, acc), n);
    return chain(...args);
  };
}

function factoryBase(...middleware) {
  function autoInc(seed = 0) {
    return () => ++seed;
  }
  const uid = autoInc();
  /**
   * Execute the generator function or a generator
   * and return a promise.
   */
  return function runtime(gen, ...args) {
    const tasks = {};
    const ctx = this;
    const runtimeId = uid();

    if (typeof gen === 'function') {
      gen = gen.apply(ctx, args);
    }

    const task = {
      [TASK]: true,
      id: runtimeId,
      iterator: gen,
      cancel: onRejected,
    };

    tasks[runtimeId] = task;

    onFulfilled(); // kickstart generator

    function onFulfilled(res) {
      const ret = gen.next(res);
      next(ret);
      return null;
    }

    function onRejected(err) {
      const ret = gen.throw(err);
      next(ret);
    }

    function addTask(fn, ...taskArgs) {
      const taskGen = runtime(fn, ...taskArgs);
      tasks[taskGen.id] = taskGen;
      return taskGen;
    }

    function cancel(taskId) {
      console.log('TRYING TO CANCEL');
      const t = tasks[taskId];
      t.cancel('Task cancelled');
      console.log(t);
      delete tasks[taskId];
    }

    /**
     * Get the next value in the generator,
     * return a promise.
     */
    function next(ret) {
      const value = ret.value;
      if (ret.done) {
        delete tasks[runtimeId];
        return value;
      }

      const taskValue = applyMiddleware(middleware)(value, promisify, addTask, cancel);
      const promiseValue = promisify.call(ctx, taskValue);

      if (promiseValue && isPromise(promiseValue)) {
        if (typeof promiseValue.cancel === 'function') {
          const nextCancel = ((prevCancel) => (err) => {
            promiseValue.cancel();
            prevCancel(err);
          })(tasks[runtimeId].cancel);

          tasks[runtimeId].cancel = nextCancel;
        }

        return promiseValue.then(onFulfilled, onRejected);
      }

      const msg = `You may only yield a function, promise, generator, array, or`
        + ` object, but the following object was passed: "${String(ret.value)}"`;

      return onRejected(new TypeError(msg));
    }

    function promisify(obj) {
      if (!obj) return obj;
      if (isPromise(obj)) return obj;
      if (isGeneratorFunction(obj) || isGenerator(obj)) {
        return runtime.call(this, obj);
      }
      if (Array.isArray(obj)) return Promise.all(obj.map(promisify));
      if (isObject(obj)) return objectToPromise.call(this, obj);
      return obj;
    }

    function objectToPromise(obj) {
      var results = new obj.constructor();
      var keys = Object.keys(obj);
      var promises = [];

      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var promise = promisify.call(this, obj[key]);
        if (promise && isPromise(promise)) {
          defer(promise, key);
        }
        else results[key] = obj[key];
      }

      return Promise
        .all(promises)
        .then(() => results);

      function defer(promise, key) {
        // predefine the key in the result
        results[key] = undefined;
        promises.push(promise.then((res) => {
          results[key] = res;
        }));
      }
    }

    return task;
  }
}

module.exports = factoryBase;
