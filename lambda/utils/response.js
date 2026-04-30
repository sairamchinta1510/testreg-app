const ok  = (body)       => ({ statusCode: 200, body: JSON.stringify(body) });
const err = (code, msg)  => ({ statusCode: code, body: JSON.stringify({ error: msg }) });

module.exports = { ok, err };
