// WCA — Utility Functions

// Bandiera emoji da codice paese ISO
function countryFlag(code){
  if(!code || code.length !== 2) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

// HTML escape utility
function esc(s){
  return s ? String(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    : "";
}

// Sleep with countdown visual feedback
async function sleepWithActivity(icon, text, ms){
  const secs = Math.round(ms/1000);
  showCountdown(icon || "⏸", text || `Pausa ${secs}s...`, secs);
  await sleep(ms);
}

// Basic sleep function
function sleep(ms){
  return new Promise(r=>setTimeout(r,ms));
}

// ═══ DOWNLOAD MODE — indica cosa si sta scaricando ═══
let currentDownloadMode = null;
function setDownloadMode(mode){
  currentDownloadMode = mode;
  const icon = document.getElementById("dmIcon");
  const title = document.getElementById("dmTitle");
  const statusDot = document.getElementById("statusDot");
  if(mode === "directory"){
    if(icon) icon.textContent = "📂";
    if(title){ title.textContent = "Download Directory"; title.style.color = "#7dd3fc"; }
    if(statusDot) statusDot.style.background = "#0ea5e9";
  } else if(mode === "network"){
    if(icon) icon.textContent = "🔄";
    if(title){ title.textContent = "Aggiornamento Network"; title.style.color = "#6ee7b7"; }
    if(statusDot) statusDot.style.background = "#10b981";
  } else if(mode === "profiles"){
    if(icon) icon.textContent = "👤";
    if(title){ title.textContent = "Download Profili"; title.style.color = "#c4b5fd"; }
    if(statusDot) statusDot.style.background = "#8b5cf6";
  } else {
    if(icon) icon.textContent = "📥";
    if(title){ title.textContent = "Download Manager"; title.style.color = ""; }
    if(statusDot) statusDot.style.background = "";
    currentDownloadMode = null;
  }
}
