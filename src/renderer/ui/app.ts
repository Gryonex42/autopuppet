/**
 * Root UI shell — CSS Grid layout, panel management, toolbar wiring.
 *
 * Creates the main DOM structure, toolbar buttons, and wires
 * user actions to the EventBus / AppState.
 */

import { EventBus, AppState, type AppEvents } from './events'
import { RigRenderer } from '../engine/renderer'
import { loadRig } from '../engine/rig'
import { autoRig } from '../ai/autoRig'

// --- Panel resize constants ---

const MIN_SIDE_PANEL = 140
const MIN_TIMELINE_HEIGHT = 80

// --- Toolbar button definitions ---

const TOOLBAR_BUTTONS = [
  { id: 'btn-open-image', label: 'Open Image', icon: '📂' },
  { id: 'btn-auto-rig', label: 'Auto Rig', icon: '🤖' },
  { id: 'btn-save-rig', label: 'Save Rig', icon: '💾' },
  { id: 'btn-play-idle', label: 'Play Idle', icon: '▶️' },
  { id: 'btn-export', label: 'Export', icon: '📤' },
] as const

// --- initApp ---

/**
 * Bootstrap the application UI. Creates the DOM layout, toolbar,
 * renderer, and event wiring. Call once on app startup.
 */
export async function initApp(container: HTMLElement): Promise<{
  bus: EventBus<AppEvents>
  state: AppState
  renderer: RigRenderer
}> {
  const bus = new EventBus<AppEvents>()
  const state = new AppState(bus)

  // --- Build DOM structure ---
  container.innerHTML = ''

  const toolbar = el('div', { id: 'toolbar', className: 'panel' })
  const partTree = el('div', { id: 'part-tree', className: 'panel' })
  const viewport = el('div', { id: 'viewport', className: 'panel' })
  const paramPanel = el('div', { id: 'param-panel', className: 'panel' })
  const timeline = el('div', { id: 'timeline', className: 'panel' })

  container.append(toolbar, partTree, viewport, paramPanel, timeline)

  // --- Toolbar ---
  const titleSpan = el('span', { textContent: 'AutoPuppet' })
  titleSpan.style.marginRight = '16px'
  toolbar.appendChild(titleSpan)

  const buttons = new Map<string, HTMLButtonElement>()
  for (const def of TOOLBAR_BUTTONS) {
    const btn = document.createElement('button')
    btn.id = def.id
    btn.className = 'toolbar-btn'
    btn.textContent = `${def.icon} ${def.label}`
    toolbar.appendChild(btn)
    buttons.set(def.id, btn)
  }

  // Loading indicator (hidden by default)
  const loadingIndicator = el('span', { id: 'loading-indicator', textContent: 'Working…' })
  loadingIndicator.style.display = 'none'
  loadingIndicator.style.marginLeft = 'auto'
  loadingIndicator.style.color = '#ffcc00'
  toolbar.appendChild(loadingIndicator)

  // --- Init renderer ---
  const renderer = new RigRenderer(viewport)
  await renderer.init()

  // --- Resizable panels ---
  setupResizablePanels(container, partTree, paramPanel, timeline)

  // --- Track currently loaded image path ---
  let currentImagePath: string | null = null

  // --- Toolbar button handlers ---

  // Open Image
  buttons.get('btn-open-image')!.addEventListener('click', async () => {
    const filePath = await window.api.openFile({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (!filePath) return
    currentImagePath = filePath

    // Load the image as a texture and display as a preview in the viewport
    try {
      await renderer.loadImagePreview(filePath)
    } catch {
      // Fallback: just record the path
      console.log('Image selected:', filePath)
    }
  })

  // Auto Rig
  buttons.get('btn-auto-rig')!.addEventListener('click', async () => {
    if (!currentImagePath) {
      alert('Open an image first.')
      return
    }
    loadingIndicator.style.display = ''
    buttons.get('btn-auto-rig')!.disabled = true
    try {
      const { rig } = await autoRig(currentImagePath)
      state.setRig(rig)
    } catch (err) {
      alert(`Auto-rig failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      loadingIndicator.style.display = 'none'
      buttons.get('btn-auto-rig')!.disabled = false
    }
  })

  // Save Rig
  buttons.get('btn-save-rig')!.addEventListener('click', async () => {
    const rig = state.getRig()
    if (!rig) {
      alert('No rig loaded.')
      return
    }
    const filePath = await window.api.saveFile({
      filters: [{ name: 'Rig Files', extensions: ['json'] }],
    })
    if (!filePath) return
    const { saveRig } = await import('../engine/rig')
    const json = saveRig(rig)
    await window.api.writeFile(filePath, new TextEncoder().encode(json).buffer as ArrayBuffer)
  })

  // Play Idle (placeholder — wired fully in Task 17)
  buttons.get('btn-play-idle')!.addEventListener('click', () => {
    console.log('Play Idle — not yet implemented (Task 17)')
  })

  // Export (placeholder — wired fully in Task 18)
  buttons.get('btn-export')!.addEventListener('click', () => {
    console.log('Export — not yet implemented (Task 18)')
  })

  // --- EventBus wiring ---

  // When a rig is loaded, push it to the renderer
  bus.on('rigLoaded', async ({ rig }) => {
    const textureDir = currentImagePath
      ? currentImagePath.replace(/\/[^/]+$/, '') + '/parts'
      : ''
    await renderer.loadRig(rig, textureDir)
  })

  // When a parameter changes, update the renderer
  bus.on('paramChanged', ({ paramId, value }) => {
    renderer.setParameter(paramId, value)
  })

  // Forward part selection from renderer to state
  renderer.onPartSelected = (partId) => {
    state.setSelectedPart(partId)
  }

  // --- Wire Electron native menu actions ---
  window.api.onMenuAction(async (action) => {
    switch (action) {
      case 'openImage':
        buttons.get('btn-open-image')!.click()
        break
      case 'openRig': {
        const filePath = await window.api.openFile({
          filters: [{ name: 'Rig Files', extensions: ['json'] }],
        })
        if (filePath) {
          const buffer = await window.api.readFile(filePath)
          const text = new TextDecoder().decode(buffer)
          const rig = loadRig(text)
          state.setRig(rig)
        }
        break
      }
      case 'saveRig':
      case 'saveRigAs':
        buttons.get('btn-save-rig')!.click()
        break
      default:
        console.log('Menu action:', action)
    }
  })

  return { bus, state, renderer }
}

// --- Resizable Panels ---

function setupResizablePanels(
  grid: HTMLElement,
  leftPanel: HTMLElement,
  rightPanel: HTMLElement,
  bottomPanel: HTMLElement,
): void {
  // Restore saved sizes
  const savedCols = localStorage.getItem('panel-cols')
  const savedRows = localStorage.getItem('panel-rows')
  if (savedCols) grid.style.gridTemplateColumns = savedCols
  if (savedRows) grid.style.gridTemplateRows = savedRows

  // Left panel resize handle (right edge of part-tree)
  attachColumnResizeHandle(grid, leftPanel, 'left')

  // Right panel resize handle (left edge of param-panel)
  attachColumnResizeHandle(grid, rightPanel, 'right')

  // Bottom panel resize handle (top edge of timeline)
  attachRowResizeHandle(grid, bottomPanel)
}

function attachColumnResizeHandle(
  grid: HTMLElement,
  panel: HTMLElement,
  side: 'left' | 'right',
): void {
  const handle = document.createElement('div')
  handle.className = `resize-handle resize-handle-${side === 'left' ? 'right' : 'left'}`
  panel.style.position = 'relative'
  panel.appendChild(handle)

  let startX = 0
  let startWidth = 0

  const onPointerMove = (e: PointerEvent) => {
    const dx = e.clientX - startX
    const newWidth = Math.max(MIN_SIDE_PANEL, startWidth + (side === 'left' ? dx : -dx))
    const cols = grid.style.gridTemplateColumns.split(/\s+/)
    if (side === 'left') {
      cols[0] = `${newWidth}px`
    } else {
      cols[2] = `${newWidth}px`
    }
    grid.style.gridTemplateColumns = cols.join(' ')
    localStorage.setItem('panel-cols', grid.style.gridTemplateColumns)
  }

  const onPointerUp = () => {
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault()
    startX = e.clientX
    startWidth = panel.getBoundingClientRect().width
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
  })
}

function attachRowResizeHandle(grid: HTMLElement, panel: HTMLElement): void {
  const handle = document.createElement('div')
  handle.className = 'resize-handle resize-handle-top'
  panel.style.position = 'relative'
  panel.appendChild(handle)

  let startY = 0
  let startHeight = 0

  const onPointerMove = (e: PointerEvent) => {
    const dy = startY - e.clientY
    const newHeight = Math.max(MIN_TIMELINE_HEIGHT, startHeight + dy)
    const rows = grid.style.gridTemplateRows.split(/\s+/)
    rows[2] = `${newHeight}px`
    grid.style.gridTemplateRows = rows.join(' ')
    localStorage.setItem('panel-rows', grid.style.gridTemplateRows)
  }

  const onPointerUp = () => {
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault()
    startY = e.clientY
    startHeight = panel.getBoundingClientRect().height
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
  })
}

// --- DOM helper ---

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Partial<HTMLElementTagNameMap[K]>,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (props) Object.assign(element, props)
  return element
}
