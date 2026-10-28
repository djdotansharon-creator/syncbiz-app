// Test helper: lets plain-Node test scripts import modules that start with `import "server-only"` (Next provides that package internally; it does not exist in node_modules).
const Module = require("node:module");
const orig = Module._resolveFilename;
const stub = require.resolve("./server-only-stub.cjs");
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return stub;
  return orig.call(this, request, ...rest);
};
