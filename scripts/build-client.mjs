import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { watch as watchFiles } from 'node:fs'
import { dirname } from 'node:path'

const ROOT = new URL('..', import.meta.url)
const ENTRY = new URL('src/client/index.js', ROOT)
const OUT = new URL('lib/client.js', ROOT)
const OUT_MAP = new URL('lib/client.js.map', ROOT)
const WATCH = process.argv.includes('--watch')

async function once() {
  const result = await build({
    entryPoints: [ENTRY.pathname],
    outfile: new URL('lib/client.raw.js', ROOT).pathname,
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
  await mkdir(dirname(OUT.pathname), { recursive: true })
  await writeFile(OUT, wrapped)
  if (map) await writeFile(OUT_MAP, map.text)
  console.log('[dsh-interpret] built lib/client.js (' + wrapped.length + ' bytes)')
}

await once()
if (WATCH) {
  let timer = null
  watchFiles(new URL('src/client', ROOT).pathname, { recursive: true }, () => {
    clearTimeout(timer)
    timer = setTimeout(() => { once().catch((error) => console.error(error)) }, 150)
  })
  console.log('[dsh-interpret] watching src/client…')
}
