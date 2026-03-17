# GitHub Copilot Instructions

## Project Context

This is a minimal Express-based webhook microservice written in Node.js that integrates with **SAP Sales and Service Cloud V2 (SSC V2)**. It acts as a central extension hub: SAP CRM sends CloudEvents-formatted webhook payloads to this service, which applies custom business logic and — for asynchronous flows — writes results back to the CRM via its REST API.

The goal is to keep this service as a **single, maintainable file** where all custom endpoints live. Avoid splitting into multiple modules unless absolutely necessary.

---

## Technology Stack

- **Runtime:** Node.js 22.x with native ES Modules (`"type": "module"` in package.json)
- **Framework:** Express 4.x — use only what Express provides natively, no extra middleware libraries
- **HTTP Client:** Node.js built-in `fetch` API — do **not** add axios, node-fetch, or got
- **Configuration:** `dotenv` for environment variables — credentials and base URLs only, never hardcoded
- **Deployment:** SAP BTP Cloud Foundry via `manifest.yml` — keep memory footprint minimal (128MB target)
- **Dependencies:** Keep to an absolute minimum; currently only `express` and `dotenv`

---

## Code Style & Conventions

- Use **ES module syntax** (`import`/`export`) throughout — never `require()`
- Use `async/await` for all asynchronous operations — avoid `.then()` chains
- Keep helper functions small and single-purpose; define them above the endpoint definitions
- Use **emoji prefixes in console logs** to make operational output scannable:
  - `✅` — success / info
  - `❌` — errors
  - `⚠️` — warnings / unexpected but non-fatal
  - `🔄` — async background processing started
  - `⏳` — waiting / delay
  - `📡` — outbound API calls
- Do **not** log full request or response payloads in normal operation — log only IDs, status codes, and key field values
- Validate all incoming webhook payloads at the top of each handler; return early with a clear error message on failure

---

## Webhook Integration Patterns

Two patterns are used; all new endpoints must follow one of them:

### Synchronous Webhook
- Receives a CloudEvents payload, performs logic **within the request lifecycle**, and returns a transformed response **before** the SAP CRM save operation completes
- Response must be `200 OK` with a JSON body containing a `data` key that holds the modified `currentImage` object
- Must complete in well under 2 seconds — no external API calls, no delays
- Validation errors return `400 Bad Request` with `{ "error": "<message>" }`

### Asynchronous Webhook
- Receives a CloudEvents payload, **immediately responds** `202 Accepted` with `{ "accepted": true, "message": "Processing in background" }`
- Spawns a background task using `setImmediate` for any logic that takes time or makes CRM API calls
- Background task: perform work, then write results back to the CRM via `PATCH` using optimistic locking (ETag / `If-Match` header)
- Errors in the background task are logged but do not produce a callback to SAP CRM

---

## SAP Sales and Service Cloud V2 API Integration

### CloudEvents Payload Format
SAP SSC V2 sends webhooks as CloudEvents. The actual business data is nested under a `data` key:
```json
{
  "specversion": "0.2",
  "type": "sap.crm.custom.event.<eventName>",
  "data": {
    "beforeImage": { ... },
    "currentImage": { ... },
    "dataContext": { ... }
  }
}
```
Always support both the wrapped format (`body.data`) and the unwrapped direct format (`body`) for resilience.

### Authentication
- All CRM API calls use **HTTP Basic Authentication**
- Build the header once at startup: `` 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') ``
- Never recompute per-request; never log the credential string

### Optimistic Locking (ETag)
For any `PATCH` to a CRM resource:
1. First `GET` the resource to obtain the current `ETag` response header
2. Include the ETag in the `PATCH` request via `If-Match` header
3. Use `Content-Type: application/merge-patch+json` for partial updates

### API Base Paths (SAP SSC V2)
- Accounts: `/sap/c4c/api/v1/account-service/accounts/{id}`
- Extend these patterns for other entity types as needed; always construct URLs from the `CRM_BASE_URL` env var

### Error Handling for CRM API Calls
- Check `response.ok`; if false, read `response.text()` and throw a descriptive error including the HTTP status
- Let the caller handle the thrown error — keep the `callCrmApi` helper generic

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `CRM_BASE_URL` | Base URL of the SAP SSC V2 tenant |
| `CRM_USERNAME` | API user (needs appropriate entity permissions) |
| `CRM_PASSWORD` | API user password |
| `PORT` | Injected by Cloud Foundry; defaults to 3000 locally |

Always validate that `CRM_BASE_URL`, `CRM_USERNAME`, and `CRM_PASSWORD` are present at startup and exit with a clear error if any are missing.

---

## Project Structure Conventions

```
server.js          ← All endpoints and helpers live here
package.json       ← Minimal dependencies only
manifest.yml       ← Cloud Foundry deployment (adjust app name when needed)
env-template.txt   ← Template; never commit actual .env
.env               ← Git-ignored; local credentials only
```

New endpoints are added directly to `server.js` under the `// ENDPOINTS` section. New helpers go under `// HELPER FUNCTIONS`.

---

## Cloud Foundry Deployment Notes

- The `manifest.yml` defines memory, instances, buildpack, and the health check endpoint (`/health`)
- The `/health` endpoint must always exist and return `{ "status": "ok", ... }`
- Environment variables are set via `cf set-env` and require `cf restage` — update `env-template.txt` when adding new required variables
- The Node.js version is resolved from the `engines` field in `package.json` — keep it pinned to 22.x

---

## What to Avoid

- Do not add a database, message queue, or caching layer unless explicitly asked
- Do not split the service into multiple files or introduce a router module without good reason
- Do not add authentication middleware for incoming webhooks without discussing the approach (SAP-side signature verification is preferred)
- Do not add TypeScript, a bundler, or a test framework unless the user explicitly requests it
- Do not use `var`; prefer `const`, use `let` only when reassignment is genuinely needed
