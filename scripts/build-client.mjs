import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { watch as watchFiles } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ENTRY = join(ROOT, 'src', 'client', 'index.js')
const OUT = join(ROOT, 'lib', 'client.js')
const OUT_MAP = join(ROOT, 'lib', 'client.js.map')
const WATCH = process.argv.includes('--watch')

async function once() {
  const result = await build({
    entryPoints: [ENTRY],
    outfile: join(ROOT, 'lib', 'client.raw.js'),
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: ['chrome120'],
    external: ['react'],
    write: false,
    sourcemap: 'external',
    logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const js = result.outputFiles.find((file) => file.path.endsWith('.js') && !file.path.endsWith('.map'))
  const map = result.outputFiles.find((file) => file.path.endsWith('.map'))
  if (!js) throw new Error('esbuild produced no JS output')
  const code = js.text.replace(/^\/\/# sourceMappingURL=.*$/gm, '').trimEnd()
  const wrapped = 'window.__ModuleLoader__.load({ id: "dsh-interpret", factory: (require) => {\n' +
    'var module = { exports: {} }; var exports = module.exports;\n' +
    code + '\nreturn module.exports;\n}});\n//# sourceMappingURL=client.js.map\n'
  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, wrapped)
  if (map) await writeFile(OUT_MAP, map.text)
  console.log('[dsh-interpret] built lib/client.js (' + wrapped.length + ' bytes)')
}

await once()
if (WATCH) {
  let timer = null
  watchFiles(join(ROOT, 'src', 'client'), { recursive: true }, () => {
    clearTimeout(timer)
    timer = setTimeout(() => { once().catch((error) => console.error(error)) }, 150)
  })
  console.log('[dsh-interpret] watching src/client…')
}
