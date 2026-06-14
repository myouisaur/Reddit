// ==UserScript==
// @name         [Reddit] Post Toggle & Track
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      4.3
// @description  Adds a toggle button to cleanly collapse posts and a tracker for downloaded posts.
// @author       Xiv
// @match        *://*.reddit.com/*
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @updateURL    https://myouisaur.github.io/Reddit/post-toggle-and-track.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/post-toggle-and-track.user.js
// ==/UserScript==

(function () {
    'use strict';

    if (document.querySelector('shreddit-app, #AppRouter-main-content')) {
        console.log('[Reddit Post Collapser] New Reddit detected. Script safely disabled.');
        return;
    }

    if (window.location.pathname.includes('/comments/')) {
        return;
    }

    if (window.__redditCollapserRunning) return;
    window.__redditCollapserRunning = true;

    const CONFIG = {
        SELECTORS: {
            CONTAINER: 'div.content',
            POST: '.thing.link'
        },
        CLASSES: {
            PROCESSED: 'xiv-processed',
            COLLAPSED: 'xiv-collapsed',
            LAST_COLLAPSED: 'xiv-last-collapsed',
            ANIMATING: 'xiv-animating',
            HIDDEN_CONTENT: 'xiv-hidden-content',
            ACTION_CONTAINER: 'xiv-action-container',
            TOGGLE_BTN: 'xiv-collapse-toggle',
            DOWNLOAD_BTN: 'xiv-download-btn',
            DOWNLOADED: 'xiv-downloaded',
            ICON_OPEN: 'xiv-icon-open',
            ICON_CLOSED: 'xiv-icon-closed',
            ICON_DOWNLOAD: 'xiv-icon-download',
            COLLAPSED_TITLE: 'xiv-collapsed-title'
        },
        SVG: {
            OPEN: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
            CLOSED: 'M11.83 9L15 12.16V12a3 3 0 00-3-3h-.17zm-4.3.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.3-3.8c4.28 0 8.01 2.37 10.02 6.01-.4.72-.88 1.38-1.4 1.98l-1.52-1.52A9.55 9.55 0 0019.8 12c-1.69-3.26-5.06-5.5-8.8-5.5-1.14 0-2.23.2-3.23.56l1.62 1.62c.5-.06 1.03-.08 1.61-.08zm-9.35-1L1.27 3.73 3.65 6.1C2.33 7.71 1.45 9.75 1 12c1.73 4.39 6 7.5 11 7.5 1.83 0 3.53-.47 5.06-1.28l2.67 2.67 1.27-1.27L2.48 2z',
            DOWNLOAD: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z'
        },
        STORAGE_KEYS: {
            COLLAPSED: 'xiv_collapsed_posts',
            DOWNLOADED: 'xiv_downloaded_posts'
        },
        OBSERVER_DEBOUNCE_MS: 100,
        ANIMATION_MS: 300,
        COLLAPSED_HEIGHT: 36,
        MAX_STORED_IDS: 1000
    };

    let debounceTimer = null;

    const Storage = {
        _data: {},
        _writeTimer: {},

        get: (key) => {
            if (Storage._data[key]) return Storage._data[key];
            try {
                const parsed = JSON.parse(GM_getValue(key, '[]'));
                if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
                    Storage._data[key] = parsed;
                } else {
                    Storage._data[key] = [];
                }
            } catch (e) {
                Storage._data[key] = [];
            }
            return Storage._data[key];
        },

        _scheduleWrite: (key) => {
            clearTimeout(Storage._writeTimer[key]);
            Storage._writeTimer[key] = setTimeout(() => {
                GM_setValue(key, JSON.stringify(Storage._data[key]));
            }, 300);
        },

        add: (key, id) => {
            if (!id) return;
            const arr = Storage.get(key);
            if (!arr.includes(id)) {
                arr.push(id);
                if (arr.length > CONFIG.MAX_STORED_IDS) arr.shift();
                Storage._scheduleWrite(key);
            }
        },

        remove: (key, id) => {
            if (!id) return;
            const arr = Storage.get(key);
            const initialLength = arr.length;
            Storage._data[key] = arr.filter(x => x !== id);
            if (Storage._data[key].length !== initialLength) Storage._scheduleWrite(key);
        }
    };

    function collapsePost(post) {
        post.style.maxHeight = post.scrollHeight + 'px';
        post.classList.add(CONFIG.CLASSES.ANIMATING);
        post.classList.remove(CONFIG.CLASSES.HIDDEN_CONTENT);

        // Force reflow
        void post.offsetHeight;

        post.classList.add(CONFIG.CLASSES.COLLAPSED);
        post.style.maxHeight = `${CONFIG.COLLAPSED_HEIGHT}px`;

        clearTimeout(post.__xivAnimTimer);
        post.__xivAnimTimer = setTimeout(() => {
            if (post.classList.contains(CONFIG.CLASSES.COLLAPSED)) {
                post.classList.remove(CONFIG.CLASSES.ANIMATING);
                post.classList.add(CONFIG.CLASSES.HIDDEN_CONTENT);
            }
        }, CONFIG.ANIMATION_MS);
    }

    function expandPost(post) {
        post.classList.remove(CONFIG.CLASSES.HIDDEN_CONTENT);
        post.style.maxHeight = 'none';
        const targetHeight = post.scrollHeight;

        post.style.maxHeight = `${CONFIG.COLLAPSED_HEIGHT}px`;
        post.classList.add(CONFIG.CLASSES.ANIMATING);

        // Force reflow
        void post.offsetHeight;
        post.classList.remove(CONFIG.CLASSES.COLLAPSED);
        post.style.maxHeight = targetHeight + 'px';

        clearTimeout(post.__xivAnimTimer);
        post.__xivAnimTimer = setTimeout(() => {
            if (!post.classList.contains(CONFIG.CLASSES.COLLAPSED)) {
                post.classList.remove(CONFIG.CLASSES.ANIMATING);
                post.style.maxHeight = '';
            }
        }, CONFIG.ANIMATION_MS);
    }

    function createSVGIcon(pathData, className) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('fill', 'currentColor');
        svg.classList.add(className);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        svg.appendChild(path);
        return svg;
    }

    function getAdjacentPost(postElement, direction) {
        let sibling = direction === 'next' ?
            postElement.nextElementSibling : postElement.previousElementSibling;
        while (sibling) {
            if (sibling.matches && sibling.matches(CONFIG.SELECTORS.POST)) return sibling;
            sibling = direction === 'next' ? sibling.nextElementSibling : sibling.previousElementSibling;
        }
        return null;
    }

    function updateGapState(post) {
        if (!post) return;
        const nextPost = getAdjacentPost(post, 'next');

        if (post.classList.contains(CONFIG.CLASSES.COLLAPSED)) {
            if (!nextPost || !nextPost.classList.contains(CONFIG.CLASSES.COLLAPSED)) {
                post.classList.add(CONFIG.CLASSES.LAST_COLLAPSED);
            } else {
                post.classList.remove(CONFIG.CLASSES.LAST_COLLAPSED);
            }
        } else {
            post.classList.remove(CONFIG.CLASSES.LAST_COLLAPSED);
        }
    }

    function getRelativeTime(date) {
        const diffInSeconds = Math.floor((new Date() - date) / 1000);
        if (diffInSeconds < 60) return 'just now';

        const diffInMinutes = Math.floor(diffInSeconds / 60);
        if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes === 1 ? '' : 's'} ago`;

        const diffInHours = Math.floor(diffInMinutes / 60);
        if (diffInHours < 24) return `${diffInHours} hour${diffInHours === 1 ? '' : 's'} ago`;

        const diffInDays = Math.floor(diffInHours / 24);
        if (diffInDays < 30) return `${diffInDays} day${diffInDays === 1 ? '' : 's'} ago`;

        const diffInMonths = Math.floor(diffInDays / 30);
        if (diffInMonths < 12) return `${diffInMonths} month${diffInMonths === 1 ? '' : 's'} ago`;

        const diffInYears = Math.floor(diffInDays / 365);
        return `${diffInYears} year${diffInYears === 1 ? '' : 's'} ago`;
    }

    function createCollapsedTitle(postElement) {
        const parts = [];
        const titleAnchor = postElement.querySelector('a.title');
        parts.push(titleAnchor ? titleAnchor.textContent : 'Post');

        const subElem = postElement.querySelector('.subreddit');
        if (subElem) parts.push(subElem.textContent);

        const commentsElem = postElement.querySelector('.comments');
        if (commentsElem) parts.push(commentsElem.textContent);

        const timeElem = postElement.querySelector('time.live-timestamp, time');
        if (timeElem) {
            const dtString = timeElem.getAttribute('datetime');
            if (dtString) {
                try {
                    const dateObj = new Date(dtString);
                    if (!isNaN(dateObj.getTime())) {
                        parts.push(getRelativeTime(dateObj));
                    }
                } catch (error) {
                    console.warn('[Reddit Post Collapser] Date parsing failed. Skipping time string.');
                }
            }
        }

        const combinedText = parts.join(' • ');
        const span = document.createElement('span');
        span.className = CONFIG.CLASSES.COLLAPSED_TITLE;
        span.textContent = combinedText;
        span.setAttribute('title', combinedText);

        return span;
    }

    function createToggleButton(postElement, postId, isInitiallyCollapsed) {
        const btn = document.createElement('button');
        btn.className = CONFIG.CLASSES.TOGGLE_BTN;
        btn.setAttribute('aria-label', 'Toggle Post Visibility');
        btn.setAttribute('title', isInitiallyCollapsed ? 'Expand Post' : 'Collapse Post');

        btn.appendChild(createSVGIcon(CONFIG.SVG.OPEN, CONFIG.CLASSES.ICON_OPEN));
        btn.appendChild(createSVGIcon(CONFIG.SVG.CLOSED, CONFIG.CLASSES.ICON_CLOSED));

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const isCollapsed = !postElement.classList.contains(CONFIG.CLASSES.COLLAPSED);
            btn.setAttribute('title', isCollapsed ? 'Expand Post' : 'Collapse Post');

            if (isCollapsed) {
                Storage.add(CONFIG.STORAGE_KEYS.COLLAPSED, postId);
                collapsePost(postElement);
            } else {
                Storage.remove(CONFIG.STORAGE_KEYS.COLLAPSED, postId);
                expandPost(postElement);
            }

            updateGapState(postElement);
            updateGapState(getAdjacentPost(postElement, 'prev'));
        });
        return btn;
    }

    function createDownloadButton(postElement, postId, isInitiallyDownloaded) {
        const btn = document.createElement('button');
        btn.className = CONFIG.CLASSES.DOWNLOAD_BTN;
        btn.setAttribute('aria-label', 'Toggle Download Status');
        btn.setAttribute('title', isInitiallyDownloaded ? 'Mark as Not Downloaded' : 'Mark as Downloaded');

        btn.appendChild(createSVGIcon(CONFIG.SVG.DOWNLOAD, CONFIG.CLASSES.ICON_DOWNLOAD));

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const isDownloaded = postElement.classList.toggle(CONFIG.CLASSES.DOWNLOADED);
            btn.setAttribute('title', isDownloaded ? 'Mark as Not Downloaded' : 'Mark as Downloaded');

            if (isDownloaded) {
                Storage.add(CONFIG.STORAGE_KEYS.DOWNLOADED, postId);
            } else {
                Storage.remove(CONFIG.STORAGE_KEYS.DOWNLOADED, postId);
            }
        });
        return btn;
    }

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .thing.${CONFIG.CLASSES.PROCESSED} {
                position: relative !important;
                border-left: 3px solid rgba(128, 128, 128, 0.4) !important;
                padding-left: 6px !important;
                overflow: hidden !important;
                transition: background-color 0.2s ease !important;
            }

            .thing.${CONFIG.CLASSES.DOWNLOADED} {
                background-color: rgba(34, 197, 94, 0.08) !important;
            }

            .thing.${CONFIG.CLASSES.ANIMATING} {
                transition: max-height ${CONFIG.ANIMATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1), margin-bottom ${CONFIG.ANIMATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1) !important;
            }

            .${CONFIG.CLASSES.ACTION_CONTAINER} {
                float: left;
                display: flex;
                flex-direction: column;
                gap: 4px;
                margin: 8px 8px 8px 0;
            }

            .${CONFIG.CLASSES.TOGGLE_BTN}, .${CONFIG.CLASSES.DOWNLOAD_BTN} {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                background: transparent;
                border: none;
                cursor: pointer;
                color: inherit;
                opacity: 0.5;
                border-radius: 4px;
                transition: background-color 0.2s ease, outline 0.2s ease, opacity 0.2s ease, color 0.2s ease;
                padding: 0;
            }

            .${CONFIG.CLASSES.TOGGLE_BTN}:hover, .${CONFIG.CLASSES.DOWNLOAD_BTN}:hover {
                background: rgba(128, 128, 128, 0.2);
                opacity: 0.9;
            }

            .${CONFIG.CLASSES.TOGGLE_BTN}:focus-visible, .${CONFIG.CLASSES.DOWNLOAD_BTN}:focus-visible {
                outline: 2px solid rgba(128, 128, 128, 0.8);
                outline-offset: 2px;
                opacity: 1;
            }

            .thing.${CONFIG.CLASSES.DOWNLOADED} .${CONFIG.CLASSES.DOWNLOAD_BTN} {
                color: #22c55e !important;
                opacity: 1 !important;
            }

            /* Hides the download button completely when the post is collapsed */
            .thing.${CONFIG.CLASSES.COLLAPSED} .${CONFIG.CLASSES.DOWNLOAD_BTN} {
                display: none !important;
            }

            .${CONFIG.CLASSES.TOGGLE_BTN} .${CONFIG.CLASSES.ICON_CLOSED} { display: none; }
            .thing.${CONFIG.CLASSES.COLLAPSED} .${CONFIG.CLASSES.TOGGLE_BTN} .${CONFIG.CLASSES.ICON_OPEN} { display: none; }
            .thing.${CONFIG.CLASSES.COLLAPSED} .${CONFIG.CLASSES.TOGGLE_BTN} .${CONFIG.CLASSES.ICON_CLOSED} { display: block; }

            .${CONFIG.CLASSES.COLLAPSED_TITLE} {
                position: absolute;
                left: 36px;
                top: 0;
                height: ${CONFIG.COLLAPSED_HEIGHT}px;
                display: flex;
                align-items: center;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.2s ease;
                font-size: x-small;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                right: 8px;
            }

            .thing.${CONFIG.CLASSES.COLLAPSED} .${CONFIG.CLASSES.COLLAPSED_TITLE} {
                opacity: 0.8;
                pointer-events: auto;
            }

            .thing > *:not(.${CONFIG.CLASSES.ACTION_CONTAINER}):not(.${CONFIG.CLASSES.COLLAPSED_TITLE}) {
                transition: opacity 0.2s ease;
            }

            /* Hide everything EXCEPT the container and the title when collapsed */
            .thing.${CONFIG.CLASSES.COLLAPSED} > *:not(.${CONFIG.CLASSES.ACTION_CONTAINER}):not(.${CONFIG.CLASSES.COLLAPSED_TITLE}) {
                opacity: 0 !important;
                pointer-events: none !important;
            }

            .thing.${CONFIG.CLASSES.HIDDEN_CONTENT} > *:not(.${CONFIG.CLASSES.ACTION_CONTAINER}):not(.${CONFIG.CLASSES.COLLAPSED_TITLE}) {
                display: none !important;
            }

            .thing.${CONFIG.CLASSES.COLLAPSED} {
                min-height: ${CONFIG.COLLAPSED_HEIGHT}px !important;
                background-color: transparent !important;
            }

            .thing.${CONFIG.CLASSES.LAST_COLLAPSED} {
                margin-bottom: 8px !important;
            }
        `;
        document.head.appendChild(style);
    }

    function processPosts(root = document) {
        try {
            const posts = [];
            if (root.matches && root.matches(CONFIG.SELECTORS.POST) && !root.classList.contains(CONFIG.CLASSES.PROCESSED)) {
                posts.push(root);
            }

            if (root.querySelectorAll) {
                const children = root.querySelectorAll(`${CONFIG.SELECTORS.POST}:not(.${CONFIG.CLASSES.PROCESSED})`);
                posts.push(...children);
            }

            if (!posts.length) return;

            const collapsedIds = Storage.get(CONFIG.STORAGE_KEYS.COLLAPSED);
            const downloadedIds = Storage.get(CONFIG.STORAGE_KEYS.DOWNLOADED);

            requestAnimationFrame(() => {
                posts.forEach(post => {
                    if (post.querySelector(`.${CONFIG.CLASSES.TOGGLE_BTN}`)) {
                        post.classList.add(CONFIG.CLASSES.PROCESSED);
                        return;
                    }

                    post.classList.add(CONFIG.CLASSES.PROCESSED);

                    const postId = post.getAttribute('data-fullname');
                    const isInitiallyCollapsed = collapsedIds.includes(postId);
                    const isInitiallyDownloaded = downloadedIds.includes(postId);

                    if (isInitiallyDownloaded) {
                        post.classList.add(CONFIG.CLASSES.DOWNLOADED);
                    }

                    const actionContainer = document.createElement('div');
                    actionContainer.className = CONFIG.CLASSES.ACTION_CONTAINER;

                    const btn = createToggleButton(post, postId, isInitiallyCollapsed);
                    const dlBtn = createDownloadButton(post, postId, isInitiallyDownloaded);
                    const collapsedTitle = createCollapsedTitle(post);

                    actionContainer.appendChild(btn);
                    actionContainer.appendChild(dlBtn);

                    const rankElem = post.querySelector('.rank');
                    if (rankElem) {
                        post.insertBefore(actionContainer, rankElem);
                        post.insertBefore(collapsedTitle, rankElem);
                    } else if (post.firstChild) {
                        post.insertBefore(actionContainer, post.firstChild);
                        post.insertBefore(collapsedTitle, actionContainer.nextSibling);
                    } else {
                        post.appendChild(actionContainer);
                        post.appendChild(collapsedTitle);
                    }

                    if (isInitiallyCollapsed) {
                        post.classList.add(CONFIG.CLASSES.COLLAPSED);
                        post.classList.add(CONFIG.CLASSES.HIDDEN_CONTENT);
                        post.style.maxHeight = `${CONFIG.COLLAPSED_HEIGHT}px`;
                    }

                    updateGapState(post);
                });
            });
        } catch (error) {
            console.error('[Reddit Post Collapser] Error processing posts:', error);
        }
    }

    function scheduleProcessing(root = document) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            processPosts(root);
        }, CONFIG.OBSERVER_DEBOUNCE_MS);
    }

    function initObserver() {
        const container = document.body;
        if (!container) return;

        const observer = new MutationObserver((mutations) => {
            const nodesToProcess = new Set();

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (
                            node.classList.contains('thing') ||
                            node.classList.contains('sitetable') ||
                            (node.id && node.id.startsWith('siteTable'))
                        ) {
                            nodesToProcess.add(node);
                        }
                    }
                }
            }

            if (nodesToProcess.size > 0) {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    nodesToProcess.forEach(node => processPosts(node));
                }, CONFIG.OBSERVER_DEBOUNCE_MS);
            }
        });
        observer.observe(container, { childList: true, subtree: true });
    }

    function initRESOptimization() {
        window.addEventListener('neverEndingLoad', () => {
            scheduleProcessing(document);
        }, { passive: true });
    }

    function init() {
        try {
            injectStyles();
            processPosts();
            initObserver();
            initRESOptimization();
        } catch (error) {
            console.error('[Reddit Post Collapser] Fatal initialization error:', error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
