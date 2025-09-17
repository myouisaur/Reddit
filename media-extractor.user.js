// ==UserScript==
// @name         [Reddit] Media Extractor
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.redditstatic.com/desktop2x/img/favicon/favicon-96x96.png
// @version      2.1
// @description  Adds buttons to Reddit posts to open or download the highest resolution images and videos (preserves JPG, converts PNG/WEBP to JPG). Filters out thumbnails, avatars, and UI icons.
// @author       Xiv
// @match        *://*.reddit.com/*
// @grant        GM_addStyle
// @updateURL    https://myouisaur.github.io/Reddit/media-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/media-extractor.user.js
// ==/UserScript==

(function() {
    'use strict';

    const BUTTON_CSS = `
        .reddit-btn-container {
            position: absolute !important;
            top: 8px !important;
            right: 8px !important;
            display: flex !important;
            gap: 4px;
            z-index: 9999 !important;
        }
        .reddit-highres-btn {
            width: 36px;
            height: 36px;
            background: rgba(0,0,0,0.4);
            backdrop-filter: blur(6px);
            color: white;
            border-radius: 10px;
            cursor: pointer;
            border: 1px solid rgba(255,255,255,0.1);
            display: flex !important;
            align-items: center;
            justify-content: center;
            font-size: 15px;
            box-shadow: 0 6px 18px rgba(0,0,0,0.2);
            transition: transform 0.12s ease, opacity 0.12s ease;
        }
        .reddit-highres-btn:hover {
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(12px);
            border: 1.5px solid rgba(255, 255, 255, 0.3);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }
        .reddit-highres-btn:active {
            transform: scale(0.95);
            opacity: 0.9;
        }
    `;

    GM_addStyle(BUTTON_CSS);

    function generateRandomString(length = 15) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    }

    function getResolution(element) {
        const w = element.naturalWidth || element.videoWidth || element.offsetWidth || 0;
        const h = element.naturalHeight || element.videoHeight || element.offsetHeight || 0;
        return `${w}x${h}`;
    }

    function getHighestResImage(img) {
        let bestUrl = img.src;
        if (img.srcset) {
            const sources = img.srcset.split(',')
                .map(s => {
                    const [url, width] = s.trim().split(' ');
                    return { url: url.trim(), width: parseInt(width) || 0 };
                })
                .sort((a, b) => b.width - a.width);
            if (sources.length > 0 && sources[0].url) bestUrl = sources[0].url;
        }
        if (bestUrl.includes('preview.redd.it')) {
            bestUrl = bestUrl.replace('preview.redd.it', 'i.redd.it');
        }
        if (bestUrl.includes('i.redd.it') || bestUrl.includes('preview.redd.it')) {
            const url = new URL(bestUrl);
            url.searchParams.delete('width');
            url.searchParams.delete('height');
            url.searchParams.delete('crop');
            url.searchParams.delete('auto');
            url.searchParams.delete('s');
            const newParams = new URLSearchParams();
            if (url.searchParams.has('format')) {
                newParams.set('format', url.searchParams.get('format'));
            }
            bestUrl = url.origin + url.pathname + (newParams.toString() ? '?' + newParams.toString() : '');
        }
        if (bestUrl.includes('imgur.com') && !bestUrl.includes('/gallery/')) {
            bestUrl = bestUrl.replace(/\/(\w+)[sml]\./, '/$1.');
        }
        return bestUrl;
    }

    function getHighestResVideo(video) {
        const sources = video.querySelectorAll('source');
        if (sources.length > 0) {
            for (let source of sources) {
                if (source.src && (source.src.includes('1080') || source.src.includes('720'))) {
                    return source.src;
                }
            }
            return sources[0].src;
        }
        return video.src || video.currentSrc;
    }

    function isAdaptiveStream(url) {
        return url && (url.includes('.m3u8') || url.includes('.mpd'));
    }

    // ✅ Filter: skip thumbnails, avatars, UI icons
    function isRedditPostMedia(element) {
        const src = element.src || element.currentSrc || '';
        if (!src) return false;

        // Skip obvious UI/avatars/emojis
        if (src.includes('redditstatic.com') ||
            src.includes('/styles/') ||
            src.includes('/avatars/') ||
            src.includes('emoji') ||
            src.endsWith('.svg') ||
            src.startsWith('data:')) {
            return false;
        }

        // Skip thumbnails (small images inside preview containers)
        if ((element.naturalWidth && element.naturalWidth <= 320) ||
            (element.naturalHeight && element.naturalHeight <= 320)) {
            if (element.closest('[data-testid*="post-preview"]') ||
                element.closest('[data-testid*="thumbnail"]') ||
                element.closest('.thumbnail') ||
                element.closest('[class*="thumbnail"]')) {
                return false;
            }
        }

        return true;
    }

    function getMediaInfo(element) {
        const isVideo = element.tagName === 'VIDEO';
        const randomStr = generateRandomString(15);
        const resolution = getResolution(element);

        if (isVideo) {
            const url = getHighestResVideo(element);
            if (isAdaptiveStream(url)) {
                return {
                    type: 'video',
                    filename: `reddit-video-${resolution}-${randomStr}.m3u8`,
                    url: url,
                    adaptive: true
                };
            }
            return {
                type: 'video',
                filename: `reddit-video-${resolution}-${randomStr}.mp4`,
                url: url,
                adaptive: false
            };
        } else {
            let url = getHighestResImage(element);
            let extension = 'jpg';
            if (url.includes('.png')) extension = 'png';
            else if (url.includes('.gif')) extension = 'gif';
            else if (url.includes('.webp')) extension = 'webp';
            else if (url.includes('.jpeg')) extension = 'jpeg';

            return {
                type: 'image',
                filename: `reddit-image-${resolution}-${randomStr}.${extension}`,
                url: url,
                adaptive: false
            };
        }
    }

    function downloadMedia(url, filename, adaptive=false) {
        if (adaptive) {
            alert('⚠ This video uses adaptive streaming. Use external tools like yt-dlp or VLC with the opened URL.');
            window.open(url, '_blank', 'noopener,noreferrer');
            return;
        }

        // Direct download for JPG/JPEG/GIF
        if (/\.(jpg|jpeg|gif)$/i.test(filename)) {
            return fetch(url)
                .then(r => r.ok ? r.blob() : Promise.reject())
                .then(blob => {
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = filename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(link.href);
                })
                .catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
        }

        // Convert PNG/WEBP → JPG
        if (/\.(png|webp)$/i.test(filename)) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = img.naturalWidth || img.width;
                canvas.height = img.naturalHeight || img.height;
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
                canvas.toBlob(function(blob) {
                    if (blob) {
                        const link = document.createElement('a');
                        link.href = URL.createObjectURL(blob);
                        link.download = filename.replace(/\.(png|webp)$/i, '.jpg');
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(link.href);
                    } else {
                        window.open(url, '_blank', 'noopener,noreferrer');
                    }
                }, 'image/jpeg', 0.92);
            };
            img.onerror = () => window.open(url, '_blank', 'noopener,noreferrer');
            img.src = url;
            return;
        }

        // Fallback (videos/others)
        fetch(url)
            .then(r => r.ok ? r.blob() : Promise.reject())
            .then(blob => {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
            })
            .catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
    }

    function removeOldButtons() {
        document.querySelectorAll('.reddit-btn-container').forEach(c => c.remove());
    }

    function addMediaButtons() {
        removeOldButtons();
        const mediaElements = document.querySelectorAll('img, video');
        let buttonsAdded = 0;

        mediaElements.forEach(element => {
            if (!isRedditPostMedia(element)) return;

            const parent = element.parentElement;
            if (!parent) return;
            if (parent.querySelector('.reddit-btn-container')) return;

            if (!/relative|absolute|fixed|sticky/i.test(getComputedStyle(parent).position)) {
                parent.style.position = 'relative';
            }

            const mediaInfo = getMediaInfo(element);
            if (!mediaInfo.url || mediaInfo.url === 'about:blank') return;

            const container = document.createElement('div');
            container.className = 'reddit-btn-container';

            const openButton = document.createElement('div');
            openButton.textContent = '🔗';
            openButton.className = 'reddit-highres-btn';
            openButton.title = `Open original ${mediaInfo.type} (highest resolution)`;
            openButton.addEventListener('mousedown', e => {
                e.stopPropagation();
                e.preventDefault();
                const currentMediaInfo = getMediaInfo(element);
                window.open(currentMediaInfo.url, '_blank', 'noopener,noreferrer');
            });

            const downloadButton = document.createElement('div');
            downloadButton.textContent = mediaInfo.adaptive ? '⚠' : '⬇';
            downloadButton.className = 'reddit-highres-btn';
            downloadButton.title = mediaInfo.adaptive ?
                'Adaptive stream: open manifest (.m3u8/.mpd) for yt-dlp/VLC' :
                `Download highest resolution ${mediaInfo.type}`;
            downloadButton.addEventListener('mousedown', e => {
                e.stopPropagation();
                e.preventDefault();
                const currentMediaInfo = getMediaInfo(element);
                downloadMedia(currentMediaInfo.url, currentMediaInfo.filename, currentMediaInfo.adaptive);
            });

            container.appendChild(openButton);
            container.appendChild(downloadButton);
            parent.appendChild(container);

            buttonsAdded++;
        });

        console.log(`Added buttons to ${buttonsAdded} media elements`);
    }

    let debounceTimer = null;
    function debouncedAddButtons() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(addMediaButtons, 200);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', debouncedAddButtons);
    } else {
        debouncedAddButtons();
    }

    window.addEventListener('load', () => setTimeout(debouncedAddButtons, 500));
    setTimeout(debouncedAddButtons, 1000);
    setTimeout(debouncedAddButtons, 2000);
    setTimeout(debouncedAddButtons, 3000);

    const observer = new MutationObserver(debouncedAddButtons);
    observer.observe(document.body, { childList: true, subtree: true });

    let currentPath = window.location.pathname;
    setInterval(() => {
        if (window.location.pathname !== currentPath) {
            currentPath = window.location.pathname;
            removeOldButtons();
            setTimeout(debouncedAddButtons, 500);
        }
    }, 1000);

})();
