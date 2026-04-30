/**
 * READ ALL — GET /registrations
 * READ ONE — GET /registrations/{id}
 */
const { listObjects, getObject } = require("../utils/gcs");
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
