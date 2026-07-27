// ==UserScript==
// @name         [Reddit] Post Filter
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      7.2
// @description  Filters Reddit posts dynamically with customizable rules for scores, dates, subreddits, keywords, and media types.
// @author       Xiv
// @match        *://*.reddit.com/*
// @run-at       document-start
// @noframes
// @updateURL    https://myouisaur.github.io/Reddit/post-filter.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/post-filter.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Prevent duplicate execution
    if (window.xivInitialized) return;

    // GUARD: Do not run on comment pages (this is a feed filter)
    if (window.location.pathname.includes('/comments/') || document.body?.classList.contains('comments-page')) {
        return;
    }

    window.xivInitialized = true;

    // ==========================================
    // CONFIGURATION & STATE
    // ==========================================

    const CONFIG = {
        // Timing
        DEBOUNCE_MS: 200,

        // Limits
        DEFAULT_MAX_SCORE: 10,
        SCROLL_MARGIN: '400px',

        // Media Parsing Extensions (Checked First)
        MEDIA_EXTENSIONS: {
            IMAGES: ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.avif'],
            VIDEOS: ['.gifv', '.gif', '.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v']
        },

        // Media Parsing Hosts (Fallback)
        MEDIA_HOSTS: {
            IMAGES: [
                'reddit.com/gallery', 'i.redd.it', 'preview.redd.it',
                'imgur.com', 'i.imgur.com', 'ibb.co', 'postimg.cc',
                'flic.kr', 'flickr.com', 'prnt.sc', 'imgflip.com'
            ],
            VIDEOS: [
                'redgifs.com', 'v.redd.it', 'streamable.com',
                'youtube.com', 'youtu.be', 'gfycat.com',
                'tiktok.com', 'vimeo.com', 'twitch.tv', 'clips.twitch.tv'
            ]
        },

        // Selectors
        SELECTORS: {
            SIDEBAR: '.side',
            TARGET_PARENT: '.content[role="main"]',
            SITE_TABLE: '#siteTable',
            POST_ITEM: '.thing.link',
            TIME_ELEMENT: 'time.live-timestamp',
            SCORE_ELEMENT: '.score.unvoted',
            UPVOTED_ARROW: '.arrow.upmod',
            DOWNVOTED_ARROW: '.arrow.downmod',
            ARCHIVED_ARROW: '.arrow.archived',
            TITLE_ELEMENT: 'p.title a.title',
            FLAIR_ELEMENT: '.linkflairlabel',
            PROMOTED_LINK: '.promotedlink',
            SUBREDDIT_LINK: 'a.subreddit, .subreddit.hover',
            DOMAIN: '.domain',
            SEARCH_BOX: '#search',
            ANNOUNCEMENT_TAG: '.stickied-tagline',
            EXPANDO_EXPANDED: '.expando-button.expanded'
        },

        // Injected Element IDs
        IDS: {
            SENTINEL: 'xiv-sentinel',
            INDICATOR: 'xiv-indicator',
            HEADER_TITLE: 'xiv-header-title',
            EMPTY_STATE: 'xiv-empty-state',
            ADVANCED_CONTAINER: 'xiv-advanced-container',
            MIN_INPUT: 'xiv-min-input',
            MAX_INPUT: 'xiv-max-input',
            MIN_RANGE: 'xiv-min-range',
            MAX_RANGE: 'xiv-max-range',
            TRACK_FILL: 'xiv-track-fill',
            LOCK_ICON: 'xiv-lock-svg-wrapper',
            SUB_LIST: 'xiv-sub-list',
            SUB_BTN_TEXT: 'xiv-sub-btn-text',
            SUB_BTN: 'xiv-sub-btn',
            SUB_MASTER_CB: 'xiv-sub-master-cb',
            SUB_SEARCH: 'xiv-sub-search-input',
            SUB_MENU: 'xiv-sub-menu',
            TYPE_BTN: 'xiv-type-btn',
            TYPE_BTN_TEXT: 'xiv-type-btn-text',
            TYPE_MENU: 'xiv-type-menu',
            RESET_BTN: 'xiv-reset-btn',
            ARCHIVED_CB: 'xiv-highlight-archived-cb',
            TEXT_INPUTS: [
                'xiv-date-from', 'xiv-date-to', 'xiv-show-keywords',
                'xiv-show-flairs', 'xiv-keywords', 'xiv-flairs', 'xiv-highlight'
            ],
            CB_INPUTS: [
                'xiv-hide-upvoted', 'xiv-show-upvoted', 'xiv-hide-downvoted',
                'xiv-show-downvoted', 'xiv-hide-promoted', 'xiv-hide-announcements',
                'xiv-hide-downloaded', 'xiv-show-downloaded'
            ]
        },

        // Assets
        ASSETS: {
            SVG_LOCK_PATH: "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z",
            TYPE_PATHS: {
                text: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
                image: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z M7 8.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0 M21 15l-5-5L5 21",
                video: "M23 7l-7 5 7 5V7z M1 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5z",
                other: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
            }
        },

        // Storage
        STORAGE_KEY: 'xiv_reddit_filter_session'
    };

    // Centralized DOM references populated during bootstrap
    const DOM = {
        mainContent: null,
        siteTable: null,
        sidebar: null
    };

    let state = {
        dateFrom: null,
        dateTo: null,

        // Score state
        minScore: 0,
        maxScore: 0,
        highestObservedScore: CONFIG.DEFAULT_MAX_SCORE,
        isMaxScoreLocked: false,
        feedContext: null,

        hideUpvoted: false,
        showUpvoted: false,
        hideDownvoted: false,
        showDownvoted: false,
        hideDownloaded: false,
        showDownloaded: false,
        hidePromoted: false,
        hideAnnouncements: false,
        postType: 'all',

        showKeywords: '',
        showFlairs: '',
        keywords: '',
        flairs: '',

        // Cached Compiled Regexes
        compiledShowKeywords: [],
        compiledShowFlairs: [],
        compiledKeywords: [],
        compiledFlairs: [],

        highlightThreshold: null,
        highlightArchived: true,

        isAdvancedOpen: false,
        totalPosts: 0,
        visiblePosts: 0,
        debounceTimer: null,
        isMutating: false,
        needsFullReeval: true,
        postCache: new WeakMap(),
        io: null,

        // Volatile state
        hiddenSubreddits: new Set(),
        knownSubreddits: new Set(),
        sortedSubreddits: [] // Cached array for performance
    };

    // ==========================================
    // UTILITIES
    // ==========================================

    function el(tag, attributes = {}, children = []) {
        const element = document.createElement(tag);
        for (const [key, value] of Object.entries(attributes)) {
            if (key === 'className') {
                element.className = value;
            } else if (key === 'htmlFor') {
                element.setAttribute('for', value);
            } else if (key === 'textContent') {
                element.textContent = value;
            } else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'tabIndex') {
                element[key] = key === 'tabIndex' ? value : !!value;
            } else if (key.startsWith('on') && typeof value === 'function') {
                element.addEventListener(key.substring(2).toLowerCase(), value);
            } else if (value !== null && value !== undefined) {
                element.setAttribute(key, value);
            }
        }
        children.forEach(child => {
            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                element.appendChild(child);
            }
        });
        return element;
    }

    function createTypeIcon(type) {
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("width", "1.4em");
        svg.setAttribute("height", "1.4em");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        svg.setAttribute("class", "xiv-type-icon");

        const path = document.createElementNS(svgNS, "path");
        path.setAttribute("d", CONFIG.ASSETS.TYPE_PATHS[type] || CONFIG.ASSETS.TYPE_PATHS['other']);
        svg.appendChild(path);

        return svg;
    }

    function parseInputDateToLocal(dateString, isEndOfDay = false) {
        if (!dateString) return null;
        const [year, month, day] = dateString.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        if (isEndOfDay) {
            date.setHours(23, 59, 59, 999);
        } else {
            date.setHours(0, 0, 0, 0);
        }
        return date.getTime();
    }

    function formatDateForInput(timestamp) {
        if (!timestamp) return '';
        const d = new Date(timestamp);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function isFilterActive() {
        return state.minScore > 0 ||
               state.isMaxScoreLocked ||
               state.dateFrom !== null ||
               state.dateTo !== null || state.hideUpvoted || state.showUpvoted ||
               state.hideDownvoted || state.showDownvoted ||
               state.hideDownloaded || state.showDownloaded ||
               state.hidePromoted ||
               state.hideAnnouncements ||
               state.showKeywords.trim() !== '' ||
               state.showFlairs.trim() !== '' ||
               state.keywords.trim() !== '' ||
               state.flairs.trim() !== '' ||
               state.postType !== 'all' ||
               state.highlightThreshold !== null ||
               state.hiddenSubreddits.size > 0;
    }

    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function buildWildcardRegexes(str) {
        if (!str) return [];
        return str.toLowerCase().split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .map(term => {
                const hasStartAsterisk = term.startsWith('*');
                const hasEndAsterisk = term.endsWith('*');

                let escapedTerm = escapeRegExp(term);
                escapedTerm = escapedTerm.replace(/\s+\\\*\s+/g, '.*');
                escapedTerm = escapedTerm.replace(/\\\*/g, '\\S*');

                const prefix = hasStartAsterisk ? '' : '(^|\\W)';
                const suffix = hasEndAsterisk ? '' : '(?!\\w)';

                return new RegExp(prefix + escapedTerm + suffix, 'i');
            });
    }

    function compileAllRegexes() {
        state.compiledShowKeywords = buildWildcardRegexes(state.showKeywords);
        state.compiledShowFlairs = buildWildcardRegexes(state.showFlairs);
        state.compiledKeywords = buildWildcardRegexes(state.keywords);
        state.compiledFlairs = buildWildcardRegexes(state.flairs);
    }

    function getFeedContext() {
        const url = new URL(window.location.href);
        url.searchParams.delete('count');
        url.searchParams.delete('after');
        url.searchParams.delete('before');
        url.searchParams.delete('page');
        return url.pathname.toLowerCase() + url.search;
    }

    // ==========================================
    // STORAGE MANAGEMENT
    // ==========================================

    function loadState() {
        try {
            const savedStr = sessionStorage.getItem(CONFIG.STORAGE_KEY);
            if (savedStr) {
                const parsed = JSON.parse(savedStr);
                state.dateFrom = parsed.dateFrom ?? null;
                state.dateTo = parsed.dateTo ?? null;

                const currentContext = getFeedContext();
                const isSameContext = (parsed.feedContext === currentContext);
                state.minScore = isSameContext ? (parsed.minScore ?? 0) : 0;
                state.isMaxScoreLocked = isSameContext ? (parsed.isMaxScoreLocked ?? false) : false;
                state.maxScore = state.isMaxScoreLocked ? (parsed.maxScore ?? 0) : 0;

                state.highestObservedScore = CONFIG.DEFAULT_MAX_SCORE;
                state.feedContext = currentContext;

                state.hideUpvoted = parsed.hideUpvoted ?? false;
                state.showUpvoted = parsed.showUpvoted ?? false;
                state.hideDownvoted = parsed.hideDownvoted ?? false;
                state.showDownvoted = parsed.showDownvoted ?? false;
                state.hideDownloaded = parsed.hideDownloaded ?? false;
                state.showDownloaded = parsed.showDownloaded ?? false;
                state.hidePromoted = parsed.hidePromoted ?? false;
                state.hideAnnouncements = parsed.hideAnnouncements ?? false;
                state.postType = parsed.postType ?? 'all';
                state.showKeywords = parsed.showKeywords ?? '';
                state.showFlairs = parsed.showFlairs ?? '';
                state.keywords = parsed.keywords ?? '';
                state.flairs = parsed.flairs ?? '';
                state.highlightThreshold = parsed.highlightThreshold ?? null;
                state.highlightArchived = parsed.highlightArchived ?? true;
                state.isAdvancedOpen = parsed.isAdvancedOpen === true;
            }
        } catch (e) {
            console.warn('[Reddit Filter] Failed to parse session state, using defaults.', e);
        }
        compileAllRegexes();
    }

    function saveState() {
        try {
            const stateToSave = {
                dateFrom: state.dateFrom,
                dateTo: state.dateTo,
                minScore: state.minScore,
                maxScore: state.isMaxScoreLocked ? state.maxScore : null,
                isMaxScoreLocked: state.isMaxScoreLocked,
                feedContext: getFeedContext(),
                hideUpvoted: state.hideUpvoted,
                showUpvoted: state.showUpvoted,
                hideDownvoted: state.hideDownvoted,
                showDownvoted: state.showDownvoted,
                hideDownloaded: state.hideDownloaded,
                showDownloaded: state.showDownloaded,
                hidePromoted: state.hidePromoted,
                hideAnnouncements: state.hideAnnouncements,
                postType: state.postType,
                showKeywords: state.showKeywords,
                showFlairs: state.showFlairs,
                keywords: state.keywords,
                flairs: state.flairs,
                highlightThreshold: state.highlightThreshold,
                highlightArchived: state.highlightArchived,
                isAdvancedOpen: state.isAdvancedOpen
            };
            sessionStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(stateToSave));
        } catch (e) {
            console.error('[Reddit Filter] Failed to save session state:', e);
        }
    }

    // ==========================================
    // CORE FILTERING LOGIC
    // ==========================================

    function getPostData(postEl) {
        let cached = state.postCache.get(postEl);
        if (cached === undefined) {
            let timestamp = null;
            const timeEl = postEl.querySelector(CONFIG.SELECTORS.TIME_ELEMENT);
            if (timeEl && timeEl.getAttribute('datetime')) {
                timestamp = new Date(timeEl.getAttribute('datetime')).getTime();
            }

            const titleEl = postEl.querySelector(CONFIG.SELECTORS.TITLE_ELEMENT);
            const titleText = titleEl ? titleEl.textContent.toLowerCase() : '';
            const href = titleEl ? (titleEl.href || '').toLowerCase() : '';

            const flairEl = postEl.querySelector(CONFIG.SELECTORS.FLAIR_ELEMENT);
            const flairText = flairEl ? flairEl.textContent.toLowerCase() : '';

            const subEl = postEl.querySelector(CONFIG.SELECTORS.SUBREDDIT_LINK);
            const subreddit = subEl ? subEl.textContent.trim().replace(/^r\//i, '') : null;

            const isPromoted = postEl.classList.contains('promotedlink') || postEl.dataset.promoted === 'true';
            const isAnnouncement = postEl.querySelector(CONFIG.SELECTORS.ANNOUNCEMENT_TAG) !== null;
            const isTextPost = postEl.classList.contains('self');
            const isArchived = postEl.querySelector(CONFIG.SELECTORS.ARCHIVED_ARROW) !== null;

            let mediaType = 'other';
            if (isTextPost) {
                mediaType = 'text';
            } else if (href) {
                let extension = '';

                try {
                    const urlObj = new URL(href);
                    const pathname = urlObj.pathname.toLowerCase();
                    const extMatch = pathname.match(/\.([a-z0-9]+)$/i);
                    if (extMatch) {
                        extension = `.${extMatch[1]}`;
                    }

                    // Step 1: Explicit Extension Checking (Overrides Host)
                    if (extension) {
                        if (CONFIG.MEDIA_EXTENSIONS.VIDEOS.includes(extension)) {
                            mediaType = 'video';
                        } else if (CONFIG.MEDIA_EXTENSIONS.IMAGES.includes(extension)) {
                            mediaType = 'image';
                        }
                    }

                    // Step 2: Fallback to Domain Matching if extension isn't explicitly defined
                    if (mediaType === 'other' || !extension) {
                        if (CONFIG.MEDIA_HOSTS.VIDEOS.some(host => href.includes(host))) {
                            mediaType = 'video';
                        } else if (CONFIG.MEDIA_HOSTS.IMAGES.some(host => href.includes(host))) {
                            mediaType = 'image';
                        }
                    }
                } catch (e) {
                    // Fail-safe simple string search if URL parsing throws
                    if (CONFIG.MEDIA_HOSTS.VIDEOS.some(host => href.includes(host))) {
                        mediaType = 'video';
                    } else if (CONFIG.MEDIA_HOSTS.IMAGES.some(host => href.includes(host))) {
                        mediaType = 'image';
                    }
                }
            }

            cached = { timestamp, titleText, flairText, subreddit, isPromoted, isAnnouncement, mediaType, isArchived, iconInjected: false };
            state.postCache.set(postEl, cached);
        }

        const scoreEl = postEl.querySelector(CONFIG.SELECTORS.SCORE_ELEMENT);
        let score = 0;
        if (scoreEl) {
            score = parseInt(scoreEl.getAttribute('title') || scoreEl.textContent, 10) || 0;
        }

        const isUpvoted = postEl.querySelector(CONFIG.SELECTORS.UPVOTED_ARROW) !== null;
        const isDownvoted = postEl.querySelector(CONFIG.SELECTORS.DOWNVOTED_ARROW) !== null;
        const isDownloaded = postEl.classList.contains('xiv-downloaded');

        return { ...cached, score, isUpvoted, isDownvoted, isDownloaded };
    }

    function checkPostVisibility(postEl) {
        const data = getPostData(postEl);
        let isVisible = true;
        let isHighlighted = false;
        let isHighlightedArchived = false;

        if (isVisible && data.subreddit && state.hiddenSubreddits.has(data.subreddit)) isVisible = false;
        if (isVisible && state.hidePromoted && data.isPromoted) isVisible = false;
        if (isVisible && state.hideAnnouncements && data.isAnnouncement) isVisible = false;

        if (isVisible && state.postType !== 'all') {
            if (state.postType === 'text' && data.mediaType !== 'text') isVisible = false;
            if (state.postType === 'link' && data.mediaType === 'text') isVisible = false;
            if (state.postType === 'image' && data.mediaType !== 'image') isVisible = false;
            if (state.postType === 'video' && data.mediaType !== 'video') isVisible = false;
            if (state.postType === 'other' && data.mediaType !== 'other') isVisible = false;
        }

        const validMax = state.isMaxScoreLocked ? state.maxScore : null;
        if (isVisible && state.minScore > 0 && data.score < state.minScore) isVisible = false;
        if (isVisible && validMax !== null && data.score > validMax) isVisible = false;

        if (isVisible && state.hideUpvoted && data.isUpvoted) isVisible = false;
        if (isVisible && state.hideDownvoted && data.isDownvoted) isVisible = false;
        if (isVisible && state.hideDownloaded && data.isDownloaded) isVisible = false;

        if (isVisible && (state.showUpvoted || state.showDownvoted || state.showDownloaded)) {
            const matchesShowUp = state.showUpvoted && data.isUpvoted;
            const matchesShowDown = state.showDownvoted && data.isDownvoted;
            const matchesShowDl = state.showDownloaded && data.isDownloaded;
            if (!matchesShowUp && !matchesShowDown && !matchesShowDl) {
                isVisible = false;
            }
        }

        if (isVisible && data.timestamp) {
            if (state.dateFrom && data.timestamp < state.dateFrom) isVisible = false;
            if (state.dateTo && data.timestamp > state.dateTo) isVisible = false;
        }

        if (isVisible && state.compiledShowKeywords.length > 0) {
            let matchedKeyword = false;
            for (const kwRegex of state.compiledShowKeywords) {
                if (kwRegex.test(data.titleText)) {
                    matchedKeyword = true;
                    break;
                }
            }
            if (!matchedKeyword) isVisible = false;
        }

        if (isVisible && state.compiledShowFlairs.length > 0) {
            let matchedFlair = false;
            if (data.flairText) {
                for (const flRegex of state.compiledShowFlairs) {
                    if (flRegex.test(data.flairText)) {
                        matchedFlair = true;
                        break;
                    }
                }
            }
            if (!matchedFlair) isVisible = false;
        }

        if (isVisible && state.compiledKeywords.length > 0) {
            for (const kwRegex of state.compiledKeywords) {
                if (kwRegex.test(data.titleText)) {
                    isVisible = false;
                    break;
                }
            }
        }

        if (isVisible && state.compiledFlairs.length > 0 && data.flairText) {
            for (const flRegex of state.compiledFlairs) {
                if (flRegex.test(data.flairText)) {
                    isVisible = false;
                    break;
                }
            }
        }

        if (isVisible && state.highlightThreshold !== null && data.score >= state.highlightThreshold) {
            isHighlighted = true;
        }

        if (isVisible && state.highlightArchived && data.isArchived) {
            isHighlightedArchived = true;
        }

        return { isVisible, isHighlighted, isHighlightedArchived, subreddit: data.subreddit, score: data.score, mediaType: data.mediaType, iconInjected: data.iconInjected };
    }

    function executeFilter() {
        if (state.isMutating) return;
        state.isMutating = true;
        requestAnimationFrame(() => {
            const selector = state.needsFullReeval ? CONFIG.SELECTORS.POST_ITEM : `${CONFIG.SELECTORS.POST_ITEM}:not([data-xiv-eval="true"])`;
            const postsToProcess = document.querySelectorAll(selector);

            const updates = [];
            let newlyProcessed = 0;
            let newlyVisible = 0;
            let discoveredNewSubreddits = false;
            let currentParseHighest = state.highestObservedScore;

            if (state.needsFullReeval) {
                state.totalPosts = 0;
                state.visiblePosts = 0;
            }

            postsToProcess.forEach(post => {
                const { isVisible, isHighlighted, isHighlightedArchived, subreddit, score, mediaType, iconInjected } = checkPostVisibility(post);

                if (score > currentParseHighest) {
                    currentParseHighest = score;
                }

                if (subreddit && !state.knownSubreddits.has(subreddit)) {
                    state.knownSubreddits.add(subreddit);
                    state.sortedSubreddits.push(subreddit);
                    state.sortedSubreddits.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
                    discoveredNewSubreddits = true;
                }

                updates.push({ post, isVisible, isHighlighted, isHighlightedArchived, mediaType, iconInjected });
                if (state.needsFullReeval) {
                    state.totalPosts++;
                    if (isVisible) state.visiblePosts++;
                } else {
                    newlyProcessed++;
                    if (isVisible) newlyVisible++;
                }
            });

            if (!state.needsFullReeval) {
                state.totalPosts += newlyProcessed;
                state.visiblePosts += newlyVisible;
            }

            if (currentParseHighest > state.highestObservedScore) {
                state.highestObservedScore = currentParseHighest;
                if (!state.isMaxScoreLocked) {
                    state.maxScore = currentParseHighest;
                }
                syncScoreUI();
            }

            // Phase 2: Write mutations
            updates.forEach(({ post, isVisible, isHighlighted, isHighlightedArchived, mediaType, iconInjected }) => {
                if (!isVisible) {
                    const expando = post.querySelector(CONFIG.SELECTORS.EXPANDO_EXPANDED);
                    if (expando) {
                        expando.click();
                    }
                }

                post.classList.toggle('xiv-hidden', !isVisible);
                post.classList.toggle('xiv-highlight', isHighlighted);
                post.classList.toggle('xiv-highlight-archived', isHighlightedArchived);

                if (post.parentElement && post.parentElement.classList.contains('spacer')) {
                    post.parentElement.classList.toggle('xiv-hidden', !isVisible);
                }

                if (!iconInjected) {
                    const domainEl = post.querySelector(CONFIG.SELECTORS.DOMAIN);
                    if (domainEl) {
                        const icon = createTypeIcon(mediaType);
                        domainEl.appendChild(icon);
                    }
                    const cached = state.postCache.get(post);
                    if (cached) cached.iconInjected = true;
                }

                post.dataset.xivEval = 'true';
            });

            if (discoveredNewSubreddits || state.needsFullReeval) {
                updateSubredditDropdownUI();
            }

            state.needsFullReeval = false;

            saveState();
            updateUIState();
            setTimeout(() => { state.isMutating = false; }, 0);
        });
    }

    function queueFilter(fullReeval = false) {
        if (fullReeval) state.needsFullReeval = true;
        clearTimeout(state.debounceTimer);
        state.debounceTimer = setTimeout(executeFilter, CONFIG.DEBOUNCE_MS);
    }

    function syncScoreUI() {
        const trackMax = Math.max(CONFIG.DEFAULT_MAX_SCORE, state.highestObservedScore, state.isMaxScoreLocked ? state.maxScore : 0);
        const currentMax = state.isMaxScoreLocked ? state.maxScore : state.highestObservedScore;

        const inputMin = document.getElementById(CONFIG.IDS.MIN_INPUT);
        const inputMax = document.getElementById(CONFIG.IDS.MAX_INPUT);
        const rangeMin = document.getElementById(CONFIG.IDS.MIN_RANGE);
        const rangeMax = document.getElementById(CONFIG.IDS.MAX_RANGE);
        const fill = document.getElementById(CONFIG.IDS.TRACK_FILL);
        const lockIconWrapper = document.getElementById(CONFIG.IDS.LOCK_ICON);

        if (inputMin && document.activeElement !== inputMin) inputMin.value = state.minScore;
        if (inputMax && document.activeElement !== inputMax) inputMax.value = currentMax;

        if (rangeMin && rangeMax) {
            rangeMin.max = trackMax;
            rangeMax.max = trackMax;
            rangeMin.value = state.minScore;
            rangeMax.value = currentMax;

            if (state.minScore > (trackMax / 2)) {
                rangeMin.style.zIndex = '3';
                rangeMax.style.zIndex = '2';
            } else {
                rangeMin.style.zIndex = '2';
                rangeMax.style.zIndex = '3';
            }
        }

        if (fill) {
            const minPct = (state.minScore / trackMax) * 100;
            const maxPct = (currentMax / trackMax) * 100;
            fill.style.left = `${minPct}%`;
            fill.style.width = `${Math.max(0, maxPct - minPct)}%`;
        }

        if (lockIconWrapper) {
            lockIconWrapper.style.display = state.isMaxScoreLocked ? 'flex' : 'none';
        }
    }

    function resetFilters() {
        CONFIG.IDS.TEXT_INPUTS.forEach(id => {
            const element = document.getElementById(id);
            if (element) element.value = '';
        });

        CONFIG.IDS.CB_INPUTS.forEach(id => {
            const element = document.getElementById(id);
            if (element) element.checked = false;
        });

        const cbArchived = document.getElementById(CONFIG.IDS.ARCHIVED_CB);
        if (cbArchived) cbArchived.checked = true;

        state.postType = 'all';
        const typeBtnText = document.getElementById(CONFIG.IDS.TYPE_BTN_TEXT);
        if (typeBtnText) typeBtnText.textContent = 'All';

        const typeMenu = document.getElementById(CONFIG.IDS.TYPE_MENU);
        if (typeMenu) {
            Array.from(typeMenu.children).forEach(c => {
                if (c.dataset.value === 'all') c.classList.add('active');
                else c.classList.remove('active');
            });
        }

        state.minScore = 0;
        state.isMaxScoreLocked = false;
        state.maxScore = state.highestObservedScore;

        state.dateFrom = null;
        state.dateTo = null;
        state.hideUpvoted = false;
        state.showUpvoted = false;
        state.hideDownvoted = false;
        state.showDownvoted = false;
        state.hideDownloaded = false;
        state.showDownloaded = false;
        state.hidePromoted = false;
        state.hideAnnouncements = false;
        state.showKeywords = '';
        state.showFlairs = '';
        state.keywords = '';
        state.flairs = '';

        compileAllRegexes();

        state.highlightThreshold = null;
        state.highlightArchived = true;
        state.hiddenSubreddits.clear();

        updateSubredditDropdownUI();
        syncScoreUI();
        queueFilter(true);
    }

    // ==========================================
    // DOM OBSERVER & SYSTEM RESILIENCE
    // ==========================================

    function setupObserver() {
        const observer = new MutationObserver(mutations => {
            let hasNewPosts = false;
            let sentinelMissing = false;

            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.matches(CONFIG.SELECTORS.POST_ITEM) || node.querySelector(CONFIG.SELECTORS.POST_ITEM)) {
                                 hasNewPosts = true;
                            }
                        }
                    }
                 }
            }

            if (!document.getElementById(CONFIG.IDS.SENTINEL)) {
                sentinelMissing = true;
            }

            if (sentinelMissing) {
                 setupInfiniteScrollSentinel();
            }

            const isClassMutation = mutations.some(m => m.type === 'attributes' && m.attributeName === 'class' && m.target.matches(CONFIG.SELECTORS.POST_ITEM));

            if (hasNewPosts || isClassMutation) {
                queueFilter(isClassMutation);
            }
        });

        if (DOM.siteTable) {
            observer.observe(DOM.siteTable, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        } else {
            observer.observe(DOM.mainContent, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        }

        DOM.siteTable.addEventListener('click', (e) => {
            if (e.target.matches('.arrow') || e.target.closest('.xiv-download-btn')) {
                setTimeout(() => queueFilter(true), 50);
            }
        });

        document.addEventListener('click', (e) => {
            const typeMenu = document.getElementById(CONFIG.IDS.TYPE_MENU);
            const typeBtn = document.getElementById(CONFIG.IDS.TYPE_BTN);
            if (typeMenu && typeBtn && !e.target.closest(`#${CONFIG.IDS.TYPE_MENU}`) && !e.target.closest(`#${CONFIG.IDS.TYPE_BTN}`)) {
                typeMenu.classList.remove('open');
                typeBtn.classList.remove('open');
            }

            const subMenu = document.getElementById(CONFIG.IDS.SUB_MENU);
            const subBtn = document.getElementById(CONFIG.IDS.SUB_BTN);
            if (subMenu && subBtn && !e.target.closest(`#${CONFIG.IDS.SUB_MENU}`) && !e.target.closest(`#${CONFIG.IDS.SUB_BTN}`)) {
                subMenu.classList.remove('open');
                subBtn.classList.remove('open');
            }
        });
    }

    function setupInfiniteScrollSentinel() {
        if (state.io) state.io.disconnect();

        const existing = document.getElementById(CONFIG.IDS.SENTINEL);
        if (existing) existing.remove();

        const sentinel = el('div', { id: CONFIG.IDS.SENTINEL, style: 'height: 1px; width: 100%; clear: left;' });
        if (DOM.siteTable) DOM.siteTable.appendChild(sentinel);

        state.io = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && state.visiblePosts < state.totalPosts) {
                window.dispatchEvent(new CustomEvent('scroll'));
            }
        }, { rootMargin: CONFIG.SCROLL_MARGIN });

        state.io.observe(sentinel);
    }

    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.altKey && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                const minInput = document.getElementById(CONFIG.IDS.MIN_INPUT);
                if (minInput) minInput.focus();
             }
        });
    }

    // ==========================================
    // STYLING & UI INJECTION
    // ==========================================

    function injectStyles() {
        if (document.getElementById('xiv-styles')) return;
        const css = `
            :root {
                --xiv-highlight-color: rgba(255, 215, 0, 0.8);
                --xiv-highlight-bg: rgba(255, 215, 0, 0.1);
                --xiv-archived-color: #ff4a08;
                --xiv-archived-bg: rgba(255, 74, 8, 0.20);
                --xiv-active-color: #28a745;
            }

            .xiv-panel-container {
                user-select: none;
                -webkit-user-select: none;
            }

            .xiv-panel-container input {
                user-select: auto;
                -webkit-user-select: auto;
            }

            .xiv-hidden,
            .xiv-hidden + .child,
            .xiv-hidden + .child + .clearleft,
            .xiv-hidden + .clearleft {
                display: none !important;
            }

            .xiv-highlight {
                border-left: 4px solid var(--xiv-highlight-color) !important;
                background-color: var(--xiv-highlight-bg) !important;
                border-radius: 3px;
                padding-left: 8px !important;
            }

            .xiv-highlight-archived {
                border-left: 4px solid var(--xiv-archived-color) !important;
                background-color: var(--xiv-archived-bg) !important;
                border-radius: 3px;
                padding-left: 8px !important;
            }

            .xiv-type-icon {
                display: inline-block;
                vertical-align: middle;
                position: relative;
                top: -1px;
                margin-left: 4px;
                color: inherit;
            }

            .xiv-section { padding-bottom: 0.75rem; margin-bottom: 0.75rem; }
            .xiv-split-row { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; width: 100%; }
            .xiv-split-col { flex: 1; display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
            .xiv-row { display: flex; flex-direction: column; margin-bottom: 0.75rem; gap: 0.25rem; }

            .xiv-score-container { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.75rem; }
            .xiv-score-labels { display: flex; justify-content: space-between; align-items: center; padding: 0; }
            .xiv-slider-row { display: flex; align-items: center; gap: 8px; }
            .xiv-score-input {
                width: 48px; background-color: transparent; color: inherit;
                border: 1px solid currentColor; opacity: 0.5; border-radius: 3px;
                padding: 4px; text-align: center; font-size: 0.8rem; font-family: inherit;
                -moz-appearance: textfield; transition: opacity 0.2s;
            }
            .xiv-score-input::-webkit-outer-spin-button,
            .xiv-score-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
            .xiv-score-input:focus { opacity: 1; outline: none; }
            .xiv-range-wrapper { position: relative; flex: 1; height: 20px; display: flex; align-items: center; color: inherit; cursor: pointer; }
            .xiv-track-bg { position: absolute; width: 100%; height: 4px; background-color: currentColor; opacity: 0.3; border-radius: 2px; top: 50%; transform: translateY(-50%); pointer-events: none; }
            .xiv-track-fill { position: absolute; height: 4px; background-color: currentColor; opacity: 0.85; border-radius: 2px; top: 50%; transform: translateY(-50%); pointer-events: none; }
            .xiv-range-input { position: absolute; width: 100%; -webkit-appearance: none; background: transparent; pointer-events: none; margin: 0; top: 50%; transform: translateY(-50%); color: inherit; }
            .xiv-range-input::-webkit-slider-thumb { pointer-events: auto; -webkit-appearance: none; height: 14px; width: 14px; border-radius: 50%; background-color: currentColor; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1); }
            .xiv-range-input::-moz-range-thumb { pointer-events: auto; height: 14px; width: 14px; border-radius: 50%; background-color: currentColor; cursor: pointer; border: none; box-shadow: 0 1px 3px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1); }

            .xiv-dropdown { position: relative; width: 100%; }
            .xiv-sub-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem; }
            .xiv-dropdown-btn { cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none; overflow: hidden; transition: border-radius 0.2s; color: inherit; }
            .xiv-dropdown-btn.open { border-bottom-left-radius: 0; border-bottom-right-radius: 0; border-bottom-color: transparent; }
            .xiv-dropdown-btn:focus { outline: none; border-color: rgba(128, 128, 128, 0.8); box-shadow: 0 0 0 2px rgba(128, 128, 128, 0.2); }
            .xiv-dropdown-btn-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 8px; }
            .xiv-dropdown-menu { display: none; width: 100%; border: 1px solid rgba(128, 128, 128, 0.3); border-top: none; border-bottom-left-radius: 0.2rem; border-bottom-right-radius: 0.2rem; box-sizing: border-box; background-color: transparent; color: inherit; }
            .xiv-dropdown-menu.open { display: block; }
            .xiv-sub-search { padding: 6px 8px; border-bottom: 1px solid rgba(128, 128, 128, 0.3); display: flex; align-items: center; gap: 8px; background-color: rgba(128, 128, 128, 0.05); }
            .xiv-sub-list { max-height: 40vh; overflow-y: auto; }

            .xiv-dropdown-item { padding: 6px 8px; display: flex; align-items: center; gap: 8px; font-size: 0.8rem; cursor: pointer; user-select: none; transition: background-color 0.2s; outline: none; }
            .xiv-dropdown-item:hover, .xiv-dropdown-item:focus { background-color: rgba(128, 128, 128, 0.1); }
            .xiv-dropdown-item.nested { padding-left: 1.75rem; }
            .xiv-dropdown-item.active { background-color: rgba(128, 128, 128, 0.15); font-weight: 600; }

            .xiv-inline-divider { display: flex; align-items: center; text-align: center; color: rgba(128, 128, 128, 0.8); font-size: 0.75rem; margin: 0 0 0.25rem 0; white-space: nowrap; text-transform: uppercase !important; letter-spacing: 0.5px; }
            .xiv-inline-divider::before, .xiv-inline-divider::after { content: ''; flex: 1; border-bottom: 1px solid rgba(128, 128, 128, 0.3); }
            .xiv-inline-divider::before { margin-right: .5em; }
            .xiv-inline-divider::after { margin-left: .5em; }

            .xiv-hr { border: none; border-bottom: 1px dashed rgba(128, 128, 128, 0.3); margin: 0.35rem 0; }
            .xiv-input-group { display: flex; align-items: stretch; width: 100%; }
            .xiv-grid-group { display: grid; grid-template-columns: max-content 1fr; row-gap: 0.25rem; width: 100%; }
            .xiv-input-prefix { display: flex; align-items: center; padding: 0 0.5rem; background-color: rgba(128, 128, 128, 0.1); border: 1px solid rgba(128, 128, 128, 0.3); border-right: none; border-top-left-radius: 0.2rem; border-bottom-left-radius: 0.2rem; font-size: 0.8rem; color: inherit; white-space: nowrap; box-sizing: border-box; }
            .xiv-input-group .xiv-input, .xiv-grid-group .xiv-input { border-top-left-radius: 0; border-bottom-left-radius: 0; flex: 1; }

            /* Native WebKit Search Cancel Button (Custom SVG Override) */
            .xiv-input[type="search"]::-webkit-search-cancel-button,
            #xiv-sub-search-input::-webkit-search-cancel-button {
                -webkit-appearance: none;
                appearance: none;
                height: 12px;
                width: 12px;
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888888' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cline x1='18' y1='6' x2='6' y2='18'%3E%3C/line%3E%3Cline x1='6' y1='6' x2='18' y2='18'%3E%3C/line%3E%3C/svg%3E");
                background-size: contain;
                background-repeat: no-repeat;
                background-position: center;
                cursor: pointer;
                opacity: 0.6;
                transition: opacity 0.2s;
            }
            .xiv-input[type="search"]::-webkit-search-cancel-button:hover,
            #xiv-sub-search-input::-webkit-search-cancel-button:hover {
                opacity: 1;
            }

            .xiv-label { font-size: 0.75rem; font-weight: 600; opacity: 0.95; white-space: nowrap; }
            .xiv-input { padding: 0.4rem 0.5rem; border: 1px solid rgba(128, 128, 128, 0.3); border-radius: 0.2rem; font-size: 0.8rem; width: 100%; box-sizing: border-box; font-family: inherit; background-color: transparent; color: inherit; transition: border-color 0.2s, box-shadow 0.2s; }
            .xiv-input:focus { outline: none; border-color: rgba(128, 128, 128, 0.8); box-shadow: 0 0 0 2px rgba(128, 128, 128, 0.2); }

            .xiv-checkbox-row { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.2rem; }
            .xiv-checkbox-row label { font-size: 0.8rem; cursor: pointer; opacity: 0.95; }

            .xiv-indicator { width: 8px; height: 8px; border-radius: 50%; background-color: var(--xiv-active-color); display: none; cursor: help; }
            .xiv-indicator.active { display: block; }
            .xiv-advanced-toggle { font-size: 0.75rem; cursor: pointer; text-align: center; padding: 0.4rem 0; font-weight: 600; user-select: none; border-radius: 0.2rem; transition: background-color 0.2s; margin-bottom: 0.5rem; opacity: 0.9; }
            .xiv-advanced-toggle:hover, .xiv-advanced-toggle:focus { background-color: rgba(128, 128, 128, 0.1); outline: none; }
            .xiv-advanced-container { display: none; }
            .xiv-advanced-container.open { display: block; }

            .xiv-reset { background: transparent; border: none; color: #d22; font-size: 0.75rem; cursor: pointer; padding: 0; font-weight: bold; opacity: 0; pointer-events: none; transition: opacity 0.2s ease; }
            .xiv-reset.visible { opacity: 1; pointer-events: auto; }
            .xiv-reset:hover { text-decoration: underline; }
            .xiv-empty-state { padding: 2rem; text-align: center; margin-bottom: 1rem; display: none; flex-direction: column; align-items: center; gap: 0.75rem; border: 2px dashed rgba(128, 128, 128, 0.3); border-radius: 4px; background-color: transparent; }
            .xiv-empty-state h3 { margin: 0; font-size: 1.1rem; opacity: 0.9; }
            .xiv-empty-state p { margin: 0; font-size: 0.85rem; opacity: 0.7; }
            .xiv-hint { font-size: 0.65rem; opacity: 0.6; font-weight: normal; margin-left: 4px; text-transform: none; }
        `;
        document.head.appendChild(el('style', { id: 'xiv-styles', textContent: css }));
    }

    function handleDropdownKeyboardNav(e, btn, menuElement) {
        if (e.key === 'Escape') {
            menuElement.classList.remove('open');
            btn.classList.remove('open');
            btn.focus();
            return;
        }

        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            btn.click();
            return;
        }

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!menuElement.classList.contains('open')) {
                btn.click();
            }
            const items = Array.from(menuElement.querySelectorAll('.xiv-dropdown-item'));
            if (!items.length) return;

            const currentIndex = items.indexOf(document.activeElement);
            let nextIndex = e.key === 'ArrowDown' ? currentIndex + 1 : currentIndex - 1;

            if (nextIndex < 0) nextIndex = items.length - 1;
            if (nextIndex >= items.length) nextIndex = 0;

            items[nextIndex]?.focus();
        }
    }

    function updateMasterCheckboxState() {
        const masterCb = document.getElementById(CONFIG.IDS.SUB_MASTER_CB);
        if (!masterCb) return;

        if (state.knownSubreddits.size <= 1) {
            masterCb.disabled = true;
            return;
        }

        masterCb.disabled = false;
        if (state.hiddenSubreddits.size === 0) {
            masterCb.checked = true;
            masterCb.indeterminate = false;
        } else if (state.hiddenSubreddits.size === state.knownSubreddits.size) {
            masterCb.checked = false;
            masterCb.indeterminate = false;
        } else {
            masterCb.checked = false;
            masterCb.indeterminate = true;
        }
    }

    function updateSubredditDropdownUI() {
        const list = document.getElementById(CONFIG.IDS.SUB_LIST);
        const btnText = document.getElementById(CONFIG.IDS.SUB_BTN_TEXT);
        const subBtn = document.getElementById(CONFIG.IDS.SUB_BTN);

        if (!list || !btnText || !subBtn) return;

        updateMasterCheckboxState();
        if (state.knownSubreddits.size <= 1) {
            btnText.textContent = 'No subreddits to filter';
            subBtn.style.pointerEvents = 'none';
            subBtn.style.opacity = '0.7';
            return;
        }

        subBtn.style.pointerEvents = 'auto';
        subBtn.style.opacity = '1';
        btnText.textContent = `Select Subreddits (${state.knownSubreddits.size - state.hiddenSubreddits.size} of ${state.knownSubreddits.size})`;

        if (list.children.length !== state.sortedSubreddits.length) {
            list.replaceChildren();
            state.sortedSubreddits.forEach(sub => {
                const checkbox = el('input', {
                    type: 'checkbox',
                    tabIndex: '-1',
                    checked: !state.hiddenSubreddits.has(sub),
                    onChange: (e) => {
                        if (e.target.checked) {
                            state.hiddenSubreddits.delete(sub);
                        } else {
                            state.hiddenSubreddits.add(sub);
                        }
                        btnText.textContent = `Select Subreddits (${state.knownSubreddits.size - state.hiddenSubreddits.size} of ${state.knownSubreddits.size})`;
                        updateMasterCheckboxState();
                        queueFilter(true);
                    }
                });

                const item = el('label', {
                    className: 'xiv-dropdown-item',
                    tabIndex: '-1',
                    onKeydown: (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            checkbox.click();
                        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Escape') {
                            const menu = document.getElementById(CONFIG.IDS.SUB_MENU);
                            handleDropdownKeyboardNav(e, subBtn, menu);
                        }
                    }
                }, [
                    checkbox,
                    el('span', { textContent: sub })
                ]);
                list.appendChild(item);
            });
        }

        const searchInput = document.getElementById(CONFIG.IDS.SUB_SEARCH);
        if (searchInput && searchInput.value) {
            const term = searchInput.value.toLowerCase();
            Array.from(list.children).forEach(child => {
                const text = child.textContent.toLowerCase();
                child.style.display = text.includes(term) ? 'flex' : 'none';
            });
        }
    }

    function generateTooltipText() {
        const active = [];

        if (state.minScore > 0) active.push(`Min Score: ${state.minScore}`);
        if (state.isMaxScoreLocked) active.push(`Max Score: ${state.maxScore}`);

        if (state.dateFrom || state.dateTo) {
            const from = state.dateFrom ? formatDateForInput(state.dateFrom) : 'Any';
            const to = state.dateTo ? formatDateForInput(state.dateTo) : 'Any';
            active.push(`Date: ${from} to ${to}`);
        }

        if (state.hiddenSubreddits.size > 0) active.push(`Blocked Subs: ${state.hiddenSubreddits.size}`);

        if (state.postType !== 'all') {
            const typeLabels = { text: 'Self/Text', link: 'Links', image: 'Images', video: 'Videos', other: 'Other Links' };
            active.push(`Post Type: ${typeLabels[state.postType] || state.postType}`);
        }

        if (state.hideUpvoted) active.push('Hidden: Upvoted');
        if (state.hideDownvoted) active.push('Hidden: Downvoted');
        if (state.hideDownloaded) active.push('Hidden: Downloaded');
        if (state.hidePromoted) active.push('Hidden: Promoted');
        if (state.hideAnnouncements) active.push('Hidden: Announcements');

        if (state.showUpvoted) active.push('Show Only: Upvoted');
        if (state.showDownvoted) active.push('Show Only: Downvoted');
        if (state.showDownloaded) active.push('Show Only: Downloaded');

        if (state.showKeywords) active.push(`Show Keywords: "${state.showKeywords}"`);
        if (state.showFlairs) active.push(`Show Flairs: "${state.showFlairs}"`);
        if (state.keywords) active.push(`Blocked Keywords: "${state.keywords}"`);
        if (state.flairs) active.push(`Blocked Flairs: "${state.flairs}"`);

        if (state.highlightThreshold !== null) active.push(`Highlight > ${state.highlightThreshold}`);

        return active.length ? `Active Filters:\n• ${active.join('\n• ')}` : 'Filters Active';
    }

    function updateUIState() {
        const headerTitle = document.getElementById(CONFIG.IDS.HEADER_TITLE);
        const resetBtn = document.getElementById(CONFIG.IDS.RESET_BTN);
        const indicator = document.getElementById(CONFIG.IDS.INDICATOR);
        const emptyState = document.getElementById(CONFIG.IDS.EMPTY_STATE);

        const active = isFilterActive();

        if (headerTitle) {
            if (active) {
                headerTitle.textContent = `${state.visiblePosts} / ${state.totalPosts}`;
            } else {
                headerTitle.textContent = 'POST FILTERS';
            }
        }

        if (resetBtn) resetBtn.classList.toggle('visible', active);

        if (indicator) {
            indicator.classList.toggle('active', active);
            indicator.title = active ? generateTooltipText() : '';
        }

        if (emptyState) {
            if (active && state.totalPosts > 0 && state.visiblePosts === 0) {
                emptyState.style.display = 'flex';
            } else {
                emptyState.style.display = 'none';
            }
        }
    }

    function buildUI() {
        const createInput = (id, type, placeholder, value, stateKey, parser, onUpdateHook = null) => {
            return el('input', {
                id: id,
                type: type,
                className: 'xiv-input',
                value: value !== null ? value : '',
                placeholder: placeholder,
                onInput: (e) => {
                    const parsed = parser(e.target.value);
                    state[stateKey] = parsed;
                    if (onUpdateHook) onUpdateHook();
                    queueFilter(true);
                }
            });
        };

        const createCheckbox = (id, labelText, stateKey, customOnChange = null) => {
            return el('div', { className: 'xiv-checkbox-row' }, [
                el('input', {
                    id: id, type: 'checkbox', checked: state[stateKey],
                    onChange: customOnChange || ((e) => { state[stateKey] = e.target.checked; queueFilter(true); })
                }),
                el('label', { htmlFor: id, textContent: labelText })
            ]);
        };

        const createExclusiveCheckbox = (id, labelText, stateKey, oppStateKey, oppId) => {
            return createCheckbox(id, labelText, stateKey, (e) => {
                state[stateKey] = e.target.checked;
                if (state[stateKey] && oppStateKey && oppId) {
                    state[oppStateKey] = false;
                    const oppCb = document.getElementById(oppId);
                    if (oppCb) oppCb.checked = false;
                }
                queueFilter(true);
            });
        };

        const createInlineDivider = (text, customStyle = '') => {
            return el('div', { className: 'xiv-inline-divider', style: customStyle, textContent: text });
        };

        const onMinChange = (e) => {
            let val = parseInt(e.target.value, 10) || 0;
            const currentMax = state.isMaxScoreLocked ? state.maxScore : state.highestObservedScore;
            val = Math.min(val, currentMax);
            state.minScore = Math.max(0, val);
            syncScoreUI();
            queueFilter(true);
        };

        const onMaxChange = (e) => {
            let val = parseInt(e.target.value, 10) || 0;
            val = Math.max(val, state.minScore);
            state.maxScore = val;
            state.isMaxScoreLocked = true;
            syncScoreUI();
            queueFilter(true);
        };

        const inputMinScore = el('input', { id: CONFIG.IDS.MIN_INPUT, type: 'number', className: 'xiv-score-input', min: 0, value: state.minScore, onInput: onMinChange });
        const inputMaxScore = el('input', { id: CONFIG.IDS.MAX_INPUT, type: 'number', className: 'xiv-score-input', min: 0, value: state.maxScore, onInput: onMaxChange });

        const rangeMin = el('input', { id: CONFIG.IDS.MIN_RANGE, type: 'range', className: 'xiv-range-input', min: 0, onInput: onMinChange });
        const rangeMax = el('input', { id: CONFIG.IDS.MAX_RANGE, type: 'range', className: 'xiv-range-input', min: 0, onInput: onMaxChange });

        const rangeWrapper = el('div', { className: 'xiv-range-wrapper' }, [
            el('div', { className: 'xiv-track-bg' }),
            el('div', { id: CONFIG.IDS.TRACK_FILL, className: 'xiv-track-fill' }),
            rangeMin,
            rangeMax
        ]);

        rangeWrapper.addEventListener('click', (e) => {
            if (e.target.tagName.toLowerCase() === 'input') return;

            const rect = rangeWrapper.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const pct = Math.max(0, Math.min(1, clickX / rect.width));

            const trackMax = Math.max(CONFIG.DEFAULT_MAX_SCORE, state.highestObservedScore, state.isMaxScoreLocked ? state.maxScore : 0);
            const currentMax = state.isMaxScoreLocked ? state.maxScore : state.highestObservedScore;
            const clickedVal = Math.round(pct * trackMax);

            if (clickedVal < state.minScore) {
                state.minScore = clickedVal;
            } else if (clickedVal > currentMax) {
                state.maxScore = clickedVal;
                state.isMaxScoreLocked = true;
            } else {
                const distMin = Math.abs(clickedVal - state.minScore);
                const distMax = Math.abs(clickedVal - currentMax);

                if (distMin <= distMax) {
                    state.minScore = clickedVal;
                } else {
                    state.maxScore = clickedVal;
                    state.isMaxScoreLocked = true;
                }
            }

            syncScoreUI();
            queueFilter(true);
        });

        // SVG Icon generation built once
        const svgNS = "http://www.w3.org/2000/svg";
        const lockSvg = document.createElementNS(svgNS, "svg");
        lockSvg.setAttribute("viewBox", "0 0 24 24");
        lockSvg.setAttribute("width", "12");
        lockSvg.setAttribute("height", "12");
        lockSvg.setAttribute("fill", "currentColor");
        const lockPath = document.createElementNS(svgNS, "path");
        lockPath.setAttribute("d", CONFIG.ASSETS.SVG_LOCK_PATH);
        lockSvg.appendChild(lockPath);

        const lockIconWrapper = el('span', {
            id: CONFIG.IDS.LOCK_ICON,
            style: 'display: none; cursor: pointer; align-items: center;',
            title: 'Click to unlock Max Score',
            onClick: () => {
                state.isMaxScoreLocked = false;
                state.maxScore = state.highestObservedScore;
                syncScoreUI();
                queueFilter(true);
            }
        });
        lockIconWrapper.appendChild(lockSvg);

        const maxLabelContainer = el('div', { style: 'display: flex; align-items: center; gap: 2px;' }, [
            lockIconWrapper,
            el('label', { className: 'xiv-label', style: 'margin: 0;', textContent: 'MAX' })
        ]);

        const scoreContainer = el('div', { className: 'xiv-score-container' }, [
            createInlineDivider('Score'),
            el('div', { className: 'xiv-score-labels' }, [
                el('label', { className: 'xiv-label', style: 'margin: 0;', textContent: 'MIN' }),
                maxLabelContainer
            ]),
            el('div', { className: 'xiv-slider-row' }, [
                inputMinScore,
                rangeWrapper,
                inputMaxScore
            ])
        ]);

        const inputDateFrom = el('input', {
            id: 'xiv-date-from', type: 'date', className: 'xiv-input',
            value: formatDateForInput(state.dateFrom),
            onChange: (e) => { state.dateFrom = parseInputDateToLocal(e.target.value, false); queueFilter(true); }
        });

        const inputDateTo = el('input', {
            id: 'xiv-date-to', type: 'date', className: 'xiv-input',
            value: formatDateForInput(state.dateTo),
            onChange: (e) => { state.dateTo = parseInputDateToLocal(e.target.value, true); queueFilter(true); }
        });

        const dateRangeSection = el('div', { className: 'xiv-row', style: 'margin-bottom: 0;' }, [
            createInlineDivider('Date Range'),
            el('div', { className: 'xiv-grid-group' }, [
                el('span', { className: 'xiv-input-prefix', textContent: 'From' }),
                inputDateFrom,
                el('span', { className: 'xiv-input-prefix', textContent: 'To' }),
                inputDateTo
            ])
        ]);

        const filtersSection = el('div', { className: 'xiv-section', style: 'border-bottom: 1px dashed rgba(128,128,128,0.3);' }, [
            scoreContainer,
            dateRangeSection
        ]);

        const subSearchInput = el('input', {
            id: CONFIG.IDS.SUB_SEARCH,
            type: 'search',
            placeholder: 'Search subreddits...',
            style: 'flex: 1; box-sizing: border-box; border: none; background: transparent; outline: none; color: inherit; font-family: inherit; font-size: 0.8rem; padding: 2px 0; min-width: 0;',
            onInput: (e) => {
                const term = e.target.value.toLowerCase();
                const list = document.getElementById(CONFIG.IDS.SUB_LIST);
                if (list) {
                    Array.from(list.children).forEach(child => {
                        const text = child.textContent.toLowerCase();
                        child.style.display = text.includes(term) ? 'flex' : 'none';
                    });
                }
            }
        });

        const masterCheckbox = el('input', {
            type: 'checkbox',
            id: CONFIG.IDS.SUB_MASTER_CB,
            title: 'Select/Deselect All',
            style: 'cursor: pointer; margin: 0;',
            onChange: (e) => {
                const list = document.getElementById(CONFIG.IDS.SUB_LIST);
                if (e.target.checked) {
                    state.hiddenSubreddits.clear();
                } else {
                    state.knownSubreddits.forEach(sub => state.hiddenSubreddits.add(sub));
                }

                if (list) {
                    const checkboxes = list.querySelectorAll('input[type="checkbox"]');
                    checkboxes.forEach(cb => {
                        cb.checked = e.target.checked;
                    });
                }

                const btnText = document.getElementById(CONFIG.IDS.SUB_BTN_TEXT);
                if (btnText) {
                    btnText.textContent = `Select Subreddits (${state.knownSubreddits.size - state.hiddenSubreddits.size} of ${state.knownSubreddits.size})`;
                }

                queueFilter(true);
            }
        });

        const subDropdownMenu = el('div', { id: CONFIG.IDS.SUB_MENU, className: 'xiv-dropdown-menu' }, [
            el('div', { className: 'xiv-sub-search' }, [
                el('label', { title: 'Select/Deselect All', style: 'display: flex; align-items: center; cursor: pointer; margin: 0;' }, [masterCheckbox]),
                subSearchInput
            ]),
            el('div', { id: CONFIG.IDS.SUB_LIST, className: 'xiv-sub-list' })
        ]);

        const subDropdownBtn = el('div', {
            id: CONFIG.IDS.SUB_BTN,
            className: 'xiv-input xiv-dropdown-btn',
            tabIndex: '0',
            onKeydown: (e) => handleDropdownKeyboardNav(e, document.getElementById(CONFIG.IDS.SUB_BTN), document.getElementById(CONFIG.IDS.SUB_MENU))
        }, [
            el('span', { id: CONFIG.IDS.SUB_BTN_TEXT, className: 'xiv-dropdown-btn-text', textContent: 'Scanning subreddits...' }),
            el('span', { textContent: '▼', style: 'font-size: 0.6rem; opacity: 0.7;' })
        ]);

        subDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.knownSubreddits.size <= 1) return;
            const menu = document.getElementById(CONFIG.IDS.SUB_MENU);
            const btn = document.getElementById(CONFIG.IDS.SUB_BTN);

            const typeMenu = document.getElementById(CONFIG.IDS.TYPE_MENU);
            const typeBtn = document.getElementById(CONFIG.IDS.TYPE_BTN);
            if (typeMenu) typeMenu.classList.remove('open');
            if (typeBtn) typeBtn.classList.remove('open');

            menu.classList.toggle('open');
            btn.classList.toggle('open');
            if (menu.classList.contains('open')) {
                document.getElementById(CONFIG.IDS.SUB_SEARCH).focus();
            }
        });

        const subHeader = el('div', { className: 'xiv-sub-header' }, [
            el('label', { className: 'xiv-label', textContent: 'Subreddit Filter' })
        ]);

        const subDropdownContainer = el('div', { className: 'xiv-dropdown xiv-row' }, [
            subHeader,
            el('div', { style: 'display: flex; flex-direction: column;' }, [
                subDropdownBtn,
                subDropdownMenu
            ])
        ]);

        const typeOptions = [
            { value: 'all', label: 'All' },
            { value: 'text', label: 'Self/Text' },
            { value: 'link', label: 'Links' },
            { value: 'image', label: 'Images', nested: true },
            { value: 'video', label: 'Videos', nested: true },
            { value: 'other', label: 'Other', nested: true }
        ];

        const initialOpt = typeOptions.find(o => o.value === state.postType) || typeOptions[0];
        const typeBtnText = el('span', { id: CONFIG.IDS.TYPE_BTN_TEXT, className: 'xiv-dropdown-btn-text', textContent: initialOpt.label });

        const typeDropdownBtn = el('div', {
            id: CONFIG.IDS.TYPE_BTN,
            className: 'xiv-input xiv-dropdown-btn',
            tabIndex: '0',
            onKeydown: (e) => handleDropdownKeyboardNav(e, document.getElementById(CONFIG.IDS.TYPE_BTN), document.getElementById(CONFIG.IDS.TYPE_MENU))
        }, [
            typeBtnText,
            el('span', { textContent: '▼', style: 'font-size: 0.6rem; opacity: 0.7;' })
        ]);

        const typeDropdownMenu = el('div', { id: CONFIG.IDS.TYPE_MENU, className: 'xiv-dropdown-menu' });

        typeOptions.forEach(opt => {
            const item = el('div', {
                className: `xiv-dropdown-item ${opt.nested ? 'nested' : ''} ${state.postType === opt.value ? 'active' : ''}`,
                textContent: opt.label,
                'data-value': opt.value,
                tabIndex: '-1',
                onClick: (e) => {
                    e.stopPropagation();
                    state.postType = opt.value;
                    typeBtnText.textContent = opt.label;

                    Array.from(typeDropdownMenu.children).forEach(c => c.classList.remove('active'));
                    item.classList.add('active');

                    typeDropdownMenu.classList.remove('open');
                    typeDropdownBtn.classList.remove('open');
                    queueFilter(true);
                },
                onKeydown: (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        item.click();
                    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Escape') {
                        handleDropdownKeyboardNav(e, typeDropdownBtn, typeDropdownMenu);
                    }
                }
            });
            typeDropdownMenu.appendChild(item);
        });

        typeDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            const subMenu = document.getElementById(CONFIG.IDS.SUB_MENU);
            const subBtn = document.getElementById(CONFIG.IDS.SUB_BTN);
            if (subMenu) subMenu.classList.remove('open');
            if (subBtn) subBtn.classList.remove('open');

            typeDropdownMenu.classList.toggle('open');
            typeDropdownBtn.classList.toggle('open');
        });

        const typeSelectRow = el('div', { className: 'xiv-dropdown xiv-row', style: 'margin-bottom: 0;' }, [
            el('div', { className: 'xiv-sub-header' }, [
                el('label', { className: 'xiv-label', textContent: 'Post Type' })
            ]),
            el('div', { style: 'display: flex; flex-direction: column;' }, [
                typeDropdownBtn,
                typeDropdownMenu
            ])
        ]);

        const postTypeSection = el('div', { className: 'xiv-section' }, [
            subDropdownContainer,
            typeSelectRow
        ]);

        const inputHighlight = createInput('xiv-highlight', 'number', '5000', state.highlightThreshold, 'highlightThreshold', v => v.trim() === '' ? null : (parseInt(v, 10) || 0));
        inputHighlight.setAttribute('min', '0');

        const highlightThresholdRow = el('div', { className: 'xiv-row', style: 'margin-bottom: 0.5rem;' }, [
            el('div', { className: 'xiv-input-group' }, [
                el('span', { className: 'xiv-input-prefix', textContent: 'Highlight score >' }),
                inputHighlight
            ])
        ]);

        const interactionSection = el('div', { className: 'xiv-section', style: 'margin-bottom: 0;' }, [
            highlightThresholdRow,
            createCheckbox(CONFIG.IDS.ARCHIVED_CB, 'Highlight archived', 'highlightArchived'),
            el('hr', { className: 'xiv-hr' }),
            el('div', { style: 'display: flex; flex-direction: column; gap: 0.15rem; margin-top: 0.2rem;' }, [
                createExclusiveCheckbox('xiv-hide-upvoted', 'Hide upvoted', 'hideUpvoted', 'showUpvoted', 'xiv-show-upvoted'),
                createExclusiveCheckbox('xiv-hide-downvoted', 'Hide downvoted', 'hideDownvoted', 'showDownvoted', 'xiv-show-downvoted'),
                createExclusiveCheckbox('xiv-hide-downloaded', 'Hide downloaded', 'hideDownloaded', 'showDownloaded', 'xiv-show-downloaded'),
                createCheckbox('xiv-hide-announcements', 'Hide announcement', 'hideAnnouncements'),
                createCheckbox('xiv-hide-promoted', 'Hide promoted', 'hidePromoted')
            ]),
            el('hr', { className: 'xiv-hr' }),
            el('div', { style: 'display: flex; flex-direction: column; gap: 0.15rem;' }, [
                createExclusiveCheckbox('xiv-show-upvoted', 'Show upvoted', 'showUpvoted', 'hideUpvoted', 'xiv-hide-upvoted'),
                createExclusiveCheckbox('xiv-show-downvoted', 'Show downvoted', 'showDownvoted', 'hideDownvoted', 'xiv-hide-downvoted'),
                createExclusiveCheckbox('xiv-show-downloaded', 'Show downloaded', 'showDownloaded', 'hideDownloaded', 'xiv-hide-downloaded')
            ])
        ]);

        const showOnlySection = el('div', { className: 'xiv-row', style: 'margin-bottom: 0.75rem;' }, [
            el('label', { className: 'xiv-label', textContent: 'Show Only' }),
            el('div', { className: 'xiv-grid-group' }, [
                el('span', { className: 'xiv-input-prefix', textContent: 'Keywords' }),
                createInput('xiv-show-keywords', 'search', 'e.g. megathread, offi*', state.showKeywords, 'showKeywords', v => v, () => state.compiledShowKeywords = buildWildcardRegexes(state.showKeywords)),
                el('span', { className: 'xiv-input-prefix', textContent: 'Flairs' }),
                createInput('xiv-show-flairs', 'search', 'e.g. news, *event*', state.showFlairs, 'showFlairs', v => v, () => state.compiledShowFlairs = buildWildcardRegexes(state.showFlairs))
            ])
        ]);

        const blockSection = el('div', { className: 'xiv-row', style: 'margin-bottom: 0;' }, [
            el('label', { className: 'xiv-label', textContent: 'Block' }),
            el('div', { className: 'xiv-grid-group' }, [
                el('span', { className: 'xiv-input-prefix', textContent: 'Keywords' }),
                createInput('xiv-keywords', 'search', 'e.g. politics, spoil*', state.keywords, 'keywords', v => v, () => state.compiledKeywords = buildWildcardRegexes(state.keywords)),
                el('span', { className: 'xiv-input-prefix', textContent: 'Flairs' }),
                createInput('xiv-flairs', 'search', 'e.g. meme, *rant*', state.flairs, 'flairs', v => v, () => state.compiledFlairs = buildWildcardRegexes(state.flairs))
            ])
        ]);

        const inclusionExclusionSection = el('div', { className: 'xiv-section' }, [
            showOnlySection,
            blockSection
        ]);

        const advancedContainer = el('div', {
            id: CONFIG.IDS.ADVANCED_CONTAINER,
            className: `xiv-advanced-container ${state.isAdvancedOpen ? 'open' : ''}`
        }, [
            postTypeSection,
            createInlineDivider('Content Interaction Options'),
            interactionSection,
            createInlineDivider('Content Inclusion / Exclusion'),
            inclusionExclusionSection
        ]);

        const advancedToggleIcon = el('span', { textContent: state.isAdvancedOpen ? '▲' : '▼', style: 'margin-left: 4px; font-size: 0.65rem;' });

        const advancedToggle = el('div', {
            className: 'xiv-advanced-toggle',
            role: 'button',
            tabIndex: '0',
            onClick: () => {
                state.isAdvancedOpen = !state.isAdvancedOpen;
                advancedContainer.classList.toggle('open', state.isAdvancedOpen);
                advancedToggleIcon.textContent = state.isAdvancedOpen ? '▲' : '▼';
                saveState();
            },
            onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advancedToggle.click(); } }
        }, [
            el('span', { textContent: 'Advanced Options' }),
            advancedToggleIcon
        ]);

        const btnReset = el('button', {
            id: CONFIG.IDS.RESET_BTN, type: 'button', className: 'xiv-reset',
            textContent: 'Clear Filters', onClick: resetFilters
        });

        const panelBody = el('div', { className: 'content' }, [
            filtersSection,
            advancedToggle,
            advancedContainer
        ]);

        const headerToggle = el('div', {
            className: 'title',
            style: 'display: flex; justify-content: space-between; align-items: center; user-select: none;'
        }, [
            el('div', { style: 'display: flex; align-items: center; gap: 8px;' }, [
                el('div', { id: CONFIG.IDS.INDICATOR, className: 'xiv-indicator' }),
                el('h1', { id: CONFIG.IDS.HEADER_TITLE, textContent: 'POST FILTERS', style: 'margin: 0; font-weight: 300;' })
            ]),
            btnReset
        ]);

        const panel = el('div', { className: 'spacer xiv-panel-container' }, [
            el('div', { className: 'sidecontentbox' }, [
                headerToggle,
                panelBody
            ])
        ]);

        const searchBox = DOM.sidebar.querySelector(CONFIG.SELECTORS.SEARCH_BOX);
        if (searchBox && searchBox.parentNode) {
            searchBox.parentNode.insertAdjacentElement('afterend', panel);
        } else {
            DOM.sidebar.prepend(panel);
        }

        const emptyStateContainer = el('div', { id: CONFIG.IDS.EMPTY_STATE, className: 'xiv-empty-state' }, [
            el('h3', { textContent: 'No posts match your filters.' }),
            el('p', { textContent: 'Adjust your date range, score, or blocklists to see content.' }),
            el('button', { className: 'btn', textContent: 'Clear All Filters', onClick: resetFilters })
        ]);

        if (DOM.siteTable && DOM.siteTable.parentNode) {
            DOM.siteTable.parentNode.insertBefore(emptyStateContainer, DOM.siteTable);
        }

        syncScoreUI();
    }

    // ==========================================
    // BOOTSTRAP
    // ==========================================

    function init() {
        loadState();
        injectStyles();
        buildUI();
        setupObserver();
        setupInfiniteScrollSentinel();
        setupKeyboardShortcuts();
        executeFilter();
    }

    function tryInit(observer = null) {
        DOM.mainContent = document.querySelector(CONFIG.SELECTORS.TARGET_PARENT);
        DOM.siteTable = document.querySelector(CONFIG.SELECTORS.SITE_TABLE);
        DOM.sidebar = document.querySelector(CONFIG.SELECTORS.SIDEBAR);

        if (DOM.mainContent && DOM.siteTable && DOM.sidebar) {
            if (observer) observer.disconnect();
            init();
            return true;
        }
        return false;
    }

    function bootstrap() {
        if (tryInit()) return;
        let throttleTimer = null;
        const observer = new MutationObserver(() => {
            if (throttleTimer) return;

            throttleTimer = setTimeout(() => {
                throttleTimer = null;
                tryInit(observer);
            }, 50);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    bootstrap();

})();
