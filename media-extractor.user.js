// ==UserScript==
// @name         [Reddit] Media Extractor
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      5.0
// @description  Adds floating open and download buttons to Reddit images and videos.
// @author       Xiv
// @match        *://*.reddit.com/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      redd.it
// @connect      i.redd.it
// @connect      v.redd.it
// @connect      redditmedia.com
// @connect      imgur.com
// @connect      ibb.co
// @connect      prnt.sc
// @connect      postimg.cc
// @connect      imgchest.com
// @connect      lensdump.com
// @connect      giphy.com
// @connect      tenor.com
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
        MIN_SIZE: 150,
        TIMING: {
            THROTTLE_MS: 250,
            SUCCESS_DURATION_MS: 1000,
            MORPH_OUT_MS: 150,
            MORPH_IN_MS: 250,
            PROGRESS_UPDATE_MS: 150,
            BLOB_REVOKE_MS: 1000,
            TOAST_DURATION_MS: 3000,
            TOAST_FADE_MS: 300
        },
        SELECTORS: {
            IMG: 'img',
            VIDEO: 'shreddit-player, video, iframe'
        },
        CLASSES: {
            WRAPPER: 'xiv-wrap',
            CONTAINER: 'xiv-btn-container',
            BTN: 'xiv-action-btn',
            ICON_WRAPPER: 'xiv-btn-icon',
            ICON_INNER: 'xiv-icon-inner',
            MORPHING: 'xiv-morphing',
            GLASS_LENS: 'xiv-glass-lens',
            GLASS_SCATTER: 'xiv-glass-scatter',
            GLASS_CHROMA: 'xiv-glass-chroma',
            GLASS_RIM: 'xiv-glass-rim',
            RIPPLE: 'xiv-glass-ripple',
            PROGRESS: 'xiv-progress-text',
            TOAST_CONTAINER: 'xiv-toast-container',
            TOAST: 'xiv-toast',
            VISIBLE: 'xiv-visible'
        },
        VALID_IMG_HOSTS: ['redd.it', 'v.redd.it', 'redditmedia.com', 'imgur.com', 'ibb.co', 'prnt.sc', 'postimg.cc', 'imgchest.com', 'lensdump.com', 'giphy.com', 'tenor.com']
    };

    const { CLASSES, TIMING } = CONFIG;

    const ICONS = {
        OPEN: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>',
        DOWNLOAD: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
        PLAY: '<polygon points="5 3 19 12 5 21 5 3"></polygon>',
        CHECK: '<polyline points="20 6 9 17 4 12" stroke="#4ade80" stroke-width="3"></polyline>'
    };

    // State Map: Maps DOM elements to their currently processed URL invisibly
    const processedMedia = new WeakMap();

    // ==========================================================================
    // MODULE 1: HELPERS & ROUTING
    // ==========================================================================
    function log(...args) {
        if (CONFIG.DEBUG) console.log('[Reddit Extractor]', ...args);
    }

    function showToast(message) {
        let container = document.getElementById(CLASSES.TOAST_CONTAINER);
        if (!container) {
            container = document.createElement('div');
            container.id = CLASSES.TOAST_CONTAINER;
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = CLASSES.TOAST;
        toast.textContent = message;
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add(CLASSES.VISIBLE));
        setTimeout(() => {
            toast.classList.remove(CLASSES.VISIBLE);
            setTimeout(() => toast.remove(), TIMING.TOAST_FADE_MS);
        }, TIMING.TOAST_DURATION_MS);
    }

    function createIcon(pathData) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.style.cssText = 'width:100%;height:100%;display:block;';
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
    // MODULE 2: UI & STYLING
    // ==========================================================================
    GM_addStyle(`
        /* ── Container ──────────────────────────────── */
        .${CLASSES.CONTAINER} {
            position: absolute !important;
            top: 10px !important;
            right: 10px !important;
            display: flex !important;
            gap: 8px;
            z-index: 2147483647 !important;
            pointer-events: none;
            visibility: hidden;
            transition: visibility 0s linear 0.3s;
        }

        .${CLASSES.CONTAINER}::before {
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

        ul > li .${CLASSES.CONTAINER},
        [data-testid="carousel"] .${CLASSES.CONTAINER},
        .gallery-viewport .${CLASSES.CONTAINER} {
            right: 45px !important;
        }

        .${CLASSES.WRAPPER}:hover > .${CLASSES.CONTAINER},
        .${CLASSES.CONTAINER}:hover {
            visibility: visible;
            pointer-events: auto !important;
            transition: visibility 0s;
        }

        .${CLASSES.WRAPPER}:hover > .${CLASSES.CONTAINER}::before,
        .${CLASSES.CONTAINER}:hover::before {
            opacity: 1;
        }

        /* ── Button shell ────────────────────────────── */
        .${CLASSES.BTN} {
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
            opacity: 0;
            will-change: transform, opacity;
            transform: translateZ(0);
            background: rgba(255, 255, 255, 0.14);
            backdrop-filter: blur(24px) saturate(180%) brightness(1.1);
            -webkit-backdrop-filter: blur(24px) saturate(180%) brightness(1.1);
            box-shadow:
                inset 0  1.5px 0   rgba(255,255,255,0.75),
                inset 0 -1.5px 0   rgba(255,255,255,0.06),
                inset  1px 0   0   rgba(255,255,255,0.30),
                inset -1px 0   0   rgba(255,255,255,0.10),
                0 0 0 0.5px        rgba(255,255,255,0.20),
                0 6px 20px         rgba(0,0,0,0.32),
                0 2px  6px         rgba(0,0,0,0.20);
            transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.35s ease, background 0.35s ease;
        }

        .${CLASSES.WRAPPER}:hover .${CLASSES.BTN},
        .${CLASSES.CONTAINER}:hover .${CLASSES.BTN} {
            opacity: 1;
        }

        .${CLASSES.BTN}[data-loading="1"] {
            cursor: default !important;
        }

        .${CLASSES.WRAPPER}:hover .${CLASSES.BTN}[data-loading="1"],
        .${CLASSES.CONTAINER}:hover .${CLASSES.BTN}[data-loading="1"] {
            opacity: 0.8 !important;
        }

        /* ── Gradient border ring ── */
        .${CLASSES.BTN}::before {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 50%;
            padding: 1px;
            background: linear-gradient(155deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.35) 25%, rgba(255,255,255,0.08) 55%, rgba(255,255,255,0.22) 100%);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask-composite: exclude;
            pointer-events: none;
            z-index: 5;
            transition: background 0.35s ease;
        }

        /* ── Top glare ── */
        .${CLASSES.BTN}::after {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 58%;
            background: radial-gradient(ellipse 75% 70% at 50% -8%, rgba(255,255,255,0.58) 0%, rgba(255,255,255,0.20) 40%, rgba(255,255,255,0.05) 70%, transparent 90%);
            border-radius: 50% 50% 0 0;
            pointer-events: none;
            z-index: 5;
            transition: background 0.35s ease;
        }

        /* ── Hover & Active states ── */
        .${CLASSES.BTN}:hover {
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

        .${CLASSES.BTN}:active {
            transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.10s ease;
            box-shadow:
                inset 0  1.5px 0  rgba(255,255,255,0.75),
                inset 0 -1.5px 0  rgba(255,255,255,0.06),
                inset  1px 0   0  rgba(255,255,255,0.30),
                inset -1px 0   0  rgba(255,255,255,0.10),
                0 0 0 0.5px       rgba(255,255,255,0.18),
                0 3px 10px        rgba(0,0,0,0.25);
        }

        /* ── Icon wrapper ── */
        .${CLASSES.ICON_WRAPPER} {
            position: relative;
            z-index: 6;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 17px;
            height: 17px;
            color: rgba(255, 255, 255, 0.96);
            filter: drop-shadow(0 0 4px rgba(0,0,0,0.65)) drop-shadow(0 1px 3px rgba(0,0,0,0.50));
            transition: filter 0.35s ease;
            pointer-events: none;
        }

        .${CLASSES.BTN}:hover .${CLASSES.ICON_WRAPPER} {
            filter: drop-shadow(0 0 7px rgba(180,210,255,0.70)) drop-shadow(0 2px 4px rgba(0,0,0,0.55));
        }

        /* ── Icon Morph Transitions ── */
        .${CLASSES.ICON_INNER} {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            transition: opacity 0.15s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
            transform-origin: center;
        }

        .${CLASSES.ICON_INNER}.${CLASSES.MORPHING} {
            opacity: 0;
            transform: scale(0.25) rotate(-45deg);
        }

        /* INNER GLASS LAYERS */
        .${CLASSES.GLASS_LENS} {
            position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%;
            background: radial-gradient(circle at 72% 56%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 45%, rgba(180,200,255,0.04) 80%, rgba(0,0,0,0) 100%);
            pointer-events: none; z-index: 1;
        }
        .${CLASSES.GLASS_SCATTER} {
            position: absolute; inset: 2px; border-radius: 50%;
            background: radial-gradient(ellipse 60% 50% at 38% 40%, rgba(255,255,255,0.09) 0%, transparent 65%);
            pointer-events: none; z-index: 2;
        }
        .${CLASSES.GLASS_CHROMA} {
            position: absolute; inset: 0; border-radius: 50%;
            background: radial-gradient(ellipse 100% 100% at 50% 50%, transparent 62%, rgba(80,200,255,0.09) 74%, rgba(255,80,100,0.07) 84%, transparent 92%);
            pointer-events: none; z-index: 3;
        }
        .${CLASSES.GLASS_RIM} {
            position: absolute; bottom: 0; left: 10%; right: 10%; height: 40%; border-radius: 0 0 50% 50%;
            background: radial-gradient(ellipse 80% 100% at 50% 115%, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.08) 45%, transparent 70%);
            pointer-events: none; z-index: 4;
        }

        /* Ripple on click */
        .${CLASSES.RIPPLE} {
            position: absolute;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.28);
            transform: scale(0);
            animation: xiv-ripple 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
            pointer-events: none;
            z-index: 7;
        }
        @keyframes xiv-ripple {
            to { transform: scale(2.8); opacity: 0; }
        }

        .${CLASSES.PROGRESS} {
            font-size: 11px;
            font-weight: 700;
            font-family: system-ui, -apple-system, sans-serif;
            letter-spacing: -0.5px;
        }

        /* Toasts */
        #${CLASSES.TOAST_CONTAINER} {
            position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
            z-index: 2147483647 !important; display: flex; flex-direction: column; gap: 8px; pointer-events: none;
        }
        .${CLASSES.TOAST} {
            background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            color: #ffffff; padding: 12px 24px; border-radius: 30px; font-size: 14px; font-family: system-ui, -apple-system, sans-serif;
            border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); opacity: 0; transform: translateY(20px);
            transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        }
        .${CLASSES.TOAST}.${CLASSES.VISIBLE} { opacity: 1; transform: translateY(0); }
    `);

    function createButton(title, iconPath, onClick) {
        const btn = document.createElement('div');
        btn.className = CLASSES.BTN;
        btn.title = title;
        btn.setAttribute('role', 'button');
        btn.setAttribute('aria-label', title);
        btn.setAttribute('tabindex', '0');

        const lens = document.createElement('div');
        lens.className = CLASSES.GLASS_LENS;
        const scatter = document.createElement('div');
        scatter.className = CLASSES.GLASS_SCATTER;
        const chroma = document.createElement('div');
        chroma.className = CLASSES.GLASS_CHROMA;
        const rim = document.createElement('div');
        rim.className = CLASSES.GLASS_RIM;

        const iconWrapper = document.createElement('span');
        iconWrapper.className = CLASSES.ICON_WRAPPER;

        const innerIconEl = document.createElement('div');
        innerIconEl.className = CLASSES.ICON_INNER;
        innerIconEl.appendChild(createIcon(iconPath));
        iconWrapper.appendChild(innerIconEl);

        btn.append(lens, scatter, chroma, rim, iconWrapper);

        const stopPropagation = (e) => { e.stopPropagation(); e.preventDefault(); };

        btn.addEventListener('pointerdown', function(e) {
            if (btn.dataset.loading === "1") return;

            const r = btn.getBoundingClientRect();
            const size = Math.max(r.width, r.height);
            const rpl = document.createElement('div');
            rpl.className = CLASSES.RIPPLE;
            rpl.style.cssText = `
                width: ${size}px; height: ${size}px;
                left: ${e.clientX - r.left - size / 2}px; top: ${e.clientY - r.top - size / 2}px;
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

    // ==========================================================================
    // MODULE 3: INTERACTION & DOWNLOAD LOGIC
    // ==========================================================================
    function getIconWrapper(btnElement) {
        return btnElement.querySelector(`.${CLASSES.ICON_WRAPPER}`) || btnElement;
    }

    function swapIconSmoothly(iconWrapper, newPathData) {
        let inner = iconWrapper.querySelector(`.${CLASSES.ICON_INNER}`);

        if (!inner) {
            inner = document.createElement('div');
            inner.className = `${CLASSES.ICON_INNER} ${CLASSES.MORPHING}`;
            iconWrapper.replaceChildren(inner);
            void inner.offsetWidth;
        }

        return new Promise(resolve => {
            inner.classList.add(CLASSES.MORPHING);
            setTimeout(() => {
                inner.replaceChildren(createIcon(newPathData));
                void inner.offsetWidth;
                inner.classList.remove(CLASSES.MORPHING);
                setTimeout(resolve, TIMING.MORPH_IN_MS);
            }, TIMING.MORPH_OUT_MS);
        });
    }

    // Extracted DRY blob fetching method replacing all complex GM_download fallback loops
    function fetchAndSaveBlob(url, filename, onProgress) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest === 'undefined') {
                return reject(new Error('GM_xmlhttpRequest not available'));
            }

            let lastUpdate = 0;
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                responseType: 'blob',
                onprogress: (e) => {
                    if (e.lengthComputable && onProgress) {
                        const now = Date.now();
                        if (now - lastUpdate > TIMING.PROGRESS_UPDATE_MS) {
                            onProgress(Math.floor((e.loaded / e.total) * 100));
                            lastUpdate = now;
                        }
                    }
                },
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) {
                        const blobUrl = URL.createObjectURL(res.response);
                        const a = document.createElement('a');
                        a.href = blobUrl;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        setTimeout(() => URL.revokeObjectURL(blobUrl), TIMING.BLOB_REVOKE_MS);
                        resolve();
                    } else {
                        reject(new Error(`HTTP Error ${res.status}`));
                    }
                },
                onerror: (err) => reject(err),
                ontimeout: () => reject(new Error('Network Timeout'))
            });
        });
    }

    async function downloadMedia(url, filename, btnElement, iconPathData) {
        if (!url || url.startsWith('blob:')) return;
        if (btnElement.dataset.loading === "1") return;

        btnElement.dataset.loading = "1";

        const restrictedName = getRestrictedHostName(url);
        if (restrictedName) {
            showToast(`Direct download restricted by ${restrictedName}. Opening player...`);
            setTimeout(() => window.open(url, '_blank'), 500);
            delete btnElement.dataset.loading;
            return;
        }

        const wrapper = getIconWrapper(btnElement);

        try {
            await fetchAndSaveBlob(url, filename, (percent) => {
                const span = document.createElement('span');
                span.className = CLASSES.PROGRESS;
                span.textContent = `${percent}%`;
                wrapper.replaceChildren(span);
            });
            await swapIconSmoothly(wrapper, ICONS.CHECK);
            setTimeout(async () => {
                await swapIconSmoothly(wrapper, iconPathData);
                delete btnElement.dataset.loading;
            }, TIMING.SUCCESS_DURATION_MS);
        } catch (err) {
            log('Download failed:', err);
            window.open(url, '_blank');
            await swapIconSmoothly(wrapper, iconPathData);
            delete btnElement.dataset.loading;
        }
    }

    function injectButtons(element, type, url) {
        const parent = element.parentElement;
        if (!parent) return;
        const currentSrc = element.src || url;

        if (processedMedia.get(element) === currentSrc) {
            if (parent.querySelector(`.${CLASSES.CONTAINER}`)) return;
        }

        const existingContainer = parent.querySelector(`.${CLASSES.CONTAINER}`);
        if (existingContainer) {
            existingContainer.remove();
        }

        processedMedia.set(element, currentSrc);
        parent.classList.add(CLASSES.WRAPPER);

        if (getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
        }

        const container = document.createElement('div');
        container.className = CLASSES.CONTAINER;

        const openIcon = type === 'video' ? ICONS.PLAY : ICONS.OPEN;
        const openBtn = createButton(`Open ${type}`, openIcon, async (btnEl) => {
            if (btnEl.dataset.loading === "1") return;
            btnEl.dataset.loading = "1";

            const wrapper = getIconWrapper(btnEl);

            try {
                if (typeof GM_openInTab === 'function') {
                    GM_openInTab(url, { active: false, insert: true });
                } else {
                    window.open(url, '_blank');
                }
                await swapIconSmoothly(wrapper, ICONS.CHECK);
                setTimeout(async () => {
                    await swapIconSmoothly(wrapper, openIcon);
                    delete btnEl.dataset.loading;
                }, TIMING.SUCCESS_DURATION_MS);
            } catch (e) {
                delete btnEl.dataset.loading;
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
        if (rect.width < CONFIG.MIN_SIZE && img.naturalWidth < CONFIG.MIN_SIZE) return false;

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

    function scan(rootNode = document) {
        if (!rootNode || !rootNode.querySelectorAll) return;

        const scanElement = (el) => {
            if (el.matches && el.matches(CONFIG.SELECTORS.IMG) && isRedditImage(el)) {
                const url = getCleanImgUrl(el);
                if (url) injectButtons(el, 'image', url);
            } else if (el.matches && el.matches(CONFIG.SELECTORS.VIDEO) && isRedditVideo(el)) {
                const url = getVideoUrl(el);
                if (url && !url.startsWith('blob:')) injectButtons(el, 'video', url);
            }
        };

        // Check the root node itself
        scanElement(rootNode);

        // Check children
        rootNode.querySelectorAll(CONFIG.SELECTORS.IMG).forEach(img => {
            if (isRedditImage(img)) {
                const url = getCleanImgUrl(img);
                if (url) injectButtons(img, 'image', url);
            }
        });

        rootNode.querySelectorAll(CONFIG.SELECTORS.VIDEO).forEach(vid => {
            if (isRedditVideo(vid)) {
                const url = getVideoUrl(vid);
                if (url && !url.startsWith('blob:')) injectButtons(vid, 'video', url);
            }
        });
    }

    let scanQueue = new Set();
    let isThrottled = false;

    function scheduleScan(node = document) {
        scanQueue.add(node);
        if (isThrottled) return;
        isThrottled = true;
        setTimeout(() => {
            requestAnimationFrame(() => {
                scanQueue.forEach(n => scan(n));
                scanQueue.clear();
                isThrottled = false;
            });
        }, TIMING.THROTTLE_MS);
    }

    function init() {
        scan();
        const domObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type === 'attributes') {
                    scheduleScan(m.target);
                } else if (m.addedNodes.length > 0) {
                    m.addedNodes.forEach(node => scheduleScan(node));
                }
            }
        });
        domObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href'] });
        document.addEventListener('load', (e) => {
            if (e.target && e.target.tagName === 'IMG') {
                scheduleScan(e.target);
            }
        }, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
