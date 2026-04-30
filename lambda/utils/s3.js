const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");

const s3        = new S3Client({ region: "eu-west-1" });
const BUCKET    = "schinta-registration-app-202604300446";
const PREFIX    = "registrations/";
const INDEX_KEY = "registrations/index.json";

async function getObject(id) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}${id}.json` }));
  return JSON.parse(await res.Body.transformToString());
}

async function putObject(id, data) {
  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         `${PREFIX}${id}.json`,
    Body:        JSON.stringify(data),
    ContentType: "application/json"
  }));
  const index = await getIndex();
  const updated = index.filter(r => String(r.id) !== String(id));
  updated.unshift(data);
  await putIndex(updated);
}

async function deleteObject(id) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}${id}.json` }));
  const index = await getIndex();
  await putIndex(index.filter(r => String(r.id) !== String(id)));
}

// Returns all registrations from index.json (newest first).
// Falls back to scanning individual files on first run, then writes the index.
async function listObjects() {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: INDEX_KEY }));
    return JSON.parse(await res.Body.transformToString());
  } catch (e) {
    if (e.name !== "NoSuchKey" && e.$metadata?.httpStatusCode !== 404) throw e;
  }
  // Index doesn't exist yet — build it from individual files
  const res   = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));
  const items = (res.Contents || [])
    .filter(o => o.Key.endsWith(".json") && o.Key !== INDEX_KEY);
  items.sort((a, b) => b.LastModified - a.LastModified);
  const records = await Promise.all(
    items.map(o => getObject(o.Key.replace(PREFIX, "").replace(".json", "")))
  );
  await putIndex(records);
  return records;
}

async function getIndex() {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: INDEX_KEY }));
    return JSON.parse(await res.Body.transformToString());
  } catch {
    return [];
  }
}

async function putIndex(records) {
  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         INDEX_KEY,
    Body:        JSON.stringify(records),
    ContentType: "application/json"
  }));
}

module.exports = { getObject, putObject, deleteObject, listObjects };
