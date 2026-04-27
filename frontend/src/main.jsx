import React from 'react'
import ReactDOM from 'react-dom/client'
import axios from 'axios'
import App from './App'
import { TZProvider } from './contexts/TZContext'
import { ThemeProvider } from './contexts/ThemeContext'
import './index.css'

// Apply theme class before first render to avoid flash of wrong theme
;(function () {
  const saved = localStorage.getItem('dashboard_theme')
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const theme = saved || (prefersDark ? 'dark' : 'light')
  document.documentElement.classList.add(theme)
})()

// Redirect to login if session expires mid-session
axios.interceptors.response.use(
  response => {
    const ct = response.headers['content-type'] || ''
    if (ct.includes('text/html') && !response.config.url?.startsWith('/auth/')) {
      window.location.href = '/auth/login'
      return Promise.reject(new Error('session_expired'))
    }
    return response
  },
  error => {
    if (error.response?.status === 401) {
      window.location.href = '/auth/login'
    }
    return Promise.reject(error)
  }
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <TZProvider>
        <App />
      </TZProvider>
    </ThemeProvider>
  </React.StrictMode>
)
