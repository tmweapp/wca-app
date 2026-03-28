const fs = require('fs').promises;
const path = require('path');

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { partners, countries, metadata } = req.body || {};
    if (!partners) return res.status(400).json({ error: "partners required" });

    // Path dove salvare i dati sul PC dell'utente
    const dataDir = path.join(process.cwd(), '../..', 'mnt', 'Downloads', 'wca-data');

    // Crea directory se non esiste
    await fs.mkdir(dataDir, { recursive: true });

    // Salva partners
    await fs.writeFile(
      path.join(dataDir, 'partners-cache.json'),
      JSON.stringify({ partners, cached_at: new Date().toISOString() }, null, 2),
      'utf8'
    );

    // Salva countries summary
    if (countries) {
      await fs.writeFile(
        path.join(dataDir, 'countries-summary.json'),
        JSON.stringify({ countries, updated_at: new Date().toISOString() }, null, 2),
        'utf8'
      );
    }

    // Aggiorna metadata
    const meta = {
      created_at: metadata?.created_at || new Date().toISOString(),
      last_sync: new Date().toISOString(),
      total_partners: partners.length,
      total_countries: countries ? countries.length : 0,
      version: "1.0"
    };
    await fs.writeFile(
      path.join(dataDir, 'metadata.json'),
      JSON.stringify(meta, null, 2),
      'utf8'
    );

    console.log(`[save-directory-cache] Salvati ${partners.length} partner in /wca-data/`);

    return res.json({
      success: true,
      saved: partners.length,
      path: dataDir
    });
  } catch (err) {
    console.error(`[save-directory-cache] Error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
