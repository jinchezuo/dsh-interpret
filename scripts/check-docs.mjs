import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const root = process.cwd()
const requiredPhrases = [
  '单插件自包含发布',
  '需要 DeepSeek Harness 应用本身',
  '翻译仍依赖 DSH 已配置的 LLM 路由',
  'Parakeet 和流式模型首次需要联网下载（约 700MB）',
  'macOS 使用 arm64 helper，Windows 使用 x64 WASAPI helper',
  '.doc 在 Windows 需要 Microsoft Word、LibreOffice 或 antiword',
  'PPTX 仍是文字+图片近似阅读',
]
const requiredFiles = [
  'README.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'docs/installation.md',
  'docs/usage.md',
  'docs/troubleshooting.md',
  'assets/system-audio/recording-helper/DSHASRRecordingHelper.app/Contents/Helpers/dsh-asr-capture-system',
  'assets/models/silero_vad.onnx',
]
const problems = []

const readme = await readFile(join(root, 'README.md'), 'utf8')
for (const phrase of requiredPhrases) {
  if (!readme.includes(phrase)) problems.push('README missing required phrase: ' + phrase)
}
for (const file of requiredFiles) {
  try { await access(join(root, file)) } catch { problems.push('missing required file: ' + file) }
}

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
for (const name of Object.keys(packageJson.dependencies || {})) {
  if (name.startsWith('@huliux/') || name.includes('dsh-asr')) problems.push('external DSH plugin dependency: ' + name)
}

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.models') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(path))
    else if (entry.name.endsWith('.md')) out.push(path)
  }
  return out
}

const files = [join(root, 'README.md'), ...await walk(join(root, 'docs'))]
for (const file of files) {
  const text = await readFile(file, 'utf8')
  const withoutCode = text.replace(/```[\s\S]*?```/g, '')
  const linkPattern = /\[[^\]]+\]\(([^)\s]+)\)/g
  let match
  while ((match = linkPattern.exec(withoutCode)) !== null) {
    const target = match[1]
    if (/^(https?:|mailto:|#|<)/i.test(target)) continue
    const [pathPart, anchor] = target.split('#')
    if (!pathPart) continue
    const expected = resolve(dirname(file), pathPart)
    try { await access(expected) } catch { problems.push('broken link in ' + file + ': ' + target) }
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log('docs checks passed')
