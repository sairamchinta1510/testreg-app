# GCP Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy testreg-app on GCP using Cloud Functions + Cloud Storage, reachable at `gcp.testreg.tadpoleindustries.com`, running in parallel with the existing AWS deployment.

**Architecture:** Cloud Function (Node.js 20) handles all API routes behind a built-in HTTPS trigger. Registrations are stored as JSON files in a private Cloud Storage bucket. The static frontend (register.html + viewer.html) is served from a public Cloud Storage bucket via an HTTPS Load Balancer with a Google-managed SSL certificate.

**Tech Stack:** Node.js 20, `@google-cloud/storage` v7, `@google-cloud/functions-framework` v3, gcloud CLI, Cloud Storage, Cloud Functions (2nd gen), HTTPS Load Balancer, Route 53 (existing)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `gcp/index.js` | Create | Cloud Function entry point — adapts GCP req/res to service layer |
| `gcp/package.json` | Create | GCP dependencies |
| `gcp/.gcloudignore` | Create | Exclude frontend/ from function deployment |
| `gcp/utils/gcs.js` | Create | Cloud Storage CRUD — replaces `lambda/utils/s3.js` |
| `gcp/utils/logger.js` | Create | Copy of `lambda/utils/logger.js` — works unchanged |
| `gcp/utils/response.js` | Create | Copy of `lambda/utils/response.js` — works unchanged |
| `gcp/services/create.js` | Create | Copy of lambda version, imports `../utils/gcs` |
| `gcp/services/read.js` | Create | Copy of lambda version, imports `../utils/gcs` |
| `gcp/services/update.js` | Create | Copy of lambda version, imports `../utils/gcs` |
| `gcp/services/delete.js` | Create | Copy of lambda version, imports `../utils/gcs` |
| `gcp/frontend/register.html` | Create | GCP version — API_URL points to Cloud Function |
| `gcp/frontend/viewer.html` | Create | GCP version — API points to Cloud Function |

---

## Task 1: GCP Project Setup

**Files:** None (infrastructure only)

- [ ] **Step 1: Go to GCP Console and create a new project**

  Navigate to: https://console.cloud.google.com/projectcreate
  - Project name: `testreg-gcp`
  - Note the **Project ID** (may be `testreg-gcp` or `testreg-gcp-XXXXXX`) — you'll use it in every gcloud command below.

- [ ] **Step 2: Enable billing on the project**

  Navigate to: https://console.cloud.google.com/billing
  Link your billing account to `testreg-gcp`.

- [ ] **Step 3: Install gcloud CLI**

  Run in PowerShell:
  ```powershell
  winget install Google.CloudSDK --silent --accept-source-agreements --accept-package-agreements
  ```
  Then restart PowerShell to pick up the new PATH.

- [ ] **Step 4: Authenticate gcloud and set project**

  ```powershell
  gcloud auth login
  gcloud config set project YOUR_PROJECT_ID
  ```
  Replace `YOUR_PROJECT_ID` with the project ID from Step 1.
  Expected: browser opens for login, then `Updated property [core/project].`

- [ ] **Step 5: Enable required APIs**

  ```powershell
  gcloud services enable `
    cloudfunctions.googleapis.com `
    cloudbuild.googleapis.com `
    storage.googleapis.com `
    compute.googleapis.com `
    run.googleapis.com `
    artifactregistry.googleapis.com
  ```
  Expected: `Operation "operations/..." finished successfully.`

- [ ] **Step 6: Commit checkpoint**

  ```powershell
  cd C:\Users\schinta\testreg-app
  git add .
  git commit -m "chore: GCP project setup complete"
  git push
  ```

---

## Task 2: Create GCS Data Bucket

**Files:** None (infrastructure only)

- [ ] **Step 1: Create private data bucket**

  ```powershell
  gcloud storage buckets create gs://testreg-gcp-data `
    --location=europe-west1 `
    --uniform-bucket-level-access
  ```
  Expected: `Creating gs://testreg-gcp-data/...`
  > If the name is taken, use `testreg-gcp-data-YOUR_PROJECT_ID` and update all references below.

- [ ] **Step 2: Confirm bucket is private (no public access)**

  ```powershell
  gcloud storage buckets describe gs://testreg-gcp-data --format="value(iamConfiguration.publicAccessPrevention)"
  ```
  Expected: `enforced`

---

## Task 3: Write GCP Utility Files

**Files:**
- Create: `gcp/utils/gcs.js`
- Create: `gcp/utils/logger.js`
- Create: `gcp/utils/response.js`
- Create: `gcp/package.json`
- Create: `gcp/.gcloudignore`

- [ ] **Step 1: Create `gcp/utils/gcs.js`**

  ```js
  /**
   * gcs.js — Cloud Storage CRUD (GCP equivalent of s3.js)
   * Bucket name is read from GCS_BUCKET env var (set at deploy time).
   */
  const { Storage } = require("@google-cloud/storage");

  const storage = new Storage();
  const BUCKET  = process.env.GCS_BUCKET || "testreg-gcp-data";
  const PREFIX  = "registrations/";

  async function getObject(id) {
    const [contents] = await storage.bucket(BUCKET).file(`${PREFIX}${id}.json`).download();
    return JSON.parse(contents.toString());
  }

  async function putObject(id, data) {
    await storage.bucket(BUCKET).file(`${PREFIX}${id}.json`).save(
      JSON.stringify(data),
      { contentType: "application/json" }
    );
  }

  async function deleteObject(id) {
    await storage.bucket(BUCKET).file(`${PREFIX}${id}.json`).delete();
  }

  async function listObjects() {
    const [files] = await storage.bucket(BUCKET).getFiles({ prefix: PREFIX });
    const jsonFiles = files.filter(f => f.name.endsWith(".json"));
    jsonFiles.sort((a, b) => new Date(b.metadata.updated) - new Date(a.metadata.updated));
    return Promise.all(
      jsonFiles.map(f => getObject(f.name.replace(PREFIX, "").replace(".json", "")))
    );
  }

  module.exports = { getObject, putObject, deleteObject, listObjects };
  ```

- [ ] **Step 2: Create `gcp/utils/logger.js`** (exact copy of `lambda/utils/logger.js`)

  ```js
  /**
   * logger.js — Structured Cloud Logging logger
   * Cloud Functions automatically stream console output to Cloud Logging.
   * Sensitive fields (ssn) are redacted before logging.
   */
  const REDACTED_FIELDS = ["ssn"];

  function redact(obj) {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(redact);
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) =>
        REDACTED_FIELDS.includes(k) ? [k, "***REDACTED***"] : [k, redact(v)]
      )
    );
  }

  function log(level, message, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(data !== undefined ? { data } : {})
    };
    console.log(JSON.stringify(entry));
  }

  function logRequest(method, path, body) {
    let parsed;
    try { parsed = body ? JSON.parse(body) : undefined; } catch { parsed = body; }
    log("INFO", "Incoming request", { method, path, body: redact(parsed) });
  }

  function logResponse(method, path, response) {
    let parsedBody;
    try { parsedBody = response.body ? JSON.parse(response.body) : undefined; } catch { parsedBody = response.body; }
    log("INFO", "Outgoing response", {
      method,
      path,
      statusCode: response.statusCode,
      body: redact(parsedBody)
    });
  }

  function logError(message, error) {
    log("ERROR", message, { error: error?.message || String(error), stack: error?.stack });
  }

  module.exports = { logRequest, logResponse, logError };
  ```

- [ ] **Step 3: Create `gcp/utils/response.js`** (exact copy of `lambda/utils/response.js`)

  ```js
  const ok  = (body)      => ({ statusCode: 200, body: JSON.stringify(body) });
  const err = (code, msg) => ({ statusCode: code, body: JSON.stringify({ error: msg }) });

  module.exports = { ok, err };
  ```

- [ ] **Step 4: Create `gcp/package.json`**

  ```json
  {
    "name": "testreg-save-gcp",
    "version": "1.0.0",
    "description": "testreg-app Cloud Function for GCP",
    "main": "index.js",
    "engines": { "node": "20" },
    "dependencies": {
      "@google-cloud/functions-framework": "^3.3.0",
      "@google-cloud/storage": "^7.7.0"
    }
  }
  ```

- [ ] **Step 5: Create `gcp/.gcloudignore`**

  ```
  frontend/
  node_modules/
  .git
  ```

- [ ] **Step 6: Commit**

  ```powershell
  cd C:\Users\schinta\testreg-app
  git add gcp/
  git commit -m "feat: add GCP utility files (gcs, logger, response)"
  git push
  ```

---

## Task 4: Write GCP Service Files

**Files:**
- Create: `gcp/services/create.js`
- Create: `gcp/services/read.js`
- Create: `gcp/services/update.js`
- Create: `gcp/services/delete.js`

These are identical to the `lambda/services/` files except the storage import is `../utils/gcs`.

- [ ] **Step 1: Create `gcp/services/create.js`**

  ```js
  /**
   * CREATE — POST /register
   * Body: { firstName, lastName, address, ssn }
   * Returns: { success, id, message }
   */
  const { putObject } = require("../utils/gcs");
  const { ok, err }   = require("../utils/response");

  async function createRegistration(event) {
    const body = JSON.parse(event.body || "{}");
    const { firstName, lastName, address, ssn } = body;

    if (!firstName || !lastName || !address || !ssn) {
      return err(400, "Missing required fields: firstName, lastName, address, ssn");
    }

    const id    = Date.now();
    const entry = { id, firstName, lastName, address, ssn, registeredAt: new Date().toISOString() };

    await putObject(id, entry);
    return ok({ success: true, id, message: `Registration #${id} saved.` });
  }

  module.exports = { createRegistration };
  ```

- [ ] **Step 2: Create `gcp/services/read.js`**

  ```js
  /**
   * READ ALL — GET /registrations
   * READ ONE — GET /registrations/{id}
   */
  const { listObjects, getObject } = require("../utils/gcs");
  const { ok, err }                = require("../utils/response");

  async function listRegistrations() {
    const entries = await listObjects();
    return ok(entries);
  }

  async function getRegistration(id) {
    if (!id) return err(400, "Missing registration ID");
    const entry = await getObject(id);
    return ok(entry);
  }

  module.exports = { listRegistrations, getRegistration };
  ```

- [ ] **Step 3: Create `gcp/services/update.js`**

  ```js
  /**
   * UPDATE — PUT /registrations/{id}
   * Body: { firstName?, lastName?, address?, ssn? }
   * Returns: { success, entry }
   */
  const { getObject, putObject } = require("../utils/gcs");
  const { ok, err }              = require("../utils/response");

  async function updateRegistration(id, event) {
    if (!id) return err(400, "Missing registration ID");

    const updates  = JSON.parse(event.body || "{}");
    const existing = await getObject(id);

    const updated = {
      ...existing,
      ...updates,
      id:           existing.id,
      registeredAt: existing.registeredAt,
      updatedAt:    new Date().toISOString()
    };

    await putObject(id, updated);
    return ok({ success: true, entry: updated });
  }

  module.exports = { updateRegistration };
  ```

- [ ] **Step 4: Create `gcp/services/delete.js`**

  ```js
  /**
   * DELETE — DELETE /registrations/{id}
   * Returns: { success, message }
   */
  const { deleteObject } = require("../utils/gcs");
  const { ok, err }      = require("../utils/response");

  async function deleteRegistration(id) {
    if (!id) return err(400, "Missing registration ID");
    await deleteObject(id);
    return ok({ success: true, message: `Registration ${id} deleted.` });
  }

  module.exports = { deleteRegistration };
  ```

- [ ] **Step 5: Commit**

  ```powershell
  cd C:\Users\schinta\testreg-app
  git add gcp/services/
  git commit -m "feat: add GCP service files (create, read, update, delete)"
  git push
  ```

---

## Task 5: Write Cloud Function Entry Point

**Files:**
- Create: `gcp/index.js`

- [ ] **Step 1: Create `gcp/index.js`**

  ```js
  /**
   * index.js — Cloud Function entry point (GCP)
   * Adapts Cloud Functions req/res into Lambda-event shape
   * so all service files work without modification.
   *
   * Routes:
   *   POST   /register              → createRegistration
   *   GET    /registrations         → listRegistrations
   *   GET    /registrations/{id}    → getRegistration
   *   PUT    /registrations/{id}    → updateRegistration
   *   DELETE /registrations/{id}    → deleteRegistration
   */
  const functions = require("@google-cloud/functions-framework");

  const { createRegistration }                 = require("./services/create");
  const { listRegistrations, getRegistration } = require("./services/read");
  const { updateRegistration }                 = require("./services/update");
  const { deleteRegistration }                 = require("./services/delete");
  const { logRequest, logResponse, logError }  = require("./utils/logger");

  const CORS_HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  functions.http("handler", async (req, res) => {
    res.set(CORS_HEADERS);

    const method = req.method;
    const path   = req.path;
    const id     = path.startsWith("/registrations/") ? path.split("/").pop() : null;

    if (method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    // Normalise to Lambda-event shape so all service files work unchanged
    const event = {
      body:           req.body ? JSON.stringify(req.body) : null,
      requestContext: { http: { method } },
      rawPath:        path
    };

    logRequest(method, path, event.body);

    let result;
    try {
      if      (method === "POST"   && path === "/register")                result = await createRegistration(event);
      else if (method === "GET"    && path === "/registrations")           result = await listRegistrations();
      else if (method === "GET"    && path.startsWith("/registrations/"))  result = await getRegistration(id);
      else if (method === "PUT"    && path.startsWith("/registrations/"))  result = await updateRegistration(id, event);
      else if (method === "DELETE" && path.startsWith("/registrations/"))  result = await deleteRegistration(id);
      else result = { statusCode: 404, body: JSON.stringify({ error: `Route not found: ${method} ${path}` }) };
    } catch (e) {
      logError("Unhandled error", e);
      result = { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) };
    }

    logResponse(method, path, result);
    res.status(result.statusCode).set("Content-Type", "application/json").send(result.body);
  });
  ```

- [ ] **Step 2: Commit**

  ```powershell
  cd C:\Users\schinta\testreg-app
  git add gcp/index.js
  git commit -m "feat: add GCP Cloud Function entry point"
  git push
  ```

---

## Task 6: Deploy Cloud Function

**Files:** None (deployment only)

- [ ] **Step 1: Install npm dependencies in gcp/**

  ```powershell
  cd C:\Users\schinta\testreg-app\gcp
  npm install
  ```
  Expected: `added N packages`

- [ ] **Step 2: Grant Cloud Build service account Storage Admin on data bucket**

  ```powershell
  $PROJECT_ID = gcloud config get-value project
  $PROJECT_NUMBER = gcloud projects describe $PROJECT_ID --format="value(projectNumber)"

  gcloud storage buckets add-iam-policy-binding gs://testreg-gcp-data `
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" `
    --role="roles/storage.objectAdmin"
  ```
  Expected: `Updated IAM policy for bucket [testreg-gcp-data].`

- [ ] **Step 3: Deploy the Cloud Function**

  ```powershell
  cd C:\Users\schinta\testreg-app\gcp

  gcloud functions deploy testreg-save-gcp `
    --gen2 `
    --runtime=nodejs20 `
    --region=europe-west1 `
    --source=. `
    --entry-point=handler `
    --trigger-http `
    --allow-unauthenticated `
    --set-env-vars GCS_BUCKET=testreg-gcp-data `
    --memory=256Mi `
    --timeout=30s
  ```
  Expected: `... State: ACTIVE ... uri: https://testreg-save-gcp-XXXX-ew.a.run.app`

- [ ] **Step 4: Note the Cloud Function URL**

  ```powershell
  gcloud functions describe testreg-save-gcp `
    --gen2 --region=europe-west1 `
    --format="value(serviceConfig.uri)"
  ```
  Copy this URL — you'll need it in Task 7 and Task 8.
  It will look like: `https://testreg-save-gcp-XXXX-ew.a.run.app`

- [ ] **Step 5: Smoke-test the Cloud Function**

  Replace `FUNCTION_URL` with the URL from Step 4:
  ```powershell
  $F = "FUNCTION_URL"

  # POST
  Invoke-RestMethod -Method POST -Uri "$F/register" `
    -ContentType "application/json" `
    -Body '{"firstName":"GCP","lastName":"Test","address":"1 Cloud Lane, London","ssn":"111-22-3333"}'

  # GET list
  Invoke-RestMethod -Method GET -Uri "$F/registrations"
  ```
  Expected: `{ success: true, id: ..., message: "Registration #... saved." }` then a list with the new entry.

---

## Task 7: Create GCP Frontend HTML

**Files:**
- Create: `gcp/frontend/register.html`
- Create: `gcp/frontend/viewer.html`

Replace `FUNCTION_URL` in the steps below with the actual URL from Task 6 Step 4.

- [ ] **Step 1: Create `gcp/frontend/register.html`**

  Copy the content of `register.html` (repo root) exactly, but change line:
  ```js
  const API_URL = 'https://x7g2e51ala.execute-api.eu-west-1.amazonaws.com/prod/register';
  ```
  to:
  ```js
  const API_URL = 'FUNCTION_URL/register';
  ```

- [ ] **Step 2: Create `gcp/frontend/viewer.html`**

  Copy the content of `viewer.html` (repo root) exactly, but change line:
  ```js
  const API = 'https://x7g2e51ala.execute-api.eu-west-1.amazonaws.com/prod';
  ```
  to:
  ```js
  const API = 'FUNCTION_URL';
  ```

- [ ] **Step 3: Commit**

  ```powershell
  cd C:\Users\schinta\testreg-app
  git add gcp/frontend/
  git commit -m "feat: add GCP frontend HTML with updated API URL"
  git push
  ```

---

## Task 8: Create Frontend GCS Bucket and Upload HTML

**Files:** None (infrastructure + deployment)

- [ ] **Step 1: Create public frontend bucket**

  ```powershell
  $PROJECT_ID = gcloud config get-value project

  gcloud storage buckets create gs://testreg-gcp-frontend-$PROJECT_ID `
    --location=europe-west1 `
    --uniform-bucket-level-access
  ```
  Note the full bucket name (e.g. `testreg-gcp-frontend-testreg-gcp`) — used in all steps below.

- [ ] **Step 2: Allow public read on frontend bucket**

  ```powershell
  gcloud storage buckets add-iam-policy-binding gs://testreg-gcp-frontend-$PROJECT_ID `
    --member="allUsers" `
    --role="roles/storage.objectViewer"
  ```
  Expected: `Updated IAM policy for bucket [testreg-gcp-frontend-...]`

- [ ] **Step 3: Upload HTML files**

  ```powershell
  gcloud storage cp C:\Users\schinta\testreg-app\gcp\frontend\register.html `
    gs://testreg-gcp-frontend-$PROJECT_ID/register.html

  gcloud storage cp C:\Users\schinta\testreg-app\gcp\frontend\viewer.html `
    gs://testreg-gcp-frontend-$PROJECT_ID/viewer.html
  ```
  Expected: `Copying ... Done`

- [ ] **Step 4: Set website index document**

  ```powershell
  gcloud storage buckets update gs://testreg-gcp-frontend-$PROJECT_ID `
    --web-main-page-suffix=register.html
  ```

- [ ] **Step 5: Smoke-test direct GCS URL**

  ```powershell
  $BUCKET = "testreg-gcp-frontend-$PROJECT_ID"
  Invoke-RestMethod "https://storage.googleapis.com/$BUCKET/register.html" | Select-Object -First 5
  ```
  Expected: first lines of the HTML.

---

## Task 9: Create HTTPS Load Balancer for Custom Domain

**Files:** None (infrastructure only)

This gives the frontend a stable IP for the custom domain + Google-managed SSL.

- [ ] **Step 1: Reserve a global static IP**

  ```powershell
  gcloud compute addresses create testreg-gcp-ip `
    --network-tier=PREMIUM `
    --ip-version=IPV4 `
    --global

  gcloud compute addresses describe testreg-gcp-ip --global --format="value(address)"
  ```
  **Copy this IP address** — you will add it to Route 53 in Task 10.

- [ ] **Step 2: Create backend bucket**

  ```powershell
  $PROJECT_ID = gcloud config get-value project

  gcloud compute backend-buckets create testreg-gcp-backend `
    --gcs-bucket-name=testreg-gcp-frontend-$PROJECT_ID `
    --enable-cdn
  ```

- [ ] **Step 3: Create URL map**

  ```powershell
  gcloud compute url-maps create testreg-gcp-urlmap `
    --default-backend-bucket=testreg-gcp-backend
  ```

- [ ] **Step 4: Create Google-managed SSL certificate**

  ```powershell
  gcloud compute ssl-certificates create testreg-gcp-cert `
    --domains=gcp.testreg.tadpoleindustries.com `
    --global
  ```
  > The certificate will only provision fully once the DNS record is pointing to the LB IP (Step 10). This is normal.

- [ ] **Step 5: Create target HTTPS proxy**

  ```powershell
  gcloud compute target-https-proxies create testreg-gcp-https-proxy `
    --url-map=testreg-gcp-urlmap `
    --ssl-certificates=testreg-gcp-cert `
    --global
  ```

- [ ] **Step 6: Create forwarding rule (binds IP to proxy)**

  ```powershell
  gcloud compute forwarding-rules create testreg-gcp-forwarding `
    --address=testreg-gcp-ip `
    --target-https-proxy=testreg-gcp-https-proxy `
    --ports=443 `
    --global
  ```

- [ ] **Step 7: Verify load balancer is configured**

  ```powershell
  gcloud compute forwarding-rules describe testreg-gcp-forwarding --global `
    --format="table(IPAddress,target,portRange)"
  ```
  Expected: shows the static IP, the https-proxy, and port 443.

---

## Task 10: Configure DNS in Route 53

**Files:** None (DNS configuration)

- [ ] **Step 1: Log in to AWS Console and go to Route 53**

  Navigate to: https://console.aws.amazon.com/route53/v2/hostedzones
  Find the hosted zone for `tadpoleindustries.com` and click into it.

- [ ] **Step 2: Create an A record for `gcp.testreg.tadpoleindustries.com`**

  Click **Create record**:
  - Record name: `gcp.testreg`
  - Record type: **A**
  - Value: *(paste the static IP from Task 9 Step 1)*
  - TTL: 300
  - Click **Create records**

- [ ] **Step 3: Verify DNS propagation**

  ```powershell
  Resolve-DnsName gcp.testreg.tadpoleindustries.com
  ```
  Expected: returns the GCP static IP. May take a few minutes to propagate.

- [ ] **Step 4: Wait for SSL certificate to provision**

  ```powershell
  gcloud compute ssl-certificates describe testreg-gcp-cert `
    --global --format="value(managed.status)"
  ```
  Expected: `ACTIVE` (may take 15-60 minutes after DNS propagates).
  If it shows `PROVISIONING`, wait and re-run.

---

## Task 11: End-to-End Verification

**Files:** None

- [ ] **Step 1: Test all API endpoints via Cloud Function URL**

  Replace `FUNCTION_URL` with actual URL from Task 6 Step 4:
  ```powershell
  $F = "FUNCTION_URL"

  # POST
  $new = Invoke-RestMethod -Method POST -Uri "$F/register" `
    -ContentType "application/json" `
    -Body '{"firstName":"E2E","lastName":"Test","address":"99 Verify St, London","ssn":"999-88-7777"}'
  Write-Host "Created: $($new.id)"
  $id = $new.id

  # GET list
  $list = Invoke-RestMethod -Method GET -Uri "$F/registrations"
  Write-Host "Total registrations: $($list.Count)"

  # GET one
  Invoke-RestMethod -Method GET -Uri "$F/registrations/$id"

  # PUT
  Invoke-RestMethod -Method PUT -Uri "$F/registrations/$id" `
    -ContentType "application/json" -Body '{"address":"100 Updated St"}'

  # DELETE
  Invoke-RestMethod -Method DELETE -Uri "$F/registrations/$id"
  Write-Host "All endpoints verified"
  ```

- [ ] **Step 2: Test frontend via custom domain**

  Open in browser: `https://gcp.testreg.tadpoleindustries.com/register.html`
  - Submit a registration → should show success banner
  - Open: `https://gcp.testreg.tadpoleindustries.com/viewer.html`
  - The submitted registration should appear in the list

- [ ] **Step 3: Verify Cloud Logging captures logs**

  ```powershell
  gcloud logging read `
    'resource.type="cloud_run_revision" AND resource.labels.service_name="testreg-save-gcp"' `
    --limit=10 `
    --format="value(textPayload)"
  ```
  Expected: JSON log lines with `"message": "Incoming request"` and `"message": "Outgoing response"`, SSN showing `***REDACTED***`.

- [ ] **Step 4: Final commit**

  ```powershell
  cd C:\Users\schinta\testreg-app
  git add .
  git commit -m "feat: complete GCP deployment — Cloud Functions + Cloud Storage + LB"
  git push
  ```

---

## Summary of Resources Created

| Resource | Name | Notes |
|----------|------|-------|
| GCS data bucket | `testreg-gcp-data` | Private, stores JSON files |
| GCS frontend bucket | `testreg-gcp-frontend-PROJECT_ID` | Public, hosts HTML |
| Cloud Function | `testreg-save-gcp` | europe-west1, Node.js 20 |
| Static IP | `testreg-gcp-ip` | Used by LB |
| Backend bucket | `testreg-gcp-backend` | Wraps frontend GCS bucket |
| URL map | `testreg-gcp-urlmap` | Routes to backend bucket |
| SSL certificate | `testreg-gcp-cert` | Google-managed, auto-renews |
| HTTPS proxy | `testreg-gcp-https-proxy` | Terminates TLS |
| Forwarding rule | `testreg-gcp-forwarding` | Binds IP:443 to proxy |
| DNS A record | `gcp.testreg.tadpoleindustries.com` | Points to static IP |
