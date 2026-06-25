import { useState } from 'react'
import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { useSettings } from './lib/settings'
import { Toaster } from 'sonner'
import { 
  Terminal, AlertTriangle, Settings as SettingsIcon, 
  HardDrive, Database, MessageSquare, Bell, Zap, Users, Menu, X 
} from 'lucide-react'

import Overview from './pages/Overview'
import S3Page from './pages/S3Page'
import DynamoDBPage from './pages/DynamoDBPage'
import SQSPage from './pages/SQSPage'
import SNSPage from './pages/SNSPage'

function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, updateSetting, isMixedContentRisk } = useSettings()
  const uiOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center pt-20 z-50" onClick={onClose}>
      <div className="card w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-medium flex items-center gap-2">
            <SettingsIcon className="h-4 w-4" /> Connection Settings
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Endpoint (live for all SDK calls + CLI commands)</label>
            <input
              className="input w-full font-mono"
              value={settings.endpoint}
              onChange={e => updateSetting('endpoint', e.target.value)}
            />
            <p className="text-[10px] text-zinc-500 mt-1">http://localhost:4566 or https://your-tunnel.ngrok-free.app</p>
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Region</label>
            <input
              className="input w-full font-mono"
              value={settings.region}
              onChange={e => updateSetting('region', e.target.value)}
            />
          </div>
        </div>

        {isMixedContentRisk && (
          <div className="warning mt-4 text-xs">
            Mixed content risk: this page is HTTPS but your endpoint is HTTP. Use an https tunnel.
          </div>
        )}

        <div className="mt-4 text-xs text-zinc-500">
          Changes are saved automatically to localStorage and affect every generated CLI command and SDK call.
        </div>

        <div className="mt-4 p-2 bg-zinc-950 border border-zinc-800 rounded text-xs">
          <div className="font-medium mb-1">Having CORS issues in dev?</div>
          <div>Start LocalStack with (using kubernetes.docker.internal for host reachability from containers/K8s):</div>
          <code className="block mt-1 p-1 bg-black rounded break-all text-emerald-300">
            docker run -p 4566:4566 -e EXTRA_CORS_ALLOWED_ORIGINS="{uiOrigin}" localstack/localstack
          </code>
          <div className="mt-1 text-amber-300">The app defaults to http://kubernetes.docker.internal:4566. Use the "Configure CORS" button on S3 buckets for per-bucket policies.</div>
        </div>
      </div>
    </div>
  )
}

function Sidebar({ onNavClick }: { onNavClick?: () => void }) {
  const { settings } = useSettings()

  const navItems = [
    { to: '/', label: 'Overview', icon: Terminal },
    { to: '/s3', label: 'S3', icon: HardDrive },
    { to: '/dynamodb', label: 'DynamoDB', icon: Database },
    { to: '/sqs', label: 'SQS', icon: MessageSquare },
    { to: '/sns', label: 'SNS', icon: Bell },
    { to: '/lambda', label: 'Lambda', icon: Zap, disabled: true },
    { to: '/cognito', label: 'Cognito', icon: Users, disabled: true },
  ]

  return (
    <div className="w-60 border-r border-zinc-800 bg-zinc-950 h-screen flex flex-col">
      <div className="px-4 py-4 border-b border-zinc-800">
        <div className="font-semibold tracking-tight">alocalstack</div>
        <div className="text-[10px] text-zinc-500 -mt-0.5">LocalStack resource browser</div>
      </div>

      <div className="px-3 py-2 text-xs text-zinc-500 border-b border-zinc-800">
        Endpoint<br />
        <span className="font-mono text-emerald-400 text-[11px] break-all">{settings.endpoint}</span>
      </div>

      <nav className="flex-1 overflow-auto py-2">
        {navItems.map(item => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavClick}
              className={({ isActive }) => 
                `flex items-center gap-3 px-4 py-2 text-sm transition-colors ${isActive ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-900'} ${item.disabled ? 'opacity-40 pointer-events-none' : ''}`
              }
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
              {item.disabled && <span className="ml-auto text-[10px] text-zinc-500">soon</span>}
            </NavLink>
          )
        })}
      </nav>

      <div className="p-3 border-t border-zinc-800 text-[10px] text-zinc-500">
        Every action produces a copyable<br />`aws --endpoint-url=...` command
      </div>
    </div>
  )
}

export default function App() {
  const { isMixedContentRisk } = useSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false) // mobile
  const location = useLocation()

  const pageTitle = location.pathname === '/' ? 'Overview' :
                    location.pathname === '/s3' ? 'S3' :
                    location.pathname === '/dynamodb' ? 'DynamoDB' :
                    location.pathname === '/sqs' ? 'SQS' :
                    location.pathname === '/sns' ? 'SNS' : 'alocalstack'

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-200">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="w-64 bg-zinc-950 border-r border-zinc-800" onClick={() => setSidebarOpen(false)}>
            <Sidebar onNavClick={() => setSidebarOpen(false)} />
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setSidebarOpen(false)} />
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 border-b border-zinc-800 flex items-center px-4 justify-between bg-zinc-950/80 backdrop-blur z-30">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="md:hidden btn p-2">
              {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <div className="font-semibold">{pageTitle}</div>
            <div className="hidden sm:block text-xs px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-400">
              Live endpoint: <span className="font-mono text-emerald-400">from settings</span>
            </div>
          </div>

          <button
            onClick={() => setSettingsOpen(true)}
            className="btn flex items-center gap-2 text-sm"
          >
            <SettingsIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Connection</span>
          </button>
        </header>

        {/* Mixed content warning (global, from the plan) */}
        {isMixedContentRisk && (
          <div className="warning mx-4 mt-3 flex gap-3 items-start text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              Mixed content risk — page is served over HTTPS (e.g. GitHub Pages) but endpoint is HTTP.
              Use an <strong>https</strong> tunnel and update the Connection settings.
            </div>
          </div>
        )}

        {/* Main content area */}
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/s3" element={<S3Page />} />
            <Route path="/dynamodb" element={<DynamoDBPage />} />
            <Route path="/sqs" element={<SQSPage />} />
            <Route path="/sns" element={<SNSPage />} />
            {/* Stubs for future phases */}
            <Route path="/lambda" element={<div className="text-zinc-400">Lambda page coming in later phase per the plan.</div>} />
            <Route path="/cognito" element={<div className="text-zinc-400">Cognito page coming in later phase per the plan.</div>} />
          </Routes>
        </main>

        <footer className="text-[10px] text-zinc-500 px-4 py-2 border-t border-zinc-800">
          alocalstack — resembles the classic LocalStack web UI • every action gives you the exact CLI command • see AGENTS.md
        </footer>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toaster position="top-center" richColors closeButton />
    </div>
  )
}
