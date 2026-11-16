import { errorPayload, readBody, readJson, sendJson } from './util.js'
import { ReaderService, MAX_BYTES as READER_MAX_BYTES, sendReaderFile } from './reader.js'

const PREFIX = '/interpret/api'

function methodNotAllowed(res, allowed) {
  res.setHeader?.('Allow', allowed.join(', '))
  sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '只支持 ' + allowed.join('/') } })
}

/** Register the same-origin JSON + SSE surface under /interpret/api. */
export function registerApi(ctx, service) {
  let webServer
  let connection
  try {
    webServer = ctx.get('webServer')
    connection = ctx.get('connection')
  } catch {
    return () => {}
  }
  if (!webServer) return () => {}
  const reader = new ReaderService(service.dataDir)

  const handler = async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://interpret.local')
      const path = url.pathname.slice(PREFIX.length) || '/'
      const method = String(req.method || 'GET').toUpperCase()

      // Health is deliberately unauthenticated: it exposes no transcript or
      // configuration, and it lets a local check prove the host half loaded.
      if (path === '/health') {
        if (method !== 'GET') return methodNotAllowed(res, ['GET'])
        let clientModules
        try { clientModules = ctx.get('clientModules') } catch {}
        let clientPath
        try { clientPath = clientModules?.clientPath?.('dsh-interpret') } catch {}
        let bootEntry = null
        try {
          const graph = clientModules?.graph?.()
          bootEntry = graph?.entries?.find((entry) => entry.id === 'dsh-interpret') || null
        } catch {}
        const state = service.describe()
        sendJson(res, 200, {
          ok: true,
          data: {
            name: 'dsh-interpret',
            version: '1.1.2',
            client: { registered: Boolean(clientPath), path: clientPath || null, boot: bootEntry },
            phase: state.phase,
            asr: state.asr?.picked ? { id: state.asr.picked.id, preparation: state.asr.picked.preparation } : null,
            mt: state.mt || null,
            glossary: state.glossary,
            streaming: state.streaming,
            terminology: state.terminology,
            live: { mic: Boolean(state.live?.mic?.en), system: Boolean(state.live?.system?.en) },
            clientStatus: service.clientStatus,
            clientEvents: service.clientEvents.slice(-5),
            segments: state.segmentCount,
            pid: process.pid,
          },
        })
        return
      }

      const rejection = connection?.requestRejection?.(req)
      if (rejection) {
        sendJson(res, rejection, { ok: false, error: { code: 'UNAUTHORIZED', message: '同传接口只接受本机同源请求。' } })
        return
      }
      if (path === '/client-event') {
        if (method !== 'POST') return methodNotAllowed(res, ['POST'])
        const body = await readJson(req, 32 * 1024)
        sendJson(res, 200, { ok: true, data: service.recordClientEvent(body || {}) })
        return
      }

      if (path === '/client-ready') {
        if (method !== 'POST') return methodNotAllowed(res, ['POST'])
        const body = await readJson(req, 32 * 1024)
        sendJson(res, 200, { ok: true, data: service.setClientStatus(body || {}) })
        return
      }

      if (path === '/state') {
        if (method !== 'GET') return methodNotAllowed(res, ['GET'])
        await service.ensureMtRoute().catch(() => {})
        sendJson(res, 200, { ok: true, data: service.describe(), segments: service.segments })
        return
      }

      if (path === '/events') {
        if (method !== 'GET') return methodNotAllowed(res, ['GET'])
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        res.write('retry: 3000\n\n')
        const send = (type, payload) => {
          if (res.writableEnded) return
          try {
            res.write('data: ' + JSON.stringify({ type, data: payload }) + '\n\n')
          } catch {}
        }
        send('state', service.describe())
        const off = service.on((type, payload) => send(type, payload))
        const heartbeat = setInterval(() => {
          if (!res.writableEnded) {
            try { res.write(': ping\n\n') } catch {}
          }
        }, 15_000)
        const close = () => {
          clearInterval(heartbeat)
          off()
        }
        req.on('close', close)
        res.on('close', close)
        return
      }

      if (path === '/session/reset') {
        if (method !== 'POST') return methodNotAllowed(res, ['POST'])
        const state = await service.resetSession()
        sendJson(res, 200, { ok: true, data: state })
        return
      }

      if (path === '/session/start') {
        if (method !== 'POST') return methodNotAllowed(res, ['POST'])
        const body = await readJson(req, 64 * 1024)
        const state = await service.start({ title: body?.title })
        sendJson(res, 200, { ok: true, data: state })
        return
      }

      if (path === '/session/stop') {
        if (method !== 'POST') return methodNotAllowed(res, ['POST'])
        const state = await service.stop()
        sendJson(res, 200, { ok: true, data: state })
        return
      }

      if (path === '/audio/mic' || path === '/audio/system') {
        if (method !== 'POST') return methodNotAllowed(res, ['POST'])
        const contentType = String(req.headers['content-type'] || '').toLowerCase()
        if (!contentType.includes('application/octet-stream')) {
          sendJson(res, 415, { ok: false, error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: '音频帧必须是 application/octet-stream。' } })
          return
        }
        const body = await readBody(req, 2 * 1024 * 1024)
        const accepted = service.pushAudio(path === '/audio/system' ? 'system' : 'mic', body)
        sendJson(res, accepted.accepted ? 202 : 409, { ok: accepted.accepted, data: accepted })
        return
      }

      if (path === '/config') {
        if (method === 'GET') {
          sendJson(res, 200, { ok: true, data: service.describe().config })
          return
        }
        if (method !== 'POST') return methodNotAllowed(res, ['GET', 'POST'])
        const body = await readJson(req, 64 * 1024)
        const config = await service.saveSettings(body || {})
        sendJson(res, 200, { ok: true, data: config })
        return
      }

      if (path === '/glossary') {
        if (method === 'GET') {
          sendJson(res, 200, { ok: true, data: { count: service.glossary.entries.length, entries: service.glossary.entries } })
          return
        }
        if (method !== 'POST') return methodNotAllowed(res, ['GET', 'POST'])
        const body = await readJson(req, 4 * 1024 * 1024)
        const entries = Array.isArray(body?.entries)
          ? await service.setGlossary(body.entries)
          : typeof body?.text === 'string'
            ? await service.importGlossary(body.text, String(body?.format || 'csv'))
            : null
        if (!entries) {
          sendJson(res, 400, { ok: false, error: { code: 'INVALID_GLOSSARY', message: '需要 entries 数组或 text 文本。' } })
          return
        }
        sendJson(res, 200, { ok: true, data: { count: entries.length, entries } })
        return
      }


      if (path === '/reader/files') {
        if (method === 'GET') {
          sendJson(res, 200, { ok: true, data: await reader.list() })
          return
        }
        if (method === 'POST') {
          const raw = await readBody(req, READER_MAX_BYTES)
          const meta = await reader.save(url.searchParams.get('name') || 'file', raw)
          sendJson(res, 200, { ok: true, data: meta })
          return
        }
        return methodNotAllowed(res, ['GET', 'POST'])
      }

      const readerMatch = /^\/reader\/files\/([A-Za-z0-9-]{1,80})(?:\/(raw|html))?$/.exec(path)
      if (readerMatch) {
        const id = readerMatch[1]
        const part = readerMatch[2]
        if (part === 'raw') {
          if (method !== 'GET') return methodNotAllowed(res, ['GET'])
          const meta = await reader.get(id)
          await sendReaderFile(res, meta, reader.mimeFor(meta))
          return
        }
        if (part === 'html') {
          if (method !== 'GET') return methodNotAllowed(res, ['GET'])
          const rendered = await reader.render(id)
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:",
          })
          res.end(rendered.html)
          return
        }
        if (method === 'GET') {
          const meta = await reader.get(id)
          sendJson(res, 200, { ok: true, data: reader.publicMeta(meta) })
          return
        }
        if (method === 'DELETE') {
          sendJson(res, 200, { ok: true, data: await reader.remove(id) })
          return
        }
        return methodNotAllowed(res, ['GET', 'DELETE'])
      }

      if (path === '/sessions') {
        if (method !== 'GET') return methodNotAllowed(res, ['GET'])
        sendJson(res, 200, { ok: true, data: await service.listSessions() })
        return
      }

      const sessionMatch = /^\/sessions\/([A-Za-z0-9-]{1,80})$/.exec(path)
      if (sessionMatch) {
        const id = sessionMatch[1]
        if (method === 'GET') {
          sendJson(res, 200, { ok: true, data: await service.getSession(id) })
          return
        }
        if (method === 'PATCH') {
          const body = await readJson(req, 64 * 1024)
          sendJson(res, 200, { ok: true, data: await service.renameSession(id, body?.title) })
          return
        }
        if (method === 'DELETE') {
          if (url.searchParams.get('confirm') !== '1') {
            sendJson(res, 409, { ok: false, error: { code: 'CONFIRMATION_REQUIRED', message: '删除会话需要 confirm=1。' } })
            return
          }
          sendJson(res, 200, { ok: true, data: await service.deleteSession(id) })
          return
        }
        return methodNotAllowed(res, ['GET', 'PATCH', 'DELETE'])
      }

      if (path === '/export') {
        if (method !== 'GET') return methodNotAllowed(res, ['GET'])
        const format = url.searchParams.get('format') || 'srt-bilingual'
        const sessionId = url.searchParams.get('session')
        const session = sessionId ? await service.getSession(sessionId).catch(() => null) : null
        if (sessionId && !session) {
          sendJson(res, 404, { ok: false, error: { code: 'SESSION_NOT_FOUND', message: '会话不存在或未完成。' } })
          return
        }
        const payload = service.exportText(format, session)
        if (!payload) {
          sendJson(res, 400, { ok: false, error: { code: 'INVALID_FORMAT', message: '不支持的导出格式。' } })
          return
        }
        const name = 'interpret-' + (sessionId || service.sessionId || 'session') + '.' + payload.extension
        res.writeHead(200, {
          'Content-Type': payload.type,
          'Content-Disposition': 'attachment; filename="' + name + '"',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        res.end(payload.body)
        return
      }

      if (path === '/terminology/stats') {
        if (method !== 'GET') return methodNotAllowed(res, ['GET'])
        sendJson(res, 200, { ok: true, data: service.describe().terminology })
        return
      }

      if (path === '/terminology/search') {
        if (method !== 'GET') return methodNotAllowed(res, ['GET'])
        const query = url.searchParams.get('q') || ''
        const domain = url.searchParams.get('domain') || ''
        const limit = Math.max(1, Math.min(30, Number(url.searchParams.get('limit') || 12)))
        sendJson(res, 200, { ok: true, data: service.terminology.search(query, { domain, limit }) })
        return
      }

      if (path === '/models') {
        if (method !== 'GET') return methodNotAllowed(res, ['GET'])
        sendJson(res, 200, { ok: true, data: await service.listModels() })
        return
      }

      if (path === '/models/vad/prepare') {
        if (method !== 'POST') return methodNotAllowed(res, ['POST'])
        sendJson(res, 200, { ok: true, data: await service.prepareVad() })
        return
      }

      if (path === '/models/streaming/prepare') {
        if (method !== 'POST') return methodNotAllowed(res, ['POST'])
        sendJson(res, 200, { ok: true, data: await service.prepareStreaming() })
        return
      }

      if (path === '/prepare/cancel') {
        if (method !== 'POST') return methodNotAllowed(res, ['POST'])
        const body = await readJson(req, 64 * 1024)
        sendJson(res, 200, { ok: true, data: await service.cancelPrepare(body?.providerId) })
        return
      }

      if (path === '/prepare') {
        if (method !== 'POST') return methodNotAllowed(res, ['POST'])
        const body = await readJson(req, 64 * 1024)
        await service.prepare(String(body?.providerId || ''))
        sendJson(res, 200, { ok: true, data: service.describe() })
        return
      }

      if (path === '/translate') {
        if (method !== 'POST') return methodNotAllowed(res, ['POST'])
        const body = await readJson(req, 256 * 1024)
        const result = await service.translateText(String(body?.text || ''))
        sendJson(res, 200, { ok: true, data: result })
        return
      }

      sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '接口不存在。' } })
    } catch (error) {
      sendJson(res, Number(error?.status) || 500, { ok: false, error: errorPayload(error) })
    }
  }

  return webServer.register({ kind: 'prefix', path: PREFIX, handler })
}
