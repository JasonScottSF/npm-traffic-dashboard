import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'

const BASE = '/api'

export function useApi(endpoint, params = {}, refreshMs = 0) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // Stable ref to the latest abort controller so refetch() can use it
  const controllerRef = useRef(null)

  const key = endpoint + JSON.stringify(params)

  useEffect(() => {
    const controller = new AbortController()
    controllerRef.current = controller
    let intervalId

    const doFetch = async () => {
      try {
        const res = await axios.get(`${BASE}${endpoint}`, {
          params,
          signal: controller.signal,
        })
        setData(res.data)
        setError(null)
      } catch (e) {
        // Ignore cancellation — it's intentional when params change
        if (!axios.isCancel(e) && e.name !== 'CanceledError') {
          setError(e.message)
        }
      } finally {
        setLoading(false)
      }
    }

    setLoading(true)
    setData(null)
    doFetch()

    if (refreshMs > 0) {
      intervalId = setInterval(doFetch, refreshMs)
    }

    return () => {
      controller.abort()
      if (intervalId) clearInterval(intervalId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshMs])

  // Manual refetch without changing params
  const refetch = useCallback(async () => {
    try {
      const res = await axios.get(`${BASE}${endpoint}`, { params })
      setData(res.data)
      setError(null)
    } catch (e) {
      if (!axios.isCancel(e) && e.name !== 'CanceledError') setError(e.message)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { data, loading, error, refetch }
}
