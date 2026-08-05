// Glance Background Service Worker

// ── Setup DNR Rules to bypass framing restrictions ───────────────────────
chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [1],
  addRules: [{
    id: 1,
    priority: 1,
    action: {
      type: "modifyHeaders",
      responseHeaders: [
        { header: "x-frame-options", operation: "remove" },
        { header: "content-security-policy", operation: "remove" },
        { header: "content-security-policy-report-only", operation: "remove" }
      ]
    },
    condition: {
      resourceTypes: ["sub_frame"]
    }
  }]
}).catch(console.error);
// ─────────────────────────────────────────────────────────────────────────

// 24-hour Cache Time-To-Live
const CACHE_TTL = 24 * 60 * 60 * 1000;

// IndexedDB Helper
class GlanceDB {
  constructor() {
    this.dbName = 'GlanceCacheDB';
    this.storeName = 'previews';
    this.version = 1;
    this.db = null;
  }

  init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'url' });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.error('IndexedDB open error:', e.target.error);
        reject(e.target.error);
      };
    });
  }

  async get(url) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(url);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async set(data) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(data);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clear() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getCount() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

const db = new GlanceDB();

// Helper to resolve relative URLs
function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href;
  } catch (e) {
    return relative;
  }
}

// Robust HTML entity decoder
function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&bull;/g, '•')
    .replace(/&middot;/g, '·')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&#x([a-fA-F0-9]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Strip HTML tags and decode entities
function sanitizeText(text) {
  if (!text) return '';
  const tagStripped = text.replace(/<[^>]*>/g, '');
  const decoded = decodeHtmlEntities(tagStripped);
  return decoded.replace(/\s+/g, ' ').trim();
}

// Extract attributes from HTML tag
function getAttr(tagHtml, name) {
  const regex = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tagHtml.match(regex);
  if (!match) return null;
  return match[1] || match[2] || match[3] || '';
}

// Parse metadata from page HTML
function parseMetadata(html, url) {
  const meta = {
    title: '',
    description: '',
    image: '',
    domain: ''
  };

  try {
    meta.domain = new URL(url).hostname;
  } catch (e) {
    meta.domain = url;
  }

  // 1. Determine base URL if base tag exists
  let baseHref = url;
  const baseMatch = html.match(/<base\s+[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))/i);
  if (baseMatch) {
    const baseVal = baseMatch[1] || baseMatch[2] || baseMatch[3];
    if (baseVal) {
      baseHref = resolveUrl(url, baseVal);
    }
  }

  // 2. Extract page title from <title> tag
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = titleMatch ? titleMatch[1] : '';

  // 3. Extract meta tags
  const metaRegex = /<meta(?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^>\s]+))?)*\s*\/?>/gi;
  let match;
  let ogTitle = '';
  let twitterTitle = '';
  let ogDesc = '';
  let twitterDesc = '';
  let stdDesc = '';
  let ogImage = '';
  let twitterImage = '';

  while ((match = metaRegex.exec(html)) !== null) {
    const metaTag = match[0];
    const name = getAttr(metaTag, 'name');
    const property = getAttr(metaTag, 'property');
    const content = getAttr(metaTag, 'content');

    if (!content) continue;

    const key = (property || name || '').toLowerCase();
    if (key === 'og:title') {
      ogTitle = content;
    } else if (key === 'twitter:title') {
      twitterTitle = content;
    } else if (key === 'description') {
      stdDesc = content;
    } else if (key === 'og:description') {
      ogDesc = content;
    } else if (key === 'twitter:description') {
      twitterDesc = content;
    } else if (key === 'og:image') {
      ogImage = content;
    } else if (key === 'twitter:image') {
      twitterImage = content;
    }
  }

  meta.title = ogTitle || twitterTitle || pageTitle || '';
  meta.description = ogDesc || twitterDesc || stdDesc || '';

  const imgUrl = ogImage || twitterImage || '';
  if (imgUrl) {
    meta.image = resolveUrl(baseHref, imgUrl);
  }

  meta.title = sanitizeText(meta.title);
  meta.description = sanitizeText(meta.description);

  return meta;
}

// Main Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchPreview') {
    handleFetchPreview(request.url, sendResponse);
    return true; // Keep channel open for async response
  } else if (request.action === 'clearCache') {
    db.clear()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  } else if (request.action === 'getCacheStats') {
    db.getCount()
      .then((count) => sendResponse({ count }))
      .catch((err) => sendResponse({ count: 0, error: err.message }));
    return true;
  }
});

// Fetch preview handler with local IndexedDB check and network timeout
async function handleFetchPreview(url, sendResponse) {
  let cached = null;
  try {
    cached = await db.get(url);
  } catch (e) {
    console.error('Cache read error', e);
  }

  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age < CACHE_TTL) {
      sendResponse({ success: true, data: cached });
      return;
    }
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(url, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // ── Frameability check ─────────────────────────────────────────────────
    let frameable = true;
    const xfo = (response.headers.get('X-Frame-Options') || '').toUpperCase().trim();
    if (xfo === 'DENY' || xfo === 'SAMEORIGIN') frameable = false;

    const csp = response.headers.get('Content-Security-Policy') || '';
    if (csp.toLowerCase().includes('frame-ancestors')) {
      const faMatch = csp.match(/frame-ancestors\s+([^;]+)/i);
      if (faMatch) {
        const val = faMatch[1].trim().toLowerCase();
        // Non-frameable if only 'none' or only 'self' (no wildcard)
        if (
          val.includes("'none'") ||
          (!val.includes('*') && val.includes("'self'") && !val.includes('http'))
        ) {
          frameable = false;
        }
      }
    }
    // ──────────────────────────────────────────────────────────────────────

    const contentType = response.headers.get('Content-Type') || '';

    // Check if the response content is NOT HTML (e.g., pdf, image, zip)
    if (!contentType.includes('text/html')) {
      let typeLabel = 'Binary File';
      if (contentType.includes('application/pdf')) {
        typeLabel = 'PDF Document';
      } else if (contentType.includes('image/')) {
        typeLabel = 'Image File';
      } else if (contentType.includes('audio/')) {
        typeLabel = 'Audio File';
      } else if (contentType.includes('video/')) {
        typeLabel = 'Video File';
      }

      const domain = new URL(url).hostname;
      const data = {
        url,
        title: url.split('/').pop() || domain,
        description: `Direct link to a ${typeLabel} (${contentType.split(';')[0]}).`,
        image: contentType.includes('image/') ? url : '',
        domain,
        frameable: false, // Binary files are not frameable
        timestamp: Date.now()
      };

      await db.set(data);
      sendResponse({ success: true, data });
      return;
    }

    const html = await response.text();
    const parsed = parseMetadata(html, url);

    const data = {
      url,
      title: parsed.title || url.split('/').pop() || parsed.domain,
      description: parsed.description || 'No description available.',
      image: parsed.image,
      domain: parsed.domain,
      frameable,
      timestamp: Date.now()
    };

    await db.set(data);
    sendResponse({ success: true, data });

  } catch (error) {
    console.error('Fetch metadata error for:', url, error);

    // Fallback to expired cache if available
    if (cached) {
      console.log('Serving expired cache item due to fetch error:', url);
      sendResponse({ success: true, data: cached });
      return;
    }

    // Final fallback
    let domain = url;
    try {
      domain = new URL(url).hostname;
    } catch (e) {}

    sendResponse({
      success: true,
      data: {
        url,
        title: domain,
        description: 'Unable to load preview (website blocked request or connection timed out).',
        image: '',
        domain,
        timestamp: Date.now()
      }
    });
  }
}
