import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import express, { type Request, type Response } from 'express'
import type { PluginRouter, ServerAPI } from '@signalk/server-api'
import type { Service } from 'bonjour-service'
import plugin from '../src/index'

// bonjour-service opens real multicast sockets. Replace it with a browser
// the tests drive by hand. vi.mock is hoisted above the imports, so the
// fake has to be hoisted with it.
const mdns = vi.hoisted(() => {
  class FakeBrowser {
    private readonly up: Array<(svc: Service) => void> = []
    stop = vi.fn()
    on(event: 'up', cb: (svc: Service) => void): this {
      if (event === 'up') this.up.push(cb)
      return this
    }
    emitUp(svc: Service): void {
      for (const cb of this.up) cb(svc)
    }
  }
  const instances: Array<{ browser: FakeBrowser; destroy: () => void }> = []
  class Bonjour {
    destroy = vi.fn()
    find(): FakeBrowser {
      const browser = new FakeBrowser()
      instances.push({ browser, destroy: this.destroy })
      return browser
    }
  }
  return { Bonjour, instances }
})
vi.mock('bonjour-service', () => ({ Bonjour: mdns.Bonjour }))

const PREFIX = '/plugins/signalk-hmi-designer'

/** The two ServerAPI members the plugin touches; nothing else is called. */
function fakeApp(dataDir: string): { app: ServerAPI; status: string[] } {
  const status: string[] = []
  const api: Pick<ServerAPI, 'setPluginStatus' | 'getDataDirPath'> = {
    setPluginStatus: (msg) => {
      status.push(msg)
    },
    getDataDirPath: () => dataDir
  }
  return { app: api as ServerAPI, status }
}

function listeningUrl(server: Server): string {
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('no TCP address')
  return `http://127.0.0.1:${addr.port}`
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
}

interface Mounted {
  base: string
  status: string[]
  close: () => Promise<void>
}

/**
 * Mount the plugin's router on a real express app the way SignalK does:
 * JSON bodies are parsed before the plugin sees them and the router
 * lives under /plugins/<id>.
 */
async function mount(dataDir: string): Promise<Mounted> {
  const { app, status } = fakeApp(dataDir)
  const p = plugin(app)
  if (!p.registerWithRouter) throw new Error('plugin has no registerWithRouter')
  const router = express.Router()
  // PluginRouter adds access() on top of an express router; the plugin
  // never calls it, so a plain router stands in.
  p.registerWithRouter(router as PluginRouter)
  const server = express()
    .use(express.json())
    .use(PREFIX, router)
    .listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  return {
    base: `${listeningUrl(server)}${PREFIX}`,
    status,
    close: () => closeServer(server)
  }
}

interface UpstreamRequest {
  method: string | undefined
  url: string | undefined
  headers: IncomingHttpHeaders
  body: string
}

interface UpstreamReply {
  status?: number
  contentType?: string
  body: Buffer | string
}

interface Upstream {
  url: string
  seen: UpstreamRequest[]
  close: () => Promise<void>
}

/** A stand-in for a cockpit panel that records what the proxy sends it. */
async function upstream(reply: UpstreamReply): Promise<Upstream> {
  const seen: UpstreamRequest[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      seen.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8')
      })
      res.statusCode = reply.status ?? 200
      if (reply.contentType) res.setHeader('content-type', reply.contentType)
      res.end(reply.body)
    })
  }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  return { url: listeningUrl(server), seen, close: () => closeServer(server) }
}

/** A port nothing listens on: bind an ephemeral one, then release it. */
async function closedPort(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('no TCP address')
  await closeServer(server)
  return addr.port
}

async function proxy(
  base: string,
  body: unknown
): Promise<globalThis.Response> {
  return fetch(`${base}/device-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

let dataDir: string
let mounted: Mounted | undefined
const cleanups: Array<() => Promise<void>> = []

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(tmpdir(), 'hmi-designer-'))
})

afterEach(async () => {
  await mounted?.close()
  mounted = undefined
  for (const c of cleanups.splice(0)) await c()
  await fs.rm(dataDir, { recursive: true, force: true })
})

describe('plugin shell', () => {
  it('identifies itself and exposes an object schema', () => {
    const p = plugin(fakeApp(dataDir).app)
    expect(p.id).toBe('signalk-hmi-designer')
    expect(p.name).toBe('HMI Designer')
    const schema = typeof p.schema === 'function' ? p.schema() : p.schema
    expect(schema).toMatchObject({ type: 'object' })
  })

  it('reports Running on start and Stopped on stop', async () => {
    const { app, status } = fakeApp(dataDir)
    const p = plugin(app)
    p.start({}, () => {})
    await p.stop()
    expect(status).toEqual(['Running', 'Stopped'])
  })
})

describe('GET /status', () => {
  it('answers with the plugin id', async () => {
    mounted = await mount(dataDir)
    const res = await fetch(`${mounted.base}/status`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      plugin: 'signalk-hmi-designer'
    })
  })
})

describe('layout persistence', () => {
  it('is 404 until a layout has been saved', async () => {
    mounted = await mount(dataDir)
    const res = await fetch(`${mounted.base}/layout`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'no layout saved yet' })
  })

  it('rejects a PUT without a JSON object body', async () => {
    mounted = await mount(dataDir)
    const res = await fetch(`${mounted.base}/layout`, { method: 'PUT' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'body must be JSON object' })
  })

  it('round-trips the last saved layout', async () => {
    mounted = await mount(dataDir)
    const first = { schema: 1, widgets: [{ kind: 'label', id: 'a' }] }
    const second = { schema: 1, widgets: [] }
    for (const layout of [first, second]) {
      const put = await fetch(`${mounted.base}/layout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(layout)
      })
      expect(put.status).toBe(200)
      expect(await put.json()).toEqual({ ok: true })
    }
    const get = await fetch(`${mounted.base}/layout`)
    expect(get.status).toBe(200)
    expect(get.headers.get('content-type')).toContain('application/json')
    expect(await get.json()).toEqual(second)
  })

  it('creates the data dir and leaves no temp file behind', async () => {
    const nested = path.join(dataDir, 'not', 'yet', 'there')
    mounted = await mount(nested)
    const put = await fetch(`${mounted.base}/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schema: 1, widgets: [] })
    })
    expect(put.status).toBe(200)
    expect(await fs.readdir(nested)).toEqual(['layout.json'])
  })
})

describe('POST /device-proxy', () => {
  it('requires a url', async () => {
    mounted = await mount(dataDir)
    const res = await proxy(mounted.base, {})
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'url required' })
  })

  it('rejects a url that does not parse', async () => {
    mounted = await mount(dataDir)
    const res = await proxy(mounted.base, { url: 'not a url' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid url' })
  })

  it('rejects schemes other than http and https', async () => {
    mounted = await mount(dataDir)
    const res = await proxy(mounted.base, { url: 'ftp://panel.local/hello' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'only http(s) supported' })
  })

  it('rejects methods other than GET, POST and PUT', async () => {
    mounted = await mount(dataDir)
    const res = await proxy(mounted.base, {
      url: 'http://panel.local/layout',
      method: 'DELETE'
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'method must be GET, POST or PUT'
    })
  })

  // PUT is what the brightness control uses: espOS's /api/v1/config only
  // accepts PUT, so a proxy that dropped it would make brightness read-only.
  it('forwards a PUT with its body', async () => {
    const panel = await upstream({
      status: 200,
      contentType: 'application/json',
      body: Buffer.from('{"ok":true}')
    })
    cleanups.push(panel.close)
    mounted = await mount(dataDir)

    const res = await proxy(mounted.base, {
      url: `${panel.url}/api/v1/config`,
      method: 'PUT',
      body: { cockpit: { brightness: 80 } }
    })
    expect(res.status).toBe(200)
    expect(panel.seen).toHaveLength(1)
    const req = panel.seen[0]
    expect(req).toBeDefined()
    expect(req?.method).toBe('PUT')
    expect(JSON.parse(req?.body ?? '{}')).toEqual({
      cockpit: { brightness: 80 }
    })
  })

  it('forwards a GET and passes status, content-type and bytes through', async () => {
    const bmp = Buffer.from([0x42, 0x4d, 0x00, 0xff, 0x10])
    const panel = await upstream({
      status: 201,
      contentType: 'image/bmp',
      body: bmp
    })
    cleanups.push(panel.close)
    mounted = await mount(dataDir)

    const res = await proxy(mounted.base, { url: `${panel.url}/screenshot` })
    expect(res.status).toBe(201)
    expect(res.headers.get('content-type')).toBe('image/bmp')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bmp)

    expect(panel.seen).toHaveLength(1)
    const req = panel.seen[0]
    expect(req?.method).toBe('GET')
    expect(req?.url).toBe('/screenshot')
    expect(req?.headers.accept).toBe('application/json')
    expect(req?.body).toBe('')
  })

  it('forwards a POST as JSON by default, upper-casing the method', async () => {
    const panel = await upstream({
      contentType: 'application/json',
      body: '{"applied":true}'
    })
    cleanups.push(panel.close)
    mounted = await mount(dataDir)

    const res = await proxy(mounted.base, {
      url: `${panel.url}/layout`,
      method: 'post',
      body: { schema: 1, widgets: [] }
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ applied: true })

    const req = panel.seen[0]
    expect(req?.method).toBe('POST')
    expect(req?.headers['content-type']).toBe('application/json')
    expect(req?.body).toBe('{"schema":1,"widgets":[]}')
  })

  it('sends a string body verbatim and keeps the caller content-type', async () => {
    const panel = await upstream({ body: 'ok' })
    cleanups.push(panel.close)
    mounted = await mount(dataDir)

    const res = await proxy(mounted.base, {
      url: `${panel.url}/cmd`,
      method: 'POST',
      body: 'brightness=40',
      headers: { 'Content-Type': 'text/plain', 'X-Num': 5, 'X-Str': 'yes' }
    })
    expect(res.status).toBe(200)

    const req = panel.seen[0]
    expect(req?.headers['content-type']).toBe('text/plain')
    expect(req?.body).toBe('brightness=40')
    // Only string header values are forwarded.
    expect(req?.headers['x-str']).toBe('yes')
    expect(req?.headers['x-num']).toBeUndefined()
  })

  it('answers 502 when the device cannot be reached', async () => {
    const port = await closedPort()
    mounted = await mount(dataDir)
    const res = await proxy(mounted.base, {
      url: `http://127.0.0.1:${port}/hello`
    })
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: unknown }
    expect(typeof body.error).toBe('string')
    expect(body.error).not.toBe('')
  })
})

describe('GET /devices', () => {
  type Handler = (req: Request, res: Response) => void | Promise<void>

  /** Record the handlers the plugin registers instead of serving them. */
  function captureRoutes(): {
    router: PluginRouter
    routes: Map<string, Handler>
  } {
    const routes = new Map<string, Handler>()
    const record = (method: string) => (route: string, handler: Handler) => {
      routes.set(`${method} ${route}`, handler)
    }
    // Only the three verbs the plugin uses; nothing else on the router is touched.
    const router = {
      get: record('GET'),
      put: record('PUT'),
      post: record('POST')
    }
    return { router: router as unknown as PluginRouter, routes }
  }

  function jsonSink(): {
    res: Response
    payload: () => unknown
    calls: () => number
  } {
    let payload: unknown
    let calls = 0
    const res = {
      json: (body: unknown) => {
        payload = body
        calls++
        return res
      }
    }
    return {
      res: res as unknown as Response,
      payload: () => payload,
      calls: () => calls
    }
  }

  interface Browse {
    sink: ReturnType<typeof jsonSink>
    browser: (typeof mdns.instances)[number]['browser']
    destroy: () => void
  }

  /** Start a /devices request against the fake mDNS and hand back the browser. */
  function browse(): Browse {
    const { router, routes } = captureRoutes()
    const p = plugin(fakeApp(dataDir).app)
    if (!p.registerWithRouter)
      throw new Error('plugin has no registerWithRouter')
    p.registerWithRouter(router)
    const handler = routes.get('GET /devices')
    if (!handler) throw new Error('GET /devices not registered')
    const sink = jsonSink()
    void handler({} as Request, sink.res)
    const inst = mdns.instances.at(-1)
    if (!inst) throw new Error('route did not open an mDNS browser')
    return { sink, browser: inst.browser, destroy: inst.destroy }
  }

  const svc = (partial: Partial<Service>): Service => partial as Service

  beforeEach(() => {
    mdns.instances.length = 0
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists panels that answered within the window, keyed by .local name', async () => {
    const { sink, browser } = browse()
    const panel = svc({
      name: 'espos-1a2b',
      host: 'espos-1a2b.local.',
      port: 8081,
      addresses: ['192.168.0.118'],
      txt: { fw: '1.2.3' }
    })
    browser.emitUp(panel)
    browser.emitUp(panel) // a repeat answer must not duplicate the entry
    expect(sink.calls()).toBe(0)

    await vi.advanceTimersByTimeAsync(1500)
    expect(sink.calls()).toBe(1)
    expect(sink.payload()).toEqual({
      devices: [
        {
          url: 'http://espos-1a2b.local:8081',
          name: 'espos-1a2b',
          txt: { fw: '1.2.3' }
        }
      ]
    })
  })

  it('falls back to the first IPv4 address when there is no host', async () => {
    const { sink, browser } = browse()
    browser.emitUp(
      svc({ name: 'bare', port: 8081, addresses: ['fe80::1', '192.168.0.5'] })
    )
    await vi.advanceTimersByTimeAsync(1500)
    expect(sink.payload()).toEqual({
      devices: [{ url: 'http://192.168.0.5:8081', name: 'bare', txt: {} }]
    })
  })

  it('skips answers without a port or address', async () => {
    const { sink, browser } = browse()
    browser.emitUp(svc({ name: 'no-port', host: 'no-port.local' }))
    browser.emitUp(svc({ name: 'no-host', port: 8081 }))
    await vi.advanceTimersByTimeAsync(1500)
    expect(sink.payload()).toEqual({ devices: [] })
  })

  it('stops browsing and tears the instance down after the window', async () => {
    const { browser, destroy } = browse()
    await vi.advanceTimersByTimeAsync(1499)
    expect(browser.stop).not.toHaveBeenCalled()
    expect(destroy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(browser.stop).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
