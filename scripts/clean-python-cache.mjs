import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()

async function walk(dir) {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.models') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__') await rm(path, { recursive: true, force: true })
      else await walk(path)
    } else if (entry.name.endsWith('.pyc')) {
      await rm(path, { force: true })
    }
  }
}

await walk(root)
console.log('python cache cleaned')
