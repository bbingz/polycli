#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const companion = path.join(here, 'polycli-companion.bundle.mjs');

const child = spawn(process.execPath, [companion, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    POLYCLI_HOST_SURFACE: process.env.POLYCLI_HOST_SURFACE || 'terminal',
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(`polycli: failed to start companion: ${error.message}`);
  process.exit(1);
});
