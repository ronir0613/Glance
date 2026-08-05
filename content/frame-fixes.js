// Glance Frame Fixes
// Injected into all frames via manifest.json to defeat CSS anti-clickjacking

if (window !== window.top && window.name === 'glance-preview') {
  // We are running inside the Glance preview iframe!
  
  // 1. Defeat CSS anti-clickjacking by forcing the body to be visible
  const forceVisibility = () => {
    if (!document.documentElement) return;
    let style = document.getElementById('glance-anti-clickjack');
    if (!style) {
      style = document.createElement('style');
      style.id = 'glance-anti-clickjack';
      style.textContent = `
        body {
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
        }
      `;
      // Append to documentElement to ensure it works even if head doesn't exist yet
      document.documentElement.appendChild(style);
    }
  };

  // Run immediately
  forceVisibility();
  
  // Run on DOMContentLoaded just in case
  document.addEventListener('DOMContentLoaded', forceVisibility);
}
