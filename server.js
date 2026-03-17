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

// Middleware
app.use(express.json())

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
console.log('✅ CRM Webhook Service Configuration:')
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
    return { error: 'Missing account ID', field: 'currentImage.id' }
  }

  return null // Valid
}

/**
 * Calculates CustomScore based on ABC classification
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

// ============================================================================
// ENDPOINTS
// ============================================================================

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CRM Webhook Service',
    timestamp: new Date().toISOString()
  })
})

/**
 * Synchronous webhook - returns calculated score immediately
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

    // Extract ABC classification
    const abcClassification = data.currentImage.customerABCClassification
    
    // Calculate score
    const calculatedScore = calculateScore(abcClassification)

    console.log(`✅ Calculated score: ${calculatedScore} (ABC: ${abcClassification})`)

    console.log(`✅ Returning response with updated CustomScore...`)
    // Create response data from currentImage and update only CustomScore
    const responseData = {
      ...data.currentImage,
      extensions: {
        ...data.currentImage.extensions,
        CustomScore: calculatedScore
      }
    }
    

    // Return response in CRM expected format
    res.status(200).json({
      data: responseData
    })
    console.log(`✅ Returned updated account data with CustomScore: ${calculatedScore}`)

  } catch (error) {
    console.error('❌ Sync webhook error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * Asynchronous webhook - accepts request and processes in background
 */
app.post('/webhooks/calculate-score-async', async (req, res) => {
  try {
    // Validate payload
    const validationError = validateWebhookPayload(req.body)
    if (validationError) {
      console.error(`❌ Validation failed: ${validationError.error}`)
      return res.status(400).json({ error: validationError.error })
    }

    // Immediately respond to acknowledge receipt
    res.status(202).json({
      accepted: true,
      message: 'Processing in background'
    })

    // Support CloudEvents format (data wrapper) or direct format
    const data = req.body.data || req.body

    // Process asynchronously
    const accountId = data.currentImage.id
    const abcClassification = data.currentImage.customerABCClassification

    console.log(`🔄 Starting async processing for account ${accountId}...`)

    // Spawn background task
    setImmediate(async () => {
      try {
        // Simulate processing delay
        console.log(`⏳ Simulating 10-second processing delay...`)
        await new Promise(resolve => setTimeout(resolve, 10000))

        // Calculate score
        const calculatedScore = calculateScore(abcClassification)
        console.log(`✅ Async calculated score: ${calculatedScore} (ABC: ${abcClassification})`)

        // Fetch current account to get fresh ETag
        console.log(`📡 Fetching current account data for ${accountId}...`)
        const getResponse = await callCrmApi(`/sap/c4c/api/v1/account-service/accounts/${accountId}`)
        const etag = getResponse.headers.get('ETag')
        
        if (!etag) {
          throw new Error('No ETag received from CRM')
        }

        console.log(`✅ Received ETag: ${etag}`)

        // Update account with calculated score
        console.log(`📡 Updating account ${accountId} with score ${calculatedScore}...`)
        await callCrmApi(
          `/sap/c4c/api/v1/account-service/accounts/${accountId}`,
          {
            method: 'PATCH',
            headers: {
              'If-Match': etag,
              'Content-Type': 'application/merge-patch+json'
            },
            body: JSON.stringify({
              extensions: {
                CustomScore: calculatedScore
              }
            })
          }
        )

        console.log(`✅ Successfully updated account ${accountId} with CustomScore: ${calculatedScore}`)

      } catch (error) {
        console.error('❌ Async webhook processing failed:')
        console.error(`   Account ID: ${accountId}`)
        console.error(`   ABC Classification: ${abcClassification}`)
        console.error(`   Error: ${error.message}`)
      }
    })

  } catch (error) {
    console.error('❌ Async webhook error:', error)
    // Note: Response already sent, so we can't respond with error
  }
})

/**
 * External alerts endpoint - returns alert signals for an account
 * SAP SSC V2 calls this endpoint to display external alerts in the UI
 */
app.post('/webhooks/external-alerts', (req, res) => {
  try {
    const data = req.body.data || req.body
    const accountId = data?.currentImage?.id || data?.objectId
    const displayId = data?.currentImage?.displayId || data?.displayId

    console.log(`✅ External alerts requested for account ${displayId || accountId || 'unknown'}`)

    const response = {
      count: 2,
      alerts: [
        {
          signalType: 'extAlert',
          object: {
            objectType: 'ACCOUNT',
            displayId: displayId || '',
            objectId: accountId || ''
          },
          groupText: 'High',
          icon: 'error_filled',
          color: 'yellow',
          message: 'Fraud'
        },
        {
          signalType: 'extAlert',
          object: {
            objectType: 'ACCOUNT',
            displayId: displayId || '',
            objectId: accountId || ''
          },
          groupText: 'Medium',
          icon: 'error_filled',
          color: 'red',
          message: 'Photo not approved'
        }
      ]
    }

    res.status(200).json(response)

  } catch (error) {
    console.error('❌ External alerts error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log(`\n🚀 CRM Webhook Service running on port ${PORT}`)
  console.log(`📍 Health check: http://localhost:${PORT}/health`)
  console.log(`📍 Sync webhook: http://localhost:${PORT}/webhooks/calculate-score-sync`)
  console.log(`📍 Async webhook: http://localhost:${PORT}/webhooks/calculate-score-async`)
  console.log(`📍 External alerts: http://localhost:${PORT}/webhooks/external-alerts\n`)
})
