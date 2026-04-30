const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const s3 = new S3Client({ region: "eu-west-1" });
const BUCKET = "schinta-registration-app-202604300446";
const PREFIX = "registrations/";

const ok  = (body) => ({ statusCode: 200, body: JSON.stringify(body) });
const err = (code, msg) => ({ statusCode: code, body: JSON.stringify({ error: msg }) });

async function readObject(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return JSON.parse(await res.Body.transformToString());
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || "GET";
  const path   = event.rawPath || "/";
  const id     = path.split("/").pop();

  if (method === "OPTIONS") return ok("");

  try {
    // POST /register — create
    if (method === "POST" && path === "/prod/register") {
      const body = JSON.parse(event.body || "{}");
      const { firstName, lastName, address, ssn } = body;
      if (!firstName || !lastName || !address || !ssn)
        return err(400, "Missing required fields");
      const newId = Date.now();
      const entry = { id: newId, firstName, lastName, address, ssn, registeredAt: new Date().toISOString() };
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}${newId}.json`, Body: JSON.stringify(entry), ContentType: "application/json" }));
      return ok({ success: true, id: newId, message: `Registration #${newId} saved.` });
    }

    // GET /registrations — list all
    if (method === "GET" && path === "/prod/registrations") {
      const listed  = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));
      const items   = listed.Contents || [];
      const entries = await Promise.all(
        items
          .filter(o => o.Key.endsWith(".json"))
          .sort((a, b) => b.LastModified - a.LastModified)
          .map(o => readObject(o.Key))
      );
      return ok(entries);
    }

    // GET /registrations/{id} — read one
    if (method === "GET" && path.startsWith("/prod/registrations/")) {
      const entry = await readObject(`${PREFIX}${id}.json`);
      return ok(entry);
    }

    // PUT /registrations/{id} — update
    if (method === "PUT" && path.startsWith("/prod/registrations/")) {
      const existing = await readObject(`${PREFIX}${id}.json`);
      const updates  = JSON.parse(event.body || "{}");
      const updated  = { ...existing, ...updates, id: existing.id, registeredAt: existing.registeredAt, updatedAt: new Date().toISOString() };
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}${id}.json`, Body: JSON.stringify(updated), ContentType: "application/json" }));
      return ok({ success: true, entry: updated });
    }

    // DELETE /registrations/{id} — delete
    if (method === "DELETE" && path.startsWith("/prod/registrations/")) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}${id}.json` }));
      return ok({ success: true, message: `Registration ${id} deleted.` });
    }

    return err(404, "Not found");
  } catch (e) {
    console.error(e);
    return err(500, "Internal server error");
  }
};
