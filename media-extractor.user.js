// ==UserScript==
// @name         [Reddit] Media Extractor
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      4.11
// @description  Adds floating open and download buttons to Reddit images and videos.
// @author       Xiv
// @match        *://*.reddit.com/*
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      *
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
            CONTAINER: 'tm-btn-container',
            BTN: 'tm-action-btn',
            ICON_WRAPPER: 'tm-btn-icon'
        },
        VALID_IMG_HOSTS: ['redd.it', 'v.redd.it', 'redditmedia.com', 'imgur.com', 'ibb.co', 'prnt.sc', 'postimg.cc', 'imgchest.com', 'lensdump.com', 'giphy.com', 'tenor.com']
    };

    const ICONS = {
        OPEN: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>',
        DOWNLOAD: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
        PLAY: '<polygon points="5 3 19 12 5 21 5 3"></polygon>',
        SPINNER: '<line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>'
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
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.style.cssText = 'width:17px;height:17px;display:block;';
        if (isSpinner) svg.classList.add('tm-spin');

        svg.innerHTML = pathData;
        return svg;
    }

    function getCleanImgUrl(imgEl) {
        const src = imgEl.src;
        if (!src) return null;
        if (src.includes('preview.redd.it')) {
            return src.split('?')[0].replace('preview.redd.it', 'i.redd.it');
        }

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
            const mediaJsonStr = player.getAttribute('packaged-media-json');
            if (mediaJsonStr) {
                try {
                    const mediaObj = JSON.parse(mediaJsonStr);
                    if (mediaObj.playbackMp4s && mediaObj.playbackMp4s.length > 0) {
                        const best = mediaObj.playbackMp4s.sort((a,b) => (b.height || 0) - (a.height || 0))[0];
                        if (best && best.url) return best.url;
                    }
                } catch(e) {
                    log('Failed to parse packaged-media-json', e);
                }
            }

            let vUrl = player.getAttribute('src') || player.getAttribute('packaged-video') ||
                       player.getAttribute('dashUrl') || player.getAttribute('hlsUrl') || '';
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
    function getIconWrapper(btnElement) {
        return btnElement.querySelector(`.${CONFIG.CLASSES.ICON_WRAPPER}`) || btnElement;
    }

    function restoreBtn(btnElement, iconPathData) {
        const wrapper = getIconWrapper(btnElement);
        wrapper.replaceChildren(createIcon(iconPathData));
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

        const wrapper = getIconWrapper(btnElement);
        wrapper.replaceChildren(createIcon(ICONS.SPINNER, true));
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
                            wrapper.replaceChildren(span);
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
        /* ── Container ──────────────────────────────── */
        .tm-btn-container {
            position: absolute !important;
            top: 10px !important;
            right: 10px !important;
            display: flex !important;
            gap: 8px;
            z-index: 2147483647 !important;
            pointer-events: none;

            /* Bug fix: Transition visibility to allow child elements to handle their own opacity fade */
            visibility: hidden;
            transition: visibility 0s linear 0.3s;
        }

        /* Subtle radial shadow behind the container */
        .tm-btn-container::before {
            content: '';
            position: absolute;
            top: -20px; right: -25px; bottom: -20px; left: -25px;
            z-index: -1;
            background: radial-gradient(ellipse at center, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0) 65%);
            pointer-events: none;
            border-radius: 50%;
            opacity: 0;
            transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        ul > li .tm-btn-container,
        [data-testid="carousel"] .tm-btn-container,
        .gallery-viewport .tm-btn-container {
            right: 45px !important;
        }

        .xiv-wrap:hover > .tm-btn-container,
        .tm-btn-container:hover {
            visibility: visible;
            pointer-events: auto !important;
            transition: visibility 0s;
        }

        .xiv-wrap:hover > .tm-btn-container::before,
        .tm-btn-container:hover::before {
            opacity: 1;
        }

        /* ── Button shell ────────────────────────────── */
        .tm-action-btn {
            position: relative;
            width: 35px;
            height: 35px;
            border-radius: 50%;
            border: none;
            outline: none;
            overflow: hidden;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            color: rgba(255, 255, 255, 0.96);

            /* Hardware acceleration & direct opacity transition to prevent Chromium backdrop-filter snapping */
            opacity: 0;
            will-change: transform, opacity;
            transform: translateZ(0);

            /* Frosted glass base */
            background: rgba(255, 255, 255, 0.14);
            backdrop-filter: blur(24px) saturate(180%) brightness(1.1);
            -webkit-backdrop-filter: blur(24px) saturate(180%) brightness(1.1);

            /* Layered inset highlights + drop shadow */
            box-shadow:
                inset 0  1.5px 0   rgba(255,255,255,0.75),
                inset 0 -1.5px 0   rgba(255,255,255,0.06),
                inset  1px 0   0   rgba(255,255,255,0.30),
                inset -1px 0   0   rgba(255,255,255,0.10),
                0 0 0 0.5px        rgba(255,255,255,0.20),
                0 6px 20px         rgba(0,0,0,0.32),
                0 2px  6px         rgba(0,0,0,0.20);

            transition:
                opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                box-shadow 0.35s ease,
                background 0.35s ease;
        }

        .xiv-wrap:hover .tm-action-btn,
        .tm-btn-container:hover .tm-action-btn {
            opacity: 1;
        }

        /* ── Gradient border ring (mask-composite trick) ── */
        .tm-action-btn::before {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 50%;
            padding: 1px;
            background: linear-gradient(
                155deg,
                rgba(255,255,255,0.72) 0%,
                rgba(255,255,255,0.35) 25%,
                rgba(255,255,255,0.08) 55%,
                rgba(255,255,255,0.22) 100%
            );
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask-composite: exclude;
            pointer-events: none;
            z-index: 5;
            transition: background 0.35s ease;
        }

        /* ── Top glare / specular highlight ── */
        .tm-action-btn::after {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 58%;
            background: radial-gradient(
                ellipse 75% 70% at 50% -8%,
                rgba(255,255,255,0.58)  0%,
                rgba(255,255,255,0.20) 40%,
                rgba(255,255,255,0.05) 70%,
                transparent            90%
            );
            border-radius: 50% 50% 0 0;
            pointer-events: none;
            z-index: 5;
            transition: background 0.35s ease;
        }

        /* ── Hover state ── */
        .tm-action-btn:hover {
            background: rgba(255, 255, 255, 0.22);
            backdrop-filter: blur(32px) saturate(210%) brightness(1.18);
            -webkit-backdrop-filter: blur(32px) saturate(210%) brightness(1.18);
            box-shadow:
                inset 0  1.5px 0   rgba(255,255,255,0.85),
                inset 0 -1.5px 0   rgba(255,255,255,0.08),
                inset  1px 0   0   rgba(255,255,255,0.40),
                inset -1px 0   0   rgba(255,255,255,0.14),
                0 0 0 0.5px        rgba(255,255,255,0.28),
                0 10px 30px        rgba(0,0,0,0.38),
                0 3px 10px         rgba(0,0,0,0.22),
                0 0 22px           rgba(140,180,255,0.22);
        }

        /* ── Active / pressed state ── */
        .tm-action-btn:active {
            transition:
                opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                box-shadow 0.10s ease;
            box-shadow:
                inset 0  1.5px 0  rgba(255,255,255,0.75),
                inset 0 -1.5px 0  rgba(255,255,255,0.06),
                inset  1px 0   0  rgba(255,255,255,0.30),
                inset -1px 0   0  rgba(255,255,255,0.10),
                0 0 0 0.5px       rgba(255,255,255,0.18),
                0 3px 10px        rgba(0,0,0,0.25);
        }

        /* ── Icon wrapper ── */
        .tm-btn-icon {
            position: relative;
            z-index: 6;
            display: flex;
            align-items: center;
            justify-content: center;
            color: rgba(255, 255, 255, 0.96);
            filter: drop-shadow(0 0 4px rgba(0,0,0,0.65)) drop-shadow(0 1px 3px rgba(0,0,0,0.50));
            transition: filter 0.35s ease;
            pointer-events: none;
        }

        /* Icon hover glow */
        .tm-action-btn:hover .tm-btn-icon {
            filter: drop-shadow(0 0 7px rgba(180,210,255,0.70)) drop-shadow(0 2px 4px rgba(0,0,0,0.55));
        }

        /* INNER GLASS LAYERS */
        .tm-glass-lens {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: radial-gradient(circle at 72% 56%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 45%, rgba(180,200,255,0.04) 80%, rgba(0,0,0,0) 100%);
            pointer-events: none;
            z-index: 1;
        }
        .tm-glass-scatter {
            position: absolute;
            inset: 2px;
            border-radius: 50%;
            background: radial-gradient(ellipse 60% 50% at 38% 40%, rgba(255,255,255,0.09) 0%, transparent 65%);
            pointer-events: none;
            z-index: 2;
        }
        .tm-glass-chroma {
            position: absolute;
            inset: 0;
            border-radius: 50%;
            background: radial-gradient(ellipse 100% 100% at 50% 50%, transparent 62%, rgba(80,200,255,0.09) 74%, rgba(255,80,100,0.07) 84%, transparent 92%);
            pointer-events: none;
            z-index: 3;
        }
        .tm-glass-rim {
            position: absolute;
            bottom: 0; left: 10%; right: 10%;
            height: 40%;
            background: radial-gradient(ellipse 80% 100% at 50% 115%, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.08) 45%, transparent 70%);
            border-radius: 0 0 50% 50%;
            pointer-events: none;
            z-index: 4;
        }

        /* Ripple on click */
        .tm-glass-ripple {
            position: absolute;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.28);
            transform: scale(0);
            animation: tm-ripple 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
            pointer-events: none;
            z-index: 7;
        }
        @keyframes tm-ripple {
            to { transform: scale(2.8); opacity: 0; }
        }

        /* Spinner */
        .tm-spin {
            animation: tm-spin-anim 0.9s linear infinite;
            transform-origin: center;
        }
        @keyframes tm-spin-anim {
            100% { transform: rotate(360deg); }
        }

        .xiv-progress-text {
            font-size: 11px;
            font-weight: 700;
            font-family: system-ui, -apple-system, sans-serif;
            letter-spacing: -0.5px;
        }

        /* Toasts */
        #xiv-toast-container {
            position: fixed;
            bottom: 24px; left: 50%; transform: translateX(-50%);
            z-index: 2147483647 !important;
            display: flex; flex-direction: column;
            gap: 8px; pointer-events: none;
        }
        .xiv-toast {
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            color: #ffffff; padding: 12px 24px; border-radius: 30px; font-size: 14px;
            font-family: system-ui, -apple-system, sans-serif;
            border: 1px solid rgba(255, 255, 255, 0.15);
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

        // Inner Glass Layers strictly implementing requested structure
        const lens = document.createElement('div');
        lens.className = 'tm-glass-lens';
        const scatter = document.createElement('div');
        scatter.className = 'tm-glass-scatter';
        const chroma = document.createElement('div');
        chroma.className = 'tm-glass-chroma';
        const rim = document.createElement('div');
        rim.className = 'tm-glass-rim';

        const iconWrapper = document.createElement('span');
        iconWrapper.className = CONFIG.CLASSES.ICON_WRAPPER;
        iconWrapper.appendChild(createIcon(iconPath));

        btn.append(lens, scatter, chroma, rim, iconWrapper);
        const stopPropagation = (e) => { e.stopPropagation(); e.preventDefault(); };

        // Strict implementation of requested ripple JS
        btn.addEventListener('pointerdown', function(e) {
            const r = btn.getBoundingClientRect();
            const size = Math.max(r.width, r.height);
            const rpl = document.createElement('div');
            rpl.className = 'tm-glass-ripple';
            rpl.style.cssText = `
                width: ${size}px;
                height: ${size}px;
                left: ${e.clientX - r.left - size / 2}px;
                top: ${e.clientY - r.top - size / 2}px;
            `;
            btn.appendChild(rpl);
            rpl.addEventListener('animationend', () => rpl.remove());
        });

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
        if (!parent) return;
        const currentSrc = element.src || url;

        // Skip if exactly the same source is already processed in this container
        if (element.dataset.xivProcessedSrc === currentSrc) {
            if (parent.querySelector(`.${CONFIG.CLASSES.CONTAINER}`)) return;
        }

        // Dynamic clean-up for recycled DOM nodes (like in Reddit galleries)
        const existingContainer = parent.querySelector(`.${CONFIG.CLASSES.CONTAINER}`);
        if (existingContainer) {
            existingContainer.remove();
        }

        element.dataset.xivProcessedSrc = currentSrc;

        parent.classList.add(CONFIG.CLASSES.WRAPPER);
        if (getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
        }

        const container = document.createElement('div');
        container.className = CONFIG.CLASSES.CONTAINER;

        const openIcon = type === 'video' ? ICONS.PLAY : ICONS.OPEN;

        const openBtn = createButton(`Open ${type}`, openIcon, () => {
            if (typeof GM_openInTab === 'function') {
                GM_openInTab(url, { active: false, insert: true });
            } else {
                window.open(url, '_blank');
            }
        });

        const dlBtn = createButton(`Download ${type}`, ICONS.DOWNLOAD, (btnEl) => {
            const ext = url.includes('.jpg') ? 'jpg' : url.includes('.png') ? 'png' : url.includes('.gif') ? 'gif' : (type === 'video' ? 'mp4' : 'jpg');
            downloadMedia(url, `reddit_${Date.now()}.${ext}`, btnEl, ICONS.DOWNLOAD);
        });

        container.appendChild(openBtn);
        container.appendChild(dlBtn);
        parent.appendChild(container);
    }

    // ==========================================================================
    // MODULE 4: LIFECYCLE & CORE LOGIC
    // ==========================================================================
    function isRedditImage(img) {
        if (img.src.includes('avatar')) return false;
        const rect = img.getBoundingClientRect();
        if (rect.width < 150 && img.naturalWidth < 150) return false;

        const isProxy = img.src.includes('external-preview.redd.it');
        const isKnownHost = CONFIG.VALID_IMG_HOSTS.some(host => img.src.includes(host));

        return isProxy || isKnownHost;
    }

    function isRedditVideo(vid) {
        if (vid.tagName === 'IFRAME') {
            const validIframes = ['redgifs.com', 'streamable.com', 'youtube.com', 'youtube-nocookie.com', 'vimeo.com', 'twitch.tv', 'imgur.com', 'tiktok.com'];
            return validIframes.some(host => vid.src.includes(host));
        }
        return true;
    }

    function scan() {
        // Images
        document.querySelectorAll(CONFIG.SELECTORS.IMG).forEach(img => {
            if (!isRedditImage(img)) return;
            const url = getCleanImgUrl(img);
            if (url) injectButtons(img, 'image', url);
        });

        // Videos
        document.querySelectorAll(CONFIG.SELECTORS.VIDEO).forEach(vid => {
            if (!isRedditVideo(vid)) return;
            const url = getVideoUrl(vid);
            if (url && !url.startsWith('blob:')) injectButtons(vid, 'video', url);
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

        const domObserver = new MutationObserver((mutations) => {
            let shouldScan = false;
            for (let i = 0; i < mutations.length; i++) {
                if (mutations[i].addedNodes.length > 0 || mutations[i].type === 'attributes') {
                    shouldScan = true;
                    break;
                }
            }
            if (shouldScan) scheduleScan();
        });

        domObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href'] });

        document.addEventListener('load', (e) => {
            if (e.target && e.target.tagName === 'IMG') {
                scheduleScan();
            }
        }, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
