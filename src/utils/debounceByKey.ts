/**
 * Coalesces rapid calls — keyed by a string — into a single trailing
 * invocation per key.
 *
 * Each distinct key gets its own timer. Calls for the same key within `delayMs`
 * collapse into one, and the LAST call's args win (trailing-edge debounce).
 * Different keys never interfere with each other.
 *
 * Used to avoid hammering ai-service with one graph resync per mutation when a
 * burst arrives (e.g. dragging several cards across a board fires many PATCHes
 * for the same project — we only need one resync once the dust settles).
 *
 * The pending timer is `unref()`-ed so a queued sync never keeps the process
 * alive on shutdown — a dropped trailing sync is recoverable (the next mutation
 * or a full sync will reconcile the graph).
 */
export function debounceByKey<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): (key: string, ...args: A) => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  return (key: string, ...args: A): void => {
    const existing = timers.get(key)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      timers.delete(key)
      fn(...args)
    }, delayMs)

    if (typeof timer.unref === 'function') timer.unref()
    timers.set(key, timer)
  }
}
