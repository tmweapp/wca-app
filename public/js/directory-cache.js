// WCA — Directory Cache

// === FULL DIRECTORY CACHE — discover una volta, usa sempre ===
// Salva: wca_fulldir_{CC} = { members:[{id,name,href,network},...], networks:{domain:count}, ts }
function getFullDirectory(countryCode){
  try { return JSON.parse(localStorage.getItem("wca_fulldir_"+countryCode)); } catch(e){ return null; }
}

function saveFullDirectory(countryCode, data){
  try { localStorage.setItem("wca_fulldir_"+countryCode, JSON.stringify(data)); } catch(e){ console.warn("saveFullDir err:", e.message); }
}

function getFullDirAge(countryCode){
  const d = getFullDirectory(countryCode);
  if(!d) return Infinity;
  return (Date.now() - d.ts) / 3600000; // ore
}
