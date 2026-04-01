// WCA — Directory Local

// === DIRECTORY LOCALE PER PAESE ===
// Ogni paese ha una directory in localStorage: wca_dir_XX = { ids: {id: "pending"|"done"|"failed"}, ts, total }
function getDirectory(code){
  if(!code) return null;
  try { return JSON.parse(localStorage.getItem("wca_dir_"+code)); } catch(e){ return null; }
}

function saveDirectory(code, dir){
  if(!code) return;
  try { localStorage.setItem("wca_dir_"+code, JSON.stringify(dir)); } catch(e){ console.warn("saveDir err:", e.message); }
}

function createDirectory(code, memberIds){
  const ids = {};
  for(const id of memberIds) ids[String(id)] = "pending";
  const dir = { ids, ts: Date.now(), total: memberIds.length };
  saveDirectory(code, dir);
  return dir;
}

function markIdDone(code, id){
  const dir = getDirectory(code);
  if(!dir) return;
  dir.ids[String(id)] = "done";
  saveDirectory(code, dir);
  // Sync: assicura che fullDir contenga anche questo ID
  try {
    const fullDir = getFullDirectory(code);
    if(fullDir && fullDir.members && !fullDir.members.find(m => String(m.id) === String(id))){
      fullDir.members.push({ id: Number(id), name: "", href: "", networks: [] });
      saveFullDirectory(code, fullDir);
    }
  } catch(e){ console.warn("markIdDone fullDir sync:", e.message); }
  refreshCountryCompletion();
}

function markIdFailed(code, id){
  const dir = getDirectory(code);
  if(!dir) return;
  dir.ids[String(id)] = "failed";
  saveDirectory(code, dir);
  // Sync: assicura che fullDir contenga anche questo ID
  try {
    const fullDir = getFullDirectory(code);
    if(fullDir && fullDir.members && !fullDir.members.find(m => String(m.id) === String(id))){
      fullDir.members.push({ id: Number(id), name: "", href: "", networks: [] });
      saveFullDirectory(code, fullDir);
    }
  } catch(e){ console.warn("markIdFailed fullDir sync:", e.message); }
}


function getPendingIds(code){
  const dir = getDirectory(code);
  if(!dir) return [];
  return Object.keys(dir.ids).filter(id => dir.ids[id] === "pending");
}

function getDoneCount(code){
  const dir = getDirectory(code);
  if(!dir) return 0;
  return Object.values(dir.ids).filter(s => s === "done").length;
}

function isCountryCompleted(code){
  const dir = getDirectory(code);
  if(!dir) return false;
  const statuses = Object.values(dir.ids);
  const pending = statuses.filter(s => s === "pending").length;
  const failed = statuses.filter(s => s === "failed").length;
  // Completato solo se nessun pending E nessun failed
  return pending === 0 && failed === 0;
}

// Completato con tolleranza: accetta fino a N falliti
function isCountryCompletedSoft(code, maxFailed = 5){
  const dir = getDirectory(code);
  if(!dir) return false;
  const statuses = Object.values(dir.ids);
  const pending = statuses.filter(s => s === "pending").length;
  const failed = statuses.filter(s => s === "failed").length;
  return pending === 0 && failed <= maxFailed;
}

function markCountryCompleted(code, count){
  const cName = selectedCountries.find(c => c.code === code)?.name || code;
  addCompletedJob(code, cName, count, typeof currentMode !== 'undefined' ? currentMode : 'unknown');
  // Salva anche in completedCountries per tracking cross-reload
  try {
    if(typeof completedCountries !== 'undefined'){
      completedCountries[code] = { count, ts: Date.now(), name: cName };
      localStorage.setItem("wca_completed_countries", JSON.stringify(completedCountries));
    }
  } catch(e){ console.warn("markCountryCompleted save err:", e.message); }
}
