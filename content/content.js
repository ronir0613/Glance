// Glance Content Script

(function () {
  // Prevent duplicate injections
  if (window.hasGlanceInjected) return;
  window.hasGlanceInjected = true;

  // Settings Cache
  let settings = {
    enabled: true,
    hoverDelay: 400,
    blacklist: []
  };

  // State Variables
  let hoverTimer = null;
  let activeAnchor = null;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let currentPreviewUrl = null;
  let glancePreviewElement = null;

  // Load Settings from chrome.storage
  function loadSettings() {
    chrome.storage.local.get({
      enabled: true,
      hoverDelay: 400,
      blacklist: []
    }, (items) => {
      settings = items;
      // If we are currently hovering but extension was disabled, hide preview
      if (!settings.enabled || isDomainExcluded(window.location.href)) {
        hidePreview();
      }
    });
  }

  loadSettings();

  // Listen for settings changes
  chrome.storage.onChanged.addListener((changes) => {
    for (let key in changes) {
      settings[key] = changes[key].newValue;
    }
    if (!settings.enabled || isDomainExcluded(window.location.href)) {
      hidePreview();
    }
  });

  // Verify domain exclusion using a regex to catch subdomains
  function isDomainExcluded(url) {
    try {
      const hostname = new URL(url).hostname;
      return settings.blacklist.some(domain => {
        const escaped = domain.replace(/\./g, '\\.');
        const regex = new RegExp(`(^|\\.)${escaped}$`, 'i');
        return regex.test(hostname);
      });
    } catch (e) {
      return false;
    }
  }

  // Verify if a target link is valid for previewing
  function isValidLink(anchor) {
    if (!anchor || !anchor.href) return false;
    
    // Ignore internal page anchors
    try {
      const url = new URL(anchor.href);
      
      // Ignore non-web protocols (chrome://, mailto:, javascript:, etc.)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

      // Ignore hash links pointing to the same page
      const currentUrl = new URL(window.location.href);
      if (url.origin === currentUrl.origin && url.pathname === currentUrl.pathname && url.search === currentUrl.search) {
        // If it only differs by hash, it's a same-page anchor
        return false;
      }

      // Ignore if the target domain itself is blacklisted
      if (isDomainExcluded(anchor.href)) return false;

      return true;
    } catch (e) {
      return false;
    }
  }

  // Create Custom Preview Element in Shadow DOM
  function initPreviewElement() {
    if (glancePreviewElement) return;

    // Create wrapper div
    glancePreviewElement = document.createElement('div');
    glancePreviewElement.id = 'glance-preview-container';
    
    // Attach Shadow DOM
    const shadow = glancePreviewElement.attachShadow({ mode: 'open' });
    
    // Link Stylesheet
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('content/content.css');
    shadow.appendChild(link);

    // Card HTML Structure
    const card = document.createElement('div');
    card.className = 'glance-card';
    card.innerHTML = `
      <div class="glance-image-container">
        <div class="skeleton-image shimmer-active"></div>
        <img class="glance-image" src="" alt="Preview Image" />
      </div>
      <div class="glance-body">
        <div class="glance-header">
          <img class="glance-favicon" src="" alt="" />
          <div class="glance-domain"></div>
          <div class="skeleton-domain shimmer-active" style="display: none;"></div>
        </div>
        <div class="glance-content-section">
          <h4 class="glance-title"></h4>
          <p class="glance-description"></p>
        </div>
        <div class="skeleton-container" style="display: none;">
          <div class="skeleton-title shimmer-active"></div>
          <div class="skeleton-title-short shimmer-active"></div>
          <div style="margin-top: 6px;"></div>
          <div class="skeleton-desc-line1 shimmer-active"></div>
          <div class="skeleton-desc-line2 shimmer-active"></div>
          <div class="skeleton-desc-line3 shimmer-active"></div>
        </div>
      </div>
    `;

    shadow.appendChild(card);
    document.body.appendChild(glancePreviewElement);

    // Listen to image load to recalculate position (in case image changes card height)
    const img = card.querySelector('.glance-image');
    img.onload = () => {
      img.classList.add('loaded');
      if (card.classList.contains('visible')) {
        repositionCard(lastMouseX, lastMouseY);
      }
    };
  }

  // Show Loading Skeleton
  function showLoadingState(url) {
    initPreviewElement();
    const shadow = glancePreviewElement.shadowRoot;
    const card = shadow.querySelector('.glance-card');

    // Reset Elements
    const imgContainer = shadow.querySelector('.glance-image-container');
    const img = shadow.querySelector('.glance-image');
    const favicon = shadow.querySelector('.glance-favicon');
    const domain = shadow.querySelector('.glance-domain');
    const contentSec = shadow.querySelector('.glance-content-section');
    const skeletonImg = shadow.querySelector('.skeleton-image');
    const skeletonDomain = shadow.querySelector('.skeleton-domain');
    const skeletonContainer = shadow.querySelector('.skeleton-container');

    // Reset visibility states
    img.classList.remove('loaded');
    img.src = '';
    imgContainer.style.display = 'flex';
    skeletonImg.style.display = 'block';

    favicon.style.display = 'none';
    domain.style.display = 'none';
    skeletonDomain.style.display = 'block';

    contentSec.style.display = 'none';
    skeletonContainer.style.display = 'flex';

    // Set Domain immediately if possible
    try {
      const targetDomain = new URL(url).hostname;
      domain.textContent = targetDomain;
      skeletonDomain.style.display = 'none';
      domain.style.display = 'block';
    } catch(e) {}

    // Position initially and show
    repositionCard(lastMouseX, lastMouseY);
    card.classList.add('visible');
  }

  // Populate Card with Metadata
  function populateCard(data) {
    if (!glancePreviewElement) return;
    const shadow = glancePreviewElement.shadowRoot;
    const card = shadow.querySelector('.glance-card');

    const imgContainer = shadow.querySelector('.glance-image-container');
    const img = shadow.querySelector('.glance-image');
    const favicon = shadow.querySelector('.glance-favicon');
    const domain = shadow.querySelector('.glance-domain');
    const title = shadow.querySelector('.glance-title');
    const desc = shadow.querySelector('.glance-description');
    const contentSec = shadow.querySelector('.glance-content-section');
    const skeletonImg = shadow.querySelector('.skeleton-image');
    const skeletonContainer = shadow.querySelector('.skeleton-container');

    // Bind values
    title.textContent = data.title;
    desc.textContent = data.description;
    domain.textContent = data.domain;

    // Load Favicon using Google S2 / Extension Favicon API
    favicon.src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(data.url)}&size=32`;
    favicon.style.display = 'block';

    // Handle preview image (OG Image)
    if (data.image) {
      img.src = data.image;
      skeletonImg.style.display = 'block'; // Keep skeleton visible until real image loads
    } else {
      imgContainer.style.display = 'none';
      skeletonImg.style.display = 'none';
    }

    // Hide loading structures, show real text content
    skeletonContainer.style.display = 'none';
    contentSec.style.display = 'block';

    // Position card again with final content sizes
    repositionCard(lastMouseX, lastMouseY);
  }

  // Position Card Intelligently
  function repositionCard(clientX, clientY) {
    if (!glancePreviewElement) return;
    const shadow = glancePreviewElement.shadowRoot;
    const card = shadow.querySelector('.glance-card');
    if (!card) return;

    // Viewport size
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Card sizes (force calculation if hidden)
    const isHidden = !card.classList.contains('visible');
    if (isHidden) {
      card.style.visibility = 'hidden';
      card.style.display = 'block';
    }

    const cardWidth = card.offsetWidth || 320;
    const cardHeight = card.offsetHeight || 180;

    if (isHidden) {
      card.style.display = '';
      card.style.visibility = '';
    }

    // Default positioning: 16px offset bottom-right of cursor
    let left = clientX + 16;
    let top = clientY + 16;

    // Check right viewport border
    if (left + cardWidth > viewportWidth - 12) {
      // Move to the left of the cursor instead
      left = clientX - 16 - cardWidth;
      // If it goes off the left screen edge, clamp it
      if (left < 12) {
        left = 12;
      }
    }

    // Check bottom viewport border
    if (top + cardHeight > viewportHeight - 12) {
      // Move to the top of the cursor instead
      top = clientY - 16 - cardHeight;
      // If it goes off the top screen edge, clamp it
      if (top < 12) {
        top = 12;
      }
    }

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  // Hide Card
  function hidePreview() {
    if (glancePreviewElement) {
      const card = glancePreviewElement.shadowRoot.querySelector('.glance-card');
      if (card) {
        card.classList.remove('visible');
      }
    }
    currentPreviewUrl = null;
  }

  // Trigger preview fetch
  function triggerPreview(url) {
    if (currentPreviewUrl === url) return;
    currentPreviewUrl = url;

    // Open card in loading mode
    showLoadingState(url);

    // Request metadata from service worker
    chrome.runtime.sendMessage({ action: 'fetchPreview', url: url }, (response) => {
      // Ensure we are still waiting for this specific URL preview
      if (currentPreviewUrl !== url) return;

      if (response && response.success && response.data) {
        populateCard(response.data);
      } else {
        // Handle failure gracefully
        let domainName = url;
        try {
          domainName = new URL(url).hostname;
        } catch(e){}

        populateCard({
          url: url,
          title: domainName,
          description: 'Could not load page preview.',
          image: '',
          domain: domainName
        });
      }
    });
  }

  // Event Handlers
  function handleMouseOver(e) {
    if (!settings.enabled || isDomainExcluded(window.location.href)) return;

    const anchor = e.target.closest('a');
    if (!isValidLink(anchor)) return;

    // Reset previous timer/hover state if hovering a new link
    if (activeAnchor && activeAnchor !== anchor) {
      clearTimeout(hoverTimer);
      hidePreview();
    }

    activeAnchor = anchor;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    // Start delay timer
    hoverTimer = setTimeout(() => {
      if (activeAnchor === anchor) {
        triggerPreview(anchor.href);
      }
    }, settings.hoverDelay);
  }

  function handleMouseMove(e) {
    if (!activeAnchor) return;
    
    // Update cursor position during delay to place the loading card accurately
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    // If card is already showing in loading skeleton, let it follow mouse movement slightly
    if (glancePreviewElement) {
      const card = glancePreviewElement.shadowRoot.querySelector('.glance-card');
      const isLoading = glancePreviewElement.shadowRoot.querySelector('.skeleton-container').style.display !== 'none';
      if (card && card.classList.contains('visible') && isLoading) {
        repositionCard(lastMouseX, lastMouseY);
      }
    }
  }

  function handleMouseOut(e) {
    if (!activeAnchor) return;

    // Check if moving to an inner element of the same anchor
    const toElement = e.relatedTarget;
    if (toElement && toElement.closest('a') === activeAnchor) {
      return; // Still hovering the same anchor
    }

    clearTimeout(hoverTimer);
    activeAnchor = null;
    hidePreview();
  }

  function handleScroll() {
    if (activeAnchor || currentPreviewUrl) {
      clearTimeout(hoverTimer);
      activeAnchor = null;
      hidePreview();
    }
  }

  function handleClick() {
    // Hide preview immediately on click so it doesn't get in the way
    clearTimeout(hoverTimer);
    activeAnchor = null;
    hidePreview();
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      clearTimeout(hoverTimer);
      activeAnchor = null;
      hidePreview();
    }
  }

  // Register Global Event Listeners
  document.addEventListener('mouseover', handleMouseOver, { passive: true });
  document.addEventListener('mousemove', handleMouseMove, { passive: true });
  document.addEventListener('mouseout', handleMouseOut, { passive: true });
  window.addEventListener('scroll', handleScroll, { passive: true });
  document.addEventListener('click', handleClick, { passive: true });
  document.addEventListener('keydown', handleKeyDown, { passive: true });

})();
