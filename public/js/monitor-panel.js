// WCA — Monitor Panel UI

function updateMonitorStatus(type, status, text){
  const el = document.getElementById(`monitor_${type}_status`);
  if(!el) return;
  const colors = {
    ok: { bg:"rgba(16,185,129,0.1)", border:"rgba(16,185,129,0.2)", text:"#6ee7b7", icon:"✅" },
    warning: { bg:"rgba(239,68,68,0.1)", border:"rgba(239,68,68,0.2)", text:"#fca5a5", icon:"⚠️" },
    attention: { bg:"rgba(245,158,11,0.1)", border:"rgba(245,158,11,0.2)", text:"#fbbf24", icon:"📅" },
    new: { bg:"rgba(99,102,241,0.1)", border:"rgba(99,102,241,0.2)", text:"#a5b4fc", icon:"🆕" },
    checking: { bg:"rgba(99,102,241,0.06)", border:"rgba(99,102,241,0.15)", text:"#a5b4fc", icon:"⏳" },
    error: { bg:"rgba(239,68,68,0.06)", border:"rgba(239,68,68,0.15)", text:"#fca5a5", icon:"❌" },
  };
  const c = colors[status] || colors.ok;
  el.style.background = c.bg;
  el.style.borderColor = c.border;
  el.innerHTML = `<span>${c.icon}</span><span style="font-size:.68rem;color:${c.text}">${text}</span>`;
}

// Esegui tutti i check per un paese
async function runFullMonitor(countryCode){
  if(!countryCode && selectedCountries.length > 0) countryCode = selectedCountries[0].code;
  if(!countryCode){ log("Seleziona un paese","warn"); return; }

  const panel = document.getElementById("monitorPanel");
  if(panel) panel.style.display = "block";

  await checkNewMembers(countryCode);
  await checkExpirations(countryCode);
  await checkBlacklist(countryCode);
}

// Monitor periodico — controlla ogni N ore
let monitorInterval = null;
let monitorIntervalHours = 0;

function startPeriodicMonitor(hours){
  if(monitorInterval) clearInterval(monitorInterval);
  monitorIntervalHours = hours;
  if(hours <= 0) { monitorInterval = null; return; }
  monitorInterval = setInterval(() => {
    if(selectedCountries.length > 0){
      log(`🔄 Monitor periodico — check automatico...`,"ok");
      for(const c of selectedCountries){
        runFullMonitor(c.code);
      }
    }
  }, hours * 3600000);
  log(`⏰ Monitor periodico attivato: ogni ${hours}h`,"ok");
}

function stopPeriodicMonitor(){
  if(monitorInterval){ clearInterval(monitorInterval); monitorInterval = null; }
  monitorIntervalHours = 0;
  log("Monitor periodico disattivato","ok");
}

// UI helper per il monitor panel
function getMonitorCountry(){
  const sel = document.getElementById("monitorCountrySelect");
  return sel ? sel.value : "";
}
function runFullMonitorFromUI(){ runFullMonitor(getMonitorCountry() || undefined); }
function checkNewMembersFromUI(){ checkNewMembers(getMonitorCountry() || undefined); }
function checkExpirationsFromUI(){ checkExpirations(getMonitorCountry() || undefined); }
function checkBlacklistFromUI(){ checkBlacklist(getMonitorCountry() || undefined); }
function setMonitorInterval(){
  const h = parseInt(document.getElementById("monitorAutoInterval").value) || 0;
  if(h > 0) startPeriodicMonitor(h);
  else stopPeriodicMonitor();
}
function updateMonitorCountry(){}

// Popola la select del monitor quando cambiano i paesi selezionati
function updateMonitorCountrySelect(){
  const sel = document.getElementById("monitorCountrySelect");
  if(!sel) return;
  sel.innerHTML = '<option value="">Primo selezionato</option>';
  for(const c of selectedCountries){
    const opt = document.createElement("option");
    opt.value = c.code;
    opt.textContent = countryFlag(c.code) + " " + c.name;
    sel.appendChild(opt);
  }
}

// Aggiungi un tasto Monitor nella cmd-bar (inline con gli altri)
function addMonitorButton(){
  const actionsRow = document.querySelector('[id="btnBell"]')?.parentElement;
  if(!actionsRow) return;
  // Controlla se esiste già
  if(document.getElementById("btnMonitor")) return;
  const btn = document.createElement("button");
  btn.id = "btnMonitor";
  btn.title = "Partner Monitor — blacklist, scadenze, nuovi membri";
  btn.style.cssText = "background:none;border:none;cursor:pointer;padding:2px;opacity:.5;transition:opacity .2s;display:flex;align-items:center;justify-content:center;width:22px;height:22px";
  btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
  btn.onclick = () => {
    const panel = document.getElementById("monitorPanel");
    if(!panel) return;
    panel.style.display = panel.style.display === "none" ? "block" : "none";
    updateMonitorCountrySelect();
  };
  btn.onmouseenter = () => btn.style.opacity = "1";
  btn.onmouseleave = () => btn.style.opacity = ".5";
  // Inserisci prima del separatore
  const sep = actionsRow.querySelector('div[style*="width:1px"]');
  if(sep) actionsRow.insertBefore(btn, sep);
  else actionsRow.appendChild(btn);
}
// Esegui all'avvio
setTimeout(addMonitorButton, 500);
