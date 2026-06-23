// ==UserScript==
// @name         [Reddit] Post Filter
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      5.3
// @description  Filters Reddit posts dynamically with customizable rules for scores, dates, subreddits, and keywords.
// @author       Xiv
// @match        *://*.reddit.com/*
// @noframes
// @run-at       document-start
// @updateURL    https://myouisaur.github.io/Reddit/post-filter.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/post-filter.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Prevent duplicate execution
    if (window.__tmRedditFilterRunning) return;

    // GUARD: Do not run on comment pages (this is a feed filter)
    if (window.location.pathname.includes('/comments/') || document.body?.classList.contains('comments-page')) {
        return;
    }

    window.__tmRedditFilterRunning = true;

    // ==========================================
    // CONFIGURATION & STATE
    // ==========================================

    const CONFIG = {
        DEBOUNCE_MS: 200,
        DEFAULT_MAX_SCORE: 10,
        SCROLL_MARGIN: '400px',
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
            SEARCH_BOX: '#search',
            ANNOUNCEMENT_TAG: '.stickied-tagline'
        },
        IDS: {
            SENTINEL: 'tm-raf-sentinel',
            INDICATOR: 'tm-raf-indicator',
            STATS: 'tm-raf-stats-text',
            EMPTY_STATE: 'tm-raf-empty-state',
            ADVANCED_CONTAINER: 'tm-raf-advanced-container',
            MIN_INPUT: 'tm-raf-min-input',
            MAX_INPUT: 'tm-raf-max-input',
            MIN_RANGE: 'tm-raf-min-range',
            MAX_RANGE: 'tm-raf-max-range',
            TRACK_FILL: 'tm-raf-track-fill',
            LOCK_ICON: 'tm-raf-lock-svg-wrapper',
            SUB_LIST: 'tm-raf-sub-list',
            SUB_BTN_TEXT: 'tm-raf-sub-btn-text',
            SUB_BTN: 'tm-raf-sub-btn',
            SUB_MASTER_CB: 'tm-raf-sub-master-cb',
            SUB_SEARCH: 'tm-raf-sub-search-input',
            SUB_MENU: 'tm-raf-sub-menu',
            RESET_BTN: 'tm-raf-reset-btn',
            POST_TYPE: 'tm-raf-post-type',
            ARCHIVED_CB: 'tm-raf-highlight-archived-cb',
            TEXT_INPUTS: [
                'tm-raf-date-from', 'tm-raf-date-to', 'tm-raf-show-keywords',
                'tm-raf-show-flairs', 'tm-raf-keywords', 'tm-raf-flairs', 'tm-raf-highlight'
            ],
            CB_INPUTS: [
                'tm-raf-hide-upvoted', 'tm-raf-show-upvoted', 'tm-raf-hide-downvoted',
                'tm-raf-show-downvoted', 'tm-raf-hide-promoted', 'tm-raf-hide-announcements'
            ]
        },
        STORAGE_KEY: 'tm_reddit_filter_session_v3',
        SVG_LOCK: '<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/>'
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
        hidePromoted: false,
        hideAnnouncements: false,
        postType: 'all',

        showKeywords: '',
        showFlairs: '',
        keywords: '',
        flairs: '',

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
            } else if (key === 'checked' || key === 'disabled' || key === 'selected') {
                element[key] = !!value;
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
               state.hidePromoted || state.hideAnnouncements ||
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

                // Escape all regex special characters first
                let escapedTerm = escapeRegExp(term);

                // 1. Multi-word wildcard: " * " becomes ".*" (matches anything, including spaces)
                escapedTerm = escapedTerm.replace(/\s+\\\*\s+/g, '.*');

                // 2. Single-word wildcard: "*" becomes "\S*" (matches anything EXCEPT spaces)
                escapedTerm = escapedTerm.replace(/\\\*/g, '\\S*');

                // (^|\W) ensures the match starts at a word boundary
                const prefix = hasStartAsterisk ? '' : '(^|\\W)';
                // (?!\w) ensures it ends at a word boundary
                const suffix = hasEndAsterisk ? '' : '(?!\\w)';

                return new RegExp(prefix + escapedTerm + suffix, 'i');
            });
    }

    function getFeedContext() {
        const url = new URL(window.location.href);
        // Remove pagination parameters so infinite scroll/next page doesn't reset the context
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
            const saved = sessionStorage.getItem(CONFIG.STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                state.dateFrom = parsed.dateFrom ?? null;
                state.dateTo = parsed.dateTo ?? null;

                const currentContext = getFeedContext();
                const isSameContext = (parsed.feedContext === currentContext);

                // Only retain score thresholds if we are on the exact same feed context
                state.minScore = isSameContext ? (parsed.minScore ?? 0) : 0;
                state.isMaxScoreLocked = isSameContext ? (parsed.isMaxScoreLocked ?? false) : false;
                state.maxScore = state.isMaxScoreLocked ? (parsed.maxScore ?? 0) : 0;

                state.highestObservedScore = CONFIG.DEFAULT_MAX_SCORE;
                state.feedContext = currentContext;

                state.hideUpvoted = parsed.hideUpvoted ?? false;
                state.showUpvoted = parsed.showUpvoted ?? false;
                state.hideDownvoted = parsed.hideDownvoted ?? false;
                state.showDownvoted = parsed.showDownvoted ?? false;
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
            console.warn('[Reddit Filter] Failed to parse session state, using defaults.');
        }
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

            const flairEl = postEl.querySelector(CONFIG.SELECTORS.FLAIR_ELEMENT);
            const flairText = flairEl ? flairEl.textContent.toLowerCase() : '';
            const subEl = postEl.querySelector(CONFIG.SELECTORS.SUBREDDIT_LINK);
            const subreddit = subEl ? subEl.textContent.trim().replace(/^r\//i, '') : null;

            const isPromoted = postEl.classList.contains('promotedlink') || postEl.dataset.promoted === 'true';
            const isAnnouncement = postEl.querySelector(CONFIG.SELECTORS.ANNOUNCEMENT_TAG) !== null;
            const isTextPost = postEl.classList.contains('self');
            const isArchived = postEl.querySelector(CONFIG.SELECTORS.ARCHIVED_ARROW) !== null;

            cached = { timestamp, titleText, flairText, subreddit, isPromoted, isAnnouncement, isTextPost, isArchived };
            state.postCache.set(postEl, cached);
        }

        const scoreEl = postEl.querySelector(CONFIG.SELECTORS.SCORE_ELEMENT);
        let score = 0;
        if (scoreEl) {
            score = parseInt(scoreEl.getAttribute('title') || scoreEl.textContent, 10) || 0;
        }

        const isUpvoted = postEl.querySelector(CONFIG.SELECTORS.UPVOTED_ARROW) !== null;
        const isDownvoted = postEl.querySelector(CONFIG.SELECTORS.DOWNVOTED_ARROW) !== null;
        return { ...cached, score, isUpvoted, isDownvoted };
    }

    function checkPostVisibility(postEl, activeKeywordRegexes, activeFlairs, activeShowKeywordRegexes, activeShowFlairs) {
        const data = getPostData(postEl);
        let isVisible = true;
        let isHighlighted = false;
        let isHighlightedArchived = false;

        // Subreddit Filter Check
        if (isVisible && data.subreddit && state.hiddenSubreddits.has(data.subreddit)) {
            isVisible = false;
        }

        if (isVisible && state.hidePromoted && data.isPromoted) isVisible = false;
        if (isVisible && state.hideAnnouncements && data.isAnnouncement) isVisible = false;

        if (isVisible && state.postType !== 'all') {
            if (state.postType === 'text' && !data.isTextPost) isVisible = false;
            if (state.postType === 'link' && data.isTextPost) isVisible = false;
        }

        const validMax = state.isMaxScoreLocked ? state.maxScore : null;
        if (isVisible && state.minScore > 0 && data.score < state.minScore) isVisible = false;
        if (isVisible && validMax !== null && data.score > validMax) isVisible = false;

        // --- Upvoted / Downvoted State Filters ---

        // Exclusion (Hide) logic acts as independent "AND" statements
        if (isVisible && state.hideUpvoted && data.isUpvoted) isVisible = false;
        if (isVisible && state.hideDownvoted && data.isDownvoted) isVisible = false;

        // Inclusion (Show) logic acts as a grouped "OR" statement bucket
        if (isVisible && (state.showUpvoted || state.showDownvoted)) {
            const matchesShowUp = state.showUpvoted && data.isUpvoted;
            const matchesShowDown = state.showDownvoted && data.isDownvoted;

            // If the user has active inclusion filters, but this post matches neither of them, hide it
            if (!matchesShowUp && !matchesShowDown) {
                isVisible = false;
            }
        }

        if (isVisible && data.timestamp) {
            if (state.dateFrom && data.timestamp < state.dateFrom) isVisible = false;
            if (state.dateTo && data.timestamp > state.dateTo) isVisible = false;
        }

        // Must Include (Show Only) Logic
        if (isVisible && activeShowKeywordRegexes.length > 0) {
            let matchedKeyword = false;
            for (const kwRegex of activeShowKeywordRegexes) {
                if (kwRegex.test(data.titleText)) {
                    matchedKeyword = true;
                    break;
                }
            }
            if (!matchedKeyword) isVisible = false;
        }

        if (isVisible && activeShowFlairs.length > 0) {
            let matchedFlair = false;
            if (data.flairText) {
                for (const flRegex of activeShowFlairs) {
                    if (flRegex.test(data.flairText)) {
                        matchedFlair = true;
                        break;
                    }
                }
            }
            if (!matchedFlair) isVisible = false;
        }

        // Blocklist Logic
        if (isVisible && activeKeywordRegexes.length > 0) {
            for (const kwRegex of activeKeywordRegexes) {
                if (kwRegex.test(data.titleText)) {
                    isVisible = false;
                    break;
                }
            }
        }

        if (isVisible && activeFlairs.length > 0 && data.flairText) {
            for (const flRegex of activeFlairs) {
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

        return { isVisible, isHighlighted, isHighlightedArchived, subreddit: data.subreddit, score: data.score };
    }

    function executeFilter() {
        if (state.isMutating) return;
        state.isMutating = true;

        requestAnimationFrame(() => {
            const selector = state.needsFullReeval ? CONFIG.SELECTORS.POST_ITEM : `${CONFIG.SELECTORS.POST_ITEM}:not([data-tm-eval="true"])`;
            const postsToProcess = document.querySelectorAll(selector);

            const activeKeywordRegexes = buildWildcardRegexes(state.keywords);
            const activeFlairs = buildWildcardRegexes(state.flairs);
            const activeShowKeywordRegexes = buildWildcardRegexes(state.showKeywords);
            const activeShowFlairs = buildWildcardRegexes(state.showFlairs);

            // Phase 1: Read metrics
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
                const { isVisible, isHighlighted, isHighlightedArchived, subreddit, score } = checkPostVisibility(
                    post, activeKeywordRegexes, activeFlairs, activeShowKeywordRegexes, activeShowFlairs
                );

                if (score > currentParseHighest) {
                    currentParseHighest = score;
                }

                if (subreddit && !state.knownSubreddits.has(subreddit)) {
                    state.knownSubreddits.add(subreddit);
                    state.sortedSubreddits.push(subreddit);
                    state.sortedSubreddits.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
                    discoveredNewSubreddits = true;
                }

                updates.push({ post, isVisible, isHighlighted, isHighlightedArchived });

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

            // Sync dynamic highest score
            if (currentParseHighest > state.highestObservedScore) {
                state.highestObservedScore = currentParseHighest;
                if (!state.isMaxScoreLocked) {
                    state.maxScore = currentParseHighest;
                }
                syncScoreUI();
            }

            // Phase 2: Write mutations
            updates.forEach(({ post, isVisible, isHighlighted, isHighlightedArchived }) => {
                post.classList.toggle('tm-raf-hidden', !isVisible);
                post.classList.toggle('tm-raf-highlight', isHighlighted);
                post.classList.toggle('tm-raf-highlight-archived', isHighlightedArchived);

                if (post.parentElement && post.parentElement.classList.contains('spacer')) {
                    post.parentElement.classList.toggle('tm-raf-hidden', !isVisible);
                }

                post.dataset.tmEval = 'true';
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

            // Fix overlapping un-clickable thumb issue by adjusting z-index dynamically
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
            if (state.isMaxScoreLocked) {
                lockIconWrapper.style.display = 'flex';
                lockIconWrapper.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">${CONFIG.SVG_LOCK}</svg>`;
            } else {
                lockIconWrapper.style.display = 'none';
                lockIconWrapper.innerHTML = '';
            }
        }
    }

    function resetFilters() {
        CONFIG.IDS.TEXT_INPUTS.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        CONFIG.IDS.CB_INPUTS.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.checked = false;
        });

        const cbArchived = document.getElementById(CONFIG.IDS.ARCHIVED_CB);
        if (cbArchived) cbArchived.checked = true;

        const typeSelect = document.getElementById(CONFIG.IDS.POST_TYPE);
        if (typeSelect) typeSelect.value = 'all';

        state.minScore = 0;
        state.isMaxScoreLocked = false;
        state.maxScore = state.highestObservedScore;

        state.dateFrom = null;
        state.dateTo = null;
        state.hideUpvoted = false;
        state.showUpvoted = false;
        state.hideDownvoted = false;
        state.showDownvoted = false;
        state.hidePromoted = false;
        state.hideAnnouncements = false;
        state.postType = 'all';
        state.showKeywords = '';
        state.showFlairs = '';
        state.keywords = '';
        state.flairs = '';
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

            if (hasNewPosts) {
                queueFilter(false);
            }
        });

        observer.observe(DOM.mainContent, { childList: true, subtree: true });

        DOM.siteTable.addEventListener('click', (e) => {
            if (e.target.matches('.arrow')) queueFilter(true);
        });
    }

    function setupInfiniteScrollSentinel() {
        if (state.io) state.io.disconnect();

        const existing = document.getElementById(CONFIG.IDS.SENTINEL);
        if (existing) existing.remove();

        const sentinel = el('div', { id: CONFIG.IDS.SENTINEL, style: 'height: 1px; width: 100%; clear: left;' });
        DOM.siteTable.appendChild(sentinel);

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
        if (document.getElementById('tm-raf-styles')) return;

        const css = `
            :root {
                --tm-raf-highlight-color: rgba(255, 215, 0, 0.8);
                --tm-raf-highlight-bg: rgba(255, 215, 0, 0.1);
                --tm-raf-archived-color: #ff4a08;
                --tm-raf-archived-bg: rgba(255, 74, 8, 0.20);
                --tm-raf-active-color: #28a745;
            }

            /* Bulletproof Hiding */
            .tm-raf-hidden,
            .tm-raf-hidden + .child,
            .tm-raf-hidden + .child + .clearleft,
            .tm-raf-hidden + .clearleft {
                display: none !important;
            }

            /* Highlighting */
            .tm-raf-highlight {
                border-left: 4px solid var(--tm-raf-highlight-color) !important;
                background-color: var(--tm-raf-highlight-bg) !important;
                border-radius: 3px;
                padding-left: 8px !important;
            }

            /* Archived Highlighting */
            .tm-raf-highlight-archived {
                border-left: 4px solid var(--tm-raf-archived-color) !important;
                background-color: var(--tm-raf-archived-bg) !important;
                border-radius: 3px;
                padding-left: 8px !important;
            }

            /* Layout Structure */
            .tm-raf-section {
                padding-bottom: 0.75rem;
                margin-bottom: 0.75rem;
            }
            .tm-raf-split-row {
                display: flex;
                gap: 0.5rem;
                margin-bottom: 0.75rem;
                width: 100%;
            }
            .tm-raf-split-col {
                flex: 1;
                display: flex;
                flex-direction: column;
                gap: 0.25rem;
                min-width: 0;
            }
            .tm-raf-row {
                display: flex;
                flex-direction: column;
                margin-bottom: 0.75rem;
                gap: 0.25rem;
            }

            /* Subreddit Native Dual Slider Styling */
            .tm-raf-score-container {
                display: flex;
                flex-direction: column;
                gap: 0.25rem;
                margin-bottom: 0.75rem;
            }
            .tm-raf-score-labels {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0;
            }
            .tm-raf-slider-row {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .tm-raf-score-input {
                width: 48px;
                background-color: transparent;
                color: inherit;
                border: 1px solid currentColor;
                opacity: 0.5;
                border-radius: 3px;
                padding: 4px;
                text-align: center;
                font-size: 0.8rem;
                font-family: inherit;
                -moz-appearance: textfield;
                transition: opacity 0.2s;
            }
            .tm-raf-score-input::-webkit-outer-spin-button,
            .tm-raf-score-input::-webkit-inner-spin-button {
                -webkit-appearance: none;
                margin: 0;
            }
            .tm-raf-score-input:focus {
                opacity: 1;
                outline: none;
            }
            .tm-raf-range-wrapper {
                position: relative;
                flex: 1;
                height: 20px;
                display: flex;
                align-items: center;
                color: inherit;
                cursor: pointer;
            }
            .tm-raf-track-bg {
                position: absolute;
                width: 100%;
                height: 4px;
                background-color: currentColor;
                opacity: 0.3;
                border-radius: 2px;
                top: 50%;
                transform: translateY(-50%);
                pointer-events: none;
            }
            .tm-raf-track-fill {
                position: absolute;
                height: 4px;
                background-color: currentColor;
                opacity: 0.85;
                border-radius: 2px;
                top: 50%;
                transform: translateY(-50%);
                pointer-events: none;
            }
            .tm-raf-range-input {
                position: absolute;
                width: 100%;
                -webkit-appearance: none;
                background: transparent;
                pointer-events: none;
                margin: 0;
                top: 50%;
                transform: translateY(-50%);
                color: inherit;
            }
            .tm-raf-range-input::-webkit-slider-thumb {
                pointer-events: auto;
                -webkit-appearance: none;
                height: 14px;
                width: 14px;
                border-radius: 50%;
                background-color: currentColor;
                cursor: pointer;
                box-shadow: 0 1px 3px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1);
            }
            .tm-raf-range-input::-moz-range-thumb {
                pointer-events: auto;
                height: 14px;
                width: 14px;
                border-radius: 50%;
                background-color: currentColor;
                cursor: pointer;
                border: none;
                box-shadow: 0 1px 3px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1);
            }

            /* Subreddit Multi-Select Inline Accordion */
            .tm-raf-dropdown {
                position: relative;
                width: 100%;
            }
            .tm-raf-sub-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 0.25rem;
            }
            .tm-raf-dropdown-btn {
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                align-items: center;
                user-select: none;
                overflow: hidden;
                transition: border-radius 0.2s;
            }
            .tm-raf-dropdown-btn.open {
                border-bottom-left-radius: 0;
                border-bottom-right-radius: 0;
                border-bottom-color: transparent;
            }
            #tm-raf-sub-btn-text {
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-right: 8px;
            }
            .tm-raf-dropdown-menu {
                display: none;
                width: 100%;
                border: 1px solid rgba(128, 128, 128, 0.3);
                border-top: none;
                border-bottom-left-radius: 0.2rem;
                border-bottom-right-radius: 0.2rem;
                box-sizing: border-box;
                background-color: transparent;
                color: inherit;
            }
            .tm-raf-dropdown-menu.open {
                display: block;
            }
            .tm-raf-sub-search {
                padding: 6px 8px;
                border-bottom: 1px solid rgba(128, 128, 128, 0.3);
                display: flex;
                align-items: center;
                gap: 8px;
                background-color: rgba(128, 128, 128, 0.05);
            }
            .tm-raf-sub-list {
                max-height: 40vh;
                overflow-y: auto;
            }
            .tm-raf-sub-item {
                padding: 6px 8px;
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 0.8rem;
                cursor: pointer;
                user-select: none;
            }
            .tm-raf-sub-item:hover {
                background-color: rgba(128, 128, 128, 0.1);
            }

            /* New layout elements */
            .tm-raf-inline-divider {
                display: flex;
                align-items: center;
                text-align: center;
                color: rgba(128, 128, 128, 0.8);
                font-size: 0.75rem;
                margin: 0 0 0.25rem 0;
                white-space: nowrap;
                text-transform: uppercase !important;
                letter-spacing: 0.5px;
            }
            .tm-raf-inline-divider::before,
            .tm-raf-inline-divider::after {
                content: '';
                flex: 1;
                border-bottom: 1px solid rgba(128, 128, 128, 0.3);
            }
            .tm-raf-inline-divider::before { margin-right: .5em; }
            .tm-raf-inline-divider::after { margin-left: .5em; }

            .tm-raf-hr {
                border: none;
                border-bottom: 1px dashed rgba(128, 128, 128, 0.3);
                margin: 0.35rem 0;
            }

            /* Input Groups & Grids */
            .tm-raf-input-group {
                display: flex;
                align-items: stretch;
                width: 100%;
            }
            .tm-raf-grid-group {
                display: grid;
                grid-template-columns: max-content 1fr;
                row-gap: 0.25rem;
                width: 100%;
            }
            .tm-raf-input-prefix {
                display: flex;
                align-items: center;
                padding: 0 0.5rem;
                background-color: rgba(128, 128, 128, 0.1);
                border: 1px solid rgba(128, 128, 128, 0.3);
                border-right: none;
                border-top-left-radius: 0.2rem;
                border-bottom-left-radius: 0.2rem;
                font-size: 0.8rem;
                color: inherit;
                white-space: nowrap;
                box-sizing: border-box;
            }
            .tm-raf-input-group .tm-raf-input,
            .tm-raf-grid-group .tm-raf-input {
                border-top-left-radius: 0;
                border-bottom-left-radius: 0;
                flex: 1;
            }

            /* Search input clearing webkit tweaks */
            .tm-raf-input[type="search"]::-webkit-search-cancel-button {
                -webkit-appearance: searchfield-cancel-button;
                cursor: pointer;
            }

            /* Typography & Inputs */
            .tm-raf-label {
                font-size: 0.75rem;
                font-weight: 600;
                opacity: 0.8;
                white-space: nowrap;
            }
            .tm-raf-input, .tm-raf-select {
                padding: 0.4rem 0.5rem;
                border: 1px solid rgba(128, 128, 128, 0.3);
                border-radius: 0.2rem;
                font-size: 0.8rem;
                width: 100%;
                box-sizing: border-box;
                font-family: inherit;
                background-color: transparent;
                color: inherit;
                transition: border-color 0.2s, box-shadow 0.2s;
            }
            .tm-raf-input:focus, .tm-raf-select:focus {
                outline: none;
                border-color: rgba(128, 128, 128, 0.8);
                box-shadow: 0 0 0 2px rgba(128, 128, 128, 0.2);
            }

            .tm-raf-checkbox-row {
                display: flex;
                align-items: center;
                gap: 0.4rem;
                margin-bottom: 0.2rem;
            }
            .tm-raf-checkbox-row label {
                font-size: 0.8rem;
                cursor: pointer;
                opacity: 0.9;
            }

            /* Interactive Elements */
            .tm-raf-indicator {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background-color: var(--tm-raf-active-color);
                opacity: 0;
                transition: opacity 0.2s ease;
            }
            .tm-raf-indicator.active {
                opacity: 1;
            }
            .tm-raf-advanced-toggle {
                font-size: 0.75rem;
                cursor: pointer;
                text-align: center;
                padding: 0.4rem 0;
                font-weight: 600;
                user-select: none;
                border-radius: 0.2rem;
                transition: background-color 0.2s;
                margin-bottom: 0.5rem;
                opacity: 0.8;
            }
            .tm-raf-advanced-toggle:hover, .tm-raf-advanced-toggle:focus {
                background-color: rgba(128, 128, 128, 0.1);
                outline: none;
            }
            .tm-raf-advanced-container {
                display: none;
            }
            .tm-raf-advanced-container.open {
                display: block;
            }

            /* Footer & States */
            .tm-raf-footer {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding-top: 0.75rem;
                border-top: 1px dashed rgba(128, 128, 128, 0.3);
            }
            .tm-raf-stats {
                font-size: 0.75rem;
                opacity: 0.8;
            }
            .tm-raf-reset {
                background: transparent;
                border: none;
                color: #d22;
                font-size: 0.75rem;
                cursor: pointer;
                padding: 0;
                font-weight: bold;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.2s ease;
            }
            .tm-raf-reset.visible {
                opacity: 1;
                pointer-events: auto;
            }
            .tm-raf-reset:hover {
                text-decoration: underline;
            }
            .tm-raf-empty-state {
                padding: 2rem;
                text-align: center;
                margin-bottom: 1rem;
                display: none;
                flex-direction: column;
                align-items: center;
                gap: 0.75rem;
                border: 2px dashed rgba(128, 128, 128, 0.3);
                border-radius: 4px;
                background-color: transparent;
            }
            .tm-raf-empty-state h3 {
                margin: 0;
                font-size: 1.1rem;
                opacity: 0.9;
            }
            .tm-raf-empty-state p {
                margin: 0;
                font-size: 0.85rem;
                opacity: 0.7;
            }
            .tm-raf-hint {
                font-size: 0.65rem;
                opacity: 0.6;
                font-weight: normal;
                margin-left: 4px;
                text-transform: none;
            }
        `;

        document.head.appendChild(el('style', { id: 'tm-raf-styles', textContent: css }));
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

        // Re-render the list ONLY if new subreddits were discovered (length mismatch)
        if (list.children.length !== state.sortedSubreddits.length) {
            list.innerHTML = ''; // Clear stale list
            state.sortedSubreddits.forEach(sub => {
                const checkbox = el('input', {
                    type: 'checkbox',
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

                const item = el('label', { className: 'tm-raf-sub-item' }, [
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

    function updateUIState() {
        const statsEl = document.getElementById(CONFIG.IDS.STATS);
        const resetBtn = document.getElementById(CONFIG.IDS.RESET_BTN);
        const indicator = document.getElementById(CONFIG.IDS.INDICATOR);
        const emptyState = document.getElementById(CONFIG.IDS.EMPTY_STATE);

        if (statsEl) {
            statsEl.textContent = `Showing ${state.visiblePosts} of ${state.totalPosts} posts`;
        }

        const active = isFilterActive();

        if (resetBtn) resetBtn.classList.toggle('visible', active);
        if (indicator) indicator.classList.toggle('active', active);

        if (emptyState) {
            if (active && state.totalPosts > 0 && state.visiblePosts === 0) {
                emptyState.style.display = 'flex';
            } else {
                emptyState.style.display = 'none';
            }
        }
    }

    function buildUI() {
        const createInput = (id, type, placeholder, value, stateKey, parser) => {
            return el('input', {
                id: id,
                type: type,
                className: 'tm-raf-input',
                value: value !== null ? value : '',
                placeholder: placeholder,
                onInput: (e) => {
                    const parsed = parser(e.target.value);
                    state[stateKey] = parsed;
                    queueFilter(true);
                }
            });
        };

        const createCheckbox = (id, labelText, stateKey, customOnChange = null) => {
            return el('div', { className: 'tm-raf-checkbox-row' }, [
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
            return el('div', { className: 'tm-raf-inline-divider', style: customStyle, textContent: text });
        };

        // --- 1. FILTERS (Basic) ---

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

        const inputMinScore = el('input', { id: CONFIG.IDS.MIN_INPUT, type: 'number', className: 'tm-raf-score-input', min: 0, value: state.minScore, onInput: onMinChange });
        const inputMaxScore = el('input', { id: CONFIG.IDS.MAX_INPUT, type: 'number', className: 'tm-raf-score-input', min: 0, value: state.maxScore, onInput: onMaxChange });
        const rangeMin = el('input', { id: CONFIG.IDS.MIN_RANGE, type: 'range', className: 'tm-raf-range-input', min: 0, onInput: onMinChange });
        const rangeMax = el('input', { id: CONFIG.IDS.MAX_RANGE, type: 'range', className: 'tm-raf-range-input', min: 0, onInput: onMaxChange });

        const rangeWrapper = el('div', { className: 'tm-raf-range-wrapper' }, [
            el('div', { className: 'tm-raf-track-bg' }),
            el('div', { id: CONFIG.IDS.TRACK_FILL, className: 'tm-raf-track-fill' }),
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

        const maxLabelContainer = el('div', { style: 'display: flex; align-items: center; gap: 2px;' }, [
            lockIconWrapper,
            el('label', { className: 'tm-raf-label', style: 'margin: 0;', textContent: 'MAX' })
        ]);

        const scoreContainer = el('div', { className: 'tm-raf-score-container' }, [
            createInlineDivider('Score'),
            el('div', { className: 'tm-raf-score-labels' }, [
                el('label', { className: 'tm-raf-label', style: 'margin: 0;', textContent: 'MIN' }),
                maxLabelContainer
            ]),
            el('div', { className: 'tm-raf-slider-row' }, [
                inputMinScore,
                rangeWrapper,
                inputMaxScore
            ])
        ]);

        const inputDateFrom = el('input', {
            id: 'tm-raf-date-from', type: 'date', className: 'tm-raf-input',
            value: formatDateForInput(state.dateFrom),
            onChange: (e) => { state.dateFrom = parseInputDateToLocal(e.target.value, false); queueFilter(true); }
        });
        const inputDateTo = el('input', {
            id: 'tm-raf-date-to', type: 'date', className: 'tm-raf-input',
            value: formatDateForInput(state.dateTo),
            onChange: (e) => { state.dateTo = parseInputDateToLocal(e.target.value, true); queueFilter(true); }
        });

        const dateRangeSection = el('div', { className: 'tm-raf-row', style: 'margin-bottom: 0;' }, [
            createInlineDivider('Date Range'),
            el('div', { className: 'tm-raf-grid-group' }, [
                el('span', { className: 'tm-raf-input-prefix', textContent: 'From' }),
                inputDateFrom,
                el('span', { className: 'tm-raf-input-prefix', textContent: 'To' }),
                inputDateTo
            ])
        ]);

        const filtersSection = el('div', { className: 'tm-raf-section', style: 'border-bottom: 1px dashed rgba(128,128,128,0.3);' }, [
            scoreContainer,
            dateRangeSection
        ]);

        // --- 2. POST TYPE & SUBREDDIT (Advanced) ---

        const subSearchInput = el('input', {
            id: CONFIG.IDS.SUB_SEARCH,
            type: 'text',
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

                // Toggle the DOM checkboxes explicitly to fix the visual desync bug
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

        const subDropdownMenu = el('div', { id: CONFIG.IDS.SUB_MENU, className: 'tm-raf-dropdown-menu' }, [
            el('div', { className: 'tm-raf-sub-search' }, [
                el('label', { title: 'Select/Deselect All', style: 'display: flex; align-items: center; cursor: pointer; margin: 0;' }, [masterCheckbox]),
                subSearchInput
            ]),
            el('div', { id: CONFIG.IDS.SUB_LIST, className: 'tm-raf-sub-list' })
        ]);

        const subDropdownBtn = el('div', { id: CONFIG.IDS.SUB_BTN, className: 'tm-raf-input tm-raf-dropdown-btn' }, [
            el('span', { id: CONFIG.IDS.SUB_BTN_TEXT, textContent: 'Scanning subreddits...' }),
            el('span', { textContent: '▼', style: 'font-size: 0.6rem; opacity: 0.7;' })
        ]);

        subDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.knownSubreddits.size <= 1) return;
            const menu = document.getElementById(CONFIG.IDS.SUB_MENU);
            const btn = document.getElementById(CONFIG.IDS.SUB_BTN);
            menu.classList.toggle('open');
            btn.classList.toggle('open');
            if (menu.classList.contains('open')) {
                document.getElementById(CONFIG.IDS.SUB_SEARCH).focus();
            }
        });

        const subHeader = el('div', { className: 'tm-raf-sub-header' }, [
            el('label', { className: 'tm-raf-label', textContent: 'Subreddit Filter' })
        ]);

        const dropdownCore = el('div', { style: 'display: flex; flex-direction: column;' }, [
            subDropdownBtn,
            subDropdownMenu
        ]);

        const subDropdownContainer = el('div', { className: 'tm-raf-dropdown tm-raf-row' }, [
            subHeader,
            dropdownCore
        ]);

        const typeSelect = el('select', {
            id: CONFIG.IDS.POST_TYPE, className: 'tm-raf-select',
            onChange: (e) => { state.postType = e.target.value; queueFilter(true); }
        }, [
            el('option', { value: 'all', textContent: 'All Posts' }),
            el('option', { value: 'text', textContent: 'Self/Text Only' }),
            el('option', { value: 'link', textContent: 'Links Only' })
        ]);
        typeSelect.value = state.postType;

        const typeSelectRow = el('div', { className: 'tm-raf-row', style: 'margin-bottom: 0;' }, [
            el('label', { className: 'tm-raf-label', htmlFor: CONFIG.IDS.POST_TYPE, textContent: 'Post Type' }),
            typeSelect
        ]);

        const postTypeSection = el('div', { className: 'tm-raf-section' }, [
            subDropdownContainer,
            typeSelectRow
        ]);

        // --- 3. INTERACTION OPTIONS (Highlights & Hides) ---

        const inputHighlight = createInput('tm-raf-highlight', 'number', '5000', state.highlightThreshold, 'highlightThreshold', v => v.trim() === '' ? null : (parseInt(v, 10) || 0));
        inputHighlight.setAttribute('min', '0');

        const highlightThresholdRow = el('div', { className: 'tm-raf-row', style: 'margin-bottom: 0.5rem;' }, [
            el('div', { className: 'tm-raf-input-group' }, [
                el('span', { className: 'tm-raf-input-prefix', textContent: 'Highlight score >' }),
                inputHighlight
            ])
        ]);

        const interactionSection = el('div', { className: 'tm-raf-section', style: 'margin-bottom: 0;' }, [
            highlightThresholdRow,
            createCheckbox(CONFIG.IDS.ARCHIVED_CB, 'Highlight archived', 'highlightArchived'),
            el('hr', { className: 'tm-raf-hr' }),
            el('div', { style: 'display: flex; flex-direction: column; gap: 0.15rem; margin-top: 0.2rem;' }, [
                createExclusiveCheckbox('tm-raf-hide-upvoted', 'Hide upvoted', 'hideUpvoted', 'showUpvoted', 'tm-raf-show-upvoted'),
                createExclusiveCheckbox('tm-raf-hide-downvoted', 'Hide downvoted', 'hideDownvoted', 'showDownvoted', 'tm-raf-show-downvoted'),
                createCheckbox('tm-raf-hide-announcements', 'Hide announcement', 'hideAnnouncements'),
                createCheckbox('tm-raf-hide-promoted', 'Hide promoted', 'hidePromoted')
            ]),
            el('hr', { className: 'tm-raf-hr' }),
            el('div', { style: 'display: flex; flex-direction: column; gap: 0.15rem;' }, [
                createExclusiveCheckbox('tm-raf-show-upvoted', 'Show upvoted', 'showUpvoted', 'hideUpvoted', 'tm-raf-hide-upvoted'),
                createExclusiveCheckbox('tm-raf-show-downvoted', 'Show downvoted', 'showDownvoted', 'hideDownvoted', 'tm-raf-hide-downvoted')
            ])
        ]);

        // --- 4. INCLUSION / EXCLUSION (Show Only & Blocks) ---

        const showOnlySection = el('div', { className: 'tm-raf-row', style: 'margin-bottom: 0.75rem;' }, [
            el('label', { className: 'tm-raf-label', textContent: 'Show Only' }),
            el('div', { className: 'tm-raf-grid-group' }, [
                el('span', { className: 'tm-raf-input-prefix', textContent: 'Keywords' }),
                createInput('tm-raf-show-keywords', 'search', 'e.g. megathread, offi*', state.showKeywords, 'showKeywords', v => v),
                el('span', { className: 'tm-raf-input-prefix', textContent: 'Flairs' }),
                createInput('tm-raf-show-flairs', 'search', 'e.g. news, *event*', state.showFlairs, 'showFlairs', v => v)
            ])
        ]);

        const blockSection = el('div', { className: 'tm-raf-row', style: 'margin-bottom: 0;' }, [
            el('label', { className: 'tm-raf-label', textContent: 'Block' }),
            el('div', { className: 'tm-raf-grid-group' }, [
                el('span', { className: 'tm-raf-input-prefix', textContent: 'Keywords' }),
                createInput('tm-raf-keywords', 'search', 'e.g. politics, spoil*', state.keywords, 'keywords', v => v),
                el('span', { className: 'tm-raf-input-prefix', textContent: 'Flairs' }),
                createInput('tm-raf-flairs', 'search', 'e.g. meme, *rant*', state.flairs, 'flairs', v => v)
            ])
        ]);

        const inclusionExclusionSection = el('div', { className: 'tm-raf-section' }, [
            showOnlySection,
            blockSection
        ]);

        // --- Assembly ---
        const advancedContainer = el('div', {
            id: CONFIG.IDS.ADVANCED_CONTAINER,
            className: `tm-raf-advanced-container ${state.isAdvancedOpen ? 'open' : ''}`
        }, [
            postTypeSection,
            createInlineDivider('Content Interaction Options'),
            interactionSection,
            createInlineDivider('Content Inclusion / Exclusion'),
            inclusionExclusionSection
        ]);

        const advancedToggleIcon = el('span', { textContent: state.isAdvancedOpen ? '▲' : '▼', style: 'margin-left: 4px; font-size: 0.65rem;' });

        const advancedToggle = el('div', {
            className: 'tm-raf-advanced-toggle',
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

        // --- Footer ---
        const footerSection = el('div', { className: 'tm-raf-footer' }, [
            el('span', { id: CONFIG.IDS.STATS, className: 'tm-raf-stats', textContent: 'Loading...' })
        ]);

        const btnReset = el('button', {
            id: CONFIG.IDS.RESET_BTN, type: 'button', className: 'tm-raf-reset',
            textContent: 'Clear Filters', onClick: resetFilters
        });

        const panelBody = el('div', { className: 'content' }, [
            filtersSection,
            advancedToggle,
            advancedContainer,
            footerSection
        ]);

        const headerToggle = el('div', {
            className: 'title',
            style: 'display: flex; justify-content: space-between; align-items: center; user-select: none;'
        }, [
            el('div', { style: 'display: flex; align-items: center; gap: 8px;' }, [
                el('h1', { textContent: 'POST FILTERS', style: 'margin: 0; font-weight: 300;' }),
                el('div', { id: CONFIG.IDS.INDICATOR, className: 'tm-raf-indicator', title: 'Filters Active' })
            ]),
            btnReset
        ]);

        const panel = el('div', { className: 'spacer' }, [
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

        const emptyStateContainer = el('div', { id: CONFIG.IDS.EMPTY_STATE, className: 'tm-raf-empty-state' }, [
            el('h3', { textContent: 'No posts match your filters.' }),
            el('p', { textContent: 'Adjust your date range, score, or blocklists to see content.' }),
            el('button', { className: 'btn', textContent: 'Clear All Filters', onClick: resetFilters })
        ]);

        if (DOM.siteTable.parentNode) {
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
