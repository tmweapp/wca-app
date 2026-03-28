// WCA — Business Cards

let bcCards = [];
let bcOpen = false;

function toggleBusinessCards(){
  bcOpen = !bcOpen;
  document.getElementById("bcSection").classList.toggle("open", bcOpen);
  if(bcOpen) loadBusinessCards();
}

function openBcUpload(){
  document.getElementById("bcUploadOverlay").classList.add("open");
  document.getElementById("bcUploadStatus").textContent = "";
}
function closeBcUpload(){
  document.getElementById("bcUploadOverlay").classList.remove("open");
}

async function loadBusinessCards(){
  try {
    const r = await fetch(API + "/api/business-cards");
    const data = await r.json();
    if(data.success && data.cards){
      bcCards = data.cards;
      renderBcList();
    }
    if(data.needs_setup){
      document.getElementById("bcList").innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:.76rem">Tabella non ancora creata. Importa un file per iniziare.</div>';
    }
  } catch(e){ console.warn("loadBusinessCards:", e); }
}

function handleBcDrop(e){
  e.preventDefault();
  e.currentTarget.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if(file) handleBcFile(file);
}

async function handleBcFile(file){
  if(!file) return;
  const ext = file.name.split(".").pop().toLowerCase();
  const statusEl = document.getElementById("bcUploadStatus");
  document.getElementById("bcDropzone").innerHTML = '<div style="font-size:1.5rem">⏳</div><div>Elaborazione di ' + file.name + '...</div>';
  if(statusEl) statusEl.textContent = "Elaborazione in corso...";

  try {
    let rows = [];
    if(ext === "csv" || ext === "tsv") {
      const text = await file.text();
      rows = parseCsvText(text, ext === "tsv" ? "\t" : ",");
    } else if(ext === "xlsx" || ext === "xls") {
      rows = await parseExcelFile(file);
    } else {
      alert("Formato non supportato. Usa CSV, TSV o Excel.");
      resetDropzone();
      if(statusEl) statusEl.textContent = "";
      return;
    }

    if(rows.length === 0){
      alert("Nessun dato trovato nel file.");
      resetDropzone();
      if(statusEl) statusEl.textContent = "";
      return;
    }

    const cards = mapRowsToCards(rows, file.name);
    if(statusEl) statusEl.textContent = `Salvataggio ${cards.length} contatti...`;

    const r = await fetch(API + "/api/business-cards", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ cards })
    });
    const data = await r.json();

    if(data.success){
      await loadBusinessCards();
      resetDropzone();
      if(statusEl) statusEl.innerHTML = '<span style="color:#10b981">✓ ' + cards.length + ' contatti importati</span>';
      // Chiudi popup dopo 1.5s
      setTimeout(closeBcUpload, 1500);
    } else {
      alert("Errore salvataggio: " + (data.error || "sconosciuto"));
      resetDropzone();
      if(statusEl) statusEl.textContent = "";
    }
  } catch(e){
    console.error("handleBcFile:", e);
    alert("Errore: " + e.message);
    resetDropzone();
    if(statusEl) statusEl.textContent = "";
  }
}

function resetDropzone(){
  document.getElementById("bcDropzone").innerHTML = '<div style="font-size:2rem;margin-bottom:6px">📂</div><div>Trascina qui un file <strong>CSV</strong> o <strong>Excel</strong></div><div style="font-size:.72rem;color:var(--text-muted);margin-top:4px">oppure clicca per sfogliare</div><input type="file" id="bcFileInput" accept=".csv,.xlsx,.xls,.tsv" style="display:none" onchange="handleBcFile(this.files[0])">';
}

function parseCsvText(text, sep){
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if(lines.length < 2) return [];
  const headers = lines[0].split(sep).map(h => h.trim().replace(/^["']|["']$/g, ""));
  const rows = [];
  for(let i = 1; i < lines.length; i++){
    const vals = lines[i].split(sep).map(v => v.trim().replace(/^["']|["']$/g, ""));
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] || ""; });
    rows.push(obj);
  }
  return rows;
}

async function parseExcelFile(file){
  // Load SheetJS from CDN if not loaded
  if(!window.XLSX){
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

function mapRowsToCards(rows, fileName){
  // Auto-detect columns by common names
  const first = rows[0];
  const keys = Object.keys(first);
  const find = (patterns) => keys.find(k => patterns.some(p => k.toLowerCase().includes(p))) || "";

  const colCompany = find(["company","azienda","società","societa","organization","organisation","firm","ditta"]);
  const colName = find(["name","nome","contact","contatto","person","persona","full name","fullname"]);
  const colFirstName = find(["first","nome","given"]);
  const colLastName = find(["last","cognome","family","surname"]);
  const colEmail = find(["email","e-mail","mail"]);
  const colPhone = find(["phone","telefono","tel","mobile","cell"]);
  const colCountry = find(["country","paese","nazione","nation"]);
  const colCity = find(["city","città","citta","town"]);
  const colPosition = find(["position","posizione","title","titolo","role","ruolo","job"]);
  const colWebsite = find(["website","web","sito","url","site"]);
  const colNotes = find(["note","notes","appunti","comment"]);

  return rows.map(r => {
    let contactName = colName ? r[colName] : "";
    if(!contactName && colFirstName) contactName = ((r[colFirstName]||"") + " " + (r[colLastName]||"")).trim();

    return {
      company_name: colCompany ? r[colCompany] : "",
      contact_name: contactName,
      email: colEmail ? r[colEmail] : "",
      phone: colPhone ? r[colPhone] : "",
      country: colCountry ? r[colCountry] : "",
      country_code: "",
      city: colCity ? r[colCity] : "",
      position: colPosition ? r[colPosition] : "",
      website: colWebsite ? r[colWebsite] : "",
      notes: colNotes ? r[colNotes] : "",
      source_file: fileName,
      raw_data: r,
    };
  }).filter(c => c.company_name || c.contact_name || c.email);
}

// Country code to flag emoji
function ccToFlag(cc){
  if(!cc || cc.length !== 2) return "🏳️";
  return String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

function renderBcList(){
  const list = document.getElementById("bcList");
  const stats = document.getElementById("bcStats");
  const total = bcCards.length;
  const matched = bcCards.filter(c => c.matched_partner).length;
  const unmatched = total - matched;

  document.getElementById("bcTotalBadge").textContent = total + " contatti";
  document.getElementById("bcClearBtn").style.display = total > 0 ? "inline-block" : "none";

  if(total > 0){
    stats.style.display = "flex";
    document.getElementById("bcStatTotal").textContent = total + " contatti";
    document.getElementById("bcStatMatch").textContent = matched + " trovati in WCA";
    document.getElementById("bcStatNoMatch").textContent = unmatched + " non trovati";
  } else {
    stats.style.display = "none";
  }

  if(total === 0){
    list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:.76rem">Nessun contatto importato</div>';
    return;
  }

  list.innerHTML = bcCards.map(c => {
    const flag = ccToFlag(c.country_code || (c.matched_partner?.country_code) || "");
    const matchHtml = c.matched_partner
      ? `<span class="bc-match found">IN WCA — ${c.matched_partner.company_name} (ID ${c.matched_partner.wca_id})</span>`
      : `<span class="bc-match not-found">NON TROVATO</span>`;

    const details = [c.position, c.email, c.phone, c.city].filter(Boolean);

    return `<div class="bc-row">
      <span class="bc-flag">${flag}</span>
      <div style="min-width:0;flex:1">
        <div class="bc-company">${c.company_name || "—"}</div>
        <div class="bc-contact">${c.contact_name || "—"}${c.position ? ' <span style="color:var(--text-muted);font-size:.66rem">(' + c.position + ')</span>' : ''}</div>
        <div class="bc-details">${details.map(d => '<span>' + d + '</span>').join("")}</div>
      </div>
      ${matchHtml}
    </div>`;
  }).join("");
}

async function clearBusinessCards(){
  if(!confirm("Cancellare tutti i biglietti da visita importati?")) return;
  try {
    await fetch(API + "/api/business-cards", { method: "DELETE" });
    bcCards = [];
    renderBcList();
  } catch(e){ alert("Errore: " + e.message); }
}
