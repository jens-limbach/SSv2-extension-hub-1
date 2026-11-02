/* CRM Extension Hub — educational dashboard
 * Plain vanilla JS, no dependencies. Fetches endpoint metadata and live
 * config from the same Express server, renders cards, and lets learners
 * copy URLs, send sample payloads, and flip the async delay. */

const origin = window.location.origin
const PATTERN_LABEL = {
  'sync-external-hook': 'Sync External Hook',
  'async-autoflow': 'Async AutoFlow',
  'sync-ui-extension': 'UI Extension',
  'mashup-ui': 'Mashup'
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

  // Full endpoint (hostname + path) — use this for testing
  card.appendChild(el('p', { class: 'field-label', text: 'Endpoint:' }))
  const copyBtn = el('button', { class: 'copy-btn', text: 'Copy' })
  copyBtn.addEventListener('click', () => copyText(fullUrl, copyBtn))
  card.appendChild(el('div', { class: 'url-row' }, [
    el('code', { text: fullUrl }),
    copyBtn
  ]))

  // Path only — this is what you paste into SSC V2 step-by-step configuration
  card.appendChild(el('p', { class: 'field-label', text: 'Path:' }))
  const copyPathBtn = el('button', { class: 'copy-btn', text: 'Copy' })
  copyPathBtn.addEventListener('click', () => copyText(ep.path, copyPathBtn))
  card.appendChild(el('div', { class: 'url-row' }, [
    el('code', { text: ep.path }),
    copyPathBtn
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

// --- mashup card -----------------------------------------------------------
// The mashup use case reuses this same page embedded as an iFrame. It differs
// from the webhook cards: no Try it / sample payload / path / responds. Instead
// it shows an endpoint with example query params, echoes the GET parameters it
// actually received, and offers window.postMessage navigation buttons so you
// can test talking back to the surrounding CRM shell.

// Posts a navigation message to the parent CRM shell and echoes it locally.
function sendPostMessage(payload, statusNode) {
  try {
    window.parent.postMessage(payload, '*')
    if (statusNode) {
      statusNode.textContent = 'Sent: ' + JSON.stringify(payload)
      statusNode.classList.remove('pm-status-warn')
    }
  } catch (err) {
    if (statusNode) {
      statusNode.textContent = 'postMessage failed: ' + String(err)
      statusNode.classList.add('pm-status-warn')
    }
  }
}

// Builds one row of navigation buttons for a given entity (Case / Opportunity).
// routingKey: 'case' or 'guidedselling'. getDisplayId returns the user-entered id.
function buildPostMessageRow(label, routingKey, getDisplayId, statusNode) {
  const row = el('div', { class: 'pm-row' })
  row.appendChild(el('span', { class: 'pm-row-label', text: label }))

  // Create — quick create view (no displayId needed)
  const createBtn = el('button', { class: 'pm-btn', text: `Create ${label}` })
  createBtn.addEventListener('click', () => sendPostMessage(
    { operation: 'navigation', params: { routingKey, viewType: 'quickcreate' } }, statusNode
  ))

  // List — list view (no displayId needed)
  const listBtn = el('button', { class: 'pm-btn', text: `List ${label}s` })
  listBtn.addEventListener('click', () => sendPostMessage(
    { operation: 'navigation', params: { routingKey, viewType: 'list' } }, statusNode
  ))

  // View — side-panel quick view (needs displayId)
  const viewBtn = el('button', { class: 'pm-btn', text: `View ${label}` })
  viewBtn.addEventListener('click', () => {
    const displayId = getDisplayId()
    if (!displayId) {
      statusNode.textContent = `Enter a ${label} displayId first to use "View ${label}".`
      statusNode.classList.add('pm-status-warn')
      return
    }
    sendPostMessage(
      { operation: 'navigation', params: { displayId, routingKey, viewType: 'quickview' } }, statusNode
    )
  })

  // Open — full details page (needs displayId)
  const openBtn = el('button', { class: 'pm-btn', text: `Open ${label}` })
  openBtn.addEventListener('click', () => {
    const displayId = getDisplayId()
    if (!displayId) {
      statusNode.textContent = `Enter a ${label} displayId first to use "Open ${label}".`
      statusNode.classList.add('pm-status-warn')
      return
    }
    sendPostMessage(
      { operation: 'navigation', params: { displayId, routingKey, viewType: 'details' } }, statusNode
    )
  })

  row.appendChild(createBtn)
  row.appendChild(listBtn)
  row.appendChild(viewBtn)
  row.appendChild(openBtn)
  return row
}

function buildMashupCard(ep) {
  const card = el('article', { class: 'card' })

  // Head — no HTTP method for a mashup, just the title + Mashup badge
  card.appendChild(el('div', { class: 'card-head' }, [
    el('h3', { text: ep.title }),
    el('span', { class: `badge ${ep.pattern}`, text: PATTERN_LABEL[ep.pattern] || ep.pattern })
  ]))

  const summary = el('p', { class: 'summary muted', text: ep.summary })
  if (ep.routingKeysDocUrl) {
    summary.appendChild(document.createTextNode(' All supported entities you can find in the '))
    summary.appendChild(el('a', { href: ep.routingKeysDocUrl, target: '_blank', rel: 'noopener', text: 'documentation' }))
    summary.appendChild(document.createTextNode(' for the routing keys.'))
  }
  card.appendChild(summary)

  // Endpoint = hostname + example query parameters (no path / responds / try it)
  const params = ep.exampleParams || {}
  const query = new URLSearchParams(params).toString()
  const endpointUrl = query ? `${origin}?${query}` : origin
  card.appendChild(el('p', { class: 'field-label', text: 'Endpoint (with example parameters):' }))
  const copyBtn = el('button', { class: 'copy-btn', text: 'Copy' })
  copyBtn.addEventListener('click', () => copyText(endpointUrl, copyBtn))
  card.appendChild(el('div', { class: 'url-row' }, [
    el('code', { text: endpointUrl }),
    copyBtn
  ]))

  // Live parameters — reflects whatever GET params this page was opened with
  card.appendChild(buildLiveParams(params))

  // window.postMessage demo — unique to the mashup card
  card.appendChild(buildPostMessageDemo())

  // Setup steps (same collapsible component as the other cards)
  const details = el('details', { class: 'setup' })
  details.appendChild(el('summary', { text: 'How to set this up in SAP Sales and Service Cloud V2' }))
  const ol = el('ol')
  ep.setupSteps.forEach(step => ol.appendChild(el('li', { text: step })))
  details.appendChild(ol)
  card.appendChild(details)

  return card
}

// Reads the current URL's query string and displays the two parameters live.
// exampleParams is used only to know which parameter names to look for.
function buildLiveParams(exampleParams) {
  const wrap = el('div', { class: 'live-params' })
  wrap.appendChild(el('strong', { text: 'Received parameters (live from this URL)' }))
  wrap.appendChild(el('p', { class: 'muted tiny', text:
    'When this page is embedded as a mashup, SSC V2 appends context as GET parameters. The values below update to reflect whatever this page was actually opened with.'
  }))

  const search = new URLSearchParams(window.location.search)
  const names = Object.keys(exampleParams || {})
  if (names.length === 0) names.push('parameter1', 'parameter2')
  const dl = el('dl', { class: 'param-list' })

  let anyReceived = false
  names.forEach(name => {
    const value = search.get(name)
    if (value !== null) anyReceived = true
    dl.appendChild(el('dt', { text: name }))
    dl.appendChild(el('dd', value !== null
      ? { text: value }
      : { class: 'param-missing', text: '— not transmitted —' }))
  })
  wrap.appendChild(dl)

  if (!anyReceived) {
    wrap.appendChild(el('p', { class: 'muted tiny', text:
      'No parameters received yet. Try opening this page with, e.g., ?parameter1=value1&parameter2=value2 — or let SSC V2 supply them once the mashup is configured.'
    }))
  }
  return wrap
}

function buildPostMessageDemo() {
  const wrap = el('div', { class: 'pm-demo' })
  wrap.appendChild(el('strong', { text: 'Interact with the CRM shell (window.postMessage)' }))
  wrap.appendChild(el('p', { class: 'muted tiny', text:
    'These buttons send a navigation message to the overlaying SSC V2 application via window.parent.postMessage. "View" opens the record in a side panel (quickview); "Open" navigates to the full details page. Both need a displayId from one of your own records.'
  }))

  // Case displayId input
  const caseInput = el('input', { class: 'pm-input', type: 'text', placeholder: 'Case displayId (e.g. 45)' })
  wrap.appendChild(el('div', { class: 'pm-input-row' }, [
    el('label', { class: 'pm-input-label', text: 'Case displayId:' }),
    caseInput
  ]))

  // Opportunity displayId input
  const oppInput = el('input', { class: 'pm-input', type: 'text', placeholder: 'Opportunity displayId (e.g. 2000042)' })
  wrap.appendChild(el('div', { class: 'pm-input-row' }, [
    el('label', { class: 'pm-input-label', text: 'Opportunity displayId:' }),
    oppInput
  ]))

  const status = el('p', { class: 'pm-status muted tiny', text: 'No message sent yet.' })

  // Row 1 — Case (routingKey: case)
  wrap.appendChild(buildPostMessageRow('Case', 'case', () => caseInput.value.trim(), status))
  // Row 2 — Opportunity (routingKey: guidedselling)
  wrap.appendChild(buildPostMessageRow('Opportunity', 'guidedselling', () => oppInput.value.trim(), status))

  wrap.appendChild(status)
  return wrap
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
    container.appendChild(el('h2', { text: `🔗 Use Cases (endpoints) (${endpoints.length})` }))
    endpoints.forEach(ep => container.appendChild(
      ep.kind === 'mashup' ? buildMashupCard(ep) : buildCard(ep)
    ))
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

