/**
 * api/cleanup.js — Trova e cancella partner senza email/telefono nei contatti
 *
 * GET  /api/cleanup              → mostra statistiche (quanti completi vs incompleti)
 * GET  /api/cleanup?preview=1    → lista dei partner incompleti (primi 200)
 * POST /api/cleanup?confirm=yes  → CANCELLA i partner incompleti
 */
const fetch = require("node-fetch");
const { SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");

function hasValidEmail(partner) {
  // Check company email
  if (partner.email && partner.email.includes("@")) return true;
  // Check contacts array
  if (Array.isArray(partner.contacts)) {
    for (const c of partner.contacts) {
      if (c.email && c.email.includes("@") && c.email !== "-") return true;
    }
  }
  return false;
}

function hasValidPhone(partner) {
  if (partner.phone && partner.phone.length > 3 && partner.phone !== "-") return true;
  if (Array.isArray(partner.contacts)) {
    for (const c of partner.contacts) {
      if (c.direct_line && c.direct_line.length > 3 && c.direct_line !== "-") return true;
      if (c.mobile && c.mobile.length > 3 && c.mobile !== "-") return true;
    }
  }
  return false;
}

async function loadAllPartners() {
  const all = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/wca_partners?select=wca_id,company_name,country_code,email,phone,contacts&order=wca_id.asc&offset=${offset}&limit=${limit}`;
    const resp = await fetch(url, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
    });
    if (!resp.ok) break;
    const rows = await resp.json();
    if (!rows || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }
  return all;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const partners = await loadAllPartners();
    const complete = [];
    const incomplete = [];

    for (const p of partners) {
      if (hasValidEmail(p) || hasValidPhone(p)) {
        complete.push(p);
      } else {
        incomplete.push(p);
      }
    }

    // GET: show stats
    if (req.method === "GET" && !req.query.preview) {
      // Country breakdown of incomplete
      const byCountry = {};
      for (const p of incomplete) {
        const cc = p.country_code || "??";
        byCountry[cc] = (byCountry[cc] || 0) + 1;
      }

      return res.json({
        total: partners.length,
        complete: complete.length,
        incomplete: incomplete.length,
        incompleteByCountry: byCountry,
        message: `${incomplete.length} partner senza email/telefono su ${partners.length} totali. Usa ?preview=1 per vedere la lista, POST ?confirm=yes per cancellarli.`,
      });
    }

    // GET ?preview=1: show incomplete list
    if (req.query.preview) {
      return res.json({
        total: partners.length,
        incomplete: incomplete.length,
        preview: incomplete.slice(0, 200).map(p => ({
          wca_id: p.wca_id,
          company_name: p.company_name,
          country_code: p.country_code,
          email: p.email || "",
          phone: p.phone || "",
          contactCount: Array.isArray(p.contacts) ? p.contacts.length : 0,
        })),
      });
    }

    // POST ?confirm=yes: delete
    if (req.method === "POST" && req.query.confirm === "yes") {
      const idsToDelete = incomplete.map(p => p.wca_id);
      if (idsToDelete.length === 0) {
        return res.json({ success: true, deleted: 0, message: "Nessun partner incompleto trovato." });
      }

      // Delete in batches of 100
      let totalDeleted = 0;
      for (let i = 0; i < idsToDelete.length; i += 100) {
        const batch = idsToDelete.slice(i, i + 100);
        const filter = batch.map(id => `wca_id.eq.${id}`).join(",");
        const delUrl = `${SUPABASE_URL}/rest/v1/wca_partners?or=(${filter})`;
        const delResp = await fetch(delUrl, {
          method: "DELETE",
          headers: {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Prefer": "return=minimal",
          },
        });
        if (delResp.ok) totalDeleted += batch.length;
      }

      return res.json({
        success: true,
        deleted: totalDeleted,
        remaining: complete.length,
        message: `Cancellati ${totalDeleted} partner incompleti. Rimasti ${complete.length} con email/telefono.`,
      });
    }

    return res.status(400).json({ error: "Usa GET per stats, GET ?preview=1 per lista, POST ?confirm=yes per cancellare." });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
