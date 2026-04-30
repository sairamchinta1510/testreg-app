# GCP Deployment Design — testreg-app

**Date:** 2026-04-30  
**Status:** Approved  

---

## Problem Statement

The testreg-app is currently running on AWS (Lambda + API Gateway + S3 + CloudFront).  
The goal is to deploy the same application on GCP, running in parallel on a separate subdomain, using equivalent GCP-managed services.

---

## Target URL

- **Frontend:** `gcp.testreg.tadpoleindustries.com`
- **API:** Cloud Function HTTPS endpoint (auto-generated, referenced by frontend)

---

## Architecture

```
User
 │
 ├──► gcp.testreg.tadpoleindustries.com
 │         │
 │    Route 53 CNAME → GCP HTTPS Load Balancer
 │         │
 │    Cloud Storage Bucket (static frontend)
 │         │  register.html / viewer.html
 │
 └──► Cloud Function HTTPS URL
           │
      Cloud Function (Node.js 20)
      testreg-save-gcp
           │
      Cloud Storage Bucket (data)
      JSON files: registrations/{id}.json
```

---

## Component Mapping

| AWS | GCP | Notes |
|-----|-----|-------|
| Lambda (testreg-save) | Cloud Functions 2nd gen | Same Node.js 20 runtime |
| API Gateway (HTTP API) | Cloud Function built-in HTTPS trigger | No separate gateway needed |
| S3 (data bucket) | Cloud Storage bucket (private) | Same JSON file pattern |
| S3 + CloudFront (frontend) | Cloud Storage (public) + HTTPS Load Balancer | Custom domain + SSL |
| CloudWatch Logs | Cloud Logging | console.log auto-captured |
| Route 53 | Route 53 (existing) + CNAME to GCP LB | No migration needed |
| ACM SSL | Google-managed SSL certificate | Attached to HTTPS LB |

---

## Code Structure

```
testreg-app/
├── lambda/               ← existing AWS code (unchanged)
│   ├── index.js
│   ├── services/
│   └── utils/
│       ├── logger.js     ← reused as-is on GCP
│       ├── response.js   ← reused as-is
│       └── s3.js
└── gcp/                  ← new GCP-specific code
    ├── index.js          ← Cloud Function entry point (same routing logic)
    ├── services/         ← symlinked or copied from lambda/services/
    │   ├── create.js
    │   ├── read.js
    │   ├── update.js
    │   └── delete.js
    └── utils/
        ├── gcs.js        ← replaces s3.js, uses @google-cloud/storage
        ├── logger.js     ← copy of lambda/utils/logger.js (works unchanged)
        └── response.js   ← copy of lambda/utils/response.js (works unchanged)
```

### Key code change: `gcp/utils/gcs.js`

Replaces all `@aws-sdk/client-s3` calls with `@google-cloud/storage` equivalents:

| AWS S3 operation | GCS equivalent |
|---|---|
| `PutObjectCommand` | `bucket.file(key).save(data)` |
| `GetObjectCommand` | `bucket.file(key).download()` |
| `DeleteObjectCommand` | `bucket.file(key).delete()` |
| `ListObjectsV2Command` | `bucket.getFiles({ prefix })` |

The `gcp/services/` files are identical to `lambda/services/` — they call `../utils/gcs` instead of `../utils/s3`.

---

## API Endpoints

Same routes as AWS, served from the Cloud Function URL:

| Method | Path | Description |
|--------|------|-------------|
| POST | /register | Create registration |
| GET | /registrations | List all |
| GET | /registrations/{id} | Get one |
| PUT | /registrations/{id} | Update |
| DELETE | /registrations/{id} | Delete |

> Note: Cloud Functions don't have a stage prefix (`/prod/`), so paths are simplified.

---

## Infrastructure Setup Steps

1. **Create GCP project** with billing enabled
2. **Enable APIs:** Cloud Functions, Cloud Storage, Cloud Build, Compute (for LB)
3. **Install gcloud CLI** and authenticate
4. **Create GCS data bucket** (private) — `testreg-gcp-data`
5. **Deploy Cloud Function** from `gcp/` directory
6. **Create GCS frontend bucket** (public) — upload `register.html` and `viewer.html`
7. **Create HTTPS Load Balancer** with backend bucket + Google-managed SSL cert for `gcp.testreg.tadpoleindustries.com`
8. **Add Route 53 CNAME** pointing `gcp.testreg.tadpoleindustries.com` → Load Balancer IP

---

## IAM / Permissions

- Cloud Function service account needs **Storage Object Admin** on the data bucket
- Frontend bucket needs **allUsers: Storage Object Viewer** for public access
- Data bucket is **private** — no public access

---

## Logging

Cloud Functions automatically stream `console.log` output to **Cloud Logging**.  
The existing `logger.js` (structured JSON logs with SSN redaction) works without modification.

Logs viewable at:  
**GCP Console → Logging → Log Explorer → resource: Cloud Function → testreg-save-gcp**

---

## Data

GCP deployment starts fresh — no data migration from AWS S3.

---

## Out of Scope

- CI/CD pipeline
- GCP Cloud Armor / WAF
- Data migration from AWS
- Monitoring dashboards / alerting
