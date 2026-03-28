const { ssoLogin } = require("./utils/auth");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { username, password } = req.body || {};
    const result = await ssoLogin(username, password);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
};
