// UI Log Module — logging to the log area with timestamp

let logCount = 0;

function log(msg, cls=""){
  const d = document.getElementById("logArea");
  const line = document.createElement("div");
  if(cls) line.className = cls;
  const t = new Date().toLocaleTimeString();
  line.textContent = `[${t}] ${msg}`;
  d.prepend(line);
  if(d.children.length > 200) d.removeChild(d.lastChild);

  // Aggiorna badge contatore se popup chiusa
  const overlay = document.getElementById("logPopupOverlay");
  if(!overlay || overlay.style.display === "none"){
    logCount++;
    updateLogBadge();
  }
}

function updateLogBadge(){
  const badge = document.getElementById("logCountBadge");
  if(!badge) return;
  if(logCount > 0){
    badge.textContent = logCount > 99 ? "99+" : logCount;
    badge.style.display = "block";
  } else {
    badge.style.display = "none";
  }
}

function toggleLogPopup(){
  const overlay = document.getElementById("logPopupOverlay");
  if(!overlay) return;
  const isOpen = overlay.style.display !== "none";
  overlay.style.display = isOpen ? "none" : "block";
  if(!isOpen){
    // Reset badge quando apri
    logCount = 0;
    updateLogBadge();
  }
}
