// ==UserScript==
// @name         [Reddit] Post Filter
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      4.0
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
        SELECTORS: {
            SIDEBAR: '.side',
            TARGET_PARENT: '.content[role="main"]',
            SITE_TABLE: '#siteTable',
            POST_ITEM: '.thing.link',
            TIME_ELEMENT: 'time.live-timestamp',
            SCORE_ELEMENT: '.score.unvoted',
            UPVOTED_ARROW: '.arrow.upmod',
            ARCHIVED_ARROW: '.arrow.archived',
            TITLE_ELEMENT: 'p.title a.title',
            FLAIR_ELEMENT: '.linkflairlabel',
            PROMOTED_LINK: '.promotedlink',
            SUBREDDIT_LINK: 'a.subreddit, .subreddit.hover',
            SEARCH_BOX: '#search'
        },
        STORAGE_KEY: 'tm_reddit_filter_session_v3'
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
        minScore: 0,
        maxScore: null,
        hideUpvoted: false,
        showUpvoted: false,
        hidePromoted: false,
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

        // Volatile state (not saved in sessionStorage)
        hiddenSubreddits: new Set(),
        knownSubreddits: new Set()
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
               state.maxScore !== null || state.dateFrom !== null ||
               state.dateTo !== null || state.hideUpvoted || state.showUpvoted || state.hidePromoted ||
               state.showKeywords.trim() !== '' ||
               state.showFlairs.trim() !== '' ||
               state.keywords.trim() !== '' ||
               state.flairs.trim() !== '' ||
               state.postType !== 'all' || state.highlightThreshold !== null ||
               state.hiddenSubreddits.size > 0;
    }

    function splitAndClean(str) {
        if (!str) return [];
        return str.toLowerCase().split(',').map(s => s.trim()).filter(s => s.length > 0);
    }

    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function buildKeywordRegexes(str) {
        if (!str) return [];
        return str.toLowerCase().split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .map(s => new RegExp(`\\b${escapeRegExp(s)}\\b`, 'i'));
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
                state.minScore = parsed.minScore ?? 0;
                state.maxScore = parsed.maxScore ?? null;
                state.hideUpvoted = parsed.hideUpvoted ?? false;
                state.showUpvoted = parsed.showUpvoted ?? false;
                state.hidePromoted = parsed.hidePromoted ?? false;
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
                maxScore: state.maxScore,
                hideUpvoted: state.hideUpvoted,
                showUpvoted: state.showUpvoted,
                hidePromoted: state.hidePromoted,
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
            const isTextPost = postEl.classList.contains('self');
            const isArchived = postEl.querySelector(CONFIG.SELECTORS.ARCHIVED_ARROW) !== null;

            cached = { timestamp, titleText, flairText, subreddit, isPromoted, isTextPost, isArchived };
            state.postCache.set(postEl, cached);
        }

        const scoreEl = postEl.querySelector(CONFIG.SELECTORS.SCORE_ELEMENT);
        let score = 0;
        if (scoreEl) {
            score = parseInt(scoreEl.getAttribute('title') || scoreEl.textContent, 10) || 0;
        }

        const isUpvoted = postEl.querySelector(CONFIG.SELECTORS.UPVOTED_ARROW) !== null;
        return { ...cached, score, isUpvoted };
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

        if (isVisible && state.postType !== 'all') {
            if (state.postType === 'text' && !data.isTextPost) isVisible = false;
            if (state.postType === 'link' && data.isTextPost) isVisible = false;
        }

        const validMax = (state.maxScore !== null && state.maxScore >= state.minScore) ? state.maxScore : null;
        if (isVisible && state.minScore > 0 && data.score < state.minScore) isVisible = false;
        if (isVisible && validMax !== null && data.score > validMax) isVisible = false;

        // Upvoted State Filters
        if (isVisible && state.hideUpvoted && data.isUpvoted) isVisible = false;
        if (isVisible && state.showUpvoted && !data.isUpvoted) isVisible = false;

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
                for (const fl of activeShowFlairs) {
                    if (data.flairText.includes(fl)) {
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
            for (const fl of activeFlairs) {
                if (data.flairText.includes(fl)) {
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

        return { isVisible, isHighlighted, isHighlightedArchived, subreddit: data.subreddit };
    }

    function executeFilter() {
        if (state.isMutating) return;
        state.isMutating = true;

        requestAnimationFrame(() => {
            const selector = state.needsFullReeval ? CONFIG.SELECTORS.POST_ITEM : `${CONFIG.SELECTORS.POST_ITEM}:not([data-tm-eval="true"])`;
            const postsToProcess = document.querySelectorAll(selector);

            const activeKeywordRegexes = buildKeywordRegexes(state.keywords);
            const activeFlairs = splitAndClean(state.flairs);
            const activeShowKeywordRegexes = buildKeywordRegexes(state.showKeywords);
            const activeShowFlairs = splitAndClean(state.showFlairs);

            // Phase 1: Read metrics
            const updates = [];
            let newlyProcessed = 0;
            let newlyVisible = 0;
            let discoveredNewSubreddits = false;

            if (state.needsFullReeval) {
                state.totalPosts = 0;
                state.visiblePosts = 0;
            }

            postsToProcess.forEach(post => {
                const { isVisible, isHighlighted, isHighlightedArchived, subreddit } = checkPostVisibility(
                    post, activeKeywordRegexes, activeFlairs, activeShowKeywordRegexes, activeShowFlairs
                );

                if (subreddit && !state.knownSubreddits.has(subreddit)) {
                    state.knownSubreddits.add(subreddit);
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

    function resetFilters() {
        ['tm-raf-min-score', 'tm-raf-max-score', 'tm-raf-date-from', 'tm-raf-date-to',
         'tm-raf-show-keywords', 'tm-raf-show-flairs', 'tm-raf-keywords', 'tm-raf-flairs', 'tm-raf-highlight'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        ['tm-raf-hide-upvoted', 'tm-raf-show-upvoted', 'tm-raf-hide-promoted'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.checked = false;
        });

        const cbArchived = document.getElementById('tm-raf-highlight-archived-cb');
        if (cbArchived) cbArchived.checked = true;

        const typeSelect = document.getElementById('tm-raf-post-type');
        if (typeSelect) typeSelect.value = 'all';

        state.minScore = 0;
        state.maxScore = null;
        state.dateFrom = null;
        state.dateTo = null;
        state.hideUpvoted = false;
        state.showUpvoted = false;
        state.hidePromoted = false;
        state.postType = 'all';
        state.showKeywords = '';
        state.showFlairs = '';
        state.keywords = '';
        state.flairs = '';
        state.highlightThreshold = null;
        state.highlightArchived = true;
        state.hiddenSubreddits.clear();

        updateSubredditDropdownUI();
        validateMinMax();
        queueFilter(true);
    }

    function validateMinMax() {
        const inputMin = document.getElementById('tm-raf-min-score');
        const inputMax = document.getElementById('tm-raf-max-score');
        if (!inputMin || !inputMax) return;

        if (state.maxScore !== null && state.minScore > state.maxScore) {
            inputMin.classList.add('tm-raf-input-error');
            inputMax.classList.add('tm-raf-input-error');
            inputMax.setAttribute('title', 'Max must be greater than Min');
        } else {
            inputMin.classList.remove('tm-raf-input-error');
            inputMax.classList.remove('tm-raf-input-error');
            inputMax.removeAttribute('title');
        }
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

            if (!document.getElementById('tm-raf-sentinel')) {
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

        const existing = document.getElementById('tm-raf-sentinel');
        if (existing) existing.remove();

        const sentinel = el('div', { id: 'tm-raf-sentinel', style: 'height: 1px; width: 100%; clear: left;' });
        DOM.siteTable.appendChild(sentinel);

        state.io = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && state.visiblePosts < state.totalPosts) {
                window.dispatchEvent(new CustomEvent('scroll'));
            }
        }, { rootMargin: '400px' });

        state.io.observe(sentinel);
    }

    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.altKey && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                const minInput = document.getElementById('tm-raf-min-score');
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
            /* Bulletproof Hiding */
            .tm-raf-hidden,
            .tm-raf-hidden + .child,
            .tm-raf-hidden + .child + .clearleft,
            .tm-raf-hidden + .clearleft {
                display: none !important;
            }

            /* Highlighting */
            .tm-raf-highlight {
                border-left: 4px solid rgba(255, 215, 0, 0.8) !important;
                background-color: rgba(255, 215, 0, 0.1) !important;
                border-radius: 3px;
                padding-left: 8px !important;
            }

            /* Archived Highlighting */
            .tm-raf-highlight-archived {
                border-left: 4px solid #ff4a08 !important;
                background-color: rgba(255, 74, 8, 0.20) !important;
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
            .tm-raf-sub-reset {
                background: transparent;
                border: none;
                color: #d22;
                font-size: 0.65rem;
                cursor: pointer;
                padding: 0;
                font-weight: bold;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.2s ease;
            }
            .tm-raf-sub-reset.visible {
                opacity: 1;
                pointer-events: auto;
            }
            .tm-raf-sub-reset:hover {
                text-decoration: underline;
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
                background-color: transparent; /* Inherits naturally */
                color: inherit;
            }
            .tm-raf-dropdown-menu.open {
                display: block;
            }
            .tm-raf-sub-search {
                padding: 4px;
                border-bottom: 1px dashed rgba(128, 128, 128, 0.3);
            }
            .tm-raf-sub-list {
                max-height: 200px;
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
                margin: 1rem 0 0.5rem 0;
                white-space: nowrap;
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
                border-bottom: 1px solid rgba(128, 128, 128, 0.3);
                margin: 0.35rem 0;
            }

            /* Composite Input Group */
            .tm-raf-input-group {
                display: flex;
                align-items: stretch;
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
            .tm-raf-input-group .tm-raf-input {
                border-top-left-radius: 0;
                border-bottom-left-radius: 0;
                flex: 1;
            }

            /* Search input clearing webkit tweaks */
            .tm-raf-input[type="search"] {
                -webkit-appearance: textfield;
            }
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

            .tm-raf-input-error {
                border-color: #d22 !important;
                background-color: rgba(221, 34, 34, 0.1) !important;
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
                background-color: #28a745;
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

    function updateSubredditDropdownUI() {
        const list = document.getElementById('tm-raf-sub-list');
        const btnText = document.getElementById('tm-raf-sub-btn-text');
        const subBtn = document.getElementById('tm-raf-sub-btn');
        const resetBtn = document.getElementById('tm-raf-sub-reset-btn');

        if (!list || !btnText || !subBtn) return;

        if (resetBtn) {
            resetBtn.classList.toggle('visible', state.hiddenSubreddits.size > 0);
        }

        if (state.knownSubreddits.size <= 1) {
            btnText.textContent = 'No subreddits to filter';
            subBtn.style.pointerEvents = 'none';
            subBtn.style.opacity = '0.7';
            return;
        }

        subBtn.style.pointerEvents = 'auto';
        subBtn.style.opacity = '1';
        btnText.textContent = `Select Subreddits (${state.knownSubreddits.size - state.hiddenSubreddits.size} of ${state.knownSubreddits.size})`;

        // Re-render the sorted list
        list.innerHTML = '';
        const sortedSubs = Array.from(state.knownSubreddits).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

        sortedSubs.forEach(sub => {
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
                    if (resetBtn) resetBtn.classList.toggle('visible', state.hiddenSubreddits.size > 0);
                    queueFilter(true);
                }
            });

            // Make entire row clickable to toggle checkbox
            const item = el('label', { className: 'tm-raf-sub-item' }, [
                checkbox,
                el('span', { textContent: sub })
            ]);
            list.appendChild(item);
        });

        // Re-apply search filter if there is active text
        const searchInput = document.getElementById('tm-raf-sub-search-input');
        if (searchInput && searchInput.value) {
            const term = searchInput.value.toLowerCase();
            Array.from(list.children).forEach(child => {
                const text = child.textContent.toLowerCase();
                child.style.display = text.includes(term) ? 'flex' : 'none';
            });
        }
    }

    function updateUIState() {
        const statsEl = document.getElementById('tm-raf-stats-text');
        const resetBtn = document.getElementById('tm-raf-reset-btn');
        const indicator = document.getElementById('tm-raf-indicator');
        const emptyState = document.getElementById('tm-raf-empty-state');

        if (statsEl) {
            statsEl.textContent = `Showing ${state.visiblePosts} of ${state.totalPosts} posts.`;
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
                    if(id.includes('score')) validateMinMax();
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

        const createInlineDivider = (text) => {
            return el('div', { className: 'tm-raf-inline-divider', textContent: text });
        };

        // --- 1. FILTERS (Basic) ---
        const inputMinScore = createInput('tm-raf-min-score', 'number', 'e.g. 10', state.minScore || '', 'minScore', v => parseInt(v, 10) || 0);
        const inputMaxScore = createInput('tm-raf-max-score', 'number', 'e.g. 1000', state.maxScore, 'maxScore', v => v.trim() === '' ? null : (parseInt(v, 10) || 0));

        inputMinScore.setAttribute('min', '0');
        inputMaxScore.setAttribute('min', '0');

        const scoreSplitRow = el('div', { className: 'tm-raf-split-row' }, [
            el('div', { className: 'tm-raf-split-col' }, [ el('label', { className: 'tm-raf-label', htmlFor: 'tm-raf-min-score', textContent: 'Minimum Score' }), inputMinScore ]),
            el('div', { className: 'tm-raf-split-col' }, [ el('label', { className: 'tm-raf-label', htmlFor: 'tm-raf-max-score', textContent: 'Maximum Score' }), inputMaxScore ])
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

        const dateSplitRow = el('div', { className: 'tm-raf-split-row', style: 'margin-bottom: 0;' }, [
            el('div', { className: 'tm-raf-split-col' }, [ el('label', { className: 'tm-raf-label', htmlFor: 'tm-raf-date-from', textContent: 'Date From' }), inputDateFrom ]),
            el('div', { className: 'tm-raf-split-col' }, [ el('label', { className: 'tm-raf-label', htmlFor: 'tm-raf-date-to', textContent: 'Date To' }), inputDateTo ])
        ]);

        const filtersSection = el('div', { className: 'tm-raf-section', style: 'border-bottom: 1px dashed rgba(128,128,128,0.3);' }, [
            scoreSplitRow,
            dateSplitRow
        ]);

        // --- 2. POST TYPE & SUBREDDIT (Advanced) ---

        // Subreddit Multi-Select Custom UI
        const subSearchInput = el('input', {
            id: 'tm-raf-sub-search-input',
            type: 'search',
            className: 'tm-raf-input',
            placeholder: 'Search subreddits...',
            style: 'width: 100%; box-sizing: border-box; border-radius: 0; border: none;',
            onInput: (e) => {
                const term = e.target.value.toLowerCase();
                const list = document.getElementById('tm-raf-sub-list');
                if (list) {
                    Array.from(list.children).forEach(child => {
                        const text = child.textContent.toLowerCase();
                        child.style.display = text.includes(term) ? 'flex' : 'none';
                    });
                }
            }
        });

        const subDropdownMenu = el('div', { id: 'tm-raf-sub-menu', className: 'tm-raf-dropdown-menu' }, [
            el('div', { className: 'tm-raf-sub-search' }, [subSearchInput]),
            el('div', { id: 'tm-raf-sub-list', className: 'tm-raf-sub-list' }) // Populated dynamically
        ]);

        const subDropdownBtn = el('div', { id: 'tm-raf-sub-btn', className: 'tm-raf-input tm-raf-dropdown-btn' }, [
            el('span', { id: 'tm-raf-sub-btn-text', textContent: 'Scanning subreddits...' }),
            el('span', { textContent: '▼', style: 'font-size: 0.6rem; opacity: 0.7;' })
        ]);

        subDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.knownSubreddits.size <= 1) return;
            const menu = document.getElementById('tm-raf-sub-menu');
            const btn = document.getElementById('tm-raf-sub-btn');
            menu.classList.toggle('open');
            btn.classList.toggle('open');
            if (menu.classList.contains('open')) {
                document.getElementById('tm-raf-sub-search-input').focus();
            }
        });

        const subResetBtn = el('button', {
            id: 'tm-raf-sub-reset-btn',
            type: 'button',
            className: 'tm-raf-sub-reset',
            textContent: 'Reset',
            onClick: (e) => {
                e.stopPropagation();
                state.hiddenSubreddits.clear();
                updateSubredditDropdownUI();
                queueFilter(true);
            }
        });

        const subHeader = el('div', { className: 'tm-raf-sub-header' }, [
            el('label', { className: 'tm-raf-label', textContent: 'Subreddit Filter' }),
            subResetBtn
        ]);

        const subDropdownContainer = el('div', { id: 'tm-raf-sub-container', className: 'tm-raf-dropdown tm-raf-row' }, [
            subHeader,
            subDropdownBtn,
            subDropdownMenu
        ]);

        const typeSelect = el('select', {
            id: 'tm-raf-post-type', className: 'tm-raf-select',
            onChange: (e) => { state.postType = e.target.value; queueFilter(true); }
        }, [
            el('option', { value: 'all', textContent: 'All Posts' }),
            el('option', { value: 'text', textContent: 'Self/Text Only' }),
            el('option', { value: 'link', textContent: 'Links Only' })
        ]);
        typeSelect.value = state.postType;

        const typeSelectRow = el('div', { className: 'tm-raf-row', style: 'margin-bottom: 0;' }, [
            el('label', { className: 'tm-raf-label', htmlFor: 'tm-raf-post-type', textContent: 'Post Type' }),
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
                el('span', { className: 'tm-raf-input-prefix', textContent: 'Highlight Posts with Score >' }),
                inputHighlight
            ])
        ]);

        const interactionSection = el('div', { className: 'tm-raf-section', style: 'margin-bottom: 0;' }, [
            highlightThresholdRow,
            createCheckbox('tm-raf-highlight-archived-cb', 'Highlight Archived Posts', 'highlightArchived'),
            el('hr', { className: 'tm-raf-hr' }),
            el('div', { style: 'display: flex; flex-direction: column; gap: 0.15rem;' }, [
                createCheckbox('tm-raf-hide-upvoted', 'Hide Upvoted Posts', 'hideUpvoted', (e) => {
                    state.hideUpvoted = e.target.checked;
                    if (state.hideUpvoted) {
                        state.showUpvoted = false;
                        const otherCb = document.getElementById('tm-raf-show-upvoted');
                        if (otherCb) otherCb.checked = false;
                    }
                    queueFilter(true);
                }),
                createCheckbox('tm-raf-hide-promoted', 'Hide Promoted Posts', 'hidePromoted')
            ]),
            el('hr', { className: 'tm-raf-hr' }),
            createCheckbox('tm-raf-show-upvoted', 'Show Upvoted Posts Only', 'showUpvoted', (e) => {
                state.showUpvoted = e.target.checked;
                if (state.showUpvoted) {
                    state.hideUpvoted = false;
                    const otherCb = document.getElementById('tm-raf-hide-upvoted');
                    if (otherCb) otherCb.checked = false;
                }
                queueFilter(true);
            })
        ]);

        // --- 4. INCLUSION / EXCLUSION (Show Only & Blocks) ---

        // Show Only Group
        const showOnlySection = el('div', { className: 'tm-raf-row', style: 'margin-bottom: 0.75rem;' }, [
            el('label', { className: 'tm-raf-label', textContent: 'Show Only' }),
            el('div', { className: 'tm-raf-input-group' }, [
                el('span', { className: 'tm-raf-input-prefix', style: 'width: 80px; justify-content: flex-start;', textContent: 'Keywords' }),
                createInput('tm-raf-show-keywords', 'search', 'e.g. megathread, official', state.showKeywords, 'showKeywords', v => v)
            ]),
            el('div', { className: 'tm-raf-input-group' }, [
                el('span', { className: 'tm-raf-input-prefix', style: 'width: 80px; justify-content: flex-start;', textContent: 'Flairs' }),
                createInput('tm-raf-show-flairs', 'search', 'e.g. news, event', state.showFlairs, 'showFlairs', v => v)
            ])
        ]);

        // Block Group
        const blockSection = el('div', { className: 'tm-raf-row', style: 'margin-bottom: 0;' }, [
            el('label', { className: 'tm-raf-label', textContent: 'Block' }),
            el('div', { className: 'tm-raf-input-group' }, [
                el('span', { className: 'tm-raf-input-prefix', style: 'width: 80px; justify-content: flex-start;', textContent: 'Keywords' }),
                createInput('tm-raf-keywords', 'search', 'e.g. politics, spoiler', state.keywords, 'keywords', v => v)
            ]),
            el('div', { className: 'tm-raf-input-group' }, [
                el('span', { className: 'tm-raf-input-prefix', style: 'width: 80px; justify-content: flex-start;', textContent: 'Flairs' }),
                createInput('tm-raf-flairs', 'search', 'e.g. meme, rant', state.flairs, 'flairs', v => v)
            ])
        ]);

        const inclusionExclusionSection = el('div', { className: 'tm-raf-section' }, [
            showOnlySection,
            blockSection
        ]);

        // --- Assembly ---
        const advancedContainer = el('div', {
            id: 'tm-raf-advanced-container',
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
        const btnReset = el('button', {
            id: 'tm-raf-reset-btn', type: 'button', className: 'tm-raf-reset',
            textContent: 'Clear Filters', onClick: resetFilters
        });

        const footerSection = el('div', { className: 'tm-raf-footer' }, [
            el('span', { id: 'tm-raf-stats-text', className: 'tm-raf-stats', textContent: 'Loading...' }),
            btnReset
        ]);

        const panelBody = el('div', { id: 'tm-raf-body', className: 'content' }, [
            filtersSection,
            advancedToggle,
            advancedContainer,
            footerSection
        ]);

        const headerToggle = el('div', {
            className: 'title',
            style: 'display: flex; justify-content: space-between; align-items: center; user-select: none;'
        }, [
            el('h1', { textContent: 'POST FILTERS', style: 'margin: 0; font-weight: 300;' }),
            el('div', { style: 'display: flex; align-items: center; gap: 6px;' }, [
                el('div', { id: 'tm-raf-indicator', className: 'tm-raf-indicator', title: 'Filters Active' })
            ])
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

        const emptyStateContainer = el('div', { id: 'tm-raf-empty-state', className: 'tm-raf-empty-state' }, [
            el('h3', { textContent: 'No posts match your filters.' }),
            el('p', { textContent: 'Adjust your date range, score, or blocklists to see content.' }),
            el('button', { className: 'btn', textContent: 'Clear All Filters', onClick: resetFilters })
        ]);

        if (DOM.siteTable.parentNode) {
            DOM.siteTable.parentNode.insertBefore(emptyStateContainer, DOM.siteTable);
        }
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
        validateMinMax();
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
