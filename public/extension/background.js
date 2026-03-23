const API_BASE = "https://wca-app.vercel.app";

// Relay messaggi dal popup alle API Vercel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if(msg.action === "api"){
    fetch(`${API_BASE}${msg.endpoint}`, {
      method: msg.method || "POST",
      headers: {"Content-Type": "application/json"},
      body: msg.body ? JSON.stringify(msg.body) : undefined,
    })
    .then(r => r.json())
    .then(data => sendResponse({success: true, data}))
    .catch(err => sendResponse({success: false, error: err.message}));
    return true; // async response
  }
  if(msg.action === "getState"){
    chrome.storage.local.get(null, (items) => sendResponse(items));
    return true;
  }
  if(msg.action === "setState"){
    chrome.storage.local.set(msg.data, () => sendResponse({ok: true}));
    return true;
  }
});
