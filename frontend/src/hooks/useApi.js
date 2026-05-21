import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

const BASE = '/api'

export function useApi(endpoint, params = {}, refreshMs = 0) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const key = endpoint + JSON.stringify(params)

  const fetch = useCallback(async () => {
    try {
      const res = await axios.get(`${BASE}${endpoint}`, { params })
      setData(res.data)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [key])

  useEffect(() => {
    setLoading(true)
    setData(null)
    fetch()
    if (refreshMs > 0) {
      const id = setInterval(fetch, refreshMs)
      return () => clearInterval(id)
    }
  }, [fetch, refreshMs])

  return { data, loading, error, refetch: fetch }
}
