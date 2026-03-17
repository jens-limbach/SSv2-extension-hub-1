# CRM Webhook Service

A minimal Express-based webhook microservice for SAP Sales and Service Cloud V2. Receives CloudEvents webhooks, applies custom business logic, and writes results back to the CRM via REST API. Designed as a central extension hub — add all your custom endpoints here.

## 🚀 Quick Start

1. **Install dependencies:** `npm install`
2. **Configure environment:** `copy env-template.txt .env` and fill in your CRM credentials
3. **Start locally:** `npm run dev` — service runs on `http://localhost:3000`

## ⚙️ Environment Variables

| Variable | Description | Required |
|---|---|---|
| `CRM_BASE_URL` | SAP SSC V2 tenant URL | Yes |
| `CRM_USERNAME` | API user with read/write access | Yes |
| `CRM_PASSWORD` | API user password | Yes |
| `PORT` | Server port (auto-set by Cloud Foundry) | No |

## 🔗 Endpoints

### `GET /health`
Health check — returns `{ "status": "ok", ... }`. Required for Cloud Foundry.

### `POST /webhooks/calculate-score-sync`
**Synchronous** — Performs logic within the request lifecycle and returns a modified `currentImage` before the CRM save completes. Must respond in under 2 seconds. Returns `200 OK` with `{ "data": { ...currentImage } }` or `400` on validation failure.

Use this pattern when the result is needed immediately (e.g. field derivation, validation, enrichment).

### `POST /webhooks/calculate-score-async`
**Asynchronous** — Immediately returns `202 Accepted`, then processes in the background using `setImmediate`. The background task performs its work and writes the result back to the CRM via a `GET` (for ETag) + `PATCH` (with `If-Match`). Errors are logged; no CRM callback on failure.

Use this pattern for slow operations, external API calls, or anything that can run independently of the save transaction.

### `POST /webhooks/external-alerts`
**Synchronous** — Returns a list of external alert signals for an account. SAP SSC V2 calls this endpoint to display alerts in the UI (e.g. fraud flags, compliance warnings). Responds with `200 OK` and an `alerts` array; each entry has a `signalType`, `icon`, `color`, `groupText`, and `message`. Replace the hardcoded sample alerts with your real business logic.

## 🎯 CloudEvents Payload Structure

SAP SSC V2 sends webhooks in CloudEvents format. Business data is nested under `data`:

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

Both the wrapped (`body.data`) and unwrapped (`body`) formats are supported. The `currentImage.id` field is always required.

## ☁️ Cloud Foundry Deployment

```bash
cf push
cf set-env crm-webhook-service CRM_BASE_URL "https://your-tenant.crm.cloud.sap"
cf set-env crm-webhook-service CRM_USERNAME "your-username"
cf set-env crm-webhook-service CRM_PASSWORD "your-password"
cf restage crm-webhook-service
```

## 📁 Project Structure

```
server.js          ← All endpoints and helpers (single file)
package.json       ← Minimal dependencies (express, dotenv)
manifest.yml       ← Cloud Foundry deployment config
env-template.txt   ← Template for .env (never commit .env)
```