import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Config, normalizeConfig, resolveDataDir } from './config.js'
import { InterpretService } from './service.js'
import { registerApi } from './api.js'

export const name = 'dsh-interpret'
export const inject = ['webServer', 'connection']
export { Config }

/** Host half: one interpretation service and its same-origin HTTP/SSE surface. */
export function apply(ctx, config = {}) {
  const settings = normalizeConfig(config)
  const dataDir = resolveDataDir(settings.dataDir)
  const marker = join(dataDir, 'startup.log')
  const mark = (line) => {
    mkdir(dataDir, { recursive: true })
      .then(() => appendFile(marker, new Date().toISOString() + ' ' + line + '\n'))
      .catch(() => {})
  }
  try {
    const service = new InterpretService(ctx, settings)
    const disposeApi = ctx.effect(() => registerApi(ctx, service), 'dsh-interpret: HTTP API')
    ctx.effect(() => () => {
      try { disposeApi?.() } catch {}
      service.dispose()
    }, 'dsh-interpret: dispose')
    mark('loaded pid=' + process.pid)
    setTimeout(() => {
      let clientPath
      try { clientPath = ctx.get('clientModules')?.clientPath?.('dsh-interpret') } catch {}
      mark('client=' + String(Boolean(clientPath)) + ' path=' + String(clientPath || 'none'))
    }, 2000)
  } catch (error) {
    mark('LOAD_FAILED ' + String(error?.stack || error))
    throw error
  }
}
