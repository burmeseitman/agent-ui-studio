import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initDaemonConnection } from './services/daemon'
import { applyPlatformClasses } from './services/platform'

const rootElement = document.getElementById('root');

if (rootElement) {
  // In the desktop build the daemon's port and token are only known at runtime,
  // so they are resolved before the first request the app makes.
  applyPlatformClasses();

  initDaemonConnection().finally(() => {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    )
  })
} else {
  console.error('Failed to find root element');
}
