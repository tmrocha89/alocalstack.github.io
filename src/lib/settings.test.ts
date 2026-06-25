import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadSettings, saveSettings, isMixedContentRisk, type Settings } from './settings'

const DEFAULTS: Settings = {
  endpoint: 'http://kubernetes.docker.internal:4566',
  region: 'us-east-1',
}

// Mock localStorage for Node environment
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()

describe('settings helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', localStorageMock)
    localStorageMock.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('loadSettings / saveSettings', () => {
    it('returns defaults when nothing is stored', () => {
      const result = loadSettings()
      expect(result).toEqual(DEFAULTS)
    })

    it('saves and loads settings correctly', () => {
      const custom: Settings = { endpoint: 'https://my-tunnel.ngrok.io', region: 'eu-central-1' }
      saveSettings(custom)

      const loaded = loadSettings()
      expect(loaded).toEqual(custom)
    })

    it('falls back to defaults on invalid JSON', () => {
      localStorage.setItem('alocalstack:settings', 'not valid json {')
      const result = loadSettings()
      expect(result).toEqual(DEFAULTS)
    })

    it('falls back gracefully on partial data', () => {
      localStorage.setItem('alocalstack:settings', JSON.stringify({ endpoint: 'https://only-endpoint' }))
      const result = loadSettings()
      expect(result.endpoint).toBe('https://only-endpoint')
      expect(result.region).toBe(DEFAULTS.region)
    })
  })

  describe('isMixedContentRisk', () => {
    it('returns false when running on http', () => {
      vi.stubGlobal('window', { location: { protocol: 'http:' } })
      const result = isMixedContentRisk({ endpoint: 'http://localhost:4566', region: 'us-east-1' })
      expect(result).toBe(false)
      vi.unstubAllGlobals()
    })

    it('detects risk when page is https but endpoint is http', () => {
      vi.stubGlobal('window', { location: { protocol: 'https:' } })
      const result = isMixedContentRisk({ endpoint: 'http://localhost:4566', region: 'us-east-1' })
      expect(result).toBe(true)
      vi.unstubAllGlobals()
    })

    it('returns false for https endpoint even on https page', () => {
      vi.stubGlobal('window', { location: { protocol: 'https:' } })
      const result = isMixedContentRisk({ endpoint: 'https://my-tunnel.ngrok.io', region: 'us-east-1' })
      expect(result).toBe(false)
      vi.unstubAllGlobals()
    })

    it('returns false in non-browser environment', () => {
      const originalWindow = (globalThis as any).window
      // @ts-expect-error - simulating non-browser
      delete (globalThis as any).window

      const result = isMixedContentRisk({ endpoint: 'http://localhost:4566', region: 'us-east-1' })
      expect(result).toBe(false)

      ;(globalThis as any).window = originalWindow
    })
  })
})