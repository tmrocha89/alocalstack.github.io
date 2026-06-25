import { createContext, useContext, useState, ReactNode } from 'react'

// Simple settings store for endpoint/region (Phase 0/1).
// Persisted to localStorage. Live values used by AWS client factory and CLI generator.

export type Settings = {
  endpoint: string
  region: string
}

const STORAGE_KEY = 'alocalstack:settings'

const DEFAULTS: Settings = {
  endpoint: 'http://kubernetes.docker.internal:4566',
  region: 'us-east-1',
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    return {
      endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : DEFAULTS.endpoint,
      region: typeof parsed.region === 'string' ? parsed.region : DEFAULTS.region,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

// Helper for the GH Pages / static hosting feature (plan requirement).
export function isMixedContentRisk(settings: Settings): boolean {
  if (typeof window === 'undefined') return false
  const pageIsHttps = window.location.protocol === 'https:'
  const endpointIsHttp = settings.endpoint.startsWith('http:')
  return pageIsHttps && endpointIsHttp
}

// React context + hook for live settings across pages
interface SettingsContextValue {
  settings: Settings
  updateSetting: (key: keyof Settings, value: string) => void
  isMixedContentRisk: boolean
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings())

  const updateSetting = (key: keyof Settings, value: string) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    saveSettings(next)
  }

  const mixed = isMixedContentRisk(settings)

  return (
    <SettingsContext.Provider value={{ settings, updateSetting, isMixedContentRisk: mixed }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) {
    // Fallback for non-provider usage (e.g. CLI generator in pure functions needs the raw value)
    const s = loadSettings()
    return {
      settings: s,
      updateSetting: (key: keyof Settings, value: string) => {
        const next = { ...s, [key]: value }
        saveSettings(next)
      },
      isMixedContentRisk: isMixedContentRisk(s),
    } as any
  }
  return ctx
}

