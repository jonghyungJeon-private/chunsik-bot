// Test-only child process: transpile CURRENT TypeScript sources, never stale dist output.
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (id, ...args) {
  if (id === '@quoky/core') return path.resolve(__dirname, '../../../core/src/index.ts');
  return resolve.call(this, id, ...args);
};
require.extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  module._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, filename);
};
const { SqliteStorageProvider } = require('../index.ts');
let store;
process.on('message', async message => {
  try {
    if (message.type === 'init') {
      store = new SqliteStorageProvider(message.busyTimeoutMs === undefined
        ? { dbPath: message.dbPath }
        : { dbPath: message.dbPath, busyTimeoutMs: message.busyTimeoutMs });
      await store.init();
      process.send({ type: 'ready' });
    } else if (message.type === 'start') {
      let result;
      try {
        const run = await store.taskRuns.guardedStart(message.expected, message.capability);
        result = { type: 'result', run };
      } catch (error) {
        result = { type: 'result', code: error.code, error: error.message };
      }
      await store.close();
      process.send(result, () => process.disconnect());
    } else if (message.type === 'delete') {
      // ADR-0089 delete-vs-guarded-start safety boundary, exercised through the real repository port.
      let result;
      try {
        await store.taskRuns.delete(message.runId);
        result = { type: 'result', deleted: true };
      } catch (error) {
        result = { type: 'result', code: error.code, error: error.message };
      }
      await store.close();
      process.send(result, () => process.disconnect());
    }
  } catch (error) {
    process.send({ type: 'fatal', error: error.message }, () => process.disconnect());
    process.exitCode = 1;
  }
});
