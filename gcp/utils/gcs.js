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
