const fetch = require("node-fetch");
const { SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");

const HEADERS = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // GET — list all business cards
    if (req.method === "GET") {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/wca_business_cards?select=*&order=created_at.desc&limit=1000`, {
        headers: HEADERS,
      });
      if (!r.ok) {
        const err = await r.text();
        // Table doesn't exist yet — return empty
        if (r.status === 404 || err.includes("does not exist")) {
          return res.json({ success: true, cards: [], needs_setup: true });
        }
        return res.json({ success: false, error: err });
      }
      const cards = await r.json();

      // Cross-reference with wca_partners — fetch all company names & contacts
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/wca_partners?select=wca_id,company_name,country_code,contacts,email,phone,website`, {
        headers: HEADERS,
      });
      const partners = pr.ok ? await pr.json() : [];

      // Build lookup maps
      const partnersByCompany = {};
      const partnersByEmail = {};
      const partnersByPhone = {};
      for (const p of partners) {
        const cn = (p.company_name || "").toLowerCase().trim();
        if (cn) partnersByCompany[cn] = p;
        if (p.email) partnersByEmail[p.email.toLowerCase().trim()] = p;
        if (p.phone) partnersByPhone[p.phone.replace(/\D/g, "")] = p;
        if (p.contacts) {
          for (const c of p.contacts) {
            if (c.email) partnersByEmail[c.email.toLowerCase().trim()] = p;
          }
        }
      }

      // Enrich cards with match info
      const enriched = cards.map(card => {
        let match = null;
        const cn = (card.company_name || "").toLowerCase().trim();
        const em = (card.email || "").toLowerCase().trim();
        const ph = (card.phone || "").replace(/\D/g, "");

        if (cn && partnersByCompany[cn]) match = partnersByCompany[cn];
        else if (em && partnersByEmail[em]) match = partnersByEmail[em];
        else if (ph && partnersByPhone[ph]) match = partnersByPhone[ph];
        // Fuzzy: check if company name is contained
        if (!match && cn) {
          for (const [pName, p] of Object.entries(partnersByCompany)) {
            if (pName.includes(cn) || cn.includes(pName)) { match = p; break; }
          }
        }

        return {
          ...card,
          matched_partner: match ? {
            wca_id: match.wca_id,
            company_name: match.company_name,
            country_code: match.country_code,
          } : null,
        };
      });

      return res.json({ success: true, cards: enriched, total_partners: partners.length });
    }

    // POST — save business cards (bulk upsert)
    if (req.method === "POST") {
      const { cards } = req.body || {};
      if (!cards || !Array.isArray(cards) || cards.length === 0) {
        return res.status(400).json({ error: "cards array richiesto" });
      }

      // Upsert each card
      const rows = cards.map(c => ({
        company_name: c.company_name || "",
        contact_name: c.contact_name || "",
        email: c.email || "",
        phone: c.phone || "",
        country: c.country || "",
        country_code: c.country_code || "",
        city: c.city || "",
        position: c.position || "",
        website: c.website || "",
        notes: c.notes || "",
        source_file: c.source_file || "",
        raw_data: c.raw_data || null,
        created_at: new Date().toISOString(),
      }));

      const r = await fetch(`${SUPABASE_URL}/rest/v1/wca_business_cards`, {
        method: "POST",
        headers: { ...HEADERS, "Prefer": "return=representation" },
        body: JSON.stringify(rows),
      });

      if (!r.ok) {
        const err = await r.text();
        return res.json({ success: false, error: err });
      }

      const saved = await r.json();
      return res.json({ success: true, saved: saved.length });
    }

    // DELETE — clear all business cards
    if (req.method === "DELETE") {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/wca_business_cards?id=gt.0`, {
        method: "DELETE",
        headers: HEADERS,
      });
      return res.json({ success: r.ok });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
