// UI Status Module — status display, progress bar, active country/download management

function setStatus(text, online=false){
  document.getElementById("statusText").textContent = text;
  const fb = document.getElementById("statusTextFallback");
  if(fb) fb.textContent = text;
  document.getElementById("statusDot").className = "status-dot " + (online?"on":"off");
  // Mostra la riga download attivo quando online
  const dlRow = document.getElementById("activeDownloadRow");
  if(dlRow && online) dlRow.style.display = "flex";
}

function setProgress(current, total){
  const pct = total > 0 ? (current/total*100) : 0;
  document.getElementById("progressFill").style.width = pct+"%";
  document.getElementById("progressText").textContent = `${current}/${total}`;
}

// === COUNTRY BADGE — bandiera + nome paese attivo ===
function setActiveCountry(code, name){
  const badge = document.getElementById("activeCountryBadge");
  const dlRow = document.getElementById("activeDownloadRow");
  const fb = document.getElementById("statusTextFallback");
  if(!code && !name){ badge.style.display = "none"; if(fb) fb.style.display = ""; return; }
  document.getElementById("activeCountryFlag").textContent = countryFlag(code);
  document.getElementById("activeCountryName").textContent = name || code;
  badge.style.display = "flex";
  if(dlRow) dlRow.style.display = "flex";
  if(fb) fb.style.display = "none";
}

function hideActiveCountry(){
  document.getElementById("activeCountryBadge").style.display = "none";
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
  bar.style.display = "flex";
  document.getElementById("activityIcon").textContent = icon;
  document.getElementById("activityText").textContent = text;
  document.getElementById("activityTimer").textContent = "";
  if(activityTimerInterval){ clearInterval(activityTimerInterval); activityTimerInterval = null; }
}

function hideActivity(){
  document.getElementById("activityBar").style.display = "none";
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
