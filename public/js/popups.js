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

// Country Popup
function openCountryPopup(){
  document.getElementById("countryPopupOverlay").classList.add("open");
  const f = document.getElementById("countryFilter");
  if(f){ f.value = ""; filterCountries(); }
  setTimeout(() => { if(f) f.focus(); }, 100);
}
function closeCountryPopup(){
  document.getElementById("countryPopupOverlay").classList.remove("open");
}

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

// Reset Panel
function openResetPanel(){ document.getElementById("resetPanelOverlay").style.display = "block"; }
function closeResetPanel(){ document.getElementById("resetPanelOverlay").style.display = "none"; }

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

function resetDirectoryCache(){
  if(!confirm("Cancellare tutta la cache directory locale?\n\nI dati in Supabase NON verranno toccati.\nPotrai ricaricarli da Supabase o riscaricarli da WCA.")) return;
  const allCountries = getAllCountryList();
  let removed = 0;
  for(const c of allCountries){
    const key = "wca_fulldir_" + c.code;
    if(localStorage.getItem(key)){ localStorage.removeItem(key); removed++; }
    const dirKey = "wca_dir_" + c.code;
    if(localStorage.getItem(dirKey)) localStorage.removeItem(dirKey);
  }
  localStorage.removeItem("wca_dir_sync_state");
  localStorage.removeItem("wca_dir_backfill_done");
  updateDirHeaderCounts();
  log(`🗑 Cache directory resettata: ${removed} paesi rimossi dal localStorage`,"ok");
}
