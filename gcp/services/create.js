/**
 * CREATE — POST /register
 * Body: { firstName, lastName, address, ssn }
 * Returns: { success, id, message }
 */
const { putObject } = require("../utils/bigquery");
const { ok, err }   = require("../utils/response");

async function createRegistration(event) {
  const body = JSON.parse(event.body || "{}");
  const { firstName, lastName, address, ssn } = body;

  if (!firstName || !lastName || !address || !ssn) {
    return err(400, "Missing required fields: firstName, lastName, address, ssn");
  }

  const id    = Date.now();
  const entry = { id, firstName, lastName, address, ssn, registeredAt: new Date().toISOString() };

  await putObject(id, entry);
  return ok({ success: true, id, message: `Registration #${id} saved.` });
}

module.exports = { createRegistration };
