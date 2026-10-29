import express from 'express'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

// Environment variables
const CRM_BASE_URL = process.env.CRM_BASE_URL
const CRM_USERNAME = process.env.CRM_USERNAME
const CRM_PASSWORD = process.env.CRM_PASSWORD

// Validate environment variables
if (!CRM_BASE_URL || !CRM_USERNAME || !CRM_PASSWORD) {
  console.error('❌ ERROR: Missing required environment variables!')
  console.error('Please ensure the following are set in your .env file:')
  console.error('  - CRM_BASE_URL')
  console.error('  - CRM_USERNAME')
  console.error('  - CRM_PASSWORD')
  process.exit(1)
}

// Create Basic Auth header
const authString = `${CRM_USERNAME}:${CRM_PASSWORD}`
const authHeader = 'Basic ' + Buffer.from(authString).toString('base64')

// Opportunity priority code for "Urgent" — adjust if your tenant uses a different value
const PRIORITY_URGENT = '2'

// Live-adjustable delay (ms) for the async score demo.
// The educational dashboard can flip this between 10000 (slow) and 0 (instant)
// so learners can watch async behaviour change. In-memory only — demo purposes,
// resets on restart and is per-instance.
let asyncScoreDelayMs = 10000

// Middleware
app.use(express.json())

// Serve the educational dashboard (static files in /public) at the root URL
app.use(express.static('public'))

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization')

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  next()
})

// Startup logging
console.log('✅ CRM Extension Hub Configuration:')
console.log(`✅ CRM API configured: ${CRM_BASE_URL}`)
console.log(`✅ Username: ${CRM_USERNAME}`)
console.log('✅ Credentials loaded successfully')

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Makes an authenticated API call to SAP CRM
 */
async function callCrmApi(endpoint, options = {}) {
  const url = `${CRM_BASE_URL}${endpoint}`
  
  const defaultOptions = {
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    }
  }

  try {
    const response = await fetch(url, { 
      ...defaultOptions, 
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...options.headers
      }
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`CRM API Error (${response.status}): ${errorText}`)
    }

    return response
  } catch (error) {
    console.error(`❌ CRM API call failed: ${error.message}`)
    throw error
  }
}

/**
 * Validates webhook payload structure
 */
function validateWebhookPayload(body) {
  if (!body) {
    return { error: 'Request body is empty', field: 'body' }
  }

  // Support CloudEvents format (data wrapper) or direct format
  const data = body.data || body

  if (!data.currentImage) {
    return { error: 'Missing currentImage object', field: 'currentImage' }
  }

  if (!data.currentImage.id) {
    return { error: 'Missing object ID', field: 'currentImage.id' }
  }

  return null // Valid
}

/**
 * Calculates a CustomScore based on ABC classification.
 * Replace this with your own business logic.
 */
function calculateScore(abcClassification) {
  const classification = abcClassification?.toUpperCase()

  switch (classification) {
    case 'A':
      return 90
    case 'B':
      return 70
    case 'C':
      return 50
    default:
      console.log(`⚠️  Unknown ABC classification: ${abcClassification}, defaulting to C (50)`)
      return 50
  }
}

/**
 * Creates a follow-up task linked to an opportunity in CRM.
 * The task is assigned to the opportunity owner and due in 3 days.
 */
async function createUrgentOpportunityTask(opportunityId, opportunityDisplayId, ownerId) {
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + 3)
  const dueDateTime = dueDate.toISOString().replace(/\.\d{3}/, '')

  const taskPayload = {
    subject: `Follow up: Urgent Opportunity – ${opportunityDisplayId}`,
    status: 'OPEN',
    dueDateTime,
    opportunity: { id: opportunityId },
    owner: { id: ownerId }
  }

  const response = await callCrmApi('/sap/c4c/api/v1/task-service/tasks', {
    method: 'POST',
    body: JSON.stringify(taskPayload)
  })
  const result = await response.json()
  return result.value?.displayId || null
}

// ============================================================================
// DASHBOARD API (used by the educational frontend in /public)
// ============================================================================

/**
 * Returns the current live demo configuration.
 */
app.get('/api/config', (req, res) => {
  res.json({ asyncScoreDelayMs })
})

/**
 * Updates the live demo configuration (currently just the async delay).
 * In-memory, demo-only: resets on restart and is per-instance.
 */
app.post('/api/config', (req, res) => {
  const value = req.body?.asyncScoreDelayMs

  if (value !== 0 && value !== 10000) {
    return res.status(400).json({ error: 'asyncScoreDelayMs must be 0 or 10000' })
  }

  asyncScoreDelayMs = value
  console.log(`✅ Async score delay set to ${asyncScoreDelayMs}ms via dashboard`)
  res.json({ asyncScoreDelayMs })
})

// ============================================================================
// ENDPOINTS
// ============================================================================

/**
 * Health check endpoint — required for Cloud Foundry
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CRM Extension Hub',
    timestamp: new Date().toISOString()
  })
})

/**
 * SYNC AUTOFLOW — Account
 *
 * Triggered by a Synchronous AutoFlow in SSC V2.
 * SSC V2 waits for this response before completing the save — the result
 * is written directly into the record without a separate API call.
 *
 * Reads customerABCClassification from the currentImage, calculates a
 * numeric CustomScore, and returns the modified currentImage so SSC V2
 * persists the CustomScore field automatically.
 *
 * Must respond in under 2 seconds. No outbound API calls here.
 * Response format: { "data": { ...currentImage } }
 */
app.post('/webhooks/calculate-score-sync', (req, res) => {
  try {
    // Validate payload
    const validationError = validateWebhookPayload(req.body)
    if (validationError) {
      console.error(`❌ Validation failed: ${validationError.error}`)
      return res.status(400).json({ error: validationError.error })
    }

    // Support CloudEvents format (data wrapper) or direct format
    const data = req.body.data || req.body

    // Extract ABC classification and calculate score
    const abcClassification = data.currentImage.customerABCClassification
    const calculatedScore = calculateScore(abcClassification)

    console.log(`✅ Sync score calculated: ${calculatedScore} (ABC: ${abcClassification})`)

    // Return the modified currentImage — SSC V2 will persist CustomScore
    res.status(200).json({
      data: {
        ...data.currentImage,
        extensions: {
          ...data.currentImage.extensions,
          CustomScore: calculatedScore
        }
      }
    })

  } catch (error) {
    console.error('❌ Sync score webhook error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * ASYNC AUTOFLOW — Account
 *
 * Triggered by an Asynchronous AutoFlow in SSC V2.
 * SSC V2 does NOT wait — we respond 202 immediately so the user's save
 * completes instantly, then process in the background.
 *
 * The background task calculates the score and writes it back to the CRM
 * using a GET (to obtain a fresh ETag) followed by a PATCH with If-Match
 * for optimistic locking.
 *
 * Use this pattern for slow operations, external API calls, or anything
 * that can run independently of the user's save transaction.
 * The 10-second delay below simulates a slow external operation.
 */
app.post('/webhooks/calculate-score-async', async (req, res) => {
  try {
    // Validate payload
    const validationError = validateWebhookPayload(req.body)
    if (validationError) {
      console.error(`❌ Validation failed: ${validationError.error}`)
      return res.status(400).json({ error: validationError.error })
    }

    // Respond immediately — SSC V2 gets 202 right away
    res.status(202).json({
      accepted: true,
      message: 'Processing in background'
    })

    // Support CloudEvents format (data wrapper) or direct format
    const data = req.body.data || req.body

    // Process asynchronously
    const accountId = data.currentImage.id
    const abcClassification = data.currentImage.customerABCClassification

    console.log(`🔄 Async score processing started for account ${accountId}...`)

    // Spawn background task — runs after the response has been sent
    setImmediate(async () => {
      try {
        // Simulate a slow external operation (e.g. calling a scoring API).
        // Delay is live-adjustable from the dashboard (10s slow ⟷ 0s instant).
        if (asyncScoreDelayMs > 0) {
          console.log(`⏳ Simulating ${asyncScoreDelayMs / 1000}-second processing delay...`)
          await new Promise(resolve => setTimeout(resolve, asyncScoreDelayMs))
        } else {
          console.log(`⏳ Delay disabled — processing immediately`)
        }

        // Calculate score
        const calculatedScore = calculateScore(abcClassification)
        console.log(`✅ Async score calculated: ${calculatedScore} (ABC: ${abcClassification})`)

        // GET the account to obtain a fresh ETag for optimistic locking
        console.log(`📡 Fetching ETag for account ${accountId}...`)
        const getResponse = await callCrmApi(`/sap/c4c/api/v1/account-service/accounts/${accountId}`)
        const etag = getResponse.headers.get('ETag')
        if (!etag) throw new Error('No ETag received from CRM')
        console.log(`✅ Received ETag: ${etag}`)

        // PATCH the account — If-Match ensures we don't overwrite a concurrent change
        console.log(`📡 Writing CustomScore ${calculatedScore} to account ${accountId}...`)
        await callCrmApi(`/sap/c4c/api/v1/account-service/accounts/${accountId}`, {
          method: 'PATCH',
          headers: {
            'If-Match': etag,
            'Content-Type': 'application/merge-patch+json'
          },
          body: JSON.stringify({
            extensions: { CustomScore: calculatedScore }
          })
        })

        console.log(`✅ Account ${accountId} updated with CustomScore: ${calculatedScore}`)

      } catch (error) {
        console.error('❌ Async score processing failed:')
        console.error(`   Account ID: ${accountId}`)
        console.error(`   Error: ${error.message}`)
      }
    })

  } catch (error) {
    console.error('❌ Async score webhook error:', error)
    // Note: Response already sent, so we can't respond with error
  }
})

/**
 * ASYNC AUTOFLOW — Opportunity
 *
 * Triggered by an Asynchronous AutoFlow in SSC V2 on the Opportunity object.
 * SSC V2 fires this after the save completes and does NOT wait for a response.
 *
 * Guard condition: only creates a task when priority *changes* TO Urgent (2).
 * Comparing beforeImage vs currentImage prevents re-triggering on unrelated
 * saves of an already-urgent opportunity.
 *
 * Creates a follow-up task linked directly to the opportunity (not the account),
 * assigned to the opportunity owner, due in 3 days.
 */
app.post('/webhooks/create-urgent-opportunity-task', async (req, res) => {
  try {
    // Validate payload
    const validationError = validateWebhookPayload(req.body)
    if (validationError) {
      console.error(`❌ Validation failed: ${validationError.error}`)
      return res.status(400).json({ error: validationError.error })
    }

    // Respond immediately
    res.status(202).json({ accepted: true, message: 'Processing in background' })

    // Support CloudEvents format (data wrapper) or direct format
    const data = req.body.data || req.body
    const currentImage = data.currentImage
    const beforeImage = data.beforeImage || {}

    // Guard: only act when priority just changed TO urgent
    if (currentImage.priority !== PRIORITY_URGENT) {
      console.log(`⚠️  Opportunity ${currentImage.displayId} — priority is not Urgent, skipping`)
      return
    }
    if (beforeImage.priority === PRIORITY_URGENT) {
      console.log(`⚠️  Opportunity ${currentImage.displayId} — priority was already Urgent, skipping`)
      return
    }

    // Spawn background task
    setImmediate(async () => {
      try {
        console.log(`🔄 Opportunity ${currentImage.displayId} changed to Urgent — creating follow-up task...`)

        const taskDisplayId = await createUrgentOpportunityTask(
          currentImage.id,
          currentImage.displayId,
          currentImage.ownerId
        )

        console.log(`✅ Follow-up task created: ${taskDisplayId} for opportunity ${currentImage.displayId}`)

      } catch (error) {
        console.error('❌ Create urgent opportunity task failed:')
        console.error(`   Opportunity: ${currentImage.displayId} (${currentImage.id})`)
        console.error(`   Error: ${error.message}`)
      }
    })

  } catch (error) {
    console.error('❌ Create urgent opportunity task webhook error:', error)
  }
})

/**
 * SYNC UI EXTENSION — External Alerts (Account)
 *
 * This is NOT an AutoFlow — it is a UI Extension connection point.
 * SSC V2 calls this endpoint on demand when rendering the Account page
 * to display external alert signals in the UI (e.g. risk flags, compliance warnings).
 *
 * SSC V2 sends the account context; we respond synchronously with an alerts array.
 * Replace the hardcoded alerts below with your real data source
 * (e.g. a compliance system, fraud detection API, or a custom database table).
 */
app.post('/webhooks/external-alerts', (req, res) => {
  try {
    const data = req.body.data || req.body
    const accountId = data?.currentImage?.id || data?.objectId
    const displayId = data?.currentImage?.displayId || data?.displayId

    console.log(`✅ External alerts requested for account ${displayId || accountId || 'unknown'}`)

    res.status(200).json({
      count: 2,
      alerts: [
        {
          signalType: 'extAlert',
          object: {
            objectType: 'ACCOUNT',
            displayId: displayId || '1000016',
            objectId: accountId || '01a15944-e5aa-7881-91a5-dc1bb733f69a'
          },
          groupText: 'High',
          icon: 'error_filled',
          color: 'red',
          message: 'local energy network down'
        },
        {
          signalType: 'extAlert',
          object: {
            objectType: 'ACCOUNT',
            displayId: displayId || '1000016',
            objectId: accountId || '01a15944-e5aa-7881-91a5-dc1bb733f69a'
          },
          groupText: 'Medium',
          icon: 'error_filled',
          color: 'yellow',
          message: 'never logged into self-service'
        }
      ]
    })

  } catch (error) {
    console.error('❌ External alerts error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * SYNC UI EXTENSION — Account Insights Chart
 *
 * This is NOT an AutoFlow — it is a UI Extension connection point.
 * SSC V2 calls this endpoint when rendering the custom chart widget
 * in the Account Insights panel.
 *
 * SSC V2 sends the account context; we respond synchronously with chart data.
 * Response shape: { total: <number>, data: [{ name, y }, ...] }
 * Replace the hardcoded values below with your real data source.
 */
app.post('/webhooks/account-insights-chart', (req, res) => {
  try {
    const data = req.body.data || req.body
    const accountId = data?.currentImage?.id || data?.objectId
    const displayId = data?.currentImage?.displayId || data?.displayId

    console.log(`✅ Account insights chart requested for account ${displayId || accountId || 'unknown'}`)

    res.status(200).json({
      total: 35.0,
      data: [
        { name: 'Open Deliveries', y: 7 },
        { name: 'Completed Deliveries',   y: 18 },
        { name: 'Delayed Deliveries',  y: 10 }
      ]
    })

  } catch (error) {
    console.error('❌ Account insights chart error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log(`\n🚀 CRM Extension Hub running on port ${PORT}`)
  console.log(`📍 Dashboard:          http://localhost:${PORT}/`)
  console.log(`📍 Health check:       http://localhost:${PORT}/health`)
  console.log(`📍 Score (sync):       http://localhost:${PORT}/webhooks/calculate-score-sync`)
  console.log(`📍 Score (async):      http://localhost:${PORT}/webhooks/calculate-score-async`)
  console.log(`📍 Urgent opp task:    http://localhost:${PORT}/webhooks/create-urgent-opportunity-task`)
  console.log(`📍 External alerts:    http://localhost:${PORT}/webhooks/external-alerts`)
  console.log(`📍 Insights chart:     http://localhost:${PORT}/webhooks/account-insights-chart\n`)
})
