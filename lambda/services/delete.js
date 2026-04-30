/**
 * DELETE — DELETE /prod/registrations/{id}
 * Returns: { success, message }
 */
const { deleteObject } = require("../utils/s3");
const { ok, err }      = require("../utils/response");

async function deleteRegistration(id) {
  if (!id) return err(400, "Missing registration ID");
  await deleteObject(id);
  return ok({ success: true, message: `Registration ${id} deleted.` });
}

module.exports = { deleteRegistration };
