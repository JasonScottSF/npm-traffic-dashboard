import React from 'react'
import ReactDOM from 'react-dom/client'
import axios from 'axios'
import App from './App'
import { TZProvider } from './contexts/TZContext'
import './index.css'

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
    <TZProvider>
      <App />
    </TZProvider>
  </React.StrictMode>
)
