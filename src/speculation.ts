type Fn = (...args: any[]) => void;

const noop = () => {};

// HOF Wraps the native Promise API
// to add take a shouldCancel promise and add
// an onCancel() callback.
export default function speculation(fn: Fn, cancel = Promise.reject()) {
  return new Promise(function(_resolve, _reject) {
    // Track if the promise becomes resolved or rejected to
    // avoid invoking onCancel after a promise becomes isSettled.
    let isSettled = false;

    // When the callsite resolves, mark the promise as fulfilled.
    const resolve = (input: any) => {
      isSettled = true;
      _resolve(input);
    };

    // When the callsite rejects, mark the promise as fulfilled.
    const reject = (input: any) => {
      isSettled = true;
      _reject(input);
    };

    const onCancel = (handleCancel: Fn) => {
      const maybeHandleCancel = (value: any) => {
        if (!isSettled) {
          handleCancel(value);
        }
      };

      return (
        cancel
          .then(
            maybeHandleCancel,
            // Ignore expected cancel rejections:
            noop,
          )
          // handle onCancel errors
          .catch(function(e) {
            return reject(e);
          })
      );
    };

    fn(resolve, reject, onCancel);
  });
}
