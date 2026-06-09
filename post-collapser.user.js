// ==UserScript==
// @name         [Reddit] Post Collapser
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      3.7
// @description  Adds a toggle button to cleanly collapse posts, displaying the title and timestamp.
// @author       Xiv
// @match        *://*.reddit.com/*
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @updateURL    https://myouisaur.github.io/Reddit/post-collapser.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/post-collapser.user.js
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
            TOGGLE_BTN: 'xiv-collapse-toggle',
            ICON_OPEN: 'xiv-icon-open',
            ICON_CLOSED: 'xiv-icon-closed',
            COLLAPSED_TITLE: 'xiv-collapsed-title'
        },
        SVG: {
            OPEN: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
            CLOSED: 'M11.83 9L15 12.16V12a3 3 0 00-3-3h-.17zm-4.3.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.3-3.8c4.28 0 8.01 2.37 10.02 6.01-.4.72-.88 1.38-1.4 1.98l-1.52-1.52A9.55 9.55 0 0019.8 12c-1.69-3.26-5.06-5.5-8.8-5.5-1.14 0-2.23.2-3.23.56l1.62 1.62c.5-.06 1.03-.08 1.61-.08zm-9.35-1L1.27 3.73 3.65 6.1C2.33 7.71 1.45 9.75 1 12c1.73 4.39 6 7.5 11 7.5 1.83 0 3.53-.47 5.06-1.28l2.67 2.67 1.27-1.27L2.48 2z'
        },
        OBSERVER_DEBOUNCE_MS: 100,
        STORAGE_KEY: 'xiv_collapsed_posts',
        MAX_STORED_IDS: 1000
    };

    let debounceTimer = null;

    const Storage = {
        get: () => {
            try {
                const parsed = JSON.parse(GM_getValue(CONFIG.STORAGE_KEY, '[]'));
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                return [];
            }
        },
        add: (id) => {
            if (!id) return;
            const arr = Storage.get();
            if (!arr.includes(id)) {
                arr.push(id);
                if (arr.length > CONFIG.MAX_STORED_IDS) {
                    arr.shift();
                }
                GM_setValue(CONFIG.STORAGE_KEY, JSON.stringify(arr));
            }
        },
        remove: (id) => {
            if (!id) return;
            let arr = Storage.get();
            arr = arr.filter(x => x !== id);
            GM_setValue(CONFIG.STORAGE_KEY, JSON.stringify(arr));
        }
    };

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
        let sibling = direction === 'next' ? postElement.nextElementSibling : postElement.previousElementSibling;
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

        // Title
        const titleAnchor = postElement.querySelector('a.title');
        parts.push(titleAnchor ? titleAnchor.textContent : 'Post');

        // Subreddit Context
        const subElem = postElement.querySelector('.subreddit');
        if (subElem) parts.push(subElem.textContent);

        // Comment Count
        const commentsElem = postElement.querySelector('.comments');
        if (commentsElem) parts.push(commentsElem.textContent);

        // Time
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

            const isCollapsed = postElement.classList.toggle(CONFIG.CLASSES.COLLAPSED);
            btn.setAttribute('title', isCollapsed ? 'Expand Post' : 'Collapse Post');

            if (isCollapsed) {
                Storage.add(postId);
            } else {
                Storage.remove(postId);
            }

            updateGapState(postElement);
            updateGapState(getAdjacentPost(postElement, 'prev'));
        });

        return btn;
    }

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .${CONFIG.CLASSES.TOGGLE_BTN} {
                float: left;
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
                margin-right: 8px;
                margin-top: 2ex;
                border-radius: 4px;
                transition: background-color 0.2s ease, outline 0.2s ease, opacity 0.2s ease;
                padding: 0;
            }

            .${CONFIG.CLASSES.TOGGLE_BTN}:hover {
                background: rgba(128, 128, 128, 0.2);
                opacity: 0.9;
            }

            .${CONFIG.CLASSES.TOGGLE_BTN}:focus-visible {
                outline: 2px solid rgba(128, 128, 128, 0.8);
                outline-offset: 2px;
                opacity: 1;
            }

            .${CONFIG.CLASSES.TOGGLE_BTN} .${CONFIG.CLASSES.ICON_CLOSED} { display: none; }
            .thing.${CONFIG.CLASSES.COLLAPSED} .${CONFIG.CLASSES.TOGGLE_BTN} .${CONFIG.CLASSES.ICON_OPEN} { display: none; }
            .thing.${CONFIG.CLASSES.COLLAPSED} .${CONFIG.CLASSES.TOGGLE_BTN} .${CONFIG.CLASSES.ICON_CLOSED} { display: block; }

            .${CONFIG.CLASSES.COLLAPSED_TITLE} {
                display: none;
                font-size: x-small;
                opacity: 0.8;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                line-height: 1.2;
                margin-top: 18px;
            }

            /* Apply border and padding to ALL processed posts to prevent X-axis shifting */
            .thing.${CONFIG.CLASSES.PROCESSED} {
                border-left: 3px solid rgba(128, 128, 128, 0.4) !important;
                padding-left: 6px !important;
            }

            /* Container Shrinkage - Maintains block flow perfectly static */
            .thing.${CONFIG.CLASSES.COLLAPSED} {
                min-height: 0 !important;
                margin-bottom: 0 !important;
                background-color: transparent !important;
                display: block !important;
                overflow: hidden !important;
            }

            .thing.${CONFIG.CLASSES.LAST_COLLAPSED} {
                margin-bottom: 8px !important;
            }

            .thing.${CONFIG.CLASSES.COLLAPSED} > *:not(.${CONFIG.CLASSES.TOGGLE_BTN}):not(.${CONFIG.CLASSES.COLLAPSED_TITLE}) {
                display: none !important;
            }

            .thing.${CONFIG.CLASSES.COLLAPSED} .${CONFIG.CLASSES.COLLAPSED_TITLE} {
                display: flex !important;
                align-items: center !important;
            }
        `;
        document.head.appendChild(style);
    }

    function processPosts(root = document) {
        try {
            const posts = root.querySelectorAll(`${CONFIG.SELECTORS.POST}:not(.${CONFIG.CLASSES.PROCESSED})`);
            if (!posts.length) return;

            const collapsedIds = Storage.get();

            requestAnimationFrame(() => {
                posts.forEach(post => {
                    if (post.querySelector(`.${CONFIG.CLASSES.TOGGLE_BTN}`)) {
                        post.classList.add(CONFIG.CLASSES.PROCESSED);
                        return;
                    }

                    post.classList.add(CONFIG.CLASSES.PROCESSED);

                    const postId = post.getAttribute('data-fullname');
                    const isInitiallyCollapsed = collapsedIds.includes(postId);

                    if (isInitiallyCollapsed) {
                        post.classList.add(CONFIG.CLASSES.COLLAPSED);
                    }

                    const btn = createToggleButton(post, postId, isInitiallyCollapsed);
                    const collapsedTitle = createCollapsedTitle(post);

                    const rankElem = post.querySelector('.rank');
                    if (rankElem) {
                        post.insertBefore(btn, rankElem);
                        post.insertBefore(collapsedTitle, rankElem);
                    } else if (post.firstChild) {
                        post.insertBefore(btn, post.firstChild);
                        post.insertBefore(collapsedTitle, post.firstChild.nextSibling);
                    } else {
                        post.appendChild(btn);
                        post.appendChild(collapsedTitle);
                    }

                    updateGapState(post);
                });
            });
        } catch (error) {
            console.error('[Reddit Post Collapser] Error processing posts:', error);
        }
    }

    function initObserver() {
        const container = document.querySelector(CONFIG.SELECTORS.CONTAINER) || document.body;
        if (!container) return;

        const observer = new MutationObserver((mutations) => {
            let shouldProcess = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.matches(CONFIG.SELECTORS.POST) || node.querySelector(CONFIG.SELECTORS.POST)) {
                                shouldProcess = true;
                                break;
                            }
                        }
                    }
                }
                if (shouldProcess) break;
            }

            if (shouldProcess) {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    processPosts(document);
                }, CONFIG.OBSERVER_DEBOUNCE_MS);
            }
        });

        observer.observe(container, { childList: true, subtree: true });
    }

    function init() {
        try {
            injectStyles();
            processPosts();
            initObserver();
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
