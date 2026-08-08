// Glance Content Script

(function () {
  if (window.hasGlanceInjected) return;
  window.hasGlanceInjected = true;

  let settings = { enabled: true, blacklist: [] };

  // ── Styles (inlined — no chrome-extension:// URL loading from page) ───────
  const GLANCE_CSS = `
    :host { all: initial; }

    /* ── Panel shell ──────────────────────────────────────────────────────── */
    .glance-panel {
      position: fixed; top: 0;
      width: 50vw; height: 100vh;
      z-index: 2147483647;
      pointer-events: none;
      box-sizing: border-box;
      opacity: 0;
      will-change: transform, opacity;
      transition: opacity 0.08s cubic-bezier(0.2, 0.8, 0.2, 1),
                  transform 0.08s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .glance-panel.right { right: 0; transform: translateX(24px); }
    .glance-panel.left { left: 0; transform: translateX(-24px); }
    .glance-panel.visible { opacity: 1; transform: translateX(0); pointer-events: auto; }

    /* ── Backdrop layer ───────────────────────────────────────────────────── */
    .glance-backdrop {
      position: fixed; inset: 0;
      z-index: 2147483646;
      pointer-events: none;
      backdrop-filter: blur(3px);
      background: rgba(0,0,0,0.1);
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .glance-backdrop.visible { opacity: 1; }

    /* ── Iframe layer ─────────────────────────────────────────────────────── */
    .glance-iframe-wrap {
      position: absolute; inset: 0;
      overflow: hidden;
      opacity: 0;
      will-change: opacity;
      transition: opacity 0.08s ease;
    }
    .glance-panel.right .glance-iframe-wrap { border-left: 1px solid rgba(255,255,255,0.12); border-right: none; }
    .glance-panel.left .glance-iframe-wrap { border-right: 1px solid rgba(255,255,255,0.12); border-left: none; }
    .glance-iframe-wrap.visible { opacity: 1; }

    /* Standard responsive layout (removed scale trick) */
    .glance-iframe {
      position: absolute; top: 0; left: 0;
      width: 100%; height: 100%;
      border: none;
      background: #fff;
      display: block;
    }

    /* Gradient bar at bottom of iframe for domain info */
    .glance-iframe-bar {
      position: absolute; bottom: 0; left: 0; right: 0;
      padding: 20px 20px 14px;
      background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%);
      display: flex; align-items: center; gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
    }
    .glance-iframe-bar img {
      width: 14px; height: 14px;
      border-radius: 2px; object-fit: contain; flex-shrink: 0;
    }
    .glance-iframe-bar-domain {
      font-size: 11px; font-weight: 500; color: #d4d4d8;
      letter-spacing: 0.02em;
    }

    /* ── Shared glass surface (used by loading + meta) ────────────────────── */
    .glass {
      position: absolute; inset: 0;
      background: rgba(8,8,12,0.5);
      backdrop-filter: blur(28px) saturate(140%) brightness(0.55);
      -webkit-backdrop-filter: blur(28px) saturate(140%) brightness(0.55);
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #f4f4f5;
    }
    .glance-panel.right .glass { border-left: 1px solid rgba(255,255,255,0.08); border-right: none; }
    .glance-panel.left .glass { border-right: 1px solid rgba(255,255,255,0.08); border-left: none; }

    /* Accent edge line */
    .glass::before {
      content: ''; position: absolute; top: 50%;
      transform: translateY(-50%);
      width: 2px; height: 120px;
      background: linear-gradient(180deg, transparent, #06b6d4 50%, transparent);
      border-radius: 1px; opacity: 0.7;
    }
    .glance-panel.right .glass::before { left: 0; right: auto; }
    .glance-panel.left .glass::before { right: 0; left: auto; }

    /* ── Loading overlay ──────────────────────────────────────────────────── */
    .glance-loading {
      display: flex; flex-direction: column; justify-content: center;
      padding: 52px;
      z-index: 3;
      opacity: 1;
      transition: opacity 0.3s ease;
    }
    .glance-loading.hidden { opacity: 0; pointer-events: none; }



    /* ── Shimmer skeleton ─────────────────────────────────────────────────── */
    @keyframes shimmer {
      0%   { background-position: -200% 0; }
      100% { background-position:  200% 0; }
    }
    .shimmer {
      background: linear-gradient(90deg, #1c1c22 25%, #2f2f3a 37%, #1c1c22 63%);
      background-size: 200% 100%;
      animation: shimmer 1.0s infinite linear;
      border-radius: 4px;
    }
    .sk-domain { width: 110px; height: 12px; flex-shrink: 0; }
    .sk-t1     { width: 88%; height: 26px; margin-bottom: 10px; }
    .sk-t2     { width: 62%; height: 26px; margin-bottom: 28px; }
    .sk-d1     { width: 100%; height: 13px; margin-bottom: 8px; }
    .sk-d2     { width: 92%;  height: 13px; margin-bottom: 8px; }
    .sk-d3     { width: 78%;  height: 13px; margin-bottom: 8px; }
    .sk-d4     { width: 50%;  height: 13px; }
    .sk-col    { display: flex; flex-direction: column; }
    /* ── Header: favicon + domain ─────────────────────────────────────────── */
    .glance-header { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }

    /* ── Frustration Toast ────────────────────────────────────────────────── */
    .glance-toast {
      position: fixed; top: 16px; right: 16px; transform: translateX(20px);
      background: #09090b; border: 1px solid #27272a; border-radius: 6px;
      padding: 12px 16px; display: flex; align-items: center; gap: 12px;
      color: #fafafa; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
      font-size: 13px; font-weight: 500;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      z-index: 2147483647; opacity: 0; pointer-events: none;
      transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .glance-toast.visible { opacity: 1; transform: translateX(0); pointer-events: auto; }
    .glance-toast-btn {
      background: #ccff00; color: #09090b; border: none; border-radius: 4px;
      padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer;
      transition: background 0.2s;
    }
    .glance-toast-btn:hover { background: #b3e600; }
    .glance-toast-dismiss {
      background: transparent; color: #a1a1aa; border: none; cursor: pointer;
      font-size: 12px; padding: 6px;
    }
    .glance-toast-dismiss:hover { color: #fafafa; }
  `;

  // ── State ──────────────────────────────────────────────────────────────────
  let hoverTimer = null;
  let activeAnchor = null;
  let currentPreviewUrl = null;
  let glanceHostElement = null;

  // Frustration tracking state
  let previewStartTime = 0;
  let frustrationCount = 0;
  let lastFrustrationUrl = null;
  let hasPromptedFrustration = false;

  // ── Settings ───────────────────────────────────────────────────────────────
  function loadSettings() {
    chrome.storage.local.get({ enabled: true, blacklist: [] }, (items) => {
      settings = items;
      if (!settings.enabled || isHostPageExcluded(window.location.href)) hidePreview();
    });
  }
  loadSettings();

  chrome.storage.onChanged.addListener((changes) => {
    for (let key in changes) settings[key] = changes[key].newValue;
    if (!settings.enabled || isHostPageExcluded(window.location.href)) hidePreview();
  });

  function isHostPageExcluded(urlStr) {
    if (isDomainExcluded(urlStr)) return true;
    try {
      const url = new URL(urlStr);
      // Disable extension entirely when the user is ON these social media sites
      const socialDomains = [
        'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 
        'linkedin.com', 'reddit.com', 'tiktok.com', 'discord.com',
        'whatsapp.com', 'youtube.com', 'messenger.com'
      ];
      if (socialDomains.some(d => url.hostname === d || url.hostname.endsWith('.' + d))) {
        return true;
      }

      // Check for sensitive/annoying page types on the current host page
      const excludedPattern = /\b(login|log-in|signin|sign-in|signup|sign-up|register|registration|join|auth|authenticate|authentication|oauth|sso|forgot-password|forgot_password|reset-password|password-reset|recover|checkout|billing|payment|bank|wallet|security|2fa|mfa|settings|account|preferences|admin|wp-admin|dashboard|cpanel|captcha|challenge)\b/i;
      if (excludedPattern.test(url.pathname) || excludedPattern.test(url.hostname)) {
        return true;
      }
    } catch(e) {}
    return false;
  }

  function isDomainExcluded(urlStr) {
    try {
      const url = new URL(urlStr);
      
      // Hardcoded exclusion for Google Images
      if (url.hostname.includes('google.') && url.pathname === '/search') {
        if (url.searchParams.get('tbm') === 'isch' || url.searchParams.get('udm') === '2') {
          return true;
        }
      }
      if (url.hostname.startsWith('images.google.')) return true;

      return settings.blacklist.some(domain => {
        const esc = domain.replace(/\./g, '\\.');
        return new RegExp(`(^|\\.)${esc}$`, 'i').test(url.hostname);
      });
    } catch (e) { return false; }
  }

  function isValidLink(anchor) {
    if (!anchor || !anchor.href) return false;
    try {
      const url = new URL(anchor.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      const curr = new URL(window.location.href);
      if (url.origin === curr.origin && url.pathname === curr.pathname && url.search === curr.search) return false;
      if (isDomainExcluded(anchor.href)) return false;

      // Ignore links without any text or media
      const textContent = anchor.textContent.trim();
      const hasMedia = anchor.querySelector('img, picture, video, svg');
      if (!textContent && !hasMedia) return false;

      // Check for sensitive/annoying page types in the target URL
      const excludedPattern = /\b(login|log-in|signin|sign-in|signup|sign-up|register|registration|join|auth|authenticate|authentication|oauth|sso|forgot-password|forgot_password|reset-password|password-reset|recover|checkout|billing|payment|bank|wallet|security|2fa|mfa|settings|account|preferences|admin|wp-admin|dashboard|cpanel|captcha|challenge)\b/i;
      if (excludedPattern.test(url.pathname) || excludedPattern.test(url.hostname)) {
        return false;
      }

      // --- 1. Block internal search engine links (Tabs, AI Mode, Pagination, etc.) ---
      // If we are on a search engine, we shouldn't preview internal links to other search pages.
      // This specifically prevents "AI Mode", "Images", and pagination links from popping up a preview.
      const searchEngines = ['google.', 'bing.com', 'duckduckgo.com', 'yahoo.com'];
      const isCurrSearch = searchEngines.some(se => curr.hostname.includes(se)) && (curr.pathname.startsWith('/search') || curr.pathname === '/');
      const isTargetSearch = searchEngines.some(se => url.hostname.includes(se)) && (url.pathname.startsWith('/search') || url.pathname === '/');
      
      if (isCurrSearch && isTargetSearch) {
        return false;
      }

      // --- 2. Block UI Tabs & Navigation ---
      // Explicitly block links inside common navigational areas and UI tab elements
      const navSelectors = 'nav, header, footer, [role="tablist"], [role="tab"], [role="navigation"], [role="menu"]';
      if (anchor.closest(navSelectors)) return false;

      // --- 3. Search Engine Bypass ---
      // ONLY bypass for actual search result pages, NOT tools like Search Console
      const searchEngineRegex = /^(www\.)?(google\.[a-z]+|bing\.com|duckduckgo\.com|yahoo\.com)$/i;
      const isSearchPage = searchEngineRegex.test(curr.hostname) && (curr.pathname.startsWith('/search') || curr.pathname === '/');
      
      if (isSearchPage) {
        const rect = anchor.getBoundingClientRect();
        if (rect.width > 800 || rect.height > 500) return false;
        return true;
      }



      // --- 3. Block "Pure" Image Links ---
      // If a link contains an image but has very little text, it's likely a standalone thumbnail or ad, not a rich article card.
      if (anchor.querySelector('img, picture, video') && textContent.length < 15) {
        return false;
      }

      // --- 4. Fallback Size Check ---
      // Prevent massive full-page overlay links (but allow article cards which are typically ~100-300px tall)
      const rect = anchor.getBoundingClientRect();
      if (rect.width > 800 || rect.height > 400) return false;

      // --- 5. The "Short UI Element" Check (Fixes custom nav bars & tabs) ---
      // UI tabs (like Search Console) and nav menus often use complex nested divs instead of standard tags.
      // However, physically, they are padded buttons. Inline text links are typically 16-24px tall.
      // Material Design tabs (like Google uses) are always 36px or taller.
      if (textContent.length < 35) {
        const rect = anchor.getBoundingClientRect();
        
        // If a short link is taller than 32px, it has padding and is acting as a button or tab.
        if (rect.height >= 32) {
            return false;
        }

        // Also catch explicitly block-styled short links
        const computed = window.getComputedStyle(anchor);
        const isBlockLevel = ['block', 'flex', 'grid', 'inline-flex'].includes(computed.display);
        if (isBlockLevel) {
            return false;
        }
      }

      return true;
    } catch (e) { return false; }
  }

  // ── Build Shadow DOM panel ─────────────────────────────────────────────────
  function initPanelElement() {
    if (glanceHostElement) return;

    glanceHostElement = document.createElement('div');
    glanceHostElement.id = 'glance-host';

    const shadow = glanceHostElement.attachShadow({ mode: 'open' });

    // Inline styles — no chrome-extension:// URL needed
    const style = document.createElement('style');
    style.textContent = GLANCE_CSS;
    shadow.appendChild(style);

    const backdrop = document.createElement('div');
    backdrop.className = 'glance-backdrop';
    backdrop.id = 'g-backdrop';
    shadow.appendChild(backdrop);

    const panel = document.createElement('div');
    panel.className = 'glance-panel';
    panel.innerHTML = `
      <!-- ① Iframe layer (frameable sites) -->
      <div class="glance-iframe-wrap" id="g-iframe-wrap">
        <iframe class="glance-iframe" id="g-iframe" name="glance-preview"
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerpolicy="no-referrer">
        </iframe>
        <div class="glance-iframe-bar">
          <img id="g-bar-fav" src="" alt="" />
          <span class="glance-iframe-bar-domain" id="g-bar-domain"></span>
        </div>
      </div>

      <!-- ③ Loading overlay (always visible first, fades out) -->
      <div class="glance-loading glass" id="g-loading">
        <div class="glance-header">
          <div class="sk-domain shimmer"></div>
        </div>
        <div class="sk-col">
          <div class="sk-t1 shimmer"></div>
          <div class="sk-t2 shimmer"></div>
        </div>
        <div class="sk-col">
          <div class="sk-d1 shimmer"></div>
          <div class="sk-d2 shimmer"></div>
          <div class="sk-d3 shimmer"></div>
          <div class="sk-d4 shimmer"></div>
        </div>
      </div>
    `;

    shadow.appendChild(panel);

    // ⑤ Frustration Toast (Independent of the panel)
    const toast = document.createElement('div');
    toast.className = 'glance-toast';
    toast.id = 'g-toast';
    toast.innerHTML = `
      <span>Glance closing too fast here?</span>
      <button class="glance-toast-btn" id="g-toast-disable">Disable on this site</button>
      <button class="glance-toast-dismiss" id="g-toast-dismiss">Dismiss</button>
    `;
    shadow.appendChild(toast);

    document.body.appendChild(glanceHostElement);
  }

  function $ (id) { return glanceHostElement && glanceHostElement.shadowRoot.getElementById(id); }
  function getPanel() { return glanceHostElement && glanceHostElement.shadowRoot.querySelector('.glance-panel'); }

  // ── Show Loading State ─────────────────────────────────────────────────────
  function showLoadingState(url) {
    initPanelElement();

    // Reset all layers
    $('g-iframe-wrap').classList.remove('visible');
    $('g-iframe').src = 'about:blank';
    $('g-loading').classList.remove('hidden');

    // Position panel dynamically based on anchor
    const panel = getPanel();
    if (activeAnchor) {
      const rect = activeAnchor.getBoundingClientRect();
      const anchorCenterX = rect.left + rect.width / 2;
      if (anchorCenterX > window.innerWidth / 2) {
        panel.classList.remove('right');
        panel.classList.add('left');
      } else {
        panel.classList.remove('left');
        panel.classList.add('right');
      }
    }

    // Pre-fill bar domain immediately
    try {
      const domain = new URL(url).hostname;
      $('g-bar-domain').textContent = domain;
      $('g-bar-fav').src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
    } catch(e) {}

    $('g-backdrop').classList.add('visible');
    getPanel().classList.add('visible');
  }

  // ── Show iframe (frameable sites) ──────────────────────────────────────────
  function showIframe(url, domain) {
    const iframe = $('g-iframe');
    const wrap   = $('g-iframe-wrap');
    const loading = $('g-loading');

    // Fade loading out when iframe fires onload
    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      wrap.classList.add('visible');
      loading.classList.add('hidden');
    };

    iframe.onload = reveal;

    // Safety timeout — reveal after 50ms even if onload hasn't fired
    // This allows users to see the page progressively loading instantly
    setTimeout(reveal, 50);

    iframe.src = url;
  }



  // ── Hide Preview ───────────────────────────────────────────────────────────
  function hidePreview() {
    // Frustration Tracking Logic
    if (currentPreviewUrl && !hasPromptedFrustration) {
      const duration = Date.now() - previewStartTime;
      
      // If closed under 600ms
      if (duration < 600) {
        if (lastFrustrationUrl === currentPreviewUrl) {
          frustrationCount++;
        } else {
          lastFrustrationUrl = currentPreviewUrl;
          frustrationCount = 1;
        }

        // 3 consecutive rapid closures on the SAME link
        if (frustrationCount >= 3) {
          hasPromptedFrustration = true;
          showFrustrationToast();
        }
      } 
      // If open successfully for a while, reset count
      else if (duration > 1500) {
        frustrationCount = 0;
        lastFrustrationUrl = null;
      }
    }

    const panel = getPanel();
    if (panel) panel.classList.remove('visible');
    if ($('g-backdrop')) $('g-backdrop').classList.remove('visible');
    currentPreviewUrl = null;
    if (glanceHostElement) {
      const iframe = glanceHostElement.shadowRoot.getElementById('g-iframe');
      if (iframe) iframe.src = 'about:blank';
    }
  }

  // ── Frustration Toast ──────────────────────────────────────────────────────
  function showFrustrationToast() {
    const toast = $('g-toast');
    if (!toast) return;
    toast.classList.add('visible');

    const disableBtn = $('g-toast-disable');
    const dismissBtn = $('g-toast-dismiss');

    disableBtn.onclick = () => {
      const hostname = window.location.hostname;
      settings.blacklist.push(hostname);
      chrome.storage.local.set({ blacklist: settings.blacklist }, () => {
        toast.classList.remove('visible');
        hidePreview();
      });
    };

    dismissBtn.onclick = () => {
      toast.classList.remove('visible');
    };
  }

  // ── URL Rewriting for Media ────────────────────────────────────────────────
  function rewriteUrlForIframe(urlStr) {
    try {
      let url = new URL(urlStr);

      // Handle Google Search Redirect URLs
      if (url.hostname.includes('google.') && url.pathname === '/url') {
        const actualUrl = url.searchParams.get('url') || url.searchParams.get('q');
        if (actualUrl) {
          url = new URL(actualUrl);
          urlStr = actualUrl;
        }
      }

      // YouTube
      if (url.hostname.includes('youtube.com') || url.hostname === 'youtu.be') {
        let videoId = null;
        if (url.hostname === 'youtu.be') {
          videoId = url.pathname.slice(1);
        } else if (url.pathname === '/watch') {
          videoId = url.searchParams.get('v');
        } else if (url.pathname.startsWith('/shorts/')) {
          videoId = url.pathname.split('/')[2];
        } else if (url.pathname.startsWith('/embed/')) {
          return urlStr;
        }
        
        if (videoId) {
          videoId = videoId.split('?')[0];
          return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=0`;
        }
      }
      return urlStr;
    } catch (e) {
      return urlStr;
    }
  }

  // ── Trigger fetch + display ────────────────────────────────────────────────
  function triggerPreview(url) {
    if (currentPreviewUrl === url) return;
    currentPreviewUrl = url;
    previewStartTime = Date.now();
    showLoadingState(url);

    let domain = url;
    try { domain = new URL(url).hostname; } catch(e) {}
    
    // With DNR rules in background.js stripping X-Frame-Options and CSP,
    // all sites are frameable. No need to fetch metadata anymore.
    const iframeUrl = rewriteUrlForIframe(url);
    showIframe(iframeUrl, domain);
  }

  // ── Event Handlers ─────────────────────────────────────────────────────────
  function isSafeZone(e, element) {
    // 1. Check if hovering the panel directly
    if (element) {
      if (element === glanceHostElement || (glanceHostElement && glanceHostElement.contains(element))) return true;
    }
    
    // 2. Check panel bounds (with buffer for CSS transform animations)
    const panel = getPanel();
    if (panel && panel.classList.contains('visible')) {
      const rect = panel.getBoundingClientRect();
      if (e.clientX >= rect.left - 32 && e.clientX <= rect.right + 32 &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        return true;
      }
    }

    // 3. Check active anchor and safe triangle
    if (activeAnchor) {
      const anchorRect = activeAnchor.getBoundingClientRect();
      const pt = { x: e.clientX, y: e.clientY };
      
      // Buffer around anchor
      if (pt.x >= anchorRect.left - 15 && pt.x <= anchorRect.right + 15 &&
          pt.y >= anchorRect.top - 15 && pt.y <= anchorRect.bottom + 15) {
        return true;
      }

      // Safe triangle from anchor to expected panel position
      const anchorCenterX = anchorRect.left + anchorRect.width / 2;
      const isPanelLeft = anchorCenterX > window.innerWidth / 2;
      
      const v1 = isPanelLeft
        ? { x: anchorRect.left, y: anchorRect.top + anchorRect.height / 2 }
        : { x: anchorRect.right, y: anchorRect.top + anchorRect.height / 2 };
      const v2 = { x: window.innerWidth / 2, y: 0 };
      const v3 = { x: window.innerWidth / 2, y: window.innerHeight };
      
      const sign = (p1, p2, p3) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
      const d1 = sign(pt, v1, v2);
      const d2 = sign(pt, v2, v3);
      const d3 = sign(pt, v3, v1);
      const has_neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
      const has_pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
      
      if (!(has_neg && has_pos)) return true;
    }
    
    return false;
  }

  let preconnectedDomain = null;
  function preconnectTo(url) {
    try {
      const origin = new URL(url).origin;
      if (preconnectedDomain === origin) return;
      preconnectedDomain = origin;
      
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = origin;
      document.head.appendChild(link);
      
      const dns = document.createElement('link');
      dns.rel = 'dns-prefetch';
      dns.href = origin;
      document.head.appendChild(dns);
    } catch(e) {}
  }

  function handleMouseOver(e) {
    if (!settings.enabled || isHostPageExcluded(window.location.href)) return;
    
    const anchor = e.target.closest('a');
    const inSafe = isSafeZone(e, e.target);

    // If we move outside the safe zone while preview is active, close immediately
    if (activeAnchor && !inSafe) {
      clearTimeout(hoverTimer);
      activeAnchor = null;
      hidePreview();
    }

    if (!isValidLink(anchor)) return;
    
    // If hovering a new valid link
    if (activeAnchor && activeAnchor !== anchor) { 
      clearTimeout(hoverTimer); 
      hidePreview(); 
    }
    
    activeAnchor = anchor;
    preconnectTo(anchor.href); // Start DNS/TCP/TLS handshake instantly

    hoverTimer = setTimeout(() => {
      if (activeAnchor === anchor) triggerPreview(anchor.href);
    }, 50);
  }

  function handleMouseOut(e) {
    if (!activeAnchor) return;
    
    // If the mouse is still in the safe zone (e.g. entering the iframe or panel), don't hide
    if (isSafeZone(e, e.relatedTarget)) {
      return;
    }

    // Left the safe zone -> close immediately
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

  function handleClick()              { clearTimeout(hoverTimer); activeAnchor = null; hidePreview(); }
  function handleKeyDown(e)           { if (e.key === 'Escape') { clearTimeout(hoverTimer); activeAnchor = null; hidePreview(); } }

  // ── Register listeners ─────────────────────────────────────────────────────
  document.addEventListener('mouseover', handleMouseOver, { passive: true });
  document.addEventListener('mouseout',  handleMouseOut,  { passive: true });
  window.addEventListener('scroll',      handleScroll,    { passive: true });
  document.addEventListener('click',     handleClick,     { passive: true });
  document.addEventListener('keydown',   handleKeyDown,   { passive: true });

})();
