import { build } from 'esbuild';
import { resolve } from 'node:path';
// The non-package spike harness shares the web client's installed public adapter dependency.
await build({ entryPoints: ['apps/editor-spike/app.mjs'], bundle: true, outfile: 'apps/editor-spike/dist/app.js', format: 'iife', nodePaths: [resolve('apps/web/node_modules')], loader: { '.narudoc': 'text' }, sourcemap: true });
