# BigQuery Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Cloud Storage (GCS) as the GCP registration data store with BigQuery, migrating existing records and updating the Cloud Function — with no changes to service files.

**Architecture:** A new `gcp/utils/bigquery.js` exports the same 4-function interface (`getObject`, `putObject`, `deleteObject`, `listObjects`) as the current `gcs.js`. The import in each service file is updated from `../utils/gcs` to `../utils/bigquery`. All 5 existing GCS records are loaded into BigQuery before the new function is deployed.

**Tech Stack:** `@google-cloud/bigquery` npm package, BigQuery DML (INSERT/UPDATE/DELETE), parameterised queries, GCP Cloud Functions 2nd gen (Node 20).

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Create | `gcp/utils/bigquery.js` | New storage utility — same interface as `gcs.js` |
| Modify | `gcp/package.json` | Add `@google-cloud/bigquery` dependency |
| Modify | `gcp/services/create.js` | Change import from `../utils/gcs` → `../utils/bigquery` |
| Modify | `gcp/services/read.js` | Change import from `../utils/gcs` → `../utils/bigquery` |
| Modify | `gcp/services/update.js` | Change import from `../utils/gcs` → `../utils/bigquery` |
| Modify | `gcp/services/delete.js` | Change import from `../utils/gcs` → `../utils/bigquery` |
| No change | `gcp/index.js` | — |
| No change | `gcp/utils/logger.js` | — |
| No change | `gcp/utils/response.js` | — |
| No change | `gcp/utils/gcs.js` | Kept but no longer used by services |

---

## Task 1: Enable BigQuery API and create dataset + table

**Files:** None (infrastructure only)

- [ ] **Step 1: Enable BigQuery API**

```powershell
gcloud services enable bigquery.googleapis.com --project=prj-d-srdl-casas-4zrs
```

Expected output: `Operation ... finished successfully.`

- [ ] **Step 2: Create dataset**

```powershell
bq mk --dataset --location=europe-west1 --project_id=prj-d-srdl-casas-4zrs testreg
```

Expected output: `Dataset 'prj-d-srdl-casas-4zrs:testreg' successfully created.`

- [ ] **Step 3: Create registrations table with schema**

```powershell
bq mk --table `
  prj-d-srdl-casas-4zrs:testreg.registrations `
  id:STRING,firstName:STRING,lastName:STRING,email:STRING,phone:STRING,address:STRING,city:STRING,postcode:STRING,country:STRING,dob:STRING,ssn:STRING,registeredAt:TIMESTAMP,updatedAt:TIMESTAMP
```

Expected output: `Table 'prj-d-srdl-casas-4zrs:testreg.registrations' successfully created.`

- [ ] **Step 4: Grant service account BigQuery access**

```powershell
gcloud projects add-iam-policy-binding prj-d-srdl-casas-4zrs `
  --member="serviceAccount:218522663210-compute@developer.gserviceaccount.com" `
  --role="roles/bigquery.dataEditor" --condition=None
```

Also grant job creation (needed for DML queries):

```powershell
gcloud projects add-iam-policy-binding prj-d-srdl-casas-4zrs `
  --member="serviceAccount:218522663210-compute@developer.gserviceaccount.com" `
  --role="roles/bigquery.jobUser" --condition=None
```

- [ ] **Step 5: Verify table exists**

```powershell
bq show prj-d-srdl-casas-4zrs:testreg.registrations
```

Expected: schema printed with all 13 columns.

---

## Task 2: Migrate existing GCS records to BigQuery

**Files:** None (data migration only)

- [ ] **Step 1: Download current data from GCS**

```powershell
gcloud storage cat gs://testreg-gcp-data/registrations/index.json --project=prj-d-srdl-casas-4zrs | Out-File -Encoding utf8 "$env:TEMP\registrations.json"
Get-Content "$env:TEMP\registrations.json" | ConvertFrom-Json | Measure-Object | Select-Object -ExpandProperty Count
```

Expected: prints count (should be 5).

- [ ] **Step 2: Transform and load records into BigQuery**

Run this PowerShell script to insert all records:

```powershell
$records = Get-Content "$env:TEMP\registrations.json" | ConvertFrom-Json
foreach ($r in $records) {
  $id           = [string]$r.id
  $firstName    = $r.firstName  -replace "'","''"
  $lastName     = $r.lastName   -replace "'","''"
  $email        = if ($r.email)    { "'$($r.email    -replace "'","''"  )'" } else { "NULL" }
  $phone        = if ($r.phone)    { "'$($r.phone    -replace "'","''"  )'" } else { "NULL" }
  $address      = $r.address    -replace "'","''"
  $city         = if ($r.city)     { "'$($r.city     -replace "'","''"  )'" } else { "NULL" }
  $postcode     = if ($r.postcode) { "'$($r.postcode -replace "'","''"  )'" } else { "NULL" }
  $country      = if ($r.country)  { "'$($r.country  -replace "'","''"  )'" } else { "NULL" }
  $dob          = if ($r.dob)      { "'$($r.dob)'"}                           else { "NULL" }
  $ssn          = if ($r.ssn)      { "'$($r.ssn      -replace "'","''"  )'" } else { "NULL" }
  $registeredAt = $r.registeredAt
  $updatedAt    = if ($r.updatedAt) { "'$($r.updatedAt)'" } else { "NULL" }

  $sql = "INSERT INTO \`prj-d-srdl-casas-4zrs.testreg.registrations\` " +
    "(id,firstName,lastName,email,phone,address,city,postcode,country,dob,ssn,registeredAt,updatedAt) VALUES " +
    "('$id','$firstName','$lastName',$email,$phone,'$address',$city,$postcode,$country,$dob,$ssn,'$registeredAt',$updatedAt)"

  bq query --use_legacy_sql=false --project_id=prj-d-srdl-casas-4zrs $sql
  Write-Host "Inserted $id"
}
```

Expected: `Inserted <id>` printed for each record.

- [ ] **Step 3: Verify row count**

```powershell
bq query --use_legacy_sql=false --project_id=prj-d-srdl-casas-4zrs "SELECT COUNT(*) as total FROM \`prj-d-srdl-casas-4zrs.testreg.registrations\`"
```

Expected: `total` equals the count from Step 1.

---

## Task 3: Add `@google-cloud/bigquery` dependency

**Files:**
- Modify: `gcp/package.json`

- [ ] **Step 1: Add dependency to package.json**

Edit `gcp/package.json` — add `"@google-cloud/bigquery": "^7.3.0"` to dependencies:

```json
{
  "name": "testreg-save-gcp",
  "version": "1.0.0",
  "description": "testreg-app Cloud Function for GCP",
  "main": "index.js",
  "engines": { "node": "20" },
  "dependencies": {
    "@google-cloud/bigquery": "^7.3.0",
    "@google-cloud/functions-framework": "^3.3.0",
    "@google-cloud/storage": "^7.7.0"
  }
}
```

- [ ] **Step 2: Install**

```powershell
cd C:\Users\schinta\testreg-app\gcp
npm install
```

Expected: `added N packages` (no errors).

- [ ] **Step 3: Commit**

```powershell
cd C:\Users\schinta\testreg-app
git add gcp/package.json gcp/package-lock.json
git commit -m "chore: add @google-cloud/bigquery dependency"
```

---

## Task 4: Write `gcp/utils/bigquery.js`

**Files:**
- Create: `gcp/utils/bigquery.js`

- [ ] **Step 1: Create the file**

Create `gcp/utils/bigquery.js` with this exact content:

```js
/**
 * bigquery.js — BigQuery CRUD for registrations
 * Same 4-function interface as gcs.js so all service files work unchanged.
 */
const { BigQuery } = require("@google-cloud/bigquery");

const bq      = new BigQuery({ projectId: process.env.GCP_PROJECT || "prj-d-srdl-casas-4zrs" });
const DATASET = "testreg";
const TABLE   = "registrations";
const FULL    = `\`${bq.projectId}.${DATASET}.${TABLE}\``;

// Normalise a BigQuery row: convert Date objects to ISO strings
function normalise(row) {
  const r = Object.assign({}, row);
  if (r.registeredAt && r.registeredAt.value) r.registeredAt = r.registeredAt.value;
  if (r.updatedAt    && r.updatedAt.value)    r.updatedAt    = r.updatedAt.value;
  if (r.updatedAt === null) delete r.updatedAt;
  return r;
}

async function getObject(id) {
  const [rows] = await bq.query({
    query:  `SELECT * FROM ${FULL} WHERE id = @id LIMIT 1`,
    params: { id: String(id) }
  });
  if (!rows.length) throw new Error(`Registration not found: ${id}`);
  return normalise(rows[0]);
}

async function putObject(id, data) {
  const safeId = String(id);
  // Try UPDATE first — if 0 rows affected, INSERT
  const updateFields = Object.keys(data)
    .filter(k => k !== "id" && k !== "registeredAt")
    .map(k => `${k} = @${k}`)
    .join(", ");

  const params = { id: safeId, ...Object.fromEntries(
    Object.entries(data)
      .filter(([k]) => k !== "id" && k !== "registeredAt")
      .map(([k, v]) => [k, v ?? null])
  )};

  const [updateJob] = await bq.createQueryJob({
    query:  `UPDATE ${FULL} SET ${updateFields} WHERE id = @id`,
    params
  });
  const [updateRows] = await updateJob.getQueryResults();

  // getQueryResults for DML returns metadata; check numDmlAffectedRows
  const metadata = await updateJob.getMetadata();
  const affected  = parseInt(metadata[0]?.statistics?.query?.numDmlAffectedRows || "0", 10);

  if (affected === 0) {
    // Record doesn't exist — INSERT
    await bq.dataset(DATASET).table(TABLE).insert([{
      id:           safeId,
      firstName:    data.firstName    ?? null,
      lastName:     data.lastName     ?? null,
      email:        data.email        ?? null,
      phone:        data.phone        ?? null,
      address:      data.address      ?? null,
      city:         data.city         ?? null,
      postcode:     data.postcode     ?? null,
      country:      data.country      ?? null,
      dob:          data.dob          ?? null,
      ssn:          data.ssn          ?? null,
      registeredAt: data.registeredAt ?? new Date().toISOString(),
      updatedAt:    data.updatedAt    ?? null
    }]);
  }
}

async function deleteObject(id) {
  await bq.query({
    query:  `DELETE FROM ${FULL} WHERE id = @id`,
    params: { id: String(id) }
  });
}

async function listObjects() {
  const [rows] = await bq.query({
    query: `SELECT * FROM ${FULL} ORDER BY registeredAt DESC`
  });
  return rows.map(normalise);
}

module.exports = { getObject, putObject, deleteObject, listObjects };
```

- [ ] **Step 2: Verify the file was saved**

```powershell
Get-Content C:\Users\schinta\testreg-app\gcp\utils\bigquery.js | Measure-Object -Line | Select-Object -ExpandProperty Lines
```

Expected: 70+ lines.

- [ ] **Step 3: Commit**

```powershell
cd C:\Users\schinta\testreg-app
git add gcp/utils/bigquery.js
git commit -m "feat: add BigQuery storage utility for GCP"
```

---

## Task 5: Update service file imports

**Files:**
- Modify: `gcp/services/create.js`
- Modify: `gcp/services/read.js`
- Modify: `gcp/services/update.js`
- Modify: `gcp/services/delete.js`

- [ ] **Step 1: Update create.js**

In `gcp/services/create.js`, change:
```js
const { putObject } = require("../utils/gcs");
```
to:
```js
const { putObject } = require("../utils/bigquery");
```

- [ ] **Step 2: Update read.js**

In `gcp/services/read.js`, change:
```js
const { listObjects, getObject } = require("../utils/gcs");
```
to:
```js
const { listObjects, getObject } = require("../utils/bigquery");
```

- [ ] **Step 3: Update update.js**

In `gcp/services/update.js`, change:
```js
const { getObject, putObject } = require("../utils/gcs");
```
to:
```js
const { getObject, putObject } = require("../utils/bigquery");
```

- [ ] **Step 4: Update delete.js**

In `gcp/services/delete.js`, change:
```js
const { deleteObject } = require("../utils/gcs");
```
to:
```js
const { deleteObject } = require("../utils/bigquery");
```

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\schinta\testreg-app
git add gcp/services/create.js gcp/services/read.js gcp/services/update.js gcp/services/delete.js
git commit -m "feat: switch GCP services from GCS to BigQuery"
```

---

## Task 6: Deploy and verify

**Files:** None (deployment only)

- [ ] **Step 1: Deploy updated Cloud Function**

```powershell
cd C:\Users\schinta\testreg-app\gcp
gcloud functions deploy testreg-gcp `
  --gen2 --runtime=nodejs20 --region=europe-west1 `
  --source=. --entry-point=handler --trigger-http `
  --set-env-vars=GCS_BUCKET=testreg-gcp-data `
  --project=prj-d-srdl-casas-4zrs 2>&1 | Select-Object -Last 5
```

Expected: `state: ACTIVE`

- [ ] **Step 2: Smoke test — GET list**

```powershell
$BASE = "https://europe-west1-prj-d-srdl-casas-4zrs.cloudfunctions.net/testreg-gcp"
$list = Invoke-RestMethod -Uri "$BASE/registrations"
Write-Host "Records: $($list.count)"
```

Expected: count equals the number of migrated records.

- [ ] **Step 3: Smoke test — POST new registration**

```powershell
$BASE = "https://europe-west1-prj-d-srdl-casas-4zrs.cloudfunctions.net/testreg-gcp"
$body = @{
  firstName="BigQuery"; lastName="Test"; email="bq@test.com"
  phone="07700900001"; address="1 BQ Lane"; city="London"
  postcode="EC1A 1BB"; country="UK"; dob="1990-01-01"; ssn="111-22-3333"
} | ConvertTo-Json
$r = Invoke-RestMethod -Uri "$BASE/register" -Method POST -Body $body -ContentType "application/json"
Write-Host "POST: success=$($r.success) id=$($r.id)"
```

Expected: `success=True id=<timestamp>`

- [ ] **Step 4: Smoke test — GET one**

```powershell
$id = $r.id
$one = Invoke-RestMethod -Uri "$BASE/registrations/$id"
Write-Host "GET one: $($one.firstName) $($one.lastName)"
```

Expected: `BigQuery Test`

- [ ] **Step 5: Smoke test — PUT (update)**

```powershell
$update = @{ firstName="BigQuery"; lastName="Updated"; address="2 BQ Lane"; city="London"; country="UK" } | ConvertTo-Json
$put = Invoke-RestMethod -Uri "$BASE/registrations/$id" -Method PUT -Body $update -ContentType "application/json"
Write-Host "PUT: $($put | ConvertTo-Json -Compress)"
```

Expected: `success=True`

- [ ] **Step 6: Smoke test — DELETE**

```powershell
$del = Invoke-RestMethod -Uri "$BASE/registrations/$id" -Method DELETE
Write-Host "DELETE: $($del.success)"
```

Expected: `True`

- [ ] **Step 7: Verify in BigQuery console**

```powershell
bq query --use_legacy_sql=false --project_id=prj-d-srdl-casas-4zrs "SELECT COUNT(*) as total FROM \`prj-d-srdl-casas-4zrs.testreg.registrations\`"
```

Expected: count reflects migrated records (test record deleted in Step 6).

- [ ] **Step 8: Commit completion tag**

```powershell
cd C:\Users\schinta\testreg-app
git tag bigquery-migration-complete
git push origin bigquery-migration-complete
```
