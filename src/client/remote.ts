/**
 * Reading a remote namespace off the client context.
 *
 * `ctx.remote.<namespace>` is a service proxy: plain property access throws
 * `cannot get property "remote.<ns>" without inject` unless the name is declared
 * in the plugin's `inject` list. That cannot work for the namespace this plugin
 * contributes itself (`remote.usageState`) — it only exists after `$mount`, so
 * declaring it would deadlock. `ctx.get()` is the inject-free accessor and returns
 * `undefined` while the namespace is absent.
 */
export function remoteService<T>(ctx: { get(name: string): unknown }, name: string): T | undefined {
  try {
    const service = ctx.get(name)
    return service === undefined ? undefined : (service as T)
  } catch {
    return undefined
  }
}
