/**
 * READ ALL — GET /prod/registrations
 * Returns: Registration[] (newest first)
 *
 * READ ONE — GET /prod/registrations/{id}
 * Returns: Registration object
 */
const { listObjects, getObject } = require("../utils/s3");
const { ok, err }                = require("../utils/response");

async function listRegistrations() {
  const entries = await listObjects();
  return ok(entries);
}

async function getRegistration(id) {
  if (!id) return err(400, "Missing registration ID");
  const entry = await getObject(id);
  return ok(entry);
}

module.exports = { listRegistrations, getRegistration };
