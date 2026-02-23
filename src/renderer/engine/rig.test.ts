import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { loadRig, saveRig } from './rig'

const FIXTURE_PATH = resolve(__dirname, '../../../test/fixtures/test-rig.json')

function fixtureJson(): string {
  return readFileSync(FIXTURE_PATH, 'utf-8')
}

describe('loadRig', () => {
  it('parses a valid rig JSON', () => {
    const rig = loadRig(fixtureJson())
    expect(rig.version).toBe('1.0')
    expect(rig.parts).toHaveLength(2)
    expect(rig.parts[0].id).toBe('face')
    expect(rig.parts[1].id).toBe('eye_left')
    expect(rig.parameters).toHaveLength(2)
    expect(rig.physics).toHaveLength(1)
  })

  it('throws on invalid JSON syntax', () => {
    expect(() => loadRig('{ not valid json')).toThrow('Invalid JSON')
  })

  it('throws on missing required field', () => {
    const json = JSON.stringify({
      version: '1.0',
      canvas: { width: 1024, height: 1024 },
      // missing parts
      parameters: [],
      physics: [],
    })
    expect(() => loadRig(json)).toThrow('Rig validation failed')
  })

  it('throws when vertex count does not match UV count', () => {
    const raw = JSON.parse(fixtureJson())
    raw.parts[0].mesh.uvs = raw.parts[0].mesh.uvs.slice(0, 3) // truncate UVs
    expect(() => loadRig(JSON.stringify(raw))).toThrow('vertex count')
  })

  it('throws when triangle index is out of bounds', () => {
    const raw = JSON.parse(fixtureJson())
    raw.parts[0].mesh.triangles.push([0, 1, 999]) // invalid index
    expect(() => loadRig(JSON.stringify(raw))).toThrow('out of bounds')
  })

  it('throws when deformer references unknown parameter', () => {
    const raw = JSON.parse(fixtureJson())
    raw.parts[0].deformers[0].paramBinding = 'nonexistent_param'
    expect(() => loadRig(JSON.stringify(raw))).toThrow('unknown parameter')
  })

  it('throws when physics references unknown parameter', () => {
    const raw = JSON.parse(fixtureJson())
    raw.physics[0].paramBinding = 'nonexistent_param'
    expect(() => loadRig(JSON.stringify(raw))).toThrow('unknown parameter')
  })
})

describe('saveRig', () => {
  it('serializes a rig to formatted JSON', () => {
    const rig = loadRig(fixtureJson())
    const json = saveRig(rig)
    expect(json).toContain('"version"')
    expect(json).toContain('"face"')
    expect(json).toContain('\n') // formatted, not minified
  })
})

describe('round-trip', () => {
  it('load → save → load produces identical output', () => {
    const rig1 = loadRig(fixtureJson())
    const json1 = saveRig(rig1)
    const rig2 = loadRig(json1)
    const json2 = saveRig(rig2)
    expect(json1).toBe(json2)
    expect(rig1).toEqual(rig2)
  })
})
