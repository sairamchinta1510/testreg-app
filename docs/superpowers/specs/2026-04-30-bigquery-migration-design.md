# Design: GCP BigQuery Migration for Registration Storage

**Date:** 2026-04-30  
**Scope:** GCP Cloud Function only (AWS Lambda remains on S3)  
**Status:** Approved

---

## Problem

The GCP Cloud Function currently stores registrations as flat JSON files in Cloud Storage (`gs://testreg-gcp-data`). This works for small volumes but has limitations:
- No native query capability (no SQL, no filtering)
- No analytics or reporting without reading all files
- Data management (updates, deletes) requires full file rewrites

## Goal

Replace Cloud Storage as the GCP registration store with **BigQuery**. All future registrations are written to and read from BigQuery. Existing records are migrated on cutover. Service files remain unchanged — only the storage utility layer changes.

---

## Architecture

### Components

| Component | Role |
|-----------|------|
| BigQuery dataset `testreg` | Houses the `registrations` table |
| `gcp/utils/bigquery.js` | Replaces `gcp/utils/gcs.js` — same 4-function interface |
| `gcp/index.js` | Unchanged — still imports from `./utils/...` |
| `gcp/services/*.js` | Unchanged — all call `getObject`, `putObject`, `deleteObject`, `listObjects` |
| `gs://testreg-gcp-data` | Kept (frontend bucket unaffected); registration files no longer written |

### Region
- BigQuery dataset: `europe-west1` (same region as Cloud Function)

---

## BigQuery Table Schema

**Dataset:** `testreg`  
**Table:** `registrations`

| Column | Type | Mode | Notes |
|--------|------|------|-------|
| `id` | STRING | REQUIRED | Registration ID (timestamp as string) |
| `firstName` | STRING | REQUIRED | |
| `lastName` | STRING | REQUIRED | |
| `email` | STRING | NULLABLE | |
| `phone` | STRING | NULLABLE | |
| `address` | STRING | REQUIRED | |
| `city` | STRING | NULLABLE | |
| `postcode` | STRING | NULLABLE | |
| `country` | STRING | NULLABLE | |
| `dob` | STRING | NULLABLE | Date of birth as string |
| `ssn` | STRING | NULLABLE | Stored as-is (same as current behaviour) |
| `registeredAt` | TIMESTAMP | REQUIRED | |
| `updatedAt` | TIMESTAMP | NULLABLE | Set on PUT; null for new records |

---

## `gcp/utils/bigquery.js` Interface

Must export the same 4 functions as `gcs.js` so all callers work without changes:

```js
async function getObject(id)           // SELECT * WHERE id = ?  → object or throws "Registration not found: <id>"
async function putObject(id, data)     // INSERT or UPDATE row
async function deleteObject(id)        // DELETE WHERE id = ?
async function listObjects()           // SELECT * ORDER BY registeredAt DESC → array
```

### Implementation notes

- Use `@google-cloud/bigquery` npm package (add to `gcp/package.json`)
- `putObject`: use `INSERT` for new records (create.js always calls with new id); use `UPDATE` for updates (update.js merges fields then calls putObject with same id)
  - To distinguish: attempt `UPDATE` first; if 0 rows affected, `INSERT`
- `getObject`: `SELECT * FROM testreg.registrations WHERE id = @id LIMIT 1`; if no rows, throw `Error("Registration not found: <id>")`
- `listObjects`: `SELECT * FROM testreg.registrations ORDER BY registeredAt DESC`
- `deleteObject`: `DELETE FROM testreg.registrations WHERE id = @id`; if 0 rows affected, silently return (matches current GCS behaviour)
- All queries use parameterised values (`@id`) to prevent injection
- BigQuery returns TIMESTAMP columns as `Date` objects — serialise to ISO string before returning to match existing JSON shape

---

## Data Flow

### POST /register
1. `create.js` builds record with `id = Date.now()`
2. Calls `putObject(id, data)` → BigQuery `INSERT`

### GET /registrations
1. `read.js` calls `listObjects()`
2. BigQuery: `SELECT * FROM testreg.registrations ORDER BY registeredAt DESC`
3. Returns array of registration objects

### GET /registrations/{id}
1. `read.js` calls `getObject(id)`
2. BigQuery: `SELECT * WHERE id = @id LIMIT 1`
3. Returns single object or 404

### PUT /registrations/{id}
1. `update.js` fetches existing record via `getObject(id)`
2. Merges fields, adds `updatedAt`
3. Calls `putObject(id, merged)` → BigQuery `UPDATE`

### DELETE /registrations/{id}
1. `delete.js` calls `deleteObject(id)`
2. BigQuery: `DELETE WHERE id = @id`

---

## Migration Plan

Before deploying the new Cloud Function:
1. Create BigQuery dataset `testreg` and table `registrations`
2. Read all existing records from `gs://testreg-gcp-data/registrations/index.json`
3. Insert each record into BigQuery via `bq insert` or a one-off script
4. Verify row count matches GCS record count
5. Deploy updated Cloud Function (with `bigquery.js`)
6. Smoke-test all 5 endpoints

---

## Dependencies

- `@google-cloud/bigquery` added to `gcp/package.json`
- BigQuery API enabled on project `prj-d-srdl-casas-4zrs`
- Default compute service account `218522663210-compute@developer.gserviceaccount.com` granted `roles/bigquery.dataEditor` on dataset

---

## What Does NOT Change

- `gcp/index.js` — unchanged
- `gcp/services/create.js` — unchanged
- `gcp/services/read.js` — unchanged
- `gcp/services/update.js` — unchanged
- `gcp/services/delete.js` — unchanged
- `gcp/utils/logger.js` — unchanged
- `gcp/utils/response.js` — unchanged
- `gcp/frontend/` — unchanged
- AWS Lambda / S3 — unchanged
- `gs://testreg-gcp-frontend` bucket — unchanged
