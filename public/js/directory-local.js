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
  refreshCountryCompletion();
}

function markIdFailed(code, id){
  const dir = getDirectory(code);
  if(!dir) return;
  dir.ids[String(id)] = "failed";
  saveDirectory(code, dir);
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
  const pending = Object.values(dir.ids).filter(s => s === "pending").length;
  return pending === 0;
}

function markCountryCompleted(code, count){
  const cName = selectedCountries.find(c => c.code === code)?.name || code;
  addCompletedJob(code, cName, count, currentMode);
}
