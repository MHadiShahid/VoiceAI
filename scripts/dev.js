#!/usr/bin/env node
// Runs the API (:3001) and the Vite dev server (:5173) together, cross-platform.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = ['server', 'client'].map((workspace) =>
  spawn(npm, ['run', 'dev', '--workspace', workspace], { stdio: 'inherit', shell: process.platform === 'win32' }),
);

const stop = () => children.forEach((child) => child.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((child) => child.on('exit', (code) => code && stop()));
