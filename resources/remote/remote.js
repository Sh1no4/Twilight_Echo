;(() => {
  const TOKEN_KEY = 'te_remote_token'

  const pairPanel = document.getElementById('pair-panel')
  const playerPanel = document.getElementById('player-panel')
  const pairForm = document.getElementById('pair-form')
  const pinInput = document.getElementById('pin-input')
  const pairError = document.getElementById('pair-error')
  const cmdError = document.getElementById('cmd-error')
  const statusChip = document.getElementById('status-chip')
  const titleEl = document.getElementById('title')
  const artistEl = document.getElementById('artist')
  const albumEl = document.getElementById('album')
  const posEl = document.getElementById('pos')
  const durEl = document.getElementById('dur')
  const seekEl = document.getElementById('seek')
  const volumeEl = document.getElementById('volume')
  const liveBadge = document.getElementById('live-badge')
  const castLine = document.getElementById('cast-line')
  const btnPrev = document.getElementById('btn-prev')
  const btnPlay = document.getElementById('btn-play')
  const btnNext = document.getElementById('btn-next')

  let token = localStorage.getItem(TOKEN_KEY) || ''
  let eventSource = null
  let seeking = false
  let state = {
    state: 'stopped',
    title: '',
    artist: '',
    album: '',
    position: 0,
    duration: 0,
    volume: 0.7,
    muted: false,
    isLive: false,
    castTarget: null
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0))
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  function setChip(text, ok) {
    statusChip.textContent = text
    statusChip.classList.toggle('ok', Boolean(ok))
  }

  function showError(el, message) {
    if (!message) {
      el.hidden = true
      el.textContent = ''
      return
    }
    el.hidden = false
    el.textContent = message
  }

  function authHeaders() {
    return token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : {}
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...authHeaders()
      }
    })
    const text = await response.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = { error: text }
    }
    if (!response.ok) {
      const err = new Error((body && body.error) || `HTTP ${response.status}`)
      err.status = response.status
      err.body = body
      throw err
    }
    return body
  }

  function applyState(next) {
    state = { ...state, ...next }
    titleEl.textContent = state.title || '未在播放'
    artistEl.textContent = state.artist || '—'
    albumEl.textContent = state.album || ''
    posEl.textContent = formatTime(state.position)
    durEl.textContent = state.isLive ? 'LIVE' : formatTime(state.duration)
    liveBadge.hidden = !state.isLive
    btnPlay.textContent = state.state === 'playing' ? '⏸' : '▶'
    if (!seeking && !state.isLive) {
      const max = Math.max(1, state.duration || 1)
      seekEl.value = String(Math.round((Math.min(state.position, max) / max) * 1000))
      seekEl.disabled = false
    }
    if (state.isLive) {
      seekEl.value = '0'
      seekEl.disabled = true
    }
    volumeEl.value = String(Math.round((state.muted ? 0 : state.volume) * 100))
    if (state.castTarget) {
      castLine.hidden = false
      castLine.textContent = `投送中：${state.castTarget}`
    } else {
      castLine.hidden = true
      castLine.textContent = ''
    }
  }

  function disconnectEvents() {
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
  }

  function connectEvents() {
    disconnectEvents()
    if (!token) return
    const url = `/api/events?token=${encodeURIComponent(token)}`
    eventSource = new EventSource(url)
    eventSource.addEventListener('state', (event) => {
      try {
        applyState(JSON.parse(event.data))
        setChip('已连接', true)
      } catch {
        // ignore bad payloads
      }
    })
    eventSource.addEventListener('auth', () => {
      clearSession('配对已失效，请重新输入 PIN')
    })
    eventSource.addEventListener('ping', () => {
      setChip('已连接', true)
    })
    eventSource.onerror = () => {
      setChip('重连中…', false)
    }
  }

  function enterPaired() {
    pairPanel.hidden = true
    playerPanel.hidden = false
    setChip('已连接', true)
    connectEvents()
    api('/api/state')
      .then(applyState)
      .catch(() => {})
  }

  function clearSession(message) {
    token = ''
    localStorage.removeItem(TOKEN_KEY)
    disconnectEvents()
    pairPanel.hidden = false
    playerPanel.hidden = true
    setChip('未连接', false)
    showError(pairError, message || '')
  }

  async function sendCommand(body) {
    showError(cmdError, '')
    try {
      await api('/api/command', {
        method: 'POST',
        body: JSON.stringify(body)
      })
    } catch (error) {
      if (error.status === 401) {
        clearSession('会话已过期，请重新配对')
        return
      }
      showError(cmdError, error.message || '命令失败')
    }
  }

  pairForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    showError(pairError, '')
    const pin = pinInput.value.trim()
    try {
      const result = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin })
      }).then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
        return body
      })
      token = result.token
      localStorage.setItem(TOKEN_KEY, token)
      pinInput.value = ''
      enterPaired()
    } catch (error) {
      showError(pairError, error.message === 'invalid_pin' ? 'PIN 错误' : error.message)
    }
  })

  btnPrev.addEventListener('click', () => sendCommand({ action: 'previous' }))
  btnNext.addEventListener('click', () => sendCommand({ action: 'next' }))
  btnPlay.addEventListener('click', () => sendCommand({ action: 'playPause' }))

  seekEl.addEventListener('pointerdown', () => {
    seeking = true
  })
  seekEl.addEventListener('pointerup', () => {
    seeking = false
  })
  seekEl.addEventListener('change', () => {
    if (state.isLive) return
    const ratio = Number(seekEl.value) / 1000
    const positionSeconds = ratio * (state.duration || 0)
    void sendCommand({ action: 'seek', positionSeconds })
    seeking = false
  })

  volumeEl.addEventListener('change', () => {
    const volume = Number(volumeEl.value) / 100
    void sendCommand({ action: 'setVolume', volume })
  })

  // Bootstrap
  fetch('/api/status')
    .then((r) => r.json())
    .then((status) => {
      if (token && status.paired) {
        enterPaired()
      } else if (token && !status.paired) {
        clearSession('')
      } else {
        setChip(status.paired ? '等待配对' : '未连接', false)
      }
    })
    .catch(() => setChip('离线', false))
})()
