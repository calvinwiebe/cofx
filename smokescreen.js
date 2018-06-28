const { task, delay, spawn, cancel } = require('./index');

function* sp() {
  try {
    console.log('waiting ...');
    yield delay(5000);
    console.log('done ...');
  } catch (err) {
    console.log('ERR', err);
  }
}

function* example() {
  try {
    const task = yield spawn(sp);
    console.log('task: ', task);
    yield delay(500);
    console.log('SHORT DELAY');
    yield cancel(task);
    console.log('HIT');
  } catch (err) {
    console.log('LAST', err);
  }
}

task(example);
