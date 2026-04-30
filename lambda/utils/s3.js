const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");

const s3     = new S3Client({ region: "eu-west-1" });
const BUCKET = "schinta-registration-app-202604300446";
const PREFIX = "registrations/";

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
}

async function deleteObject(id) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}${id}.json` }));
}

async function listObjects() {
  const res   = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));
  const items = (res.Contents || []).filter(o => o.Key.endsWith(".json"));
  items.sort((a, b) => b.LastModified - a.LastModified);
  return Promise.all(items.map(o => getObject(o.Key.replace(PREFIX, "").replace(".json", ""))));
}

module.exports = { getObject, putObject, deleteObject, listObjects };
