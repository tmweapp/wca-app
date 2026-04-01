// WCA — Monitor (Blacklist, Expirations, Directory)

let blacklistResults = [];
let blacklistChecking = false;

async function checkBlacklist(countryCode){
  if(blacklistChecking){ log("Blacklist check già in corso...","warn"); return; }
  blacklistChecking = true;
  const panel = document.getElementById("monitorPanel");
  if(panel) panel.style.display = "block";

  const body = {};
  if(countryCode) body.countryCode = countryCode;
  else if(selectedCountries.length > 0) body.countryCode = selectedCountries[0].code;
  else { log("Seleziona un paese per il blacklist check","warn"); blacklistChecking = false; return; }

  const country = body.countryCode;
  const cName = selectedCountries.find(c => c.code === country)?.name || country;
  log(`🔍 Verifica blacklist per ${cName}...`,"ok");
  showActivity("🔍", `Blacklist check ${cName}...`);
  updateMonitorStatus("blacklist", "checking", `Verifica ${cName}...`);

  try {
    const resp = await fetch(API + "/api/check-blacklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if(data.success){
      blacklistResults = data.results || [];
      const s = data.summary;
      log(`✅ Blacklist ${cName}: ${s.active} attivi, ${s.blacklisted} blacklisted, ${s.expired} scaduti, ${s.errors} errori`,"ok");
      if(s.blacklisted > 0){
        log(`⚠️ ATTENZIONE: ${s.blacklisted} partner nella BLACKLIST!`,"err");
        notifyEvent(`${s.blacklisted} partner blacklisted trovati in ${cName}!`);
      }
      updateMonitorStatus("blacklist", s.blacklisted > 0 ? "warning" : "ok",
        `${s.active} attivi, ${s.blacklisted} blacklisted, ${s.expired} scaduti`);
      renderBlacklistResults(data.results);
    } else {
      log(`⚠ Blacklist check fallito: ${data.error}`,"err");
      updateMonitorStatus("blacklist", "error", data.error);
    }
  } catch(e){
    log(`❌ Errore blacklist check: ${e.message}`,"err");
    updateMonitorStatus("blacklist", "error", e.message);
  }
  hideActivity();
  blacklistChecking = false;
}

function renderBlacklistResults(results){
  const list = document.getElementById("monitorBlacklistList");
  if(!list) return;
  const flagged = results.filter(r => r.blacklisted || r.expired);
  if(flagged.length === 0){
    list.innerHTML = '<div style="text-align:center;padding:8px;font-size:.7rem;color:#6ee7b7">Nessun partner blacklisted o scaduto trovato</div>';
    return;
  }
  list.innerHTML = flagged.map(r => {
    const icon = r.blacklisted ? "🚫" : "⏰";
    const color = r.blacklisted ? "#ef4444" : "#fbbf24";
    const label = r.blacklisted ? "BLACKLISTED" : "SCADUTO";
    const detail = r.context ? r.context.substring(0, 80) : (r.expires || "");
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;background:rgba(${r.blacklisted?'239,68,68':'245,158,11'},0.08);border:1px solid rgba(${r.blacklisted?'239,68,68':'245,158,11'},0.2);margin-bottom:3px">
      <span>${icon}</span>
      <div style="flex:1;min-width:0">
        <span style="font-size:.72rem;font-weight:600;color:${color}">ID ${r.wca_id}</span>
        <span style="font-size:.6rem;color:var(--text-muted);margin-left:6px">${label}</span>
      </div>
      <span style="font-size:.58rem;color:var(--text-muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(detail)}</span>
    </div>`;
  }).join("");
}

// Expiration Monitor
let expirationData = null;
let expirationChecking = false;

async function checkExpirations(countryCode){
  if(expirationChecking){ log("Expiration check già in corso...","warn"); return; }
  expirationChecking = true;
  const panel = document.getElementById("monitorPanel");
  if(panel) panel.style.display = "block";

  const body = { thresholdDays: 90 };
  if(countryCode) body.countryCode = countryCode;
  else if(selectedCountries.length > 0) body.countryCode = selectedCountries[0].code;

  const cLabel = body.countryCode
    ? (selectedCountries.find(c => c.code === body.countryCode)?.name || body.countryCode)
    : "tutti i paesi";
  log(`📅 Verifica scadenze per ${cLabel}...`,"ok");
  showActivity("📅", `Scadenze ${cLabel}...`);
  updateMonitorStatus("expiration", "checking", `Verifica ${cLabel}...`);

  try {
    const resp = await fetch(API + "/api/check-expirations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if(data.success){
      expirationData = data;
      const s = data.summary;
      log(`📅 Scadenze: ${s.expired} scaduti, ${s.expiring} in scadenza (90gg), ${s.active} attivi, ${s.unknown} senza data`,"ok");
      if(s.expired > 0){
        log(`⚠️ ${s.expired} partner con membership SCADUTA!`,"warn");
        notifyEvent(`${s.expired} partner scaduti trovati!`);
      }
      if(s.expiring > 0){
        log(`📅 ${s.expiring} partner in scadenza entro 90 giorni`,"warn");
      }
      updateMonitorStatus("expiration",
        s.expired > 0 ? "warning" : (s.expiring > 0 ? "attention" : "ok"),
        `${s.expired} scaduti, ${s.expiring} in scadenza, ${s.active} attivi`);
      renderExpirationResults(data);
    } else {
      log(`⚠ Expiration check fallito: ${data.error}`,"err");
      updateMonitorStatus("expiration", "error", data.error);
    }
  } catch(e){
    log(`❌ Errore expiration check: ${e.message}`,"err");
    updateMonitorStatus("expiration", "error", e.message);
  }
  hideActivity();
  expirationChecking = false;
}

function renderExpirationResults(data){
  const list = document.getElementById("monitorExpirationList");
  if(!list) return;
  const items = [...(data.expired||[]), ...(data.expiring||[])];
  if(items.length === 0){
    list.innerHTML = '<div style="text-align:center;padding:8px;font-size:.7rem;color:#6ee7b7">Tutti i partner sono in regola</div>';
    return;
  }
  list.innerHTML = items.slice(0, 50).map(p => {
    const isExpired = p.days_remaining < 0;
    const icon = isExpired ? "🔴" : (p.days_remaining <= 30 ? "🟡" : "🟠");
    const color = isExpired ? "#ef4444" : (p.days_remaining <= 30 ? "#fbbf24" : "#fb923c");
    const daysText = isExpired
      ? `scaduto da ${Math.abs(p.days_remaining)}gg`
      : `scade tra ${p.days_remaining}gg`;
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 10px;border-radius:6px;background:rgba(${isExpired?'239,68,68':'245,158,11'},0.06);border:1px solid rgba(${isExpired?'239,68,68':'245,158,11'},0.15);margin-bottom:2px">
      <span style="font-size:.7rem">${icon}</span>
      <div style="flex:1;min-width:0">
        <span style="font-size:.7rem;font-weight:600;color:var(--text-primary)">${esc(p.company_name)}</span>
        <span style="font-size:.58rem;color:var(--text-muted);margin-left:4px">(${p.wca_id})</span>
      </div>
      <div style="text-align:right">
        <div style="font-size:.62rem;font-weight:600;color:${color}">${daysText}</div>
        <div style="font-size:.55rem;color:var(--text-muted)">${p.expires_date||""}</div>
      </div>
    </div>`;
  }).join("");
}

// Directory Update
async function checkNewMembers(countryCode){
  if(!countryCode && selectedCountries.length > 0) countryCode = selectedCountries[0].code;
  if(!countryCode){ log("Seleziona un paese","warn"); return; }

  const cName = selectedCountries.find(c => c.code === countryCode)?.name || countryCode;
  const oldDir = getFullDirectory(countryCode);
  const oldCount = oldDir ? oldDir.members.length : 0;

  log(`🔄 Aggiornamento directory ${cName} (attuale: ${oldCount} membri)...`,"ok");
  showActivity("🔄", `Aggiornamento directory ${cName}...`);
  updateMonitorStatus("directory", "checking", `Aggiornamento ${cName}...`);

  scraping = true;
  const newDir = await discoverFullDirectory(countryCode, cName, true); // full con network
  scraping = false;
  hideActivity();

  if(!newDir){
    updateMonitorStatus("directory", "error", "Directory vuota");
    return;
  }

  const newCount = newDir.members.length;
  const diff = newCount - oldCount;

  // Trova i nuovi ID
  const oldIds = oldDir ? new Set(oldDir.members.map(m => m.id)) : new Set();
  const newMembers = newDir.members.filter(m => !oldIds.has(m.id));

  if(newMembers.length > 0){
    log(`✅ ${cName}: ${newMembers.length} NUOVI membri trovati! (totale: ${newCount})`,"ok");
    notifyEvent(`${newMembers.length} nuovi membri in ${cName}!`);
    for(const m of newMembers.slice(0, 10)){
      log(`   + ${m.name} (ID ${m.id}) — ${(m.networks||[]).join(", ")}`,"ok");
    }
    if(newMembers.length > 10) log(`   ... e altri ${newMembers.length - 10}`,"ok");
  } else if(diff < 0){
    log(`📉 ${cName}: ${Math.abs(diff)} membri rimossi (${oldCount} → ${newCount})`,"warn");
  } else {
    log(`✅ ${cName}: nessun nuovo membro (totale: ${newCount})`,"ok");
  }

  updateMonitorStatus("directory", newMembers.length > 0 ? "new" : "ok",
    newMembers.length > 0
      ? `${newMembers.length} nuovi, ${newCount} totali`
      : `${newCount} membri — nessuna novità`);

  renderDirectoryUpdateResults(countryCode, cName, newMembers, newCount, oldCount);
  return newMembers;
}

function renderDirectoryUpdateResults(code, name, newMembers, totalNew, totalOld){
  const list = document.getElementById("monitorDirectoryList");
  if(!list) return;
  const diff = totalNew - totalOld;
  let html = `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.15);margin-bottom:4px">
    <span style="font-size:1.1rem">${countryFlag(code)}</span>
    <div style="flex:1">
      <span style="font-size:.72rem;font-weight:600;color:var(--text-primary)">${name}</span>
      <span style="font-size:.6rem;color:var(--text-muted);margin-left:6px">${totalNew} membri</span>
    </div>
    <span style="font-size:.62rem;font-weight:600;color:${diff > 0 ? '#6ee7b7' : (diff < 0 ? '#fbbf24' : 'var(--text-muted)')}">${diff > 0 ? '+'+diff : diff}</span>
  </div>`;

  if(newMembers.length > 0){
    html += newMembers.slice(0, 20).map(m => {
      return `<div style="display:flex;align-items:center;gap:6px;padding:4px 10px 4px 24px;font-size:.65rem">
        <span style="color:#6ee7b7;font-weight:700">NEW</span>
        <span style="color:var(--text-primary)">${esc(m.name)}</span>
        <span style="color:var(--text-muted)">(${m.id})</span>
        <span style="color:var(--text-muted);margin-left:auto;font-size:.58rem">${(m.networks||[]).join(", ")}</span>
      </div>`;
    }).join("");
    if(newMembers.length > 20) html += `<div style="font-size:.6rem;color:var(--text-muted);padding:4px 24px">... e altri ${newMembers.length-20}</div>`;
  }
  list.innerHTML = html;
}
