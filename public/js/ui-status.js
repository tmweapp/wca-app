// UI Status Module — status display, progress bar, active country/download management

function setStatus(text, online=false){
  const st = document.getElementById("statusText");
  if(st) st.textContent = text;
  const fb = document.getElementById("statusTextFallback");
  if(fb) fb.textContent = text;
  const dot = document.getElementById("statusDot");
  if(dot) dot.className = "status-dot " + (online?"on":"off");
  // Mostra la riga download attivo quando online
  const dlRow = document.getElementById("activeDownloadRow");
  if(dlRow && online) dlRow.style.display = "flex";
}

function setProgress(current, total){
  const pct = total > 0 ? (current/total*100) : 0;
  const fill = document.getElementById("progressFill");
  if(fill) fill.style.width = pct+"%";
  const pt = document.getElementById("progressText");
  if(pt) pt.textContent = `${current}/${total}`;
}

// === COUNTRY BADGE — bandiera + nome paese attivo ===
function setActiveCountry(code, name){
  const badge = document.getElementById("activeCountryBadge");
  const dlRow = document.getElementById("activeDownloadRow");
  const fb = document.getElementById("statusTextFallback");
  if(!code && !name){ if(badge) badge.style.display = "none"; if(fb) fb.style.display = ""; return; }
  const cf = document.getElementById("activeCountryFlag");
  if(cf) cf.textContent = countryFlag(code);
  const cn = document.getElementById("activeCountryName");
  if(cn) cn.textContent = name || code;
  if(badge) badge.style.display = "flex";
  if(dlRow) dlRow.style.display = "flex";
  if(fb) fb.style.display = "none";
}

function hideActiveCountry(){
  const b = document.getElementById("activeCountryBadge");
  if(b) b.style.display = "none";
  const fb = document.getElementById("statusTextFallback");
  if(fb) fb.style.display = "";
}

function hideDownloadRow(){
  const dlRow = document.getElementById("activeDownloadRow");
  if(dlRow) dlRow.style.display = "none";
  hideCountryCompletion();
  resetCompletedNetworks();
}

// === ACTIVITY BAR — mostra cosa sta succedendo in tempo reale ===
let activityTimerInterval = null;

function showActivity(icon, text){
  const bar = document.getElementById("activityBar");
  if(!bar) return;
  bar.style.display = "flex";
  const ai = document.getElementById("activityIcon"); if(ai) ai.textContent = icon;
  const at = document.getElementById("activityText"); if(at) at.textContent = text;
  const atr = document.getElementById("activityTimer"); if(atr) atr.textContent = "";
  if(activityTimerInterval){ clearInterval(activityTimerInterval); activityTimerInterval = null; }
}

function hideActivity(){
  const bar = document.getElementById("activityBar");
  if(bar) bar.style.display = "none";
  if(activityTimerInterval){ clearInterval(activityTimerInterval); activityTimerInterval = null; }
}

function showCountdown(icon, text, seconds){
  const bar = document.getElementById("activityBar");
  bar.style.display = "flex";
  document.getElementById("activityIcon").textContent = icon;
  document.getElementById("activityText").textContent = text;
  const timerEl = document.getElementById("activityTimer");
  let remaining = seconds;
  timerEl.textContent = remaining + "s";
  if(activityTimerInterval) clearInterval(activityTimerInterval);
  activityTimerInterval = setInterval(() => {
    remaining--;
    if(remaining <= 0){ timerEl.textContent = "0s"; clearInterval(activityTimerInterval); activityTimerInterval = null; }
    else timerEl.textContent = remaining + "s";
  }, 1000);
}
