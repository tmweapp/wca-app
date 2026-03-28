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
