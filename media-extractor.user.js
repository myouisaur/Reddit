// ==UserScript==
// @name         [Reddit] Media Extractor
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.redditstatic.com/desktop2x/img/favicon/favicon-96x96.png
// @version      3.6
// @description  Adds buttons to Reddit posts to open or download the highest resolution images and videos.
// @author       Xiv
// @match        *://*.reddit.com/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      redd.it
// @connect      redditmedia.com
// @connect      imgur.com
// @connect      redgifs.com
// @run-at       document-start
// @updateURL    https://myouisaur.github.io/Reddit/media-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/media-extractor.user.js
// ==/UserScript==

(function () {
  'use strict';

  // 1. UI STYLING
  GM_addStyle(`
    .xiv-container {
      position: absolute !important;
      top: 10px !important;
      right: 10px !important;
      display: flex !important;
      gap: 6px;
      z-index: 2147483647 !important;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .xiv-wrap:hover > .xiv-container, .xiv-container:hover {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
    .xiv-btn {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      cursor: pointer;
      display: flex !important;
      align-items: center;
      justify-content: center;
      background: rgba(15, 20, 25, 0.85);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: white;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      pointer-events: auto !important;
    }
    .xiv-btn:hover { background: rgba(255, 69, 0, 1); transform: scale(1.1); }
    .xiv-btn svg { width: 18px; height: 18px; fill: currentColor; }
  `);

  const icons = {
    open: '<svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>',
    dl: '<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
    vid: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'
  };

  // 2. CORE UTILS
  function download(url, name) {
    if (!url || url.startsWith('blob:')) return;

    // Safety check for 3rd party restriction
    if (url.includes('redgifs.com')) {
        alert("Direct download restricted by RedGifs. Opening their high-res player for you...");
        window.open(url, '_blank');
        return;
    }

    GM_xmlhttpRequest({
      method: 'GET', url: url, responseType: 'blob',
      onload: (res) => {
        const bUrl = window.URL.createObjectURL(res.response);
        const a = document.createElement('a');
        a.href = bUrl; a.download = name;
        a.click(); window.URL.revokeObjectURL(bUrl);
      }
    });
  }

  function getCleanImgUrl(url) {
    if (!url) return '';
    if (url.includes('preview.redd.it')) return url.split('?')[0].replace('preview.redd.it', 'i.redd.it');
    return url;
  }

  // 3. INJECTION
  function inject(el, type, url) {
    const parent = el.parentElement;
    if (!parent || parent.querySelector('.xiv-container')) return;

    parent.classList.add('xiv-wrap');
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

    const container = document.createElement('div');
    container.className = 'xiv-container';

    const openBtn = document.createElement('div');
    openBtn.className = 'xiv-btn';
    openBtn.innerHTML = type === 'video' ? icons.vid : icons.open;
    openBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); window.open(url, '_blank'); };

    const dlBtn = document.createElement('div');
    dlBtn.className = 'xiv-btn';
    dlBtn.innerHTML = icons.dl;
    dlBtn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      download(url, `reddit_${Date.now()}.${type === 'video' ? 'mp4' : 'jpg'}`);
    };

    container.appendChild(openBtn);
    container.appendChild(dlBtn);
    parent.appendChild(container);
  }

  // 4. SCANNER
  function scan() {
    // A. Photos (Fast check)
    document.querySelectorAll('img:not(.xiv-checked)').forEach(img => {
      const src = img.src;
      if (!src || src.includes('avatar') || img.width < 150) return;
      img.classList.add('xiv-checked'); // Prevent re-scanning
      if (src.includes('redd.it') || src.includes('redditmedia.com') || src.includes('imgur.com')) {
        inject(img, 'image', getCleanImgUrl(src));
      }
    });

    // B. Videos (Shadow DOM & Fast Tracking)
    const players = document.querySelectorAll('shreddit-player, video, iframe[src*="redgifs"]');

    players.forEach(p => {
      let vUrl = '';

      if (p.tagName === 'SHREDDIT-PLAYER') {
        vUrl = p.getAttribute('src') || p.getAttribute('packaged-video');
        if (vUrl && vUrl.includes('.m3u8')) {
           vUrl = vUrl.split('HLSPlaylist.m3u8')[0] + 'DASH_720.mp4?source=fallback';
        }
      } else if (p.tagName === 'VIDEO') {
        vUrl = p.src || p.querySelector('source')?.src;
      } else if (p.tagName === 'IFRAME' && p.src.includes('redgifs')) {
        // Fix RedGifs: Open the watch page instead of the iframe embed
        vUrl = p.src.replace('ifr/', 'watch/').split('?')[0];
      }

      if (vUrl && !vUrl.startsWith('blob:')) {
        inject(p, 'video', vUrl);
      }
    });
  }

  // 5. OBSERVER (Higher frequency for videos)
  let timer;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, 200); // Reduced from 400ms to 200ms for speed
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
      scan();
    });
  } else {
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
  }
})();
