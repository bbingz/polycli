#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { getTerminalCommandDefinition } from '../lib/command-surface.generated.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const companion = path.join(here, 'polycli-companion.bundle.mjs');
const tui = path.join(here, 'polycli-tui.mjs');

const args = process.argv.slice(2);
const command = args[0];
const definition = getTerminalCommandDefinition([command]);
const delegated = definition?.dispatchTarget === 'terminal-wrapper';
const target = delegated ? tui : companion;
const forwardedArgs = delegated ? args.slice(1) : args;

const child = spawn(process.execPath, [target, ...forwardedArgs], {
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
