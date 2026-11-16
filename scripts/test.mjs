import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const testDir = join(root, 'test')
const files = (await readdir(testDir))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => join('test', name))
if (files.length === 0) {
  console.error('no test files found')
  process.exit(1)
}
const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: root })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
