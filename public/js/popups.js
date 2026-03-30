// WCA — Popups (Search, Country, Network, Reset)

// Search Popup
function openSearchPopup(){
  document.getElementById("searchPopupOverlay").classList.add("open");
  setTimeout(()=>document.getElementById("searchPopupInput").focus(), 100);
}
function closeSearchPopup(){
  document.getElementById("searchPopupOverlay").classList.remove("open");
}
function applySearchPopup(){
  const val = document.getElementById("searchPopupInput").value;
  const by = document.getElementById("searchPopupBy").value;
  document.getElementById("txtSearch").value = val;
  document.getElementById("selSearchBy").value = by;
  // Trigger search event
  const evt = new Event("input", {bubbles:true});
  document.getElementById("txtSearch").dispatchEvent(evt);
  closeSearchPopup();
}
function clearSearchPopup(){
  document.getElementById("searchPopupInput").value = "";
  document.getElementById("searchPopupBy").value = "";
  document.getElementById("txtSearch").value = "";
  const evt = new Event("input", {bubbles:true});
  document.getElementById("txtSearch").dispatchEvent(evt);
  closeSearchPopup();
}

// Country Popup — definite in countries.js (openCountryPopup, closeCountryPopup)

// Network Popup
function openNetworkPopup(){
  document.getElementById("networkPopupOverlay").classList.add("open");
}
function closeNetworkPopup(){
  document.getElementById("networkPopupOverlay").classList.remove("open");
  updateNetworkSelBadge();
  renderSelectedNetworkTags();
}
function confirmNetworkSelection(){
  closeNetworkPopup();
}
function renderSelectedNetworkTags(){
  const container = document.getElementById("selectedNetworksTags");
  if(!container) return;
  const checked = document.querySelectorAll("#networksGrid input[type=checkbox]:checked");
  container.innerHTML = "";
  if(checked.length === 0){
    container.innerHTML = '<span style="font-size:.74rem;color:var(--text-muted);font-style:italic">Nessun network selezionato</span>';
    return;
  }
  checked.forEach(cb => {
    const tag = document.createElement("span");
    tag.textContent = cb.value;
    tag.style.cssText = "display:inline-block;font-size:.7rem;font-weight:600;color:#a5b4fc;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);padding:3px 10px;border-radius:12px;white-space:nowrap";
    container.appendChild(tag);
  });
}
function updateNetworkSelBadge(){
  const cnt = document.querySelectorAll("#networksGrid input[type=checkbox]:checked").length;
  const badge = document.getElementById("networkSelBadge");
  if(badge){
    if(cnt > 0){ badge.textContent = cnt; badge.style.display = "block"; }
    else { badge.style.display = "none"; }
  }
}

// ═══ NETWORK CONFIRM POPUP — mostra selezione network + conferma ═══
function showNetworkConfirmPopup(title, description){
  return new Promise((resolve) => {
    // Crea overlay
    let overlay = document.getElementById("networkConfirmOverlay");
    if(!overlay){
      overlay = document.createElement("div");
      overlay.id = "networkConfirmOverlay";
      overlay.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)";
      document.body.appendChild(overlay);
    }

    const selNets = getSelectedNetworks();
    const allNets = typeof ALL_NETWORKS !== 'undefined' ? ALL_NETWORKS.filter(n => n.siteId > 0) : [];

    let netListHtml = "";
    for(const net of allNets){
      const checked = selNets.includes(net.name) ? "checked" : "";
      netListHtml += `<label style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:6px;cursor:pointer;transition:background .15s;font-size:.72rem;color:#e2e8f0" onmouseover="this.style.background='rgba(99,102,241,0.1)'" onmouseout="this.style.background='transparent'"><input type="checkbox" class="ncpCheck" value="${net.name}" ${checked} style="accent-color:#6366f1;width:13px;height:13px"> ${net.name}</label>`;
    }

    overlay.innerHTML = `
      <div style="background:#1e1e2e;border:1px solid rgba(99,102,241,0.3);border-radius:16px;padding:20px 24px;max-width:440px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 24px 48px rgba(0,0,0,0.5)">
        <div style="font-size:1rem;font-weight:800;color:#fff;margin-bottom:4px">${title}</div>
        <div style="font-size:.75rem;color:#94a3b8;margin-bottom:14px">${description}</div>
        <div style="font-size:.65rem;font-weight:700;color:#a5b4fc;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Filtra Network (opzionale)</div>
        <div style="display:flex;gap:6px;margin-bottom:10px">
          <button onclick="document.querySelectorAll('.ncpCheck').forEach(c=>c.checked=true)" style="font-size:.6rem;padding:2px 8px;border-radius:4px;border:1px solid rgba(99,102,241,0.3);background:rgba(99,102,241,0.1);color:#a5b4fc;cursor:pointer">Tutti</button>
          <button onclick="document.querySelectorAll('.ncpCheck').forEach(c=>c.checked=false)" style="font-size:.6rem;padding:2px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#94a3b8;cursor:pointer">Nessuno</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;max-height:240px;overflow-y:auto;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:6px;margin-bottom:16px;scrollbar-width:thin">${netListHtml}</div>
        <div style="font-size:.65rem;color:#64748b;margin-bottom:14px">Se nessun network è selezionato, verranno scaricati <b style="color:#e2e8f0">tutti i partner</b>.</div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="ncpCancel" style="padding:6px 16px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#94a3b8;font-size:.75rem;cursor:pointer;transition:all .15s">Annulla</button>
          <button id="ncpConfirm" style="padding:6px 20px;border-radius:8px;border:none;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:.75rem;font-weight:700;cursor:pointer;transition:all .15s;box-shadow:0 4px 12px rgba(99,102,241,0.3)">Avvia</button>
        </div>
      </div>`;
    overlay.style.display = "flex";

    document.getElementById("ncpCancel").onclick = () => {
      overlay.style.display = "none";
      resolve(false);
    };
    document.getElementById("ncpConfirm").onclick = () => {
      // Sincronizza selezione con la griglia network principale
      const popupChecked = new Set(Array.from(document.querySelectorAll(".ncpCheck:checked")).map(c => c.value));
      const mainChecks = document.querySelectorAll("#networksGrid input[type=checkbox]");
      mainChecks.forEach(cb => { cb.checked = popupChecked.has(cb.value); });
      updateNetworkSelBadge();
      overlay.style.display = "none";
      resolve(true);
    };
    overlay.onclick = (e) => {
      if(e.target === overlay){ overlay.style.display = "none"; resolve(false); }
    };
  });
}

// Reset Panel
function openResetPanel(){ document.getElementById("resetPanelOverlay").style.display = "block"; }
function closeResetPanel(){ document.getElementById("resetPanelOverlay").style.display = "none"; }

async function deleteOrphanProfiles(){
  // Prima mostra stats
  try {
    const statsResp = await fetch(API+"/api/cleanup");
    const stats = await statsResp.json();
    if(stats.incomplete === 0){
      alert("Nessun profilo orfano trovato. Tutti i "+stats.total+" partner hanno email o telefono.");
      return;
    }
    if(!confirm("Trovati "+stats.incomplete+" profili orfani su "+stats.total+" totali.\n\nSono partner senza email/telefono o [not_found].\nVuoi cancellarli? Potrai riscaricarli con dati completi.")) return;
    closeResetPanel();
    log("🗑 Cancellazione "+stats.incomplete+" profili orfani in corso...","warn");
    const delResp = await fetch(API+"/api/cleanup?confirm=yes");
    const result = await delResp.json();
    if(result.success){
      log("✅ Cancellati "+result.deleted+" profili orfani. Rimasti "+result.remaining+" completi.","ok");
      if(typeof loadPartnerAgenda === "function") loadPartnerAgenda();
    } else {
      log("⚠ Errore cancellazione: "+(result.error||"sconosciuto"),"warn");
    }
  } catch(e){ log("⚠ Errore cleanup: "+e.message,"warn"); }
}

function resetLocalScrapeData(){
  if(!confirm("Cancellare tutti i dati locali di scraping?\n\nJob, sessioni, stato download verranno rimossi.\nIl database Supabase e la cache directory NON verranno toccati.")) return;
  const keysToRemove = [];
  for(let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    if(k && (k.startsWith("wca_job_") || k.startsWith("wca_session_") || k.startsWith("wca_scrape_") || k.startsWith("wca_completed_") || k.startsWith("wca_suspended_") || k === "wca_scraping_state")) keysToRemove.push(k);
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
  log(`🗑 Dati locali scraping resettati: ${keysToRemove.length} chiavi rimosse`,"ok");
}

async function resetDirectoryCache(){
  if(!confirm("Cancellare la DIRECTORY (IDs + networks) da Supabase?\n\nPotrai ricaricarli da zero da WCA.\nI profili scaricati (email, contatti) restano intatti.")) return;
  if(!confirm("SEI SICURO? Cancella directory per TUTTI i paesi da Supabase.")) return;
  closeResetPanel();
  try {
    log("🗑 Reset directory da Supabase in corso...","warn");
    const resp = await fetch(API+"/api/reset-directory",{ method:"POST", headers:{"Content-Type":"application/json"} });
    const data = await resp.json();
    if(data.success){
      // Pulisci anche localStorage
      const allCountries = getAllCountryList();
      let cleared = 0;
      for(const c of allCountries){
        const key = "wca_fulldir_"+c.code;
        if(localStorage.getItem(key)){ localStorage.removeItem(key); cleared++; }
        const dirKey = "wca_dir_"+c.code;
        if(localStorage.getItem(dirKey)) localStorage.removeItem(dirKey);
      }
      localStorage.removeItem("wca_dir_sync_state");
      localStorage.removeItem("wca_dir_backfill_done");
      log(`🗑 Directory resettata: ${data.deleted} da Supabase, ${cleared} da localStorage`,"ok");
      updateDirHeaderCounts();
    } else {
      log(`⚠ Errore reset directory: ${data.error}`,"warn");
    }
  } catch(e){ log(`⚠ Errore reset directory: ${e.message}`,"warn"); }
}
