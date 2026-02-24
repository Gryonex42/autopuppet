import {
  Application,
  Container,
  Mesh,
  MeshGeometry,
  Texture,
  Graphics,
  Assets,
} from 'pixi.js'
import type { Rig, Part, Deformer as DeformerConfig } from './rig'
import { createDeformer, type DeformerInstance, type BBox } from './deformer'

// --- Per-part runtime state ---

interface PartState {
  part: Part
  mesh: Mesh<MeshGeometry>
  geometry: MeshGeometry
  basePositions: Float32Array
  deformers: { instance: DeformerInstance; paramBinding: string }[]
}

// --- RigRenderer ---

export class RigRenderer {
  private app: Application | null = null
  private root: Container = new Container()
  private parts: Map<string, PartState> = new Map()
  private paramValues: Map<string, number> = new Map()
  private container: HTMLElement
  private selectionOverlay: Graphics | null = null
  private selectedPartId: string | null = null

  /** Callbacks set externally for events */
  onPartSelected: ((partId: string | null) => void) | null = null

  constructor(container: HTMLElement) {
    this.container = container
  }

  /** Async init — must be called before any other method. */
  async init(): Promise<void> {
    const app = new Application()
    await app.init({
      background: 0x2b2b2b,
      resizeTo: this.container,
      antialias: true,
    })
    this.container.appendChild(app.canvas)
    app.stage.addChild(this.root)

    // Enable pan/zoom via pointer events
    this.setupCameraControls(app.canvas)

    this.app = app
  }

  /** Load a rig: create PIXI meshes for each part sorted by zIndex. */
  async loadRig(rig: Rig, textureBasePath: string): Promise<void> {
    this.clear()

    // Initialize parameter default values
    for (const param of rig.parameters) {
      this.paramValues.set(param.id, param.default)
    }

    // Sort parts by zIndex (lower draws first / behind)
    const sorted = [...rig.parts].sort((a, b) => a.zIndex - b.zIndex)

    for (const part of sorted) {
      const texturePath = textureBasePath
        ? `${textureBasePath}/${part.texture}`
        : part.texture

      let texture: Texture
      try {
        texture = await Assets.load(texturePath)
      } catch {
        // If texture can't be loaded, use white texture as fallback
        texture = Texture.WHITE
      }

      // Flatten vertex data: [[x,y], ...] → Float32Array [x0, y0, x1, y1, ...]
      const positions = new Float32Array(part.mesh.vertices.length * 2)
      for (let i = 0; i < part.mesh.vertices.length; i++) {
        positions[i * 2] = part.mesh.vertices[i][0]
        positions[i * 2 + 1] = part.mesh.vertices[i][1]
      }

      // Flatten UV data
      const uvs = new Float32Array(part.mesh.uvs.length * 2)
      for (let i = 0; i < part.mesh.uvs.length; i++) {
        uvs[i * 2] = part.mesh.uvs[i][0]
        uvs[i * 2 + 1] = part.mesh.uvs[i][1]
      }

      // Flatten triangle indices
      const indices = new Uint32Array(part.mesh.triangles.length * 3)
      for (let i = 0; i < part.mesh.triangles.length; i++) {
        indices[i * 3] = part.mesh.triangles[i][0]
        indices[i * 3 + 1] = part.mesh.triangles[i][1]
        indices[i * 3 + 2] = part.mesh.triangles[i][2]
      }

      const geometry = new MeshGeometry({
        positions: positions.slice(), // working copy
        uvs,
        indices,
      })

      const mesh = new Mesh({ geometry, texture })
      mesh.label = part.id
      mesh.eventMode = 'static'

      this.root.addChild(mesh)

      // Build deformer instances
      const partBbox = computeBBox(positions)
      const deformers = part.deformers.map((config) => ({
        instance: createDeformer(config, partBbox),
        paramBinding: config.paramBinding,
      }))

      this.parts.set(part.id, {
        part,
        mesh,
        geometry,
        basePositions: positions, // original, never mutated
        deformers,
      })
    }

    // Set up click handler for part selection
    this.setupPartSelection()
  }

  /** Update a single parameter and re-deform affected parts. */
  setParameter(paramId: string, value: number): void {
    this.paramValues.set(paramId, value)
    this.applyDeformations()
  }

  /**
   * Batch-set all parameters and re-deform once.
   * Respects part hierarchy: parents are deformed before children.
   */
  setAllParameters(params: Record<string, number>): void {
    for (const [id, value] of Object.entries(params)) {
      this.paramValues.set(id, value)
    }
    this.applyDeformations()
  }

  /** Resize the renderer to fit its container. */
  resize(): void {
    this.app?.resize()
  }

  /** Load a single image as a preview sprite (no rig). */
  async loadImagePreview(blobUrl: string): Promise<void> {
    this.clear()
    const { Sprite, ImageSource } = await import('pixi.js')
    const response = await fetch(blobUrl)
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)
    const source = new ImageSource({ resource: bitmap })
    const texture = new Texture({ source })
    const sprite = new Sprite(texture)
    this.root.addChild(sprite)
  }

  /** Remove all parts and reset state. */
  clear(): void {
    for (const state of this.parts.values()) {
      this.root.removeChild(state.mesh)
      state.mesh.destroy()
      state.geometry.destroy()
    }
    this.parts.clear()
    this.paramValues.clear()
    this.clearSelectionOverlay()
    this.selectedPartId = null
  }

  /** Destroy the PIXI application and clean up. */
  destroy(): void {
    this.clear()
    if (this.app) {
      this.app.destroy(true, { children: true })
      this.app = null
    }
  }

  // --- Deformation ---

  private applyDeformations(): void {
    for (const state of this.parts.values()) {
      let positions = state.basePositions

      for (const { instance, paramBinding } of state.deformers) {
        const value = this.paramValues.get(paramBinding) ?? 0
        positions = instance.apply(positions, value)
      }

      // Write deformed positions into the live geometry buffer
      state.geometry.positions = positions
    }
  }

  // --- Camera Controls ---

  private setupCameraControls(canvas: HTMLCanvasElement): void {
    let isPanning = false
    let lastX = 0
    let lastY = 0

    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      // Middle button or Ctrl+left button for panning
      if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
        isPanning = true
        lastX = e.clientX
        lastY = e.clientY
        e.preventDefault()
      }
    })

    canvas.addEventListener('pointermove', (e: PointerEvent) => {
      if (!isPanning) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      this.root.x += dx
      this.root.y += dy
      lastX = e.clientX
      lastY = e.clientY
    })

    const stopPanning = () => { isPanning = false }
    canvas.addEventListener('pointerup', stopPanning)
    canvas.addEventListener('pointerleave', stopPanning)

    // Zoom with scroll wheel
    canvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault()
      const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1
      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      // Zoom toward cursor position
      const worldX = (mouseX - this.root.x) / this.root.scale.x
      const worldY = (mouseY - this.root.y) / this.root.scale.y

      this.root.scale.x *= scaleFactor
      this.root.scale.y *= scaleFactor

      this.root.x = mouseX - worldX * this.root.scale.x
      this.root.y = mouseY - worldY * this.root.scale.y
    }, { passive: false })
  }

  // --- Part Selection ---

  private setupPartSelection(): void {
    for (const [partId, state] of this.parts) {
      state.mesh.on('pointerdown', (e) => {
        // Don't interfere with pan (middle button or ctrl+click)
        if (e.button === 1 || e.ctrlKey) return
        this.selectPart(partId)
      })
    }
  }

  private selectPart(partId: string | null): void {
    this.clearSelectionOverlay()
    this.selectedPartId = partId

    if (partId) {
      const state = this.parts.get(partId)
      if (state) {
        this.drawWireframeOverlay(state)
      }
    }

    this.onPartSelected?.(partId)
  }

  private drawWireframeOverlay(state: PartState): void {
    const gfx = new Graphics()
    const positions = state.geometry.positions
    const { triangles } = state.part.mesh

    gfx.setStrokeStyle({ width: 1, color: 0x00ffff, alpha: 0.8 })

    for (const [a, b, c] of triangles) {
      const ax = positions[a * 2], ay = positions[a * 2 + 1]
      const bx = positions[b * 2], by = positions[b * 2 + 1]
      const cx = positions[c * 2], cy = positions[c * 2 + 1]

      gfx.moveTo(ax, ay)
      gfx.lineTo(bx, by)
      gfx.lineTo(cx, cy)
      gfx.closePath()
      gfx.stroke()
    }

    this.root.addChild(gfx)
    this.selectionOverlay = gfx
  }

  private clearSelectionOverlay(): void {
    if (this.selectionOverlay) {
      this.root.removeChild(this.selectionOverlay)
      this.selectionOverlay.destroy()
      this.selectionOverlay = null
    }
  }
}

// --- Helpers ---

function computeBBox(positions: Float32Array): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < positions.length; i += 2) {
    const x = positions[i], y = positions[i + 1]
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
