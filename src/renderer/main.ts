// Renderer entry point
import { RigRenderer } from './engine/renderer'
import { loadRig } from './engine/rig'

// Inline test rig JSON (matches test/fixtures/test-rig.json)
const TEST_RIG_JSON = `{
  "version": "1.0",
  "canvas": { "width": 1024, "height": 1024 },
  "parts": [
    {
      "id": "face", "zIndex": 1, "texture": "__white__",
      "mesh": {
        "vertices": [
          [300,100],[500,100],[600,200],[600,400],
          [500,500],[300,500],[200,400],[200,200],
          [350,250],[450,250],[400,350]
        ],
        "uvs": [
          [0.25,0.0],[0.625,0.0],[0.875,0.25],[0.875,0.75],
          [0.625,1.0],[0.25,1.0],[0.125,0.75],[0.125,0.25],
          [0.375,0.375],[0.5625,0.375],[0.46875,0.625]
        ],
        "triangles": [
          [0,1,8],[1,2,9],[2,3,9],[3,4,10],[4,5,10],
          [5,6,10],[6,7,8],[7,0,8],[8,9,10],[6,10,8]
        ]
      },
      "deformers": [{
        "type": "warp", "paramBinding": "head_angle_x",
        "gridSize": [4,4], "bbox": {"x":200,"y":100,"w":400,"h":400},
        "mode": "squeeze_center"
      }]
    },
    {
      "id": "eye_left", "zIndex": 2, "texture": "__white__",
      "mesh": {
        "vertices": [[310,220],[370,210],[380,260],[340,280],[300,260]],
        "uvs": [[0.125,0.143],[0.875,0.0],[1.0,0.714],[0.5,1.0],[0.0,0.714]],
        "triangles": [[0,1,4],[1,2,3],[1,3,4]]
      },
      "deformers": [{
        "type": "rotate", "paramBinding": "eye_open_left",
        "origin": [340,250], "childrenFollow": false
      }]
    }
  ],
  "parameters": [
    { "id": "head_angle_x", "range": [-30,30], "default": 0, "keys": [-30,0,30] },
    { "id": "eye_open_left", "range": [0,1], "default": 1, "keys": [0,0.5,1] }
  ],
  "physics": [
    { "target": "face", "type": "pendulum", "length": 100, "damping": 0.9, "paramBinding": "head_angle_x" }
  ]
}`

async function main(): Promise<void> {
  const viewport = document.getElementById('viewport')!
  const paramPanel = document.getElementById('param-panel')!

  // Init renderer
  const renderer = new RigRenderer(viewport)
  await renderer.init()

  // Parse and load the test rig (textures will fallback to white)
  const rig = loadRig(TEST_RIG_JSON)
  await renderer.loadRig(rig, '')

  // Build quick parameter sliders in the param panel
  paramPanel.innerHTML = '<div style="font-weight:600;margin-bottom:8px">Parameters</div>'

  for (const param of rig.parameters) {
    const row = document.createElement('div')
    row.style.marginBottom = '12px'

    const label = document.createElement('label')
    label.textContent = param.id
    label.style.display = 'block'
    label.style.marginBottom = '2px'
    label.style.fontSize = '12px'
    label.style.color = '#aaa'

    const valueSpan = document.createElement('span')
    valueSpan.textContent = String(param.default)
    valueSpan.style.float = 'right'
    valueSpan.style.color = '#6cf'
    label.appendChild(valueSpan)

    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = String(param.range[0])
    slider.max = String(param.range[1])
    slider.step = '0.1'
    slider.value = String(param.default)
    slider.style.width = '100%'

    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value)
      valueSpan.textContent = val.toFixed(1)
      renderer.setParameter(param.id, val)
    })

    row.appendChild(label)
    row.appendChild(slider)
    paramPanel.appendChild(row)
  }

  // Log part selections
  renderer.onPartSelected = (partId) => {
    console.log('Part selected:', partId)
  }

  // Wire menu actions from Electron native menu
  window.api.onMenuAction(async (action) => {
    switch (action) {
      case 'openImage': {
        const filePath = await window.api.openFile({
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
        })
        if (filePath) {
          console.log('Opened image:', filePath)
        }
        break
      }
      case 'openRig': {
        const filePath = await window.api.openFile({
          filters: [{ name: 'Rig Files', extensions: ['json'] }],
        })
        if (filePath) {
          console.log('Opened rig:', filePath)
          const buffer = await window.api.readFile(filePath)
          const text = new TextDecoder().decode(buffer)
          const newRig = loadRig(text)
          await renderer.loadRig(newRig, '')
          console.log('Rig loaded from file')
        }
        break
      }
      case 'saveRig':
      case 'saveRigAs': {
        const filePath = await window.api.saveFile({
          filters: [{ name: 'Rig Files', extensions: ['json'] }],
        })
        if (filePath) {
          console.log('Save rig to:', filePath)
        }
        break
      }
      default:
        console.log('Menu action:', action)
    }
  })

  console.log('AutoPuppet renderer loaded — test rig displayed')
}

main().catch(console.error)
