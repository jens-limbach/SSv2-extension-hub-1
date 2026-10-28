/* CRM Extension Hub — educational dashboard
 * Plain vanilla JS, no dependencies. Fetches endpoint metadata and live
 * config from the same Express server, renders cards, and lets learners
 * copy URLs, send sample payloads, and flip the async delay. */

const origin = window.location.origin
const PATTERN_LABEL = {
  'sync-external-hook': 'Sync External Hook',
  'async-autoflow': 'Async AutoFlow',
  'sync-ui-extension': 'UI Extension'
}

// --- helpers ---------------------------------------------------------------

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else if (k === 'text') node.textContent = v
    else node.setAttribute(k, v)
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text)
    const original = btn.textContent
    btn.textContent = 'Copied ✓'
    setTimeout(() => { btn.textContent = original }, 1200)
  } catch {
    btn.textContent = 'Copy failed'
  }
}

// --- host + health ---------------------------------------------------------

document.getElementById('host-origin').textContent = origin

// Populate the one-time setup section's host name + copy button
const setupHost = document.getElementById('setup-host')
if (setupHost) setupHost.textContent = origin
const setupHostCopy = document.getElementById('setup-host-copy')
if (setupHostCopy) setupHostCopy.addEventListener('click', () => copyText(origin, setupHostCopy))

async function refreshHealth() {
  const node = document.getElementById('health')
  try {
    const res = await fetch('/health')
    const body = await res.json()
    node.textContent = res.ok ? `🟢 ${body.status} · ${new Date(body.timestamp).toLocaleTimeString()}` : '🔴 unhealthy'
  } catch {
    node.textContent = '🔴 unreachable'
  }
}

// --- delay toggle ----------------------------------------------------------

function markActiveToggle(delay) {
  document.querySelectorAll('.toggle-btn').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.delay) === delay)
  })
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config')
    const { asyncScoreDelayMs } = await res.json()
    markActiveToggle(asyncScoreDelayMs)
  } catch { /* ignore */ }
}

async function setDelay(delay) {
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asyncScoreDelayMs: delay })
    })
    const { asyncScoreDelayMs } = await res.json()
    markActiveToggle(asyncScoreDelayMs)
  } catch { /* ignore */ }
}

// Builds the inline delay control shown inside the async score card.
function buildDelayControl() {
  const wrap = el('div', { class: 'delay-control' })
  wrap.appendChild(el('strong', { text: 'Processing delay (live demo)' }))
  wrap.appendChild(el('p', { class: 'muted tiny', text:
    'This webhook simulates a slow background operation. Flip the delay, then hit "Try it" to compare instant vs. slow processing. In-memory & demo-only: resets on restart, affects one instance.'
  }))
  const group = el('div', { class: 'toggle-group' }, [
    el('button', { class: 'toggle-btn', 'data-delay': '10000', text: '10s (slow)' }),
    el('button', { class: 'toggle-btn', 'data-delay': '0', text: '0s (instant)' })
  ])
  group.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => setDelay(Number(btn.dataset.delay)))
  })
  wrap.appendChild(group)
  return wrap
}

// --- endpoint cards --------------------------------------------------------

function buildCard(ep) {
  const fullUrl = origin + ep.path
  const card = el('article', { class: 'card' })

  card.appendChild(el('div', { class: 'card-head' }, [
    el('span', { class: 'method', text: ep.method }),
    el('h3', { text: ep.title }),
    el('span', { class: `badge ${ep.pattern}`, text: PATTERN_LABEL[ep.pattern] || ep.pattern })
  ]))

  card.appendChild(el('p', { class: 'summary muted', text: ep.summary }))

  const copyBtn = el('button', { class: 'copy-btn', text: 'Copy' })
  copyBtn.addEventListener('click', () => copyText(fullUrl, copyBtn))
  card.appendChild(el('div', { class: 'url-row' }, [
    el('code', { text: fullUrl }),
    copyBtn
  ]))

  const note = el('p', { class: 'response-note' })
  note.appendChild(document.createTextNode('Responds: '))
  note.appendChild(el('code', { text: ep.responseNote }))
  card.appendChild(note)

  // Inline live-demo control, only for the async score endpoint
  if (ep.path === '/webhooks/calculate-score-async') {
    card.appendChild(buildDelayControl())
  }

  const result = el('div', { class: 'result' })
  const tryBtn = el('button', { class: 'try-btn', text: 'Try it' })
  tryBtn.addEventListener('click', () => sendSample(ep, fullUrl, tryBtn, result))

  const sampleToggle = el('button', { class: 'toggle-link', text: 'Show sample payload' })
  const samplePre = el('pre', { class: 'json' }, el('code', { text: JSON.stringify(ep.sample, null, 2) }))
  samplePre.style.display = 'none'
  sampleToggle.addEventListener('click', () => {
    const hidden = samplePre.style.display === 'none'
    samplePre.style.display = hidden ? 'block' : 'none'
    sampleToggle.textContent = hidden ? 'Hide sample payload' : 'Show sample payload'
  })

  card.appendChild(el('div', { class: 'card-actions' }, [tryBtn, sampleToggle]))
  card.appendChild(samplePre)
  card.appendChild(result)

  const details = el('details', { class: 'setup' })
  details.appendChild(el('summary', { text: 'How to set this up in SAP Sales and Service Cloud V2' }))
  const ol = el('ol')
  ep.setupSteps.forEach(step => ol.appendChild(el('li', { text: step })))
  details.appendChild(ol)
  card.appendChild(details)

  return card
}

async function sendSample(ep, fullUrl, btn, result) {
  btn.disabled = true
  const label = btn.textContent
  btn.textContent = 'Sending…'
  const started = performance.now()
  try {
    const res = await fetch(fullUrl, {
      method: ep.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ep.sample)
    })
    const ms = Math.round(performance.now() - started)
    let bodyText
    try { bodyText = JSON.stringify(await res.json(), null, 2) }
    catch { bodyText = await res.text() }

    result.innerHTML = ''
    const statusClass = res.ok ? 'status-ok' : 'status-bad'
    const meta = el('div', { class: 'meta' })
    meta.appendChild(el('span', { class: statusClass, text: `${res.status} ${res.statusText}` }))
    meta.appendChild(document.createTextNode(` · ${ms} ms round-trip`))
    result.appendChild(meta)
    result.appendChild(el('pre', { class: 'json' }, el('code', { text: bodyText })))
    result.classList.add('show')
  } catch (err) {
    result.innerHTML = ''
    result.appendChild(el('div', { class: 'meta' }, el('span', { class: 'status-bad', text: 'Request failed' })))
    result.appendChild(el('pre', { class: 'json' }, el('code', { text: String(err) })))
    result.classList.add('show')
  } finally {
    btn.disabled = false
    btn.textContent = label
  }
}

async function loadEndpoints() {
  const container = document.getElementById('endpoints')
  try {
    const res = await fetch('endpoints.json')
    const { endpoints } = await res.json()
    container.appendChild(el('h2', { text: `🔗 Endpoints (${endpoints.length})` }))
    endpoints.forEach(ep => container.appendChild(buildCard(ep)))
    // Mark the active delay toggle now that the control has been rendered
    await loadConfig()
  } catch (err) {
    container.appendChild(el('p', { class: 'muted', text: 'Could not load endpoints: ' + err }))
  }
}

// --- boot ------------------------------------------------------------------

refreshHealth()
setInterval(refreshHealth, 15000)
loadEndpoints()

