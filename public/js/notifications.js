// Notifications Module — bell icon with notification count, sound, and desktop notifications

// === NOTIFICATION BELL — suono + badge contatore ===
let notificationsEnabled = false;
let notificationCount = 0;
const bellAudio = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1lZWltbW1zc3V1dXZ2dnV1c3FtaWViXltYVlRSUlRWWFxgZGhtcnZ6fX+BgoKBgH58eXVxbGdiXlpXVFJRUlRXW19kZ2txdXh7foCBgoGAf316d3NuamViXltYVlVVVlhbXmJma3B0eHt+gIGCgYCAf3x5dnJuamZjYF5cW1tcXWBjZ2xwdHh7foCBgoGAf316d3RwbGlmYmBfXl5fYGNmaWxtcHN2eXt9f4CBgYGAf348e3h1cnBtamhmZWRkZGVmaWltcHN2eXt9f4CBgYGAf348e3h1cnBtamhmZWRkZGVmaWltcHN2eXt9f4CBgYGAf35+e3h1cnBuamZjYF5eW1xcXWBjZ2xwc3d6fH6AgYKBgH9+e3h1cnBtamhhY2FfX19gY2ZpaWxvcHN2eHt9f4GBgoGAf35+e3h1cXBuamZjYF9eXl5fYGNmamxwc3d6fH5+gIGBgYB+fn57eHVzb25qZmNgXl5eXmBjZmlsbHBzd3p7fH5+gICBgYGAf39+e3h1dHBuamZjYF5eXl5eYGNmZ2xwc3d5e3t+fn5+gICBgICAf39/fnx5dXRybm5mZWNgXl9fX2BjZ2ZmaGxwc3d5e3t9fn5+gICAf39/fnt5dXRybm5mZWNgXl9fX2BjZ2ZlaWxwc3d5e3t9fn5/gICAgICAgH9+fnt4dXRybm5mZWRgXl9fX2BjZ2ZlaWxwc3d4eXt7fX5+f4CAgICAgH9+f39+eHV0cm5uZmVkYF5fX19gY2dnZWlsb3Nzd3h5e3t9fn5/gICAgICAgH9/f35+eHV0cm5uZmVkYF5fX19gY2dnZWlsb3Nzd3h5e3t9fn5/gICAgICAgH9/f35+eHV0cm5uZmVkYF5fX19gY2dnZWlsb3Nzd3h5e3t9fn5/gICAgICAgH9/f35+eHV0cm5uZmVkYF5fX19gY2dnZWlsb3Nzd3h5e3t9fn5/gICAgICAgH9/f35+eHV0cm5uZmVkYF5fX19gY2dnZWlsb3Nzd3h5e3t9fn5/gICAgICAgH9/f35+eHV0cm5uZmVkYF5fX19gY2dnZWlsb3Nzd3h5e3t9fn5/gICAgICAgH9/f35+eHV0cm5uZmVkYF5fX19gY2dnZWlsb3Nzd3h5e3t9fn5/gICAgICAgH9/f35+eHV0cm5uZmVkYF5fX19gY2dnZWlsb3Nzd3h5e3t9fn5/gICAgICAgH9/f35+eHV0cm5uZmVkYF5fX19gY2dnZWlsb3Nzd3h5e3t9fn5/gICAgICAgH9/f35+eHV0cm5uZmVkYF5fX19gY2dnZWlsb3Nzd3h5e3t9fn5/gA==");

function toggleNotifications(){
  notificationsEnabled = !notificationsEnabled;
  const bellBtn = document.getElementById("btnBell");
  if(bellBtn) bellBtn.style.opacity = notificationsEnabled ? "1" : "0.4";
  if(notificationsEnabled){
    bellAudio.play().catch(()=>{});
    notificationCount = 0;
    updateBellBadge();
    if("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  }
}

function notifyEvent(msg){
  notificationCount++;
  updateBellBadge();
  if(notificationsEnabled){
    try { bellAudio.currentTime = 0; bellAudio.play().catch(()=>{}); } catch(e){}
    if("Notification" in window && Notification.permission === "granted"){
      new Notification("WCA Scraper", { body: msg, icon: "📡" });
    }
  }
}

function updateBellBadge(){
  const b = document.getElementById("bellBadge");
  if(!b) return;
  if(notificationCount > 0){ b.textContent = notificationCount > 99 ? "99+" : notificationCount; b.style.display = "block"; }
  else { b.style.display = "none"; }
}

// Request notification permission on first toggle
if("Notification" in window && Notification.permission === "default"){
  // will ask when user clicks bell
}
