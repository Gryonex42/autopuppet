import { describe, it, expect, vi } from 'vitest'
import { EventBus } from './events'

type TestEvents = {
  ping: { msg: string }
  count: { n: number }
}

describe('EventBus', () => {
  it('subscriber receives emitted events', () => {
    const bus = new EventBus<TestEvents>()
    const cb = vi.fn()
    bus.on('ping', cb)
    bus.emit('ping', { msg: 'hello' })
    expect(cb).toHaveBeenCalledWith({ msg: 'hello' })
  })

  it('unsubscribe stops receiving events', () => {
    const bus = new EventBus<TestEvents>()
    const cb = vi.fn()
    bus.on('ping', cb)
    bus.off('ping', cb)
    bus.emit('ping', { msg: 'nope' })
    expect(cb).not.toHaveBeenCalled()
  })

  it('multiple listeners all fire', () => {
    const bus = new EventBus<TestEvents>()
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    bus.on('count', cb1)
    bus.on('count', cb2)
    bus.emit('count', { n: 42 })
    expect(cb1).toHaveBeenCalledWith({ n: 42 })
    expect(cb2).toHaveBeenCalledWith({ n: 42 })
  })

  it('emitting an event with no listeners does nothing', () => {
    const bus = new EventBus<TestEvents>()
    // Should not throw
    expect(() => bus.emit('ping', { msg: 'nobody home' })).not.toThrow()
  })

  it('listeners for different events are independent', () => {
    const bus = new EventBus<TestEvents>()
    const pingCb = vi.fn()
    const countCb = vi.fn()
    bus.on('ping', pingCb)
    bus.on('count', countCb)
    bus.emit('ping', { msg: 'hi' })
    expect(pingCb).toHaveBeenCalledOnce()
    expect(countCb).not.toHaveBeenCalled()
  })

  it('off on non-subscribed callback is a no-op', () => {
    const bus = new EventBus<TestEvents>()
    const cb = vi.fn()
    expect(() => bus.off('ping', cb)).not.toThrow()
  })
})
