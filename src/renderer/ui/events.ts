import type { Rig } from '../engine/rig'

// --- Typed EventBus ---

type Callback<T> = (data: T) => void

export class EventBus<T extends Record<string, unknown>> {
  private listeners = new Map<keyof T, Set<Callback<never>>>()

  on<K extends keyof T>(event: K, cb: Callback<T[K]>): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(cb as Callback<never>)
  }

  off<K extends keyof T>(event: K, cb: Callback<T[K]>): void {
    this.listeners.get(event)?.delete(cb as Callback<never>)
  }

  emit<K extends keyof T>(event: K, data: T[K]): void {
    const cbs = this.listeners.get(event)
    if (cbs) for (const cb of cbs) (cb as Callback<T[K]>)(data)
  }
}

// --- Application event map ---

export type AppEvents = {
  paramChanged: { paramId: string; value: number }
  partSelected: { partId: string | null }
  rigLoaded: { rig: Rig }
  animationTick: { time: number }
  rigUpdated: void
}

// --- Application state ---

export class AppState {
  private rig: Rig | null = null
  private params = new Map<string, number>()
  private selectedPart: string | null = null
  private playing = false
  private playbackTime = 0

  constructor(private bus: EventBus<AppEvents>) {}

  getRig(): Rig | null { return this.rig }

  setRig(rig: Rig): void {
    this.rig = rig
    this.params.clear()
    for (const p of rig.parameters) this.params.set(p.id, p.default)
    this.selectedPart = null
    this.bus.emit('rigLoaded', { rig })
  }

  getParam(id: string): number { return this.params.get(id) ?? 0 }

  setParam(id: string, value: number): void {
    this.params.set(id, value)
    this.bus.emit('paramChanged', { paramId: id, value })
  }

  getAllParams(): Map<string, number> { return this.params }

  getSelectedPart(): string | null { return this.selectedPart }

  setSelectedPart(partId: string | null): void {
    this.selectedPart = partId
    this.bus.emit('partSelected', { partId })
  }

  isPlaying(): boolean { return this.playing }
  setPlaying(v: boolean): void { this.playing = v }

  getPlaybackTime(): number { return this.playbackTime }
  setPlaybackTime(t: number): void { this.playbackTime = t }
}
