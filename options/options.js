// Glance Options Dashboard Handler

document.addEventListener('DOMContentLoaded', () => {
  const delaySlider = document.getElementById('delay-slider');
  const delayVal = document.getElementById('delay-val');
  const cacheStats = document.getElementById('cache-stats');
  const clearCacheBtn = document.getElementById('clear-cache-btn');
  
  const blacklistInput = document.getElementById('blacklist-input');
  const addDomainBtn = document.getElementById('add-domain-btn');
  const blacklistSearch = document.getElementById('blacklist-search');
  const blacklistUl = document.getElementById('blacklist-ul');
  const emptyState = document.getElementById('empty-state');
  
  const toast = document.getElementById('toast');

  let blacklist = [];
  let toastTimeout = null;

  // Retrieve configurations and render
  chrome.storage.local.get({
    hoverDelay: 150,
    blacklist: []
  }, (items) => {
    // 1. Slider Setup
    delaySlider.value = items.hoverDelay;
    delayVal.textContent = `${items.hoverDelay} ms`;
    
    // 2. Blacklist Setup
    blacklist = items.blacklist;
    renderBlacklist();
  });

  // Calculate local IndexedDB cache previews count
  function updateCacheStats() {
    chrome.runtime.sendMessage({ action: 'getCacheStats' }, (response) => {
      if (response && response.count !== undefined) {
        cacheStats.textContent = `Cached Previews: ${response.count} items`;
      } else {
        cacheStats.textContent = 'Cached Previews: Error';
      }
    });
  }

  updateCacheStats();

  // Show status popup toast
  function showToast(message) {
    clearTimeout(toastTimeout);
    toast.textContent = message;
    toast.classList.add('show');
    toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }

  // Handle delay slider change
  delaySlider.addEventListener('input', () => {
    const val = delaySlider.value;
    delayVal.textContent = `${val} ms`;
  });

  delaySlider.addEventListener('change', () => {
    const val = parseInt(delaySlider.value, 10);
    chrome.storage.local.set({ hoverDelay: val }, () => {
      showToast(`Hover delay set to ${val}ms`);
    });
  });

  // Clear previews cache
  clearCacheBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all cached website previews?')) {
      chrome.runtime.sendMessage({ action: 'clearCache' }, (response) => {
        if (response && response.success) {
          showToast('Previews cache cleared successfully');
          updateCacheStats();
        } else {
          showToast('Failed to clear cache');
        }
      });
    }
  });

  // Render Exclusions Blacklist UI list
  function renderBlacklist() {
    blacklistUl.innerHTML = '';
    const query = blacklistSearch.value.trim().toLowerCase();
    
    // Filter exclusions if searching
    const filteredList = blacklist.filter(domain => domain.toLowerCase().includes(query));

    if (filteredList.length === 0) {
      emptyState.style.display = 'flex';
      blacklistUl.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    blacklistUl.style.display = 'block';

    // Sort list alphabetically
    filteredList.sort().forEach((domain) => {
      const li = document.createElement('li');
      
      const textSpan = document.createElement('span');
      textSpan.textContent = domain;
      li.appendChild(textSpan);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.title = `Remove ${domain}`;
      deleteBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
      
      deleteBtn.addEventListener('click', () => {
        removeDomain(domain);
      });

      li.appendChild(deleteBtn);
      blacklistUl.appendChild(li);
    });
  }

  // Add domain to exclusion blacklist
  function addDomain() {
    let rawInput = blacklistInput.value.trim();
    if (!rawInput) return;

    // Sanitize input: Strip protocol if present
    let domain = rawInput;
    if (domain.includes('://')) {
      try {
        domain = new URL(domain).hostname;
      } catch (e) {
        domain = domain.split('://')[1];
      }
    }
    
    // Strip trailing path/query/slashes
    domain = domain.split('/')[0].split('?')[0].split('#')[0];
    domain = domain.toLowerCase();

    // Basic domain validation
    if (domain.length < 3 || !domain.includes('.')) {
      alert('Please enter a valid website hostname (e.g. github.com)');
      return;
    }

    if (blacklist.includes(domain)) {
      showToast(`${domain} is already excluded`);
      blacklistInput.value = '';
      return;
    }

    blacklist.push(domain);
    chrome.storage.local.set({ blacklist: blacklist }, () => {
      blacklistInput.value = '';
      renderBlacklist();
      showToast(`Added ${domain} to exclusions`);
    });
  }

  // Remove domain from exclusion blacklist
  function removeDomain(domain) {
    blacklist = blacklist.filter(d => d !== domain);
    chrome.storage.local.set({ blacklist: blacklist }, () => {
      renderBlacklist();
      showToast(`Removed ${domain} from exclusions`);
    });
  }

  // Bind exclusion control events
  addDomainBtn.addEventListener('click', addDomain);
  
  blacklistInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addDomain();
    }
  });

  blacklistSearch.addEventListener('input', renderBlacklist);
});
