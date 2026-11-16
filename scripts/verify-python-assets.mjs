import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = process.cwd()
const site = join(root, 'assets', 'python', 'site-packages')
const platform = join(root, 'assets', 'python', process.platform === 'win32' ? 'win32-x64' : 'mac-arm64', 'site-packages')
const required = [
  join(site, 'docx', '__init__.py'),
  join(site, 'openpyxl', '__init__.py'),
  join(site, 'et_xmlfile', '__init__.py'),
  'assets/python/MANIFEST.json',
]
if (process.platform === 'win32') required.push(join(platform, 'lxml', '__init__.py'))
for (const file of required) {
  try { await access(file) } catch { console.error('missing: ' + file); process.exit(1) }
}
const python = process.env.DSH_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const env = { ...process.env }
const paths = [process.platform === 'win32' ? platform : null, site, process.env.PYTHONPATH].filter(Boolean)
env.PYTHONPATH = paths.join(delimiter)
try {
  await execFileAsync(python, ['-c', 'import docx, openpyxl, lxml.etree; print("python assets ok")'], { env, timeout: 30000 })
} catch (error) {
  console.error('python import failed: ' + (error?.stderr || error?.message || error))
  process.exit(1)
}
console.log('python assets ok')
