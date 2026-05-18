// ==UserScript==
// @name         [Reddit] Media Extractor
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.redditstatic.com/desktop2x/img/favicon/favicon-96x96.png
// @version      4.2
// @description  Adds floating open and download buttons to Reddit images and videos.
// @author       Xiv
// @match        *://*.reddit.com/*
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      redd.it
// @connect      v.redd.it
// @connect      redditmedia.com
// @connect      redgifs.com
// @connect      imgur.com
// @connect      streamable.com
// @connect      youtube.com
// @connect      vimeo.com
// @connect      twitch.tv
// @connect      ibb.co
// @connect      giphy.com
// @connect      tenor.com
// @noframes
// @updateURL    https://myouisaur.github.io/Reddit/media-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/media-extractor.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.__xivRedditExtractorRunning) return;
  window.__xivRedditExtractorRunning = true;

  // ==========================================================================
  // CONFIG & CONSTANTS
  // ==========================================================================
  const CONFIG = {
    DEBUG: false,
    THROTTLE_MS: 250,
    MIN_SIZE: 150,
    SELECTORS: {
      IMG: 'img',
      VIDEO: 'shreddit-player, video, iframe'
    },
    CLASSES: {
      WRAPPER: 'xiv-wrap',
      CONTAINER: 'xiv-container',
      BTN: 'xiv-glass-btn'
    },
    VALID_IMG_HOSTS: ['redd.it', 'v.redd.it', 'redditmedia.com', 'imgur.com', 'ibb.co', 'prnt.sc', 'postimg.cc', 'imgchest.com', 'lensdump.com', 'giphy.com', 'tenor.com']
  };

  const ICONS = {
    OPEN: 'M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
    DOWNLOAD: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
    PLAY: 'M8 5v14l11-7z',
    SPINNER: 'M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z'
  };

  // ==========================================================================
  // MODULE 1: HELPERS & ROUTING
  // ==========================================================================
  function log(...args) {
    if (CONFIG.DEBUG) console.log('[Reddit Extractor]', ...args);
  }

  function showToast(message) {
    let container = document.getElementById('xiv-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'xiv-toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'xiv-toast';
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('xiv-visible'));
    setTimeout(() => {
      toast.classList.remove('xiv-visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function createIcon(pathData, isSpinner = false) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    if (isSpinner) svg.classList.add('xiv-spin');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
    return svg;
  }

  function getCleanImgUrl(imgEl) {
    const src = imgEl.src;
    if (!src) return null;

    // 1. Native Reddit High-Res Translation
    if (src.includes('preview.redd.it')) {
      return src.split('?')[0].replace('preview.redd.it', 'i.redd.it');
    }

    // 2. External Proxy Resolution (Bulletproof Query Parameter parsing)
    if (src.includes('external-preview.redd.it')) {
      try {
        const urlObj = new URL(src);
        const trueUrl = urlObj.searchParams.get('url');
        if (trueUrl) return decodeURIComponent(trueUrl);
      } catch (e) {
        log('Failed to parse external preview URL', e);
      }
    }

    return src.split('?')[0];
  }

  function getVideoUrl(player) {
    if (player.tagName === 'IFRAME') {
      const src = player.src;
      if (src.includes('redgifs.com')) return src.replace('ifr/', 'watch/').split('?')[0];
      if (src.includes('streamable.com')) return src.replace('/e/', '/').split('?')[0];
      if (src.includes('youtube.com/embed/') || src.includes('youtube-nocookie.com/embed/')) {
        return src.replace(/youtube(-nocookie)?\.com\/embed\//, 'youtube.com/watch?v=').split('?')[0];
      }
      if (src.includes('player.vimeo.com/video/')) return src.replace('player.vimeo.com/video/', 'vimeo.com/').split('?')[0];
      if (src.includes('clips.twitch.tv/embed')) {
        const match = src.match(/clip=([^&]+)/);
        if (match) return `https://clips.twitch.tv/${match[1]}`;
      }
      if (src.includes('imgur.com') && src.includes('/embed')) return src.replace('/embed', '');
      return null;
    }

    if (player.tagName === 'SHREDDIT-PLAYER') {
      // Primary: Check JSON for highest res
      const mediaJsonStr = player.getAttribute('packaged-media-json');
      if (mediaJsonStr) {
        try {
          const mediaObj = JSON.parse(mediaJsonStr);
          if (mediaObj.playbackMp4s && mediaObj.playbackMp4s.length > 0) {
            const best = mediaObj.playbackMp4s.sort((a,b) => (b.height || 0) - (a.height || 0))[0];
            if (best && best.url) return best.url;
          }
        } catch(e) { log('Failed to parse packaged-media-json', e); }
      }

      // Secondary: Check DOM Attributes directly
      let vUrl = player.getAttribute('src') || player.getAttribute('packaged-video') || player.getAttribute('dashUrl') || player.getAttribute('hlsUrl') || '';
      if (vUrl.includes('.m3u8')) vUrl = vUrl.split('HLSPlaylist.m3u8')[0] + 'DASH_480.mp4?source=fallback';
      return vUrl;
    }

    if (player.tagName === 'VIDEO') {
      return player.src || player.querySelector('source')?.src || '';
    }
    return '';
  }

  function getRestrictedHostName(url) {
    const restricted = ['redgifs.com', 'streamable.com', 'youtube.com', 'youtu.be', 'twitch.tv', 'vimeo.com', 'tiktok.com', 'imgur.com/a/', 'imgur.com/gallery/'];
    const found = restricted.find(h => url.includes(h));
    if (!found) return null;

    if (found.includes('imgur')) return 'Imgur Gallery';
    if (found === 'youtu.be') return 'YouTube';
    const name = found.split('.')[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  // ==========================================================================
  // MODULE 2: DOWNLOAD ENGINE
  // ==========================================================================
  function restoreBtn(btnElement, iconPathData) {
    btnElement.replaceChildren(createIcon(iconPathData));
    btnElement.style.pointerEvents = '';
  }

  function fallbackDownload(url, filename, btnElement, iconPathData) {
    if (typeof GM_xmlhttpRequest === 'undefined') {
      window.open(url, '_blank');
      restoreBtn(btnElement, iconPathData);
      return;
    }

    GM_xmlhttpRequest({
      method: 'GET',
      url: url,
      responseType: 'blob',
      onload: (res) => {
        if (res.status >= 200 && res.status < 300) {
          const blobUrl = URL.createObjectURL(res.response);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        } else {
          log('Fallback XHR failed with status:', res.status);
          window.open(url, '_blank');
        }
        restoreBtn(btnElement, iconPathData);
      },
      onerror: () => {
        log('Fallback XHR network error');
        window.open(url, '_blank');
        restoreBtn(btnElement, iconPathData);
      }
    });
  }

  function downloadMedia(url, filename, btnElement, iconPathData) {
    if (!url || url.startsWith('blob:')) return;

    const restrictedName = getRestrictedHostName(url);
    if (restrictedName) {
      showToast(`Direct download restricted by ${restrictedName}. Opening player...`);
      setTimeout(() => window.open(url, '_blank'), 500);
      return;
    }

    btnElement.replaceChildren(createIcon(ICONS.SPINNER, true));
    btnElement.style.pointerEvents = 'none';

    if (typeof GM_download === 'function') {
      let lastUpdate = 0;
      GM_download({
        url: url,
        name: filename,
        onprogress: (e) => {
          if (e.lengthComputable) {
            const now = Date.now();
            if (now - lastUpdate > 150) {
              const percent = Math.floor((e.loaded / e.total) * 100);
              const span = document.createElement('span');
              span.className = 'xiv-progress-text';
              span.textContent = `${percent}%`;
              btnElement.replaceChildren(span);
              lastUpdate = now;
            }
          }
        },
        onload: () => restoreBtn(btnElement, iconPathData),
        onerror: (err) => {
          log('GM_download failed, using GM_xmlhttpRequest fallback', err);
          fallbackDownload(url, filename, btnElement, iconPathData);
        },
        ontimeout: () => fallbackDownload(url, filename, btnElement, iconPathData)
      });
    } else {
      fallbackDownload(url, filename, btnElement, iconPathData);
    }
  }

  // ==========================================================================
  // MODULE 3: UI & STYLING
  // ==========================================================================
  GM_addStyle(`
    .xiv-container {
      position: absolute !important;
      top: 10px !important;
      right: 10px !important;
      display: flex !important;
      gap: 8px;
      z-index: 2147483647 !important;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* Prevent overlap with Reddit's native image gallery arrows */
    ul > li .xiv-container,
    [data-testid="carousel"] .xiv-container,
    .gallery-viewport .xiv-container {
      right: 45px !important;
    }

    .xiv-wrap:hover > .xiv-container,
    .xiv-container:hover {
      opacity: 1 !important;
      pointer-events: auto !important;
    }

    /* Glassmorphism UI */
    .xiv-glass-btn {
      width: clamp(32px, 3.5vw, 40px);
      height: clamp(32px, 3.5vw, 40px);
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: #ffffff;
      border-radius: 50%;
      cursor: pointer;
      border: 1px solid rgba(255, 255, 255, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      user-select: none;
    }

    .xiv-glass-btn svg {
      width: 50%;
      height: 50%;
      display: block;
      fill: currentColor;
      pointer-events: none;
    }

    .xiv-glass-btn:hover {
      transform: scale(1.05);
      background: rgba(0, 0, 0, 0.8);
      border-color: rgba(255, 255, 255, 0.4);
    }

    .xiv-glass-btn:active {
      transform: scale(0.95);
    }

    .xiv-progress-text {
      font-size: 11px;
      font-weight: 700;
      font-family: system-ui, -apple-system, sans-serif;
      letter-spacing: -0.5px;
    }

    @keyframes xiv-spin { 100% { transform: rotate(360deg); } }
    .xiv-spin { animation: xiv-spin 1s linear infinite; }

    #xiv-toast-container {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      z-index: 2147483647 !important; /* Forces above all theater overlays */
      display: flex; flex-direction: column; gap: 8px; pointer-events: none;
    }

    .xiv-toast {
      background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      color: #ffffff; padding: 12px 24px; border-radius: 30px; font-size: 14px;
      font-family: system-ui, -apple-system, sans-serif; border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); opacity: 0; transform: translateY(20px);
      transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    }

    .xiv-toast.xiv-visible { opacity: 1; transform: translateY(0); }
  `);

  function createButton(title, iconPath, onClick) {
    const btn = document.createElement('div');
    btn.className = CONFIG.CLASSES.BTN;
    btn.title = title;

    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', title);
    btn.setAttribute('tabindex', '0');

    btn.appendChild(createIcon(iconPath));

    const stopPropagation = (e) => { e.stopPropagation(); e.preventDefault(); };

    btn.addEventListener('mousedown', stopPropagation);
    btn.addEventListener('mouseup', stopPropagation);
    btn.addEventListener('click', (e) => { stopPropagation(e); onClick(btn); });

    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { stopPropagation(e); onClick(btn); }
    });

    return btn;
  }

  function injectButtons(element, type, url) {
    const parent = element.parentElement;
    if (!parent || parent.querySelector(`.${CONFIG.CLASSES.CONTAINER}`)) return;

    parent.classList.add(CONFIG.CLASSES.WRAPPER);
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }

    const container = document.createElement('div');
    container.className = CONFIG.CLASSES.CONTAINER;

    const openIcon = type === 'video' ? ICONS.PLAY : ICONS.OPEN;
    const openBtn = createButton(`Open ${type}`, openIcon, () => window.open(url, '_blank'));

    const dlBtn = createButton(`Download ${type}`, ICONS.DOWNLOAD, (btnEl) => {
      const ext = url.includes('.jpg') ? 'jpg' : url.includes('.png') ? 'png' : url.includes('.gif') ? 'gif' : (type === 'video' ? 'mp4' : 'jpg');
      downloadMedia(url, `reddit_${Date.now()}.${ext}`, btnEl, ICONS.DOWNLOAD);
    });

    container.appendChild(openBtn);
    container.appendChild(dlBtn);
    parent.appendChild(container);
  }

  // ==========================================================================
  // MODULE 4: LIFECYCLE & OBSERVERS
  // ==========================================================================
  const mediaObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;

        if (el.tagName === 'IMG') {
          if (entry.boundingClientRect.width >= CONFIG.MIN_SIZE) {
            const url = getCleanImgUrl(el);
            if (url) injectButtons(el, 'image', url);
          }
        } else {
          const url = getVideoUrl(el);
          if (url && !url.startsWith('blob:')) injectButtons(el, 'video', url);
        }

        observer.unobserve(el);
      }
    });
  }, { rootMargin: '400px' });

  function scan() {
    // 1. Scan Images
    document.querySelectorAll(CONFIG.SELECTORS.IMG).forEach(img => {
      if (img.dataset.xivObserved || img.src.includes('avatar')) return;

      const isProxy = img.src.includes('external-preview.redd.it');
      const isKnownHost = CONFIG.VALID_IMG_HOSTS.some(host => img.src.includes(host));

      if (!isProxy && !isKnownHost) return;

      img.dataset.xivObserved = 'true';
      mediaObserver.observe(img);
    });

    // 2. Scan Videos & Iframes
    document.querySelectorAll(CONFIG.SELECTORS.VIDEO).forEach(vid => {
      if (vid.dataset.xivObserved) return;

      if (vid.tagName === 'IFRAME') {
        const validIframes = ['redgifs.com', 'streamable.com', 'youtube.com', 'youtube-nocookie.com', 'vimeo.com', 'twitch.tv', 'imgur.com', 'tiktok.com'];
        if (!validIframes.some(host => vid.src.includes(host))) return;
      }

      vid.dataset.xivObserved = 'true';
      mediaObserver.observe(vid);
    });
  }

  let isThrottled = false;
  function scheduleScan() {
    if (isThrottled) return;
    isThrottled = true;
    setTimeout(() => {
      requestAnimationFrame(() => { scan(); isThrottled = false; });
    }, CONFIG.THROTTLE_MS);
  }

  function init() {
    scan();

    // Highly optimized observer: Only triggers scan if elements are added to the DOM
    const domObserver = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (let i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length > 0) {
          for (let j = 0; j < mutations[i].addedNodes.length; j++) {
            if (mutations[i].addedNodes[j].nodeType === 1) { // Node.ELEMENT_NODE
              shouldScan = true;
              break;
            }
          }
        }
        if (shouldScan) break;
      }
      if (shouldScan) scheduleScan();
    });

    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
