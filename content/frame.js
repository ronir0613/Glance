// Glance Frame Helper Script (runs in all frames)
(function() {
  if (window.top !== window.self) {
    document.documentElement.classList.add('glance-preview-iframe');
  }
})();
