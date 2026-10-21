# CRM Extension Hub

A minimal Express-based webhook microservice for SAP Sales and Service Cloud V2 (SSC V2). Demonstrates the key extension patterns available in SSC V2: synchronous and asynchronous AutoFlows, and UI Extension data providers. Designed as a single-file central hub — add all your custom endpoints here.

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

---

### `POST /webhooks/calculate-score-sync`
**Pattern: Synchronous AutoFlow — Account**

Triggered by a Synchronous AutoFlow in SSC V2. SSC V2 **waits** for this response before completing the save — no separate write-back API call is needed.

Reads `customerABCClassification` from the account's `currentImage`, calculates a numeric `CustomScore` (A=90, B=70, C=50), and returns the modified `currentImage` so SSC V2 persists the field automatically.

**Rules:** Must respond in under 2 seconds. No outbound API calls.

**Response:** `200 OK` with `{ "data": { ...currentImage, extensions: { CustomScore: 90 } } }`

---

### `POST /webhooks/calculate-score-async`
**Pattern: Asynchronous AutoFlow — Account**

Triggered by an Asynchronous AutoFlow in SSC V2. SSC V2 does **not** wait — the service responds `202 Accepted` immediately so the user's save completes instantly. A background task then calculates the score and writes it back to the CRM via:
1. `GET` account → obtain current `ETag`
2. `PATCH` account with `If-Match: <etag>` header (optimistic locking)

Includes a 10-second simulated delay to illustrate that async flows can handle slow operations or external API calls.

**Response:** `202 Accepted` with `{ "accepted": true, "message": "Processing in background" }`

---

### `POST /webhooks/create-urgent-opportunity-task`
**Pattern: Asynchronous AutoFlow — Opportunity**

Triggered by an Asynchronous AutoFlow in SSC V2 on the **Opportunity** object (not Account). SSC V2 fires this after the save completes and does not wait.

**Guard condition:** Only creates a task when the opportunity's `priority` field *changes* to `"2"` (Urgent). Uses `beforeImage` vs `currentImage` comparison to avoid re-triggering on unrelated saves of an already-urgent opportunity.

When triggered, creates a follow-up task in CRM:
- Linked directly to the opportunity (`opportunity: { id }`)
- Assigned to the opportunity owner
- Due in 3 days
- Subject: `Follow up: Urgent Opportunity – <displayId>`

**Response:** `202 Accepted` with `{ "accepted": true, "message": "Processing in background" }`

---

### `POST /webhooks/external-alerts`
**Pattern: Synchronous UI Extension — External Alerts (Account)**

This is **not** an AutoFlow. SSC V2 calls this endpoint on demand when rendering the Account page to display external alert signals in the UI (e.g. risk flags, compliance warnings).

SSC V2 sends the account context; the service responds synchronously with an `alerts` array. Replace the hardcoded sample alerts with your real data source.

**Response:** `200 OK` with `{ "count": 2, "alerts": [...] }`. Each alert has `signalType`, `icon`, `color`, `groupText`, and `message`.

---

### `POST /webhooks/account-insights-chart`
**Pattern: Synchronous UI Extension — Account Insights Chart**

This is **not** an AutoFlow. SSC V2 calls this endpoint when rendering a custom chart widget in the Account Insights panel.

SSC V2 sends the account context; the service responds synchronously with chart data. Replace the hardcoded values with your real data source.

**Response:** `200 OK` with `{ "total": 35.0, "data": [{ "name": "...", "y": <number> }, ...] }`

---

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

`beforeImage` contains the state **before** the save. Use it (as in the urgent opportunity task endpoint) to check what actually changed.

## ☁️ Cloud Foundry Deployment

```bash
cf push
cf set-env crm-extension-hub2 CRM_BASE_URL "https://your-tenant.crm.cloud.sap"
cf set-env crm-extension-hub2 CRM_USERNAME "your-username"
cf set-env crm-extension-hub2 CRM_PASSWORD "your-password"
cf restage crm-extension-hub2
```

## 📁 Project Structure

```
server.js          ← All endpoints and helpers (single file)
package.json       ← Minimal dependencies (express, dotenv)
manifest.yml       ← Cloud Foundry deployment config
env-template.txt   ← Template for .env (never commit .env)
```