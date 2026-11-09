/* CRM Extension Hub — educational dashboard
 * Plain vanilla JS, no dependencies. Fetches endpoint metadata and live
 * config from the same Express server, renders cards, and lets learners
 * copy URLs, send sample payloads, and flip the async delay. */

const origin = window.location.origin
const PATTERN_LABEL = {
  'sync-external-hook': 'Sync External Hook',
  'async-autoflow': 'Async AutoFlow',
  'sync-ui-extension': 'UI Extension',
  'mashup-ui': 'Mashup',
  'signals-api': 'Signals API'
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
    const { asyncScoreDelayMs, tenant } = await res.json()
    markActiveToggle(asyncScoreDelayMs)
    if (tenant) renderTenantStatus(tenant)
  } catch { /* ignore */ }
}

// --- temporary tenant override --------------------------------------------
// Mirrors the delay toggle: talks to the same /api/config channel. The server
// only ever returns host + flags (never the credentials), and auto-reverts to
// the default host after 15 minutes.

let tenantCountdownTimer = null

function fmtRemaining(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = String(Math.floor(total / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

function renderTenantStatus(tenant) {
  const originNode = document.getElementById('tenant-origin')
  const badge = document.getElementById('tenant-badge')
  const defaultHost = document.getElementById('tenant-default-host')
  if (defaultHost) defaultHost.textContent = tenant.defaultBaseUrl || '(unknown)'
  if (originNode) originNode.textContent = tenant.baseUrl || '(unknown)'

  if (tenantCountdownTimer) { clearInterval(tenantCountdownTimer); tenantCountdownTimer = null }

  if (!badge) return
  if (tenant.isOverridden && tenant.expiresAt) {
    badge.classList.remove('tenant-default')
    badge.classList.add('tenant-temp')
    const tick = () => {
      const left = tenant.expiresAt - Date.now()
      if (left <= 0) {
        clearInterval(tenantCountdownTimer); tenantCountdownTimer = null
        loadConfig() // confirm server-side revert and repaint
        return
      }
      badge.textContent = `temporary · ${fmtRemaining(left)} left`
    }
    tick()
    tenantCountdownTimer = setInterval(tick, 1000)
  } else {
    badge.classList.remove('tenant-temp')
    badge.classList.add('tenant-default')
    badge.textContent = 'default'
  }
}

function setTenantStatusMsg(msg, isError) {
  const node = document.getElementById('tenant-status')
  if (!node) return
  node.textContent = msg || ''
  node.classList.toggle('pm-status-warn', !!isError)
}

async function activateTenant() {
  const baseUrl = document.getElementById('tenant-baseurl').value.trim()
  const username = document.getElementById('tenant-username').value.trim()
  const password = document.getElementById('tenant-password').value
  if (!baseUrl || !username || !password) {
    setTenantStatusMsg('Please fill in Base URL, Username and Password.', true)
    return
  }
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant: { baseUrl, username, password } })
    })
    const body = await res.json()
    if (!res.ok) {
      setTenantStatusMsg(body.error || 'Activation failed.', true)
      return
    }
    setTenantStatusMsg(`✅ Override active — pointing at ${body.tenant.baseUrl}`, false)
    renderTenantStatus(body.tenant)
  } catch (err) {
    setTenantStatusMsg('Request failed: ' + err, true)
  }
}

async function deactivateTenant() {
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant: null })
    })
    const body = await res.json()
    if (!res.ok) {
      setTenantStatusMsg(body.error || 'Deactivation failed.', true)
      return
    }
    setTenantStatusMsg(`🔄 Back to default host — ${body.tenant.baseUrl}`, false)
    renderTenantStatus(body.tenant)
  } catch (err) {
    setTenantStatusMsg('Request failed: ' + err, true)
  }
}

// --- tenant modal ----------------------------------------------------------
// The pencil button in the header opens a modal dialog containing the tenant
// override controls (demo-only). All the IDs inside the modal are the same ones
// renderTenantStatus/activateTenant/deactivateTenant already use.

let tenantModalLastFocus = null

function openTenantModal() {
  const modal = document.getElementById('tenant-modal')
  if (!modal) return
  tenantModalLastFocus = document.activeElement
  modal.hidden = false
  const firstInput = document.getElementById('tenant-baseurl')
  if (firstInput) firstInput.focus()
}

function closeTenantModal() {
  const modal = document.getElementById('tenant-modal')
  if (!modal || modal.hidden) return
  modal.hidden = true
  if (tenantModalLastFocus && typeof tenantModalLastFocus.focus === 'function') {
    tenantModalLastFocus.focus()
  }
  tenantModalLastFocus = null
}

function initTenantControl() {
  const activate = document.getElementById('tenant-activate')
  const deactivate = document.getElementById('tenant-deactivate')
  if (activate) activate.addEventListener('click', activateTenant)
  if (deactivate) deactivate.addEventListener('click', deactivateTenant)

  // Pencil button in the header opens the tenant modal.
  const edit = document.getElementById('tenant-edit')
  if (edit) {
    edit.addEventListener('click', ev => {
      ev.preventDefault()
      openTenantModal()
    })
  }

  const modal = document.getElementById('tenant-modal')
  const closeBtn = document.getElementById('tenant-modal-close')
  if (closeBtn) closeBtn.addEventListener('click', closeTenantModal)
  if (modal) {
    // Click on the backdrop (outside the dialog) closes the modal.
    modal.addEventListener('click', ev => {
      if (ev.target === modal) closeTenantModal()
    })
  }
  // Escape closes the modal.
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') closeTenantModal()
  })
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
  if (ep.anchor) card.id = ep.anchor

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
// routingKey: 'case' or 'guidedselling'. getObjectKey returns the user-entered id.
function buildPostMessageRow(label, routingKey, getObjectKey, statusNode) {
  const row = el('div', { class: 'pm-row' })

  // Create — quick create view (no objectKey needed)
  const createBtn = el('button', { class: 'pm-btn', text: `Create ${label}` })
  createBtn.addEventListener('click', () => sendPostMessage(
    { operation: 'navigation', params: { routingKey, viewType: 'quickcreate' } }, statusNode
  ))

  // List — list view (no objectKey needed)
  const listBtn = el('button', { class: 'pm-btn', text: `List ${label}s` })
  listBtn.addEventListener('click', () => sendPostMessage(
    { operation: 'navigation', params: { routingKey, viewType: 'list' } }, statusNode
  ))

  // View — side-panel quick view (needs objectKey)
  const viewBtn = el('button', { class: 'pm-btn', text: `View ${label}` })
  viewBtn.addEventListener('click', () => {
    const objectKey = getObjectKey()
    if (!objectKey) {
      statusNode.textContent = `Enter a ${label} objectKey first to use "View ${label}".`
      statusNode.classList.add('pm-status-warn')
      return
    }
    sendPostMessage(
      { operation: 'navigation', params: { objectKey, routingKey, viewType: 'quickview' } }, statusNode
    )
  })

  // Open — full details page (needs objectKey)
  const openBtn = el('button', { class: 'pm-btn', text: `Open ${label}` })
  openBtn.addEventListener('click', () => {
    const objectKey = getObjectKey()
    if (!objectKey) {
      statusNode.textContent = `Enter a ${label} objectKey first to use "Open ${label}".`
      statusNode.classList.add('pm-status-warn')
      return
    }
    sendPostMessage(
      { operation: 'navigation', params: { objectKey, routingKey, viewType: 'details' } }, statusNode
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
  if (ep.anchor) card.id = ep.anchor

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

// --- signals API card ------------------------------------------------------
// The APIs section's single example. Unlike the webhook cards, this does NOT
// get called by SSC V2 — the browser posts the user's inputs to our own
// /api/signals proxy, which forwards an authenticated POST to the CRM's
// Insights Signals API. Reuses the .pm-input / .pm-btn / .result styling.

function buildSignalsCard(ep) {
  const card = el('article', { class: 'card' })
  if (ep.anchor) card.id = ep.anchor

  // Head — no HTTP method badge, just the title + Signals API badge
  card.appendChild(el('div', { class: 'card-head' }, [
    el('h3', { text: ep.title }),
    el('span', { class: `badge ${ep.pattern}`, text: PATTERN_LABEL[ep.pattern] || ep.pattern })
  ]))

  const summary = el('p', { class: 'summary muted', text: ep.summary })
  if (ep.docUrl) {
    summary.appendChild(document.createTextNode(' Full API reference & Swagger: '))
    summary.appendChild(el('a', { href: ep.docUrl, target: '_blank', rel: 'noopener', text: 'api.sap.com' }))
    summary.appendChild(document.createTextNode('.'))
  }
  card.appendChild(summary)

  // CRM API path this proxy forwards to (read-only, with copy button)
  if (ep.apiPath) {
    card.appendChild(el('p', { class: 'field-label', text: 'CRM API path (called by this service):' }))
    const copyBtn = el('button', { class: 'copy-btn', text: 'Copy' })
    copyBtn.addEventListener('click', () => copyText(ep.apiPath, copyBtn))
    card.appendChild(el('div', { class: 'url-row' }, [
      el('code', { text: ep.apiPath }),
      copyBtn
    ]))
  }

  // Sample payload (pretty-printed) so learners see the full shape being sent.
  card.appendChild(el('p', { class: 'field-label', text: 'Sample payload:' }))
  card.appendChild(el('pre', { class: 'json' }, el('code', { text: JSON.stringify(ep.sample, null, 2) })))

  // Input fields — Account UUID, message, score (prefilled from the sample).
  const sample = ep.sample || {}
  const wrap = el('div', { class: 'pm-demo' })
  wrap.appendChild(el('strong', { text: 'Post a signal' }))
  wrap.appendChild(el('p', { class: 'muted tiny', text:
    'Paste an account UUID, optionally tweak the message and score, then post the signal. It will appear in that account\u2019s 360 view.'
  }))

  const accountInput = el('input', { class: 'pm-input', type: 'text',
    placeholder: 'Account UUID (e.g. 01a15933-bbd8-7aac-885b-2dcb03548680)' })
  const messageInput = el('input', { class: 'pm-input', type: 'text', value: sample.message || '' })
  const scoreInput = el('input', { class: 'pm-input', type: 'number', value: sample.score ?? 70 })

  const group = el('div', { class: 'pm-group' })
  group.appendChild(el('div', { class: 'pm-input-row' }, [
    el('label', { class: 'pm-input-label', text: 'Account UUID:' }), accountInput
  ]))
  group.appendChild(el('div', { class: 'pm-input-row' }, [
    el('label', { class: 'pm-input-label', text: 'Message:' }), messageInput
  ]))
  group.appendChild(el('div', { class: 'pm-input-row' }, [
    el('label', { class: 'pm-input-label', text: 'Score:' }), scoreInput
  ]))
  wrap.appendChild(group)

  const result = el('div', { class: 'result' })
  const postBtn = el('button', { class: 'pm-btn', text: 'Post Signal' })
  postBtn.addEventListener('click', () => postSignal({
    accountId: accountInput.value.trim(),
    message: messageInput.value.trim(),
    score: scoreInput.value
  }, postBtn, result))

  wrap.appendChild(el('div', { class: 'pm-row' }, [postBtn]))
  card.appendChild(wrap)
  card.appendChild(result)

  // Setup steps (same collapsible component as the other cards)
  const details = el('details', { class: 'setup' })
  details.appendChild(el('summary', { text: 'How to use this' }))
  const ol = el('ol')
  ep.setupSteps.forEach(step => ol.appendChild(el('li', { text: step })))
  details.appendChild(ol)
  card.appendChild(details)

  return card
}

// Sends the signal via our own /api/signals proxy and renders the response.
async function postSignal(body, btn, result) {
  if (!body.accountId) {
    result.innerHTML = ''
    result.appendChild(el('div', { class: 'meta' }, el('span', { class: 'status-bad', text: 'Enter an Account UUID first.' })))
    result.classList.add('show')
    return
  }
  btn.disabled = true
  const label = btn.textContent
  btn.textContent = 'Posting\u2026'
  const started = performance.now()
  try {
    const res = await fetch('/api/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const ms = Math.round(performance.now() - started)
    let bodyText
    try { bodyText = JSON.stringify(await res.json(), null, 2) }
    catch { bodyText = await res.text() }

    result.innerHTML = ''
    const statusClass = res.ok ? 'status-ok' : 'status-bad'
    const meta = el('div', { class: 'meta' })
    meta.appendChild(el('span', { class: statusClass, text: `${res.status} ${res.statusText}` }))
    meta.appendChild(document.createTextNode(` \u00b7 ${ms} ms round-trip`))
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

// Builds a self-contained group: one objectKey input row followed directly by
// its Create / List / View / Open button row, wrapped in a .pm-group box.
// Reuses buildPostMessageRow so the button behaviour stays identical.
function buildPostMessageGroup(label, routingKey, placeholder, statusNode) {
  const group = el('div', { class: 'pm-group' })

  const input = el('input', { class: 'pm-input', type: 'text', placeholder })
  group.appendChild(el('div', { class: 'pm-input-row' }, [
    el('label', { class: 'pm-input-label', text: `${label} objectKey:` }),
    input
  ]))

  group.appendChild(buildPostMessageRow(label, routingKey, () => input.value.trim(), statusNode))
  return group
}

function buildPostMessageDemo() {
  const wrap = el('div', { class: 'pm-demo' })
  wrap.appendChild(el('strong', { text: 'Interact with the CRM shell (window.postMessage)' }))
  wrap.appendChild(el('p', { class: 'muted tiny', text:
    'These buttons send a navigation message to the overlaying SSC V2 application via window.parent.postMessage. "View" opens the record in a side panel (quickview); "Open" navigates to the full details page. Both need a objectKey from one of your own records.'
  }))

  const status = el('p', { class: 'pm-status muted tiny', text: 'No message sent yet.' })

  // One group per entity — the button row sits directly under its input.
  wrap.appendChild(buildPostMessageGroup('Account', 'mdaccount', 'Account UUID (e.g. 0197a1ea-08ef-7ddd-a4c2-b7df1fc1c5b9)', status))
  wrap.appendChild(buildPostMessageGroup('Case', 'case', 'Case UUID (e.g. 0197a1ea-08ef-7ddd-a4c2-b7df1fc1c5b9)', status))
  wrap.appendChild(buildPostMessageGroup('Opportunity', 'guidedselling', 'Opportunity UUID (e.g. 0197a1ea-08ef-7ddd-a4c2-b7df1fc1c5b9)', status))

  // Other — standalone actions that aren't tied to an entity/objectKey.
  const otherGroup = el('div', { class: 'pm-group' })
  otherGroup.appendChild(el('div', { class: 'pm-input-row' }, [
    el('label', { class: 'pm-input-label', text: 'Other:' })
  ]))
  const refreshRow = el('div', { class: 'pm-row' })
  const refreshBtn = el('button', { class: 'pm-btn', text: 'Refresh Case' })
  refreshBtn.addEventListener('click', () => sendPostMessage(
    { event: 'refreshEvent', operation: 'triggerMashupEvent' }, status
  ))
  refreshRow.appendChild(refreshBtn)
  otherGroup.appendChild(refreshRow)
  wrap.appendChild(otherGroup)

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

// --- section nav (scroll-spy + smooth scroll) ------------------------------
// The sticky top bar highlights the use case currently in view and smooth-
// scrolls to a section on click. Init runs AFTER the cards are rendered so the
// anchor targets (card ids) actually exist in the DOM.

function initSectionNav() {
  const nav = document.getElementById('section-nav')
  if (!nav) return

  const links = Array.from(nav.querySelectorAll('a[data-target]'))
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // Map target id -> nav link, and collect the sections that actually exist.
  const linkByTarget = new Map()
  const sections = []
  links.forEach(link => {
    const target = document.getElementById(link.dataset.target)
    if (!target) return
    linkByTarget.set(target.id, link)
    sections.push(target)
  })
  if (!sections.length) return

  function setActive(id) {
    links.forEach(l => l.classList.toggle('active', l.dataset.target === id))
  }

  // Smooth-scroll on click (respecting reduced-motion), and set active early.
  links.forEach(link => {
    link.addEventListener('click', ev => {
      const target = document.getElementById(link.dataset.target)
      if (!target) return
      ev.preventDefault()
      setActive(link.dataset.target)
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
      history.replaceState(null, '', '#' + link.dataset.target)
    })
  })

  // Scroll-spy: highlight whichever tracked section is nearest the top.
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => { entry.target.dataset.inView = entry.isIntersecting ? '1' : '' })
    const visible = sections
      .filter(s => s.dataset.inView)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
    if (visible.length) setActive(visible[0].id)
  }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 })

  sections.forEach(s => observer.observe(s))
  setActive(sections[0].id)
}

async function loadEndpoints() {
  const container = document.getElementById('endpoints')
  try {
    const res = await fetch('endpoints.json')
    const { endpoints } = await res.json()
    const mashupMount = document.getElementById('mashup-section')
    const apisMount = document.getElementById('apis-section')
    endpoints.forEach(ep => {
      if (ep.kind === 'mashup') {
        mashupMount.appendChild(buildMashupCard(ep))
      } else if (ep.kind === 'api') {
        if (apisMount) apisMount.appendChild(buildSignalsCard(ep))
      } else {
        container.appendChild(buildCard(ep))
      }
    })
    // Mark the active delay toggle now that the control has been rendered
    await loadConfig()
    // Cards exist now — wire up the sticky section nav (scroll-spy + smooth scroll)
    initSectionNav()
  } catch (err) {
    container.appendChild(el('p', { class: 'muted', text: 'Could not load endpoints: ' + err }))
  }
}

// --- boot ------------------------------------------------------------------

refreshHealth()
setInterval(refreshHealth, 15000)
initTenantControl()
loadConfig()
// Keep the tenant host/badge in sync (e.g. after a 15-min auto-revert)
setInterval(loadConfig, 15000)
loadEndpoints()

