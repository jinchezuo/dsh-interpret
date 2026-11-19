import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const required = [
  'lib/client.js',
  'cordis.patch.yml',
  'assets/system-audio/recording-helper/DSHASRRecordingHelper.app/Contents/Helpers/dsh-asr-capture-system',
  'assets/models/silero_vad.onnx',
  'assets/system-audio/LICENSE',
  'src/host/readers/render.py',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
]
if (process.platform === 'win32') required.push('assets/system-audio/win32-x64/dsh-asr-capture-system.exe')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const problems = []
for (const path of required) {
  try { await access(join(root, path)) } catch { problems.push('missing: ' + path) }
}
if (pkg.version !== '1.2.0') problems.push('version must be 1.2.0')
if (pkg.license !== 'MIT') problems.push('license must be MIT')
const deps = Object.keys(pkg.dependencies || {})
if (deps.some((name) => name.startsWith('@huliux/') || name.includes('dsh-asr'))) {
  problems.push('external DSH plugin dependency found: ' + deps.join(', '))
}
if (!pkg.files?.includes('assets') || !pkg.files?.includes('src/host') || !pkg.files?.includes('src/client')) problems.push('files must include assets, src/host and src/client')
const capture = await readFile(join(root, 'src/host/system-capture.js'), 'utf8')
if (!capture.includes("assets', 'system-audio'") && !capture.includes('assets/system-audio')) {
  problems.push('system-capture does not prefer the bundled helper')
}
if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log('standalone package checks passed')
