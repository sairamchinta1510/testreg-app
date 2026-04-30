/**
 * gcs.js — Cloud Storage CRUD (GCP equivalent of s3.js)
 * Bucket name is read from GCS_BUCKET env var (set at deploy time).
 */
const { Storage } = require("@google-cloud/storage");

const storage   = new Storage();
const BUCKET    = process.env.GCS_BUCKET || "testreg-gcp-data";
const PREFIX    = "registrations/";
const INDEX_KEY = "registrations/index.json";

async function getObject(id) {
  const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) throw new Error('Invalid registration ID');

  try {
    const [contents] = await storage.bucket(BUCKET).file(`${PREFIX}${safeId}.json`).download();
    return JSON.parse(contents.toString());
  } catch (error) {
    if (error.code === 404) throw new Error(`Registration not found: ${id}`);
    throw new Error(`Failed to retrieve registration ${id}: ${error.message}`);
  }
}

async function putObject(id, data) {
  const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) throw new Error('Invalid registration ID');

  try {
    await storage.bucket(BUCKET).file(`${PREFIX}${safeId}.json`).save(
      JSON.stringify(data),
      { contentType: "application/json" }
    );
    const index = await getIndex();
    const updated = index.filter(r => String(r.id) !== String(id));
    updated.unshift(data);
    await putIndex(updated);
  } catch (error) {
    throw new Error(`Failed to save registration ${id}: ${error.message}`);
  }
}

async function deleteObject(id) {
  const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) throw new Error('Invalid registration ID');

  try {
    await storage.bucket(BUCKET).file(`${PREFIX}${safeId}.json`).delete();
    const index = await getIndex();
    await putIndex(index.filter(r => String(r.id) !== String(id)));
  } catch (error) {
    if (error.code === 404) return;
    throw new Error(`Failed to delete registration ${id}: ${error.message}`);
  }
}

// Returns all registrations from index.json (newest first).
// Falls back to scanning individual files on first run, then writes the index.
async function listObjects() {
  const bucket = storage.bucket(BUCKET);
  const [exists] = await bucket.file(INDEX_KEY).exists();
  if (exists) {
    const [contents] = await bucket.file(INDEX_KEY).download();
    return JSON.parse(contents.toString());
  }

  // Index doesn't exist yet — build it from individual files
  const [files] = await storage.bucket(BUCKET).getFiles({ prefix: PREFIX });
  const jsonFiles = files.filter(f => f.name.endsWith(".json") && f.name !== INDEX_KEY);
  jsonFiles.sort((a, b) => new Date(b.metadata.updated) - new Date(a.metadata.updated));

  const results = await Promise.allSettled(
    jsonFiles.map(f => getObject(f.name.replace(PREFIX, "").replace(".json", "")))
  );
  const records = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  await putIndex(records);
  return records;
}

async function getIndex() {
  try {
    const [contents] = await storage.bucket(BUCKET).file(INDEX_KEY).download();
    return JSON.parse(contents.toString());
  } catch (error) {
    if (error.code === 404) return [];
    throw error;
  }
}

async function putIndex(records) {
  await storage.bucket(BUCKET).file(INDEX_KEY).save(
    JSON.stringify(records),
    { contentType: "application/json" }
  );
}

module.exports = { getObject, putObject, deleteObject, listObjects };
