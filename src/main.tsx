import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { SettingsProvider } from './lib/settings'
import './index.css'

// Use Vite's base (set via VITE_BASE for GitHub Pages subpath deploys like /repo-name/)
// This makes internal routes (/s3, /dynamodb, etc.) work correctly on project sites.
const basename = import.meta.env.BASE_URL || '/'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
