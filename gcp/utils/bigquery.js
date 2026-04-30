/**
 * bigquery.js — BigQuery CRUD for registrations
 * Same 4-function interface as gcs.js so all service files work unchanged.
 *
 * Env vars:
 *   GCP_PROJECT   — GCP project ID (default: prj-d-srdl-casas-4zrs)
 *   GCP_KMS_KEY   — full KMS key resource name required by org CMEK policy
 */
const { BigQuery } = require("@google-cloud/bigquery");

const PROJECT = process.env.GCP_PROJECT || "prj-d-srdl-casas-4zrs";
const KMS_KEY = process.env.GCP_KMS_KEY ||
  "projects/prj-d-srdl-casas-4zrs/locations/europe-west1/keyRings/casas-github/cryptoKeys/casas-repo-sync";

const bq      = new BigQuery({ projectId: PROJECT });
const DATASET = "testreg";
const TABLE   = "registrations";
const FULL    = `\`${PROJECT}.${DATASET}.${TABLE}\``;

// Encryption config required by org CMEK policy — passed to every query job
const encryptionConfig = { kmsKeyName: KMS_KEY };

// Normalise a BigQuery row: convert Date/value objects to ISO strings, drop null updatedAt
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
    params: { id: String(id) },
    types:  { id: "STRING" },
    destinationEncryptionConfiguration: encryptionConfig
  });
  if (!rows.length) throw new Error(`Registration not found: ${id}`);
  return normalise(rows[0]);
}

async function putObject(id, data) {
  const safeId = String(id);

  // Build UPDATE fields (exclude id and registeredAt — those never change)
  const fields = ["firstName","lastName","email","phone","address","city","postcode","country","dob","ssn","updatedAt"];
  const setClause = fields.map(k => `${k} = @${k}`).join(", ");
  const params = { id: safeId };
  const types  = { id: "STRING" };
  for (const k of fields) {
    params[k] = data[k] ?? null;
    types[k]  = "STRING";
  }

  const [job] = await bq.createQueryJob({
    query:  `UPDATE ${FULL} SET ${setClause} WHERE id = @id`,
    params,
    types,
    destinationEncryptionConfiguration: encryptionConfig
  });
  await job.getQueryResults();
  const [meta] = await job.getMetadata();
  const affected = parseInt(meta?.statistics?.query?.numDmlAffectedRows || "0", 10);

  if (affected === 0) {
    // New record — use DML INSERT (streaming insert would block UPDATE/DELETE on buffered rows)
    const insertParams = {
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
    };
    const insertTypes = {};
    for (const k of Object.keys(insertParams)) insertTypes[k] = "STRING";

    const [insertJob] = await bq.createQueryJob({
      query: `INSERT INTO ${FULL} (id,firstName,lastName,email,phone,address,city,postcode,country,dob,ssn,registeredAt,updatedAt)
              VALUES (@id,@firstName,@lastName,@email,@phone,@address,@city,@postcode,@country,@dob,@ssn,@registeredAt,@updatedAt)`,
      params: insertParams,
      types:  insertTypes,
      destinationEncryptionConfiguration: encryptionConfig
    });
    await insertJob.getQueryResults();
  }
}

async function deleteObject(id) {
  await bq.query({
    query:  `DELETE FROM ${FULL} WHERE id = @id`,
    params: { id: String(id) },
    types:  { id: "STRING" },
    destinationEncryptionConfiguration: encryptionConfig
  });
}

async function listObjects() {
  const [rows] = await bq.query({
    query: `SELECT * FROM ${FULL} ORDER BY registeredAt DESC`,
    destinationEncryptionConfiguration: encryptionConfig
  });
  return rows.map(normalise);
}

module.exports = { getObject, putObject, deleteObject, listObjects };
