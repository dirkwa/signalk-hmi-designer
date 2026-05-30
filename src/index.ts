import { Plugin, ServerAPI } from '@signalk/server-api'
import { Request, Response, IRouter } from 'express'

const PLUGIN_ID = 'signalk-hmi-designer'

interface ProxyBody {
  url?: unknown
  body?: unknown
  method?: unknown
  headers?: unknown
}

/**
 * SignalK plugin entry for the HMI Designer webapp.
 *
 * The plugin itself is mostly a thin shell: SignalK serves the
 * compiled React webapp from public/, and this entrypoint exposes a
 * couple of REST helpers under /plugins/signalk-hmi-designer/ that
 * the webapp uses:
 *
 *   GET  /status           — liveness; included so the appstore badge
 *                            shows the plugin as "running".
 *   POST /device-proxy     — forwards a request to a target device on
 *                            the local network. Used by the designer to
 *                            POST /layout to discovered devices without
 *                            tripping browser CORS, and to GET /hello
 *                            for capability discovery.
 *
 * Device discovery (mDNS browse) happens client-side in the webapp via
 * the SK server's built-in /signalk/v1/discovery endpoint; we don't
 * need to mirror it here.
 */
const plugin = (app: ServerAPI): Plugin => {
  return {
    id: PLUGIN_ID,
    name: 'HMI Designer',
    description:
      'Drag-and-drop designer for runtime-rendering HMI display devices',

    schema: () => ({
      type: 'object',
      properties: {}
    }),

    start: () => {
      app.setPluginStatus('Running')
    },

    stop: () => {
      app.setPluginStatus('Stopped')
    },

    registerWithRouter(router: IRouter) {
      router.get('/status', (_req: Request, res: Response) => {
        res.json({ ok: true, plugin: PLUGIN_ID })
      })

      // Forward arbitrary GET/POST to a device on the local network.
      // The webapp can't talk to a device's :8081 directly because the
      // browser sees that as a cross-origin call. Sending it via the
      // SK server origin keeps everything same-origin and inherits SK
      // auth.
      router.post('/device-proxy', async (req: Request, res: Response) => {
        const b = (req.body ?? {}) as ProxyBody
        if (typeof b.url !== 'string') {
          res.status(400).json({ error: 'url required' })
          return
        }
        const url = b.url
        // Only allow http(s):// to private addresses. We accept the
        // shape of a normal URL; rejection of public targets is
        // host-level concern (SK server should be on a LAN), but we
        // still parse to catch typos.
        let parsed: URL
        try {
          parsed = new URL(url)
        } catch {
          res.status(400).json({ error: 'invalid url' })
          return
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          res.status(400).json({ error: 'only http(s) supported' })
          return
        }

        const method =
          typeof b.method === 'string' ? b.method.toUpperCase() : 'GET'
        if (method !== 'GET' && method !== 'POST') {
          res.status(400).json({ error: 'method must be GET or POST' })
          return
        }

        const headers: Record<string, string> = { Accept: 'application/json' }
        if (b.headers && typeof b.headers === 'object') {
          for (const [k, v] of Object.entries(
            b.headers as Record<string, unknown>
          )) {
            if (typeof v === 'string') headers[k] = v
          }
        }

        const init: RequestInit = { method, headers }
        if (method === 'POST') {
          const payload =
            typeof b.body === 'string' ? b.body : JSON.stringify(b.body ?? {})
          init.body = payload
          if (!('Content-Type' in headers))
            headers['Content-Type'] = 'application/json'
        }

        try {
          const controller = new AbortController()
          const t = setTimeout(() => controller.abort(), 10_000)
          init.signal = controller.signal
          const upstream = await fetch(url, init)
          clearTimeout(t)
          const text = await upstream.text()
          res.status(upstream.status)
          const ct = upstream.headers.get('content-type')
          if (ct) res.setHeader('content-type', ct)
          res.send(text)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          res.status(502).json({ error: msg })
        }
      })
    }
  }
}

export default plugin
