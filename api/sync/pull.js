const { pullDeviceState } = require("../../src/cloud-sync");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const deviceId = String(req.query?.deviceId || "").trim();

    if (!deviceId) {
      return sendJson(res, 400, { error: "deviceId is required." });
    }

    return sendJson(res, 200, {
      deviceId,
      ...(await pullDeviceState(deviceId))
    });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "Internal server error." });
  }
};

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
