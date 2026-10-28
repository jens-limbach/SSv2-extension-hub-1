# CRM Extension Hub

A minimal Express-based webhook microservice for SAP Sales and Service Cloud V2 (SSC V2). Demonstrates the key extension patterns available in SSC V2: synchronous and asynchronous AutoFlows and UI Extension data providers. Designed as a single-file central extension hub.

## 🚀 Quick Start

Get from zero to a running microservice in five steps with a simple web interface that leads you step by step through the configuration.

1. **Prerequisites** — A Cloud Foundry account with a target space, and the `cf` CLI installed and logged in (`cf login`). A local Node.js install is *optional* — it is not required to deploy.

2. **Clone the repository** — In a terminal:
   ```bash
   git clone <repository-url>
   ```
   Then open the folder in VS Code (`code .`, or **File → Open Folder**).

3. **Make the app name unique** *(only on a BTP trial or a shared BTP account)* — App names and routes must be unique per landscape. In `manifest.yml`, append your initials or another suffix to `name` (e.g. `crm-extension-hub-abc`), and use that same name in the commands below.

4. **Deploy to Cloud Foundry** — From the project folder, push the app and set your CRM credentials:
   ```bash
   cf push
   cf set-env crm-extension-hub CRM_BASE_URL "myxxxxxxx.de1.demo.crm.cloud.sap"
   cf set-env crm-extension-hub CRM_USERNAME "your-username"
   cf set-env crm-extension-hub CRM_PASSWORD "your-password"
   cf restage crm-extension-hub
   ```
   Replace the app name (`crm-extension-hub`, defined in `manifest.yml`) and the values with your own.

5. **Open the dashboard** — Find your app's URL (the `routes` line in `cf app crm-extension-hub`, or the output of `cf push`) and open `https://<your-route>/` in a browser.

6. **Follow the on-page instructions** — The dashboard lists every endpoint with its live URL and copy buttons, lets you send sample payloads with the **Try it** buttons, and gives step-by-step **"How to set this up in SAP Sales and Service Cloud V2"** instructions for each use case. Configure everything from there.

### Run locally (optional)

Local running is only useful for reading and inspecting the code — the webhook use cases need a reachable SSC V2 tenant, so **live CRM calls will not work locally**.

```bash
npm install                      # install dependencies
copy env-template.txt .env       # then fill in your CRM credentials
npm run dev                      # runs on http://localhost:3000
```

Open `http://localhost:3000/` to view the dashboard locally.

## 🖥️ Live Dashboard

The service serves a lean, zero-build educational dashboard at its **root URL** (`/`). It is plain static HTML/CSS/JS in `public/`, served by the same Express app — no framework, no bundler. It gives you:

- The **live hostname** and copy-paste-ready full URL for every webhook
- A **health indicator** (pings `/health`)
- Per-endpoint **"How to set this up in SAP Sales and Service Cloud V2"** step-by-step instructions
- **"Try it"** buttons that POST a realistic sample payload so you can see sync (`200`) vs. async (`202`) behaviour without a live tenant
- A **delay toggle** for the async score webhook (10s slow ⟷ 0s instant)

The delay toggle is **in-memory and demo-only**: it resets on restart and affects a single instance. It is driven by `GET`/`POST /api/config`; the endpoint catalogue comes from `GET /api/endpoints`.

### Viewing logs

Since you most likely deployed with the Cloud Foundry CLI, watching the service is one more command:

```bash
cf logs crm-extension-hub            # live tail
cf logs crm-extension-hub --recent   # dump recent logs
```

Log lines use emoji prefixes: ✅ info · 🔄 async started · ⏳ waiting · 📡 outbound call · ⚠️ warning · ❌ error.


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

## 📁 Project Structure

```
server.js          ← All endpoints and helpers (single file)
public/            ← Static educational dashboard (index.html, styles.css, app.js)
package.json       ← Minimal dependencies (express, dotenv)
manifest.yml       ← Cloud Foundry deployment config
env-template.txt   ← Template for .env (never commit .env)
```