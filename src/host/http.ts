/**
 * Fork note (dsh 0.1.7): Typert RPC registration (the `typertRemote` service
 * property + `$mount` client contribution) followed the 0.1.5-rc.2 protocol and
 * no longer mounts under 0.1.7. The same two payloads travel over plain webServer
 * HTTP routes instead — same-origin, cookie-authenticated, the pattern dsh-quota
 * already proves on this harness version.
 */
import type { UsageStateService } from './service.ts'

const API_PREFIX = '/plugins/usage-state/api'

interface HttpRequestLike {
  url?: string
}
interface HttpResponseLike {
  writeHead(code: number, headers: Record<string, string>): HttpResponseLike
  end(body?: string): unknown
}
interface HostContextLike {
  /** Graceful degradation: routes register only when the web server is composed. */
  inject(
    names: readonly string[],
    callback: (sctx: { webServer?: { register(route: unknown): void } }) => void,
  ): void
}

/** Register `GET /plugins/usage-state/api/{state,credentials}` returning
 * `{ ok: true, value }` / `{ ok: false, error: { message } }` — the exact shapes
 * the client store's `RemoteResult` contract consumes. */
export function registerHttpRoutes(ctx: HostContextLike, service: UsageStateService): void {
  ctx.inject(['webServer'], sctx => {
    sctx.webServer?.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (req: HttpRequestLike, res: HttpResponseLike) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const send = (code: number, body: unknown): void => {
          res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body))
        }
        try {
          if (url.pathname === `${API_PREFIX}/state`) {
            const force = url.searchParams.get('force') === '1'
            return send(200, { ok: true, value: await service.getState(force) })
          }
          if (url.pathname === `${API_PREFIX}/credentials`) {
            return send(200, { ok: true, value: await service.describeCredentials() })
          }
          return send(404, { ok: false, error: { message: `unknown path ${url.pathname}` } })
        } catch (error) {
          return send(500, { ok: false, error: { message: error instanceof Error ? error.message : String(error) } })
        }
      },
    })
  })
}
