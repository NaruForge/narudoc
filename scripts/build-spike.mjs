import { build } from 'esbuild';
await build({ entryPoints: ['apps/editor-spike/app.mjs'], bundle: true, outfile: 'apps/editor-spike/dist/app.js', format: 'iife', loader: { '.narudoc': 'text' }, sourcemap: true });
