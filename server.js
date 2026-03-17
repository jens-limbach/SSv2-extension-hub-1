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

/**
 * Fetches an employee's manager displayId from CRM
 */
async function getEmployeesManager(employeeId) {
  const response = await callCrmApi(`/sap/c4c/api/v1/employee-service/employees/${employeeId}`)
  const employeeData = await response.json()
  return employeeData.managerEmployeeDisplayId || null
}

/**
 * Resolves an employee's internal ID from their displayId
 */
async function getEmployeeID(employeeDisplayId) {
  const encodedId = encodeURIComponent(employeeDisplayId)
  const response = await callCrmApi(`/sap/c4c/api/v1/employee-service/employees?filter=employeeDisplayId eq '${encodedId}'`)
  const result = await response.json()
  return result.value?.length > 0 ? result.value[0].id : null
}

/**
 * Creates a focus account task in CRM
 */
async function createFocusAccountTask(accountId, ownerId, organizerId) {
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + 7)
  const dueDateTime = dueDate.toISOString().replace(/\.\d{3}/, '')

  const taskPayload = {
    description: 'Focus Account Request',
    taskCategory: 'Z0001',
    status: 'INPROCESS',
    dueDateTime,
    account: { id: accountId },
    owner: { id: ownerId },
    organizer: { id: organizerId },
    notes: [{ content: 'Please confirm or decline your focus account.' }]
  }

  const response = await callCrmApi('/sap/c4c/api/v1/task-service/tasks', {
    method: 'POST',
    body: JSON.stringify(taskPayload)
  })
  const result = await response.json()
  return result.value?.displayId || null
}

/**
 * Creates a contact person in CRM
 */
async function createContact(givenName, familyName, eMail, accountId) {
  const contactPayload = { givenName, familyName, eMail }
  if (accountId) contactPayload.accountId = accountId

  const response = await callCrmApi('/sap/c4c/api/v1/contact-person-service/contactPersons', {
    method: 'POST',
    body: JSON.stringify(contactPayload)
  })
  const result = await response.json()
  return result.value?.id || null
}

/**
 * Adds a contact to an opportunity and returns the opportunity-contact ID
 */
async function addContactToOpportunity(opportunityId, contactId) {
  const response = await callCrmApi(`/sap/c4c/api/v1/opportunity-service/opportunities/${opportunityId}/contacts`, {
    method: 'POST',
    body: JSON.stringify({ partyId: contactId })
  })
  const result = await response.json()
  return result.value?.id || null
}

/**
 * Sets a contact as the primary contact on an opportunity
 */
async function setContactAsPrimary(opportunityId, contactOppId, etag) {
  await callCrmApi(`/sap/c4c/api/v1/opportunity-service/opportunities/${opportunityId}/contacts/${contactOppId}`, {
    method: 'PATCH',
    headers: {
      'If-Match': etag,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ isPrimary: true })
  })
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
 * Create Focus Account Task webhook - creates approval tasks based on request status
 * Async: responds immediately, processes CRM API calls in background
 */
app.post('/webhooks/create-focus-account-task', async (req, res) => {
  try {
    const validationError = validateWebhookPayload(req.body)
    if (validationError) {
      console.error(`❌ Validation failed: ${validationError.error}`)
      return res.status(400).json({ error: validationError.error })
    }

    res.status(202).json({ accepted: true, message: 'Processing in background' })

    const data = req.body.data || req.body
    const currentImage = data.currentImage
    const accountId = currentImage.id
    const focusAccountRequestStatus = currentImage.extensions?.FocusAccountRequest || null

    if (!focusAccountRequestStatus || !['10', '40'].includes(focusAccountRequestStatus)) {
      console.log(`⚠️  FocusAccountRequest status is '${focusAccountRequestStatus}' — no action needed for account ${currentImage.displayId}`)
      return
    }

    setImmediate(async () => {
      try {
        const statusLabel = focusAccountRequestStatus === '10' ? 'Awaiting Answer' : 'Request Manually'
        console.log(`🔄 Focus Account Request status: ${statusLabel}. Processing for account ${currentImage.displayId}...`)

        console.log(`📡 Fetching manager for owner ${currentImage.ownerId}...`)
        const managerDisplayId = await getEmployeesManager(currentImage.ownerId)
        if (!managerDisplayId) {
          throw new Error(`No manager found for employee ${currentImage.ownerId}`)
        }
        console.log(`✅ Manager displayId: ${managerDisplayId}`)

        console.log(`📡 Resolving manager employee ID...`)
        const managerEmployeeId = await getEmployeeID(managerDisplayId)
        if (!managerEmployeeId) {
          throw new Error(`Could not resolve employee ID for displayId ${managerDisplayId}`)
        }
        console.log(`✅ Manager employee ID: ${managerEmployeeId}`)

        // Status 10: task owner = account owner, organizer = manager
        // Status 40: task owner = manager, organizer = account owner
        const ownerId = focusAccountRequestStatus === '10' ? currentImage.ownerId : managerEmployeeId
        const organizerId = focusAccountRequestStatus === '10' ? managerEmployeeId : currentImage.ownerId

        console.log(`📡 Creating focus account task for account ${currentImage.displayId}...`)
        const taskDisplayId = await createFocusAccountTask(accountId, ownerId, organizerId)
        console.log(`✅ Task created successfully: ${taskDisplayId}`)

      } catch (error) {
        console.error('❌ Focus account request processing failed:')
        console.error(`   Account: ${currentImage.displayId} (${accountId})`)
        console.error(`   Status: ${focusAccountRequestStatus}`)
        console.error(`   Error: ${error.message}`)
      }
    })

  } catch (error) {
    console.error('❌ Focus account request webhook error:', error)
  }
})

/**
 * Update Account from Focus Task - updates focus account status when task is completed/canceled
 * Async: responds immediately, processes CRM API calls in background
 */
app.post('/webhooks/update-account-from-focus-task', async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ error: 'Request body is empty' })
    }

    res.status(202).json({ accepted: true, message: 'Processing in background' })

    const data = req.body.data || req.body
    const currentImage = data.currentImage

    if (!currentImage) {
      console.log('⚠️  No currentImage in payload — skipping')
      return
    }

    const taskStatus = currentImage.status
    const accountId = currentImage.account?.id

    if (!accountId) {
      console.log('⚠️  No account ID in task payload — skipping')
      return
    }

    let focusAccountStatus = null
    if (taskStatus === 'COMPLETED') {
      focusAccountStatus = '20' // Focused
    } else if (taskStatus === 'CANCELED') {
      focusAccountStatus = '30' // Not Focused
    }

    if (!focusAccountStatus) {
      console.log(`⚠️  Task status '${taskStatus}' does not trigger an update — skipping`)
      return
    }

    setImmediate(async () => {
      try {
        const statusLabel = focusAccountStatus === '20' ? 'Focused' : 'Not Focused'
        console.log(`🔄 Task ${taskStatus} — setting account ${accountId} to ${statusLabel}...`)

        console.log(`📡 Fetching ETag for account ${accountId}...`)
        const getResponse = await callCrmApi(`/sap/c4c/api/v1/account-service/accounts/${accountId}`)
        const etag = getResponse.headers.get('ETag')
        if (!etag) {
          throw new Error('No ETag received from CRM')
        }
        console.log(`✅ Received ETag: ${etag}`)

        console.log(`📡 Updating focus account status for ${accountId}...`)
        await callCrmApi(`/sap/c4c/api/v1/account-service/accounts/${accountId}`, {
          method: 'PATCH',
          headers: {
            'If-Match': etag,
            'Content-Type': 'application/merge-patch+json'
          },
          body: JSON.stringify({
            extensions: {
              FocusAccountStatus: focusAccountStatus,
              FocusAccountRequest: '50'
            }
          })
        })

        console.log(`✅ Account ${accountId} updated: FocusAccountStatus=${focusAccountStatus}, FocusAccountRequest=50`)

      } catch (error) {
        console.error('❌ Update account from focus task failed:')
        console.error(`   Account ID: ${accountId}`)
        console.error(`   Task Status: ${taskStatus}`)
        console.error(`   Error: ${error.message}`)
      }
    })

  } catch (error) {
    console.error('❌ Update account from focus task webhook error:', error)
  }
})

/**
 * Create New Contact from Guided Selling - creates a contact and sets it as primary on the opportunity
 * Async: responds immediately, processes CRM API calls in background
 */
app.post('/webhooks/create-new-contact-guided-selling', async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ error: 'Request body is empty' })
    }

    res.status(202).json({ accepted: true, message: 'Processing in background' })

    const data = req.body.data || req.body
    const currentImage = data.currentImage

    if (!currentImage?.id) {
      console.log('⚠️  No opportunity ID in payload — skipping')
      return
    }

    if (!currentImage.extensions?.newContact) {
      console.log(`⚠️  No newContact flag set for opportunity ${currentImage.id} — skipping`)
      return
    }

    setImmediate(async () => {
      try {
        const opportunityId = currentImage.id
        console.log(`🔄 Creating new contact for opportunity ${opportunityId}...`)

        // Create contact
        console.log(`📡 Creating contact: ${currentImage.extensions.newContact_Firstname} ${currentImage.extensions.newContact_Lastname}...`)
        const contactId = await createContact(
          currentImage.extensions.newContact_Firstname,
          currentImage.extensions.newContact_Lastname,
          currentImage.extensions.newContact_EmailAddress,
          currentImage.account?.id
        )
        if (!contactId) {
          throw new Error('Contact creation returned no ID')
        }
        console.log(`✅ Contact created: ${contactId}`)

        // Add contact to opportunity
        console.log(`📡 Adding contact to opportunity ${opportunityId}...`)
        const contactOppId = await addContactToOpportunity(opportunityId, contactId)
        if (!contactOppId) {
          throw new Error('Adding contact to opportunity returned no ID')
        }
        console.log(`✅ Contact added to opportunity: ${contactOppId}`)

        // Get opportunity ETag and set contact as primary
        console.log(`📡 Fetching ETag for opportunity ${opportunityId}...`)
        const getResponse = await callCrmApi(`/sap/c4c/api/v1/opportunity-service/opportunities/${opportunityId}`)
        const etag = getResponse.headers.get('ETag')
        if (!etag) {
          throw new Error('No ETag received from CRM')
        }
        console.log(`✅ Received ETag: ${etag}`)

        console.log(`📡 Setting contact as primary on opportunity ${opportunityId}...`)
        await setContactAsPrimary(opportunityId, contactOppId, etag)
        console.log(`✅ Contact ${contactId} set as primary on opportunity ${opportunityId}`)

      } catch (error) {
        console.error('❌ Create new contact guided selling failed:')
        console.error(`   Opportunity: ${currentImage.id}`)
        console.error(`   Error: ${error.message}`)
      }
    })

  } catch (error) {
    console.error('❌ Create new contact guided selling webhook error:', error)
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
  console.log(`📍 Focus account:  http://localhost:${PORT}/webhooks/create-focus-account-task`)
  console.log(`📍 Update account: http://localhost:${PORT}/webhooks/update-account-from-focus-task`)
  console.log(`📍 Guided selling: http://localhost:${PORT}/webhooks/create-new-contact-guided-selling`)
  console.log(`📍 External alerts: http://localhost:${PORT}/webhooks/external-alerts\n`)
})
