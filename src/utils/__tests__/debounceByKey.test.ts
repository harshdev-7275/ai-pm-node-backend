import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounceByKey } from '../debounceByKey.js'

describe('debounceByKey', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces rapid calls for the same key into a single trailing invocation', () => {
    const fn = vi.fn()
    const debounced = debounceByKey(fn, 1000)

    debounced('p1', 'a')
    debounced('p1', 'b')
    debounced('p1', 'c')

    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)

    // Only the last call's args survive (trailing-edge debounce)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('c')
  })

  it('debounces each key independently', () => {
    const fn = vi.fn()
    const debounced = debounceByKey(fn, 1000)

    debounced('p1', 'one')
    debounced('p2', 'two')

    vi.advanceTimersByTime(1000)

    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenCalledWith('one')
    expect(fn).toHaveBeenCalledWith('two')
  })

  it('fires again for calls spaced beyond the delay window', () => {
    const fn = vi.fn()
    const debounced = debounceByKey(fn, 1000)

    debounced('p1', 'first')
    vi.advanceTimersByTime(1000)

    debounced('p1', 'second')
    vi.advanceTimersByTime(1000)

    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenNthCalledWith(1, 'first')
    expect(fn).toHaveBeenNthCalledWith(2, 'second')
  })

  it('does not invoke the function before the delay elapses', () => {
    const fn = vi.fn()
    const debounced = debounceByKey(fn, 1000)

    debounced('p1', 'x')
    vi.advanceTimersByTime(999)

    expect(fn).not.toHaveBeenCalled()
  })
})
