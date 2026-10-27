// @vestra-player/sdk/ts-plugin: the TypeScript server loads language-service
// plugins with require() and Node 10 resolution (no package.json "exports"),
// hence this CommonJS directory. The plugin itself is dist/ts-plugin.js, an
// ES module without top-level await, which require() loads (Node 22.12+).
"use strict";
module.exports = require("../dist/ts-plugin.js").default;
