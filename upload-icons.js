#!/usr/bin/env node
/**
 * Upload icone 3D su Supabase Storage
 * Esegui: node upload-icons.js
 */
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://dlldkrzoxvjxpgkkttxu.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsbGRrcnpveHZqeHBna2t0dHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODcyMDU4NCwiZXhwIjoyMDc0Mjk2NTg0fQ.py_d96kA6Mqvi0ugBm4gmIlJSoOC_KbwUM7cgDR-O_E";
const BUCKET = "icons";

// Mappa: nome file sorgente → nome file destinazione su Supabase
const ICONS = {
  "pinpoint.png": "pinpoint.png",
  "lente.png": "lente.png",
  "mondo.png": "mondo.png",
  "satellite.png": "satellite.png",
  "tastiera.png": "tastiera.png",
  "campana.png": "campana.png",
};

// Cartella sorgente — cerca in vari percorsi possibili
const POSSIBLE_PATHS = [
  path.join(__dirname, "..", "barchat-icone", "avatars"),
  path.join(__dirname, "barchat-icone", "avatars"),
  path.resolve(process.env.HOME || "~", "Downloads", "barchat-icone", "avatars"),
];

async function main() {
  // Trova la cartella sorgente
  let srcDir = null;
  for (const p of POSSIBLE_PATHS) {
    if (fs.existsSync(p)) { srcDir = p; break; }
  }
  if (!srcDir) {
    console.error("❌ Cartella avatars non trovata! Cercata in:", POSSIBLE_PATHS);
    process.exit(1);
  }
  console.log(`📂 Sorgente: ${srcDir}`);

  // 1. Crea bucket (ignora errore se esiste già)
  console.log(`\n🪣 Creo bucket "${BUCKET}"...`);
  const bucketResp = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
  const bucketData = await bucketResp.json();
  if (bucketResp.ok) {
    console.log(`  ✅ Bucket "${BUCKET}" creato`);
  } else if (bucketData.message?.includes("already exists")) {
    console.log(`  ℹ️  Bucket "${BUCKET}" esiste già`);
  } else {
    console.log(`  ⚠️  Bucket response:`, bucketData);
  }

  // 2. Upload ogni icona
  console.log(`\n📤 Upload icone...`);
  for (const [srcName, destName] of Object.entries(ICONS)) {
    const filePath = path.join(srcDir, srcName);
    if (!fs.existsSync(filePath)) {
      console.log(`  ⏭ ${srcName} — file non trovato, salto`);
      continue;
    }

    const fileBuffer = fs.readFileSync(filePath);
    console.log(`  📤 ${srcName} (${(fileBuffer.length / 1024).toFixed(0)} KB) → ${BUCKET}/${destName}`);

    const uploadResp = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${destName}`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "image/png",
        "x-upsert": "true",
      },
      body: fileBuffer,
    });

    if (uploadResp.ok) {
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${destName}`;
      console.log(`  ✅ OK → ${publicUrl}`);
    } else {
      const err = await uploadResp.text();
      console.log(`  ❌ Errore ${uploadResp.status}: ${err}`);
    }
  }

  // 3. Mostra URL pubblici
  console.log(`\n🔗 URL pubblici:`);
  for (const destName of Object.values(ICONS)) {
    console.log(`  ${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${destName}`);
  }

  console.log(`\n✅ Fatto! Le icone sono ora su Supabase Storage.`);
}

main().catch(err => { console.error("❌ Errore:", err.message); process.exit(1); });
