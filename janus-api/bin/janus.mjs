#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const cliTs = join(root, 'src', 'cli.ts')
const child = spawn(process.execPath, [tsxCli, cliTs, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: true
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
