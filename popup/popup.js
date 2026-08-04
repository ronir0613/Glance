// Glance Popup Actions

document.addEventListener('DOMContentLoaded', () => {
  const globalToggle = document.getElementById('global-toggle');
  const siteToggle = document.getElementById('site-toggle');
  const statusBadge = document.getElementById('status-badge');
  const siteDesc = document.getElementById('site-desc');
  const domainText = document.getElementById('domain-text');
  const statusDot = document.getElementById('status-dot');
  const settingsBtn = document.getElementById('settings-btn');

  let currentHostname = '';
  let blacklist = [];
  let isEnabled = true;

  // Retrieve current configurations
  chrome.storage.local.get({
    enabled: true,
    blacklist: []
  }, (items) => {
    isEnabled = items.enabled;
    blacklist = items.blacklist;
    
    globalToggle.checked = isEnabled;
    updateStatusBadge(isEnabled);

    // Query active tab to setup site-specific settings
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) return;
      const activeTab = tabs[0];
      const urlString = activeTab.url || '';

      if (urlString.startsWith('http://') || urlString.startsWith('https://')) {
        try {
          const urlObj = new URL(urlString);
          currentHostname = urlObj.hostname;
          domainText.textContent = currentHostname;

          // Site is allowed if it's NOT in the blacklist
          const isSiteEnabled = !isDomainExcluded(currentHostname, blacklist);
          
          siteToggle.disabled = false;
          siteToggle.checked = isSiteEnabled;
          siteDesc.textContent = `Enable previews on this site`;
          
          updateFooterStatus(isEnabled && isSiteEnabled);
        } catch (e) {
          handleInternalPage();
        }
      } else {
        handleInternalPage();
      }
    });
  });

  // Handle internal page states (chrome://, etc.)
  function handleInternalPage() {
    domainText.textContent = 'Browser Internal Page';
    siteDesc.textContent = 'Disabled on browser pages';
    siteToggle.disabled = true;
    siteToggle.checked = false;
    updateFooterStatus(false);
  }

  // Verify domain exclusion using a regex matching subdomains
  function isDomainExcluded(hostname, exclusionList) {
    return exclusionList.some(domain => {
      const escaped = domain.replace(/\./g, '\\.');
      const regex = new RegExp(`(^|\\.)${escaped}$`, 'i');
      return regex.test(hostname);
    });
  }

  // Update Status Badge UI
  function updateStatusBadge(active) {
    if (active) {
      statusBadge.textContent = 'active';
      statusBadge.classList.remove('disabled');
    } else {
      statusBadge.textContent = 'off';
      statusBadge.classList.add('disabled');
    }
  }

  // Update Footer Dot Indicator
  function updateFooterStatus(active) {
    if (active) {
      statusDot.classList.add('active');
    } else {
      statusDot.classList.remove('active');
    }
  }

  // Save changes on Global Toggle
  globalToggle.addEventListener('change', () => {
    isEnabled = globalToggle.checked;
    chrome.storage.local.set({ enabled: isEnabled }, () => {
      updateStatusBadge(isEnabled);
      
      const isSiteEnabled = siteToggle.checked && !siteToggle.disabled;
      updateFooterStatus(isEnabled && isSiteEnabled);
    });
  });

  // Save changes on Current Site Toggle
  siteToggle.addEventListener('change', () => {
    if (!currentHostname) return;

    const isSiteEnabled = siteToggle.checked;
    
    if (isSiteEnabled) {
      // Remove from blacklist
      blacklist = blacklist.filter(d => d !== currentHostname && !currentHostname.endsWith('.' + d));
    } else {
      // Add to blacklist if not already there
      if (!blacklist.includes(currentHostname)) {
        blacklist.push(currentHostname);
      }
    }

    chrome.storage.local.set({ blacklist: blacklist }, () => {
      updateFooterStatus(isEnabled && isSiteEnabled);
    });
  });

  // Open settings dashboard
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
