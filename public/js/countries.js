// WCA — Country Selector & Flag Display

const ALL_COUNTRIES = [
  {g:"Principali",items:[["IT","Italia"],["US","Stati Uniti"],["GB","Regno Unito"],["DE","Germania"],["FR","Francia"],["ES","Spagna"],["CN","Cina"],["IN","India"],["BR","Brasile"],["AE","Emirati Arabi"],["TR","Turchia"],["NL","Paesi Bassi"],["AU","Australia"],["JP","Giappone"],["KR","Corea del Sud"],["SG","Singapore"],["HK","Hong Kong"],["TH","Thailandia"],["MX","Messico"],["CA","Canada"]]},
  {g:"Europa",items:[["AL","Albania"],["AD","Andorra"],["AT","Austria"],["BY","Bielorussia"],["BE","Belgio"],["BA","Bosnia"],["BG","Bulgaria"],["HR","Croazia"],["CY","Cipro"],["CZ","Rep. Ceca"],["DK","Danimarca"],["EE","Estonia"],["FI","Finlandia"],["GR","Grecia"],["HU","Ungheria"],["IS","Islanda"],["IE","Irlanda"],["LV","Lettonia"],["LT","Lituania"],["LU","Lussemburgo"],["MT","Malta"],["MD","Moldavia"],["ME","Montenegro"],["MK","Macedonia Nord"],["NO","Norvegia"],["PL","Polonia"],["PT","Portogallo"],["RO","Romania"],["RS","Serbia"],["SK","Slovacchia"],["SI","Slovenia"],["SE","Svezia"],["CH","Svizzera"],["UA","Ucraina"]]},
  {g:"Asia-Pacifico",items:[["AF","Afghanistan"],["BD","Bangladesh"],["KH","Cambogia"],["ID","Indonesia"],["IQ","Iraq"],["IR","Iran"],["IL","Israele"],["JO","Giordania"],["KW","Kuwait"],["LB","Libano"],["MY","Malesia"],["MM","Myanmar"],["NP","Nepal"],["NZ","Nuova Zelanda"],["OM","Oman"],["PK","Pakistan"],["PH","Filippine"],["QA","Qatar"],["SA","Arabia Saudita"],["LK","Sri Lanka"],["TW","Taiwan"],["VN","Vietnam"]]},
  {g:"Africa",items:[["DZ","Algeria"],["AO","Angola"],["CM","Camerun"],["CI","Costa d'Avorio"],["CD","RD Congo"],["EG","Egitto"],["ET","Etiopia"],["GH","Ghana"],["KE","Kenya"],["LY","Libia"],["MA","Marocco"],["MZ","Mozambico"],["NG","Nigeria"],["SN","Senegal"],["ZA","Sudafrica"],["TZ","Tanzania"],["TN","Tunisia"],["UG","Uganda"]]},
  {g:"Americhe",items:[["AR","Argentina"],["BO","Bolivia"],["CL","Cile"],["CO","Colombia"],["CR","Costa Rica"],["CU","Cuba"],["DO","Rep. Dominicana"],["EC","Ecuador"],["SV","El Salvador"],["GT","Guatemala"],["HN","Honduras"],["JM","Giamaica"],["NI","Nicaragua"],["PA","Panama"],["PY","Paraguay"],["PE","Perù"],["PR","Porto Rico"],["TT","Trinidad e Tobago"],["UY","Uruguay"],["VE","Venezuela"]]},
  {g:"Altro",items:[["RU","Russia"],["GE","Georgia"],["AM","Armenia"],["AZ","Azerbaigian"],["KZ","Kazakistan"],["UZ","Uzbekistan"],["FJ","Fiji"],["PG","Papua Nuova Guinea"]]}
];

let countryPartnerCounts = {};
let countryDirCounts = {};

async function loadDirCounts(){
  try {
    const resp = await fetch(API+"/api/partners?action=directory_counts");
    const data = await resp.json();
    if(data.success && data.counts){
      countryDirCounts = data.counts;
      try { sessionStorage.setItem("wca_dir_counts", JSON.stringify(countryDirCounts)); } catch(e){}
    } else {
      try { const c = sessionStorage.getItem("wca_dir_counts"); if(c) countryDirCounts = JSON.parse(c); } catch(e){}
    }
  } catch(e){
    try { const c = sessionStorage.getItem("wca_dir_counts"); if(c) countryDirCounts = JSON.parse(c); } catch(e2){}
  }
}

async function loadCountryCounts(){
  try {
    const resp = await fetch(API+"/api/partners?action=country_counts");
    const data = await resp.json();
    if(data.success && data.counts){
      countryPartnerCounts = data.counts;
      try { sessionStorage.setItem("wca_partner_counts", JSON.stringify(countryPartnerCounts)); } catch(e){}
    } else {
      // Recovery da sessionStorage se API fallisce
      recoverPartnerCounts();
    }
    renderFlagChips();
  } catch(e){
    console.warn("loadCountryCounts error:", e.message);
    recoverPartnerCounts();
    renderFlagChips();
  }
}

function incrementPartnerCount(cc){
  if(!cc) return;
  const code=cc.toUpperCase();
  countryPartnerCounts[code]=(countryPartnerCounts[code]||0)+1;
  // Salva in sessionStorage per recovery
  try { sessionStorage.setItem("wca_partner_counts", JSON.stringify(countryPartnerCounts)); } catch(e){}
  renderFlagChips();
}

// Recovery: ricarica conteggi se persi (es. dopo errore save)
function recoverPartnerCounts(){
  try {
    const cached = sessionStorage.getItem("wca_partner_counts");
    if(cached){
      const parsed = JSON.parse(cached);
      for(const [code, cnt] of Object.entries(parsed)){
        if(!countryPartnerCounts[code] || countryPartnerCounts[code] < cnt){
          countryPartnerCounts[code] = cnt;
        }
      }
    }
  } catch(e){ console.warn("recoverPartnerCounts:", e.message); }
}

async function initCountrySelector(){
  await Promise.all([loadCountryCounts(), loadDirCounts()]);
  const list = document.getElementById("countryList");
  let html = "";
  for(const group of ALL_COUNTRIES){
    html += `<div style="padding:4px 8px;font-size:.65rem;color:#6366f1;font-weight:700;text-transform:uppercase;letter-spacing:1px;background:rgba(0,0,0,0.3)">${group.g}</div>`;
    for(const [code, name] of group.items){
      const flag = countryFlag(code);
      const profCnt = countryPartnerCounts[code] || 0;
      const dirCnt = countryDirCounts[code] || 0;
      const doneBadge = isCountryCompleted(code) ? `<span style="background:rgba(16,185,129,0.15);color:#6ee7b7;font-size:.6rem;padding:1px 5px;border-radius:4px">done</span>` : "";
      // Badge: dirCnt (directory) / profCnt (scaricati)
      let cntBadge = "";
      if(dirCnt > 0 || profCnt > 0){
        const pColor = profCnt >= dirCnt && dirCnt > 0 ? "#6ee7b7" : "#93c5fd";
        cntBadge = `<span style="margin-left:auto;display:flex;gap:3px;align-items:center;font-size:.6rem">`;
        if(dirCnt > 0) cntBadge += `<span style="background:rgba(99,102,241,0.15);color:#a5b4fc;padding:1px 5px;border-radius:6px" title="In directory">${dirCnt}</span>`;
        cntBadge += `<span style="background:rgba(16,185,129,0.15);color:${pColor};padding:1px 5px;border-radius:6px" title="Profili scaricati">${profCnt}</span>`;
        cntBadge += `</span>`;
      } else {
        cntBadge = `<span style="margin-left:auto;color:#475569;font-size:.65rem">—</span>`;
      }
      html += `<label style="display:flex;align-items:center;gap:6px;padding:5px 8px;font-size:.78rem;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.04);transition:all 0.15s" data-code="${code}" data-name="${name.toLowerCase()}" onmouseover="this.style.background='rgba(99,102,241,0.08)'" onmouseout="this.style.background='transparent'">
        <input type="checkbox" value="${code}" onchange="toggleCountry('${code}','${name}')" style="accent-color:#6366f1"> ${flag} ${name} ${doneBadge} ${cntBadge}
      </label>`;
    }
  }
  list.innerHTML = html;
}

function openCountryPopup(){
  document.getElementById("countryPopupOverlay").classList.add("open");
  const f = document.getElementById("countryFilter");
  if(f){ f.value = ""; filterCountries(); }
  setTimeout(() => { if(f) f.focus(); }, 100);
}

function closeCountryPopup(){
  document.getElementById("countryPopupOverlay").classList.remove("open");
}

function toggleCountryDropdown(){ openCountryPopup(); }

function filterCountries(){
  const q = document.getElementById("countryFilter").value.toLowerCase();
  document.querySelectorAll("#countryList label").forEach(l => {
    l.style.display = (l.dataset.name.includes(q) || l.dataset.code.toLowerCase().includes(q)) ? "flex" : "none";
  });
}

function toggleCountry(code, name){
  const idx = selectedCountries.findIndex(c => c.code === code);
  if(idx >= 0) selectedCountries.splice(idx, 1);
  else selectedCountries.push({code, name});
  updateCountryDisplay();
  refreshHeaderFlags();
}

function selectAllCountries(){
  selectedCountries = [];
  for(const group of ALL_COUNTRIES){
    for(const [code, name] of group.items){
      selectedCountries.push({code, name});
    }
  }
  document.querySelectorAll("#countryList input[type=checkbox]").forEach(cb => cb.checked = true);
  updateCountryDisplay();
  refreshHeaderFlags();
}

function clearCountries(){
  selectedCountries = [];
  document.querySelectorAll("#countryList input[type=checkbox]").forEach(cb => cb.checked = false);
  updateCountryDisplay();
  refreshHeaderFlags();
}

function updateCountryDisplay(){
  const cnt = selectedCountries.length;
  // Update popup count
  const popCnt = document.getElementById("countrySelCount");
  if(popCnt) popCnt.textContent = cnt + " selezionati";
  // Aggiorna monitor country select
  if(typeof updateMonitorCountrySelect === "function") try { updateMonitorCountrySelect(); } catch(e){ console.warn("updateMonitorCountrySelect:", e.message); }
  // Update ALL picker badges (discover + network panels)
  ["countrySelBadge"].forEach(id => {
    const b = document.getElementById(id);
    if(b){ if(cnt > 0){ b.textContent = cnt; b.style.display = "block"; } else { b.style.display = "none"; } }
  });
  // Update selected countries preview — carosello orizzontale
  const preview = document.getElementById("selectedCountriesPreview");
  if(preview){
    if(cnt === 0){
      preview.style.display = "none";
      preview.innerHTML = "";
    } else {
      preview.style.display = "flex";
      preview.style.flexWrap = "nowrap";
      preview.style.overflowX = "auto";
      preview.style.overflowY = "hidden";
      preview.style.gap = "4px";
      preview.style.padding = "2px 0";
      preview.innerHTML = selectedCountries.map(c => {
        const pCnt = countryPartnerCounts[c.code] || 0;
        const isActive = typeof currentScrapingCountry !== 'undefined' && currentScrapingCountry === c.code;
        const border = isActive ? "2px solid #ef4444" : "1px solid rgba(99,102,241,0.25)";
        const bg = isActive ? "rgba(239,68,68,0.08)" : "rgba(99,102,241,0.08)";
        const shadow = isActive ? "0 0 8px rgba(239,68,68,0.4)" : "none";
        const nameLines = c.name.length > 10 ? `white-space:normal;max-width:56px;text-align:center` : `white-space:nowrap`;
        return `<span data-country-chip="${c.code}" style="display:inline-flex;flex-direction:column;align-items:center;gap:2px;padding:4px 6px;border-radius:8px;background:${bg};border:${border};box-shadow:${shadow};cursor:default;flex-shrink:0;min-width:54px;max-width:70px;position:relative">
          <span style="font-size:1.4rem;line-height:1">${countryFlag(c.code)}</span>
          <span style="font-size:.55rem;color:#c7d2fe;font-weight:600;line-height:1.2;${nameLines}">${c.name}${pCnt > 0 ? '<br><span style="opacity:.5;font-size:.5rem">('+pCnt+')</span>' : ''}</span>
          <span onclick="event.stopPropagation();removeCountry('${c.code}')" style="position:absolute;top:-4px;right:-4px;width:14px;height:14px;background:#374151;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:.6rem;color:#9ca3af;line-height:1">×</span>
        </span>`;
      }).join("");
    }
  }
}

function removeCountry(code){
  selectedCountries = selectedCountries.filter(c => c.code !== code);
  const cb = document.querySelector(`#countryList input[value="${code}"]`);
  if(cb) cb.checked = false;
  updateCountryDisplay();
  refreshHeaderFlags();
}

function refreshHeaderFlags(){
  renderFlagChips();
}

function renderFlagChips(){
  const flagsDiv = document.getElementById("headerFlags");
  if(!flagsDiv) return;
  const nameMap = {};
  ALL_COUNTRIES.forEach(g => g.items.forEach(([code, name]) => { nameMap[code] = name; }));
  const sorted = Object.entries(countryPartnerCounts).filter(([code,v]) => v > 0 && code.length === 2 && /^[A-Z]{2}$/.test(code)).sort((a,b) => b[1] - a[1]);
  let hasIncomplete = false;
  const activeCode = typeof currentScrapingCountry !== 'undefined' ? currentScrapingCountry : null;
  const chips = sorted.map(([code, cnt]) => {
    const isSelected = selectedCountries.some(c => c.code === code);
    const isActive = activeCode === code;
    const dir = getDirectory(code);
    const dirTotal = dir ? Object.keys(dir.ids).length : 0;
    const pending = dir ? Object.values(dir.ids).filter(s => s === "pending").length : 0;
    const missing = dirTotal - cnt;
    if(pending > 0) hasIncomplete = true;
    const name = nameMap[code] || code;
    const cls = `flag-chip${isSelected?' selected':''}${isActive?' active-download':''}`;
    return `<div class="${cls}" data-flag-chip="${code}" onclick="selectFlagCountry('${code}','${name}')" title="${name}: ${cnt} profili${dirTotal > 0 ? ', -'+missing+' su '+dirTotal : ''}">
      <span class="flag-emoji">${countryFlag(code)}</span>
      <span class="flag-counts">
        <span class="flag-count-top">${cnt}</span>
        ${dirTotal > 0 && missing > 0 ? '<span class="flag-count-bottom">-'+missing+'</span>' : (dirTotal > 0 ? '<span class="flag-count-ok">✓</span>' : '')}
      </span>
      <span class="flag-name">${name}</span>
    </div>`;
  });
  // Tasto retry PROFILI — confronta directory vs profili e scarica solo i mancanti
  chips.push(`<div class="flag-chip" onclick="retryIncompleteDirectories()" title="👤 Confronta directory vs profili — scarica solo i mancanti" style="cursor:pointer;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.4)">
    <span style="font-size:1rem">🔄</span>
    <span style="font-size:.5rem;font-weight:700;color:#c4b5fd;letter-spacing:.3px">RETRY</span>
  </div>`);
  flagsDiv.innerHTML = chips.join("");
}

function _initAllPopups(){ initCountrySelector(); initNetworksGrid(); }
if(document.readyState === "loading"){ document.addEventListener("DOMContentLoaded", _initAllPopups); }
else { _initAllPopups(); }

function toggleAllCountriesMode(){
  const chk = document.getElementById("chkAllCountries");
  const hint = document.getElementById("allCountriesHint");
  if(hint) hint.style.display = chk.checked ? "inline" : "none";
}

function getAllCountriesList(){
  const all = [];
  for(const group of ALL_COUNTRIES){
    for(const [code, name] of group.items){
      all.push({code, name});
    }
  }
  return all;
}

function selectFlagCountry(code, name){
  // Se non è già selezionato, aggiungilo
  if(!selectedCountries.some(c => c.code === code)){
    selectedCountries.push({code, name});
    const cb = document.querySelector(`#countryList input[value="${code}"]`);
    if(cb) cb.checked = true;
    updateCountryDisplay();
  }
  // Scroll al pannello download
  document.querySelector(".container").scrollIntoView({behavior:"smooth"});
  // Aggiorna evidenziazione flags
  loadHeaderCounts();
}
