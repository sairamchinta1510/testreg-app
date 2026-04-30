/**
 * gcs.js — Cloud Storage CRUD (GCP equivalent of s3.js)
 * Bucket name is read from GCS_BUCKET env var (set at deploy time).
 */
const { Storage } = require("@google-cloud/storage");

const storage = new Storage();
const BUCKET  = process.env.GCS_BUCKET || "testreg-gcp-data";
const PREFIX  = "registrations/";

async function getObject(id) {
  const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) throw new Error('Invalid registration ID');
  
  try {
    const [contents] = await storage.bucket(BUCKET).file(`${PREFIX}${safeId}.json`).download();
    return JSON.parse(contents.toString());
  } catch (error) {
    if (error.code === 404) {
      throw new Error(`Registration not found: ${id}`);
    }
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
  } catch (error) {
    throw new Error(`Failed to save registration ${id}: ${error.message}`);
  }
}

async function deleteObject(id) {
  const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) throw new Error('Invalid registration ID');
  
  try {
    await storage.bucket(BUCKET).file(`${PREFIX}${safeId}.json`).delete();
  } catch (error) {
    if (error.code === 404) {
      return;
    }
    throw new Error(`Failed to delete registration ${id}: ${error.message}`);
  }
}

async function listObjects() {
  const [files] = await storage.bucket(BUCKET).getFiles({ prefix: PREFIX });
  const jsonFiles = files.filter(f => f.name.endsWith(".json"));
  jsonFiles.sort((a, b) => new Date(b.metadata.updated) - new Date(a.metadata.updated));
  
  const results = await Promise.allSettled(
    jsonFiles.map(f => getObject(f.name.replace(PREFIX, "").replace(".json", "")))
  );
  return results.filter(r => r.status === 'fulfilled').map(r => r.value);
}

module.exports = { getObject, putObject, deleteObject, listObjects };
