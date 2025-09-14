// ==UserScript==
// @name         [Reddit] Media Extractor
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.redditstatic.com/desktop2x/img/favicon/favicon-96x96.png
// @version      1.5
// @description  Adds buttons to Reddit posts to open or download the highest resolution images and videos. Works best for single media posts. Adaptive streams and galleries are labeled with warnings or fall back to open-only.
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
            width: 32px;
            height: 32px;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(8px);
            color: white;
            border-radius: 6px;
            cursor: pointer;
            border: 1px solid rgba(255, 255, 255, 0.3);
            display: flex !important;
            align-items: center;
            justify-content: center;
            user-select: none;
            pointer-events: auto !important;
            transition: all 0.2s ease;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
            flex-shrink: 0;
        }
        .reddit-highres-btn:hover {
            background: rgba(0, 0, 0, 0.9);
            transform: scale(1.05);
        }
        .reddit-highres-btn:active {
            opacity: 0.8;
            transform: scale(0.95);
        }
    `;

    GM_addStyle(BUTTON_CSS);

    function generateRandomString(length) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    function getHighestResImage(img) {
        let bestUrl = img.src;

        if (img.srcset) {
            const sources = img.srcset.split(',')
                .map(source => {
                    const parts = source.trim().split(' ');
                    return {
                        url: parts[0].trim(),
                        width: parseInt(parts[1]) || 0
                    };
                })
                .sort((a, b) => b.width - a.width);

            if (sources.length > 0 && sources[0].url) {
                bestUrl = sources[0].url;
            }
        }

        if (bestUrl) {
            if (bestUrl.includes('preview.redd.it')) {
                bestUrl = bestUrl.replace('preview.redd.it', 'i.redd.it');
            }

            if (bestUrl.includes('i.redd.it') || bestUrl.includes('preview.redd.it')) {
                const url = new URL(bestUrl);
                bestUrl = bestUrl.replace('preview.redd.it', 'i.redd.it');
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
                bestUrl = bestUrl.replace(/\/(\w+)s\./, '/$1.');
                bestUrl = bestUrl.replace(/\/(\w+)m\./, '/$1.');
                bestUrl = bestUrl.replace(/\/(\w+)l\./, '/$1.');
            }
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

    function isRedditPostMedia(element) {
        const src = element.src || element.currentSrc || '';
        if (!src) return false;
        if (!element.offsetParent) return false;

        if (element.naturalWidth && element.naturalWidth <= 320 && element.naturalHeight && element.naturalHeight <= 320) {
            if (element.closest('[data-testid*="post-preview"]') ||
                element.closest('[data-testid*="thumbnail"]') ||
                element.closest('.thumbnail') ||
                element.closest('[class*="thumbnail"]') ||
                element.closest('[style*="max-width: 320px"]') ||
                element.closest('[style*="max-height: 320px"]')) {
                return false;
            }
        }

        if (element.naturalWidth && element.naturalWidth < 50) return false;
        if (element.naturalHeight && element.naturalHeight < 50) return false;

        if (src.includes('redditstatic.com') ||
            src.includes('/styles/') ||
            src.includes('/avatars/') ||
            src.includes('emoji') ||
            src.endsWith('.svg') ||
            src.startsWith('data:')) {
            return false;
        }

        if (element.closest('header') ||
            element.closest('nav') ||
            element.closest('[role="banner"]')) {
            return false;
        }

        const isInExpandedView = element.closest('[data-testid="media-lightbox"]') ||
                                element.closest('[role="dialog"]') ||
                                element.closest('.Lightbox') ||
                                element.closest('[class*="lightbox"]') ||
                                element.closest('[class*="modal"]') ||
                                element.closest('[class*="overlay"]') ||
                                element.closest('[data-testid="post-content"]') ||
                                (element.naturalWidth > 500 || element.offsetWidth > 500);

        if (!isInExpandedView) return false;

        const isLargeEnough = (element.naturalWidth >= 400 && element.naturalHeight >= 200) ||
                             (element.offsetWidth >= 400 && element.offsetHeight >= 200);

        if (!isLargeEnough) return false;

        const inContent = element.closest('[data-testid*="post"]') ||
                         element.closest('[id^="t3_"]') ||
                         element.closest('article') ||
                         element.closest('.Post') ||
                         element.closest('[slot*="media"]') ||
                         element.closest('shreddit-post') ||
                         element.closest('.media') ||
                         element.closest('[class*="media"]') ||
                         element.closest('[data-click-id="media"]');

        return inContent || (isLargeEnough && src.includes('redd.it'));
    }

    function getMediaInfo(element) {
        const isVideo = element.tagName === 'VIDEO';
        const randomStr = generateRandomString(15);

        if (isVideo) {
            const url = getHighestResVideo(element);
            if (isAdaptiveStream(url)) {
                return {
                    type: 'video',
                    filename: `reddit-video-${randomStr}.m3u8`,
                    url: url,
                    adaptive: true
                };
            }
            return {
                type: 'video',
                filename: `reddit-video-${randomStr}.mp4`,
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
                filename: `reddit-image-${randomStr}.${extension}`,
                url: url,
                adaptive: false
            };
        }
    }

    function removeOldButtons() {
        document.querySelectorAll('.reddit-btn-container').forEach(container => container.remove());
    }

    function downloadMedia(url, filename, adaptive=false) {
        if (adaptive) {
            alert('⚠ This video uses adaptive streaming. Use external tools like yt-dlp or VLC with the opened URL.');
            window.open(url, '_blank', 'noopener,noreferrer');
            return;
        }

        fetch(url)
            .then(response => {
                if (!response.ok) throw new Error('Network response was not ok');
                return response.blob();
            })
            .then(blob => {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
            })
            .catch(error => {
                console.log('Download failed, opening in new tab instead:', error);
                window.open(url, '_blank', 'noopener,noreferrer');
            });
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

            const computedStyle = getComputedStyle(parent);
            if (!/relative|absolute|fixed|sticky/i.test(computedStyle.position)) {
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
            openButton.tabIndex = 0;
            openButton.addEventListener('mousedown', function(e) {
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
            downloadButton.tabIndex = 0;
            downloadButton.addEventListener('mousedown', function(e) {
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

    console.log('Reddit Media Extractor loaded successfully!');
})();
