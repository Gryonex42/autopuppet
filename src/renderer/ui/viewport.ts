/**
 * Viewport panel — mounts a PixiJS canvas, wires EventBus events
 * to the RigRenderer, and handles resize.
 */

import { RigRenderer } from '../engine/renderer'
import type { EventBus, AppEvents } from './events'

/**
 * Initialise the viewport panel. Creates a PIXI.Application inside
 * the given container and wires EventBus events for rig loading,
 * parameter changes, and canvas resize.
 *
 * @param container - DOM element to mount the PixiJS canvas into
 * @param eventBus - Application EventBus
 * @param getTextureBasePath - Returns the base directory for part textures (derived from the current image path)
 */
export async function initViewport(
  container: HTMLElement,
  eventBus: EventBus<AppEvents>,
  getTextureBasePath: () => string,
): Promise<RigRenderer> {
  const renderer = new RigRenderer(container)
  await renderer.init()

  // --- EventBus wiring ---

  // 13.2: When a rig is loaded, push it to the renderer
  eventBus.on('rigLoaded', async ({ rig }) => {
    const textureDir = getTextureBasePath()
    await renderer.loadRig(rig, textureDir)
  })

  // 13.3: When a parameter changes, update deformations in real-time
  eventBus.on('paramChanged', ({ paramId, value }) => {
    renderer.setParameter(paramId, value)
  })

  // 13.4: Resize the PIXI viewport when the container div is resized
  const resizeObserver = new ResizeObserver(() => {
    renderer.resize()
  })
  resizeObserver.observe(container)

  return renderer
}
