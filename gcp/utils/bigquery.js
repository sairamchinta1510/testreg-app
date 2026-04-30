/**
 * bigquery.js — BigQuery CRUD for registrations
 * Same 4-function interface as gcs.js so all service files work unchanged.
 */
const { BigQuery } = require("@google-cloud/bigquery");

const bq      = new BigQuery({ projectId: process.env.GCP_PROJECT || "prj-d-srdl-casas-4zrs" });
const DATASET = "testreg";
const TABLE   = "registrations";
const FULL    = `\`${process.env.GCP_PROJECT || "prj-d-srdl-casas-4zrs"}.${DATASET}.${TABLE}\``;

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
    query:  `SELECT * FROM \`prj-d-srdl-casas-4zrs.testreg.registrations\` WHERE id = @id LIMIT 1`,
    params: { id: String(id) }
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
  for (const k of fields) params[k] = data[k] ?? null;

  const [job] = await bq.createQueryJob({
    query:  `UPDATE \`prj-d-srdl-casas-4zrs.testreg.registrations\` SET ${setClause} WHERE id = @id`,
    params
  });
  await job.getQueryResults();
  const [meta] = await job.getMetadata();
  const affected = parseInt(meta?.statistics?.query?.numDmlAffectedRows || "0", 10);

  if (affected === 0) {
    // New record — INSERT
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
    query:  `DELETE FROM \`prj-d-srdl-casas-4zrs.testreg.registrations\` WHERE id = @id`,
    params: { id: String(id) }
  });
}

async function listObjects() {
  const [rows] = await bq.query({
    query: `SELECT * FROM \`prj-d-srdl-casas-4zrs.testreg.registrations\` ORDER BY registeredAt DESC`
  });
  return rows.map(normalise);
}

module.exports = { getObject, putObject, deleteObject, listObjects };
