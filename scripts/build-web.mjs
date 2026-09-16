import { build } from 'esbuild';
await build({ entryPoints: ['apps/web/public/app.mjs'], bundle: true, outfile: 'apps/web/dist/app.js', format: 'iife', sourcemap: true });
