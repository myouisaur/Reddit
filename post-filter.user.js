// ==UserScript==
// @name         [Reddit] Post Filter
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      2.5
// @description  Filters Reddit posts.
// @author       Xiv
// @match        *://old.reddit.com/*
// @match        *://www.reddit.com/*
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @updateURL    https://myouisaur.github.io/Reddit/post-filter.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/post-filter.user.js
// ==/UserScript==

(function () {
    'use strict';

    if (window.__tmRedditFilterRunning) return;
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
            TITLE_ELEMENT: 'p.title a.title',
            FLAIR_ELEMENT: '.linkflairlabel',
            PROMOTED_LINK: '.promotedlink',
            SEARCH_BOX: '#search'
        },
        STORAGE_KEY: 'tm_reddit_filter_state_v2'
    };

    const mainContent = document.querySelector(CONFIG.SELECTORS.TARGET_PARENT);
    const siteTable = document.querySelector(CONFIG.SELECTORS.SITE_TABLE);
    const sidebar = document.querySelector(CONFIG.SELECTORS.SIDEBAR);
    if (!mainContent || !siteTable || !sidebar) return;

    let state = {
        dateFrom: null,
        dateTo: null,
        minScore: 0,
        maxScore: null,
        hideUpvoted: false,
        hidePromoted: false,
        postType: 'all',
        keywords: '',
        flairs: '',
        highlightThreshold: null,

        isAdvancedOpen: false,
        totalPosts: 0,
        visiblePosts: 0,
        debounceTimer: null,
        isMutating: false,
        needsFullReeval: true,
        postCache: new WeakMap(),
        io: null
    };

    // ==========================================
    // UTILITIES
    // ==========================================

    function el(tag, attributes = {}, children = []) {
        const element = document.createElement(tag);
        for (const [key, value] of Object.entries(attributes)) {
            if (key === 'className') {
                element.className = value;
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

    function isFilterActive() {
        return state.minScore > 0 || state.maxScore !== null || state.dateFrom !== null ||
               state.dateTo !== null || state.hideUpvoted || state.hidePromoted ||
               state.keywords.trim() !== '' || state.flairs.trim() !== '' ||
               state.postType !== 'all' || state.highlightThreshold !== null;
    }

    function splitAndClean(str) {
        if (!str) return [];
        return str.toLowerCase().split(',').map(s => s.trim()).filter(s => s.length > 0);
    }

    // ==========================================
    // STORAGE MANAGEMENT
    // ==========================================

    function loadState() {
        try {
            const saved = GM_getValue(CONFIG.STORAGE_KEY, '{}');
            const parsed = JSON.parse(saved);
            state.isAdvancedOpen = parsed.isAdvancedOpen === true;
        } catch (e) {
            console.warn('[Reddit Filter] Failed to parse stored state, using defaults.');
        }
    }

    function saveState() {
        try {
            GM_setValue(CONFIG.STORAGE_KEY, JSON.stringify({
                isAdvancedOpen: state.isAdvancedOpen
            }));
        } catch (e) {
            console.error('[Reddit Filter] Failed to save state:', e);
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

            const isPromoted = postEl.classList.contains('promotedlink') || postEl.dataset.promoted === 'true';
            const isTextPost = postEl.classList.contains('self');

            cached = { timestamp, titleText, flairText, isPromoted, isTextPost };
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

    function evaluatePost(postEl, activeKeywords, activeFlairs) {
        const data = getPostData(postEl);
        let isVisible = true;
        let isHighlighted = false;

        if (state.hidePromoted && data.isPromoted) isVisible = false;

        if (isVisible && state.postType !== 'all') {
            if (state.postType === 'text' && !data.isTextPost) isVisible = false;
            if (state.postType === 'link' && data.isTextPost) isVisible = false;
        }

        const validMax = (state.maxScore !== null && state.maxScore >= state.minScore) ? state.maxScore : null;
        if (isVisible && state.minScore > 0 && data.score < state.minScore) isVisible = false;
        if (isVisible && validMax !== null && data.score > validMax) isVisible = false;

        if (isVisible && state.hideUpvoted && data.isUpvoted) isVisible = false;

        if (isVisible && data.timestamp) {
            if (state.dateFrom && data.timestamp < state.dateFrom) isVisible = false;
            if (state.dateTo && data.timestamp > state.dateTo) isVisible = false;
        }

        if (isVisible && activeKeywords.length > 0) {
            for (const kw of activeKeywords) {
                if (data.titleText.includes(kw)) {
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

        postEl.classList.toggle('tm-raf-hidden', !isVisible);
        postEl.classList.toggle('tm-raf-highlight', isHighlighted);

        if (postEl.parentElement && postEl.parentElement.classList.contains('spacer')) {
            postEl.parentElement.classList.toggle('tm-raf-hidden', !isVisible);
        }

        postEl.dataset.tmEval = 'true';
    }

    function executeFilter() {
        if (state.isMutating) return;
        state.isMutating = true;

        requestAnimationFrame(() => {
            const selector = state.needsFullReeval ? CONFIG.SELECTORS.POST_ITEM : `${CONFIG.SELECTORS.POST_ITEM}:not([data-tm-eval="true"])`;
            const postsToProcess = document.querySelectorAll(selector);

            const activeKeywords = splitAndClean(state.keywords);
            const activeFlairs = splitAndClean(state.flairs);

            postsToProcess.forEach(post => {
                evaluatePost(post, activeKeywords, activeFlairs);
            });

            state.totalPosts = document.querySelectorAll(CONFIG.SELECTORS.POST_ITEM).length;
            const hiddenPosts = document.querySelectorAll(`.tm-raf-hidden${CONFIG.SELECTORS.POST_ITEM}`).length;
            state.visiblePosts = state.totalPosts - hiddenPosts;

            state.needsFullReeval = false;
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
        ['tm-raf-min-score', 'tm-raf-max-score', 'tm-raf-date-from', 'tm-raf-date-to', 'tm-raf-keywords', 'tm-raf-flairs', 'tm-raf-highlight'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        ['tm-raf-hide-upvoted', 'tm-raf-hide-promoted'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.checked = false;
        });

        const typeSelect = document.getElementById('tm-raf-post-type');
        if (typeSelect) typeSelect.value = 'all';

        state.minScore = 0;
        state.maxScore = null;
        state.dateFrom = null;
        state.dateTo = null;
        state.hideUpvoted = false;
        state.hidePromoted = false;
        state.postType = 'all';
        state.keywords = '';
        state.flairs = '';
        state.highlightThreshold = null;

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

        observer.observe(mainContent, { childList: true, subtree: true });

        document.addEventListener('click', (e) => {
            if (e.target.matches('.arrow')) queueFilter(true);
        });
    }

    function setupInfiniteScrollSentinel() {
        if (state.io) state.io.disconnect();

        const existing = document.getElementById('tm-raf-sentinel');
        if (existing) existing.remove();

        const sentinel = el('div', { id: 'tm-raf-sentinel', style: 'height: 1px; width: 100%; clear: both;' });
        siteTable.appendChild(sentinel);

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

            /* Layout Structure */
            .tm-raf-section {
                padding-bottom: 0.75rem;
                margin-bottom: 0.75rem;
                border-bottom: 1px dashed rgba(128, 128, 128, 0.3);
            }
            .tm-raf-section:last-child {
                border-bottom: none;
                padding-bottom: 0;
                margin-bottom: 0;
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

            @media (prefers-color-scheme: dark) {
                .tm-raf-input[type="date"]::-webkit-calendar-picker-indicator {
                    filter: invert(1);
                }
            }

            .tm-raf-input-error {
                border-color: #d22 !important;
                background-color: rgba(221, 34, 34, 0.1) !important;
            }
            .tm-raf-checkbox-row {
                display: flex;
                align-items: center;
                gap: 0.4rem;
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
            }
            .tm-raf-stats {
                font-size: 0.75rem;
                opacity: 0.6;
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

    function updateUIState() {
        const statsEl = document.getElementById('tm-raf-stats-text');
        const resetBtn = document.getElementById('tm-raf-reset-btn');
        const indicator = document.getElementById('tm-raf-indicator');
        const emptyState = document.getElementById('tm-raf-empty-state');

        if (statsEl) {
            statsEl.textContent = `${state.visiblePosts} / ${state.totalPosts} posts`;
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

        // --- Basic Section ---
        const inputMinScore = createInput('tm-raf-min-score', 'number', 'Min (e.g. 10)', state.minScore || '', 'minScore', v => parseInt(v, 10) || 0);
        const inputMaxScore = createInput('tm-raf-max-score', 'number', 'Max (infinite)', state.maxScore, 'maxScore', v => v.trim() === '' ? null : (parseInt(v, 10) || 0));
        inputMinScore.setAttribute('min', '0');
        inputMaxScore.setAttribute('min', '0');

        const scoreSplitRow = el('div', { className: 'tm-raf-split-row', style: 'margin-top: 0.5rem;' }, [
            el('div', { className: 'tm-raf-split-col' }, [ el('label', { className: 'tm-raf-label', textContent: 'Min Upvotes' }), inputMinScore ]),
            el('div', { className: 'tm-raf-split-col' }, [ el('label', { className: 'tm-raf-label', textContent: 'Max Upvotes' }), inputMaxScore ])
        ]);

        const inputDateFrom = el('input', {
            id: 'tm-raf-date-from', type: 'date', className: 'tm-raf-input',
            onChange: (e) => { state.dateFrom = parseInputDateToLocal(e.target.value, false); queueFilter(true); }
        });
        const inputDateTo = el('input', {
            id: 'tm-raf-date-to', type: 'date', className: 'tm-raf-input',
            onChange: (e) => { state.dateTo = parseInputDateToLocal(e.target.value, true); queueFilter(true); }
        });

        const dateSplitRow = el('div', { className: 'tm-raf-split-row', style: 'margin-bottom: 0;' }, [
            el('div', { className: 'tm-raf-split-col' }, [ el('label', { className: 'tm-raf-label', textContent: 'Date From' }), inputDateFrom ]),
            el('div', { className: 'tm-raf-split-col' }, [ el('label', { className: 'tm-raf-label', textContent: 'Date To' }), inputDateTo ])
        ]);

        const basicSection = el('div', { className: 'tm-raf-section' }, [
            scoreSplitRow,
            dateSplitRow
        ]);

        // --- Advanced Section ---
        const typeSelect = el('select', {
            id: 'tm-raf-post-type', className: 'tm-raf-select',
            onChange: (e) => { state.postType = e.target.value; queueFilter(true); }
        }, [
            el('option', { value: 'all', textContent: 'All Posts' }),
            el('option', { value: 'text', textContent: 'Self/Text Only' }),
            el('option', { value: 'link', textContent: 'Links Only' })
        ]);
        typeSelect.value = state.postType;

        const inputHighlight = createInput('tm-raf-highlight', 'number', '> 5000', state.highlightThreshold, 'highlightThreshold', v => v.trim() === '' ? null : (parseInt(v, 10) || 0));
        inputHighlight.setAttribute('min', '0');

        const typeAndHighlightRow = el('div', { className: 'tm-raf-split-row' }, [
            el('div', { className: 'tm-raf-split-col' }, [ el('label', { className: 'tm-raf-label', textContent: 'Post Type' }), typeSelect ]),
            el('div', { className: 'tm-raf-split-col' }, [ el('label', { className: 'tm-raf-label', textContent: 'Highlight If...' }), inputHighlight ])
        ]);

        const inputKeywords = createInput('tm-raf-keywords', 'text', 'e.g. politics, update', state.keywords, 'keywords', v => v);
        const keywordsRow = el('div', { className: 'tm-raf-row' }, [
            el('label', { className: 'tm-raf-label' }, [ 'Blocked Keywords', el('span', { className: 'tm-raf-hint', textContent: '(comma-separated)' }) ]),
            inputKeywords
        ]);

        const inputFlairs = createInput('tm-raf-flairs', 'text', 'e.g. meme, rant', state.flairs, 'flairs', v => v);
        const flairsRow = el('div', { className: 'tm-raf-row' }, [
            el('label', { className: 'tm-raf-label' }, [ 'Blocked Flairs', el('span', { className: 'tm-raf-hint', textContent: '(comma-separated)' }) ]),
            inputFlairs
        ]);

        const createCheckbox = (id, labelText, stateKey) => {
            return el('div', { className: 'tm-raf-checkbox-row' }, [
                el('input', {
                    id: id, type: 'checkbox', checked: state[stateKey],
                    onChange: (e) => { state[stateKey] = e.target.checked; queueFilter(true); }
                }),
                el('label', { htmlFor: id, textContent: labelText })
            ]);
        };

        const checkboxSplitRow = el('div', { className: 'tm-raf-split-row', style: 'margin-bottom: 0;' }, [
            el('div', { className: 'tm-raf-split-col' }, [ createCheckbox('tm-raf-hide-upvoted', 'Hide Upvoted', 'hideUpvoted') ]),
            el('div', { className: 'tm-raf-split-col' }, [ createCheckbox('tm-raf-hide-promoted', 'Hide Promoted', 'hidePromoted') ])
        ]);

        const advancedContainer = el('div', {
            id: 'tm-raf-advanced-container',
            className: `tm-raf-advanced-container tm-raf-section ${state.isAdvancedOpen ? 'open' : ''}`
        }, [
            typeAndHighlightRow,
            keywordsRow,
            flairsRow,
            checkboxSplitRow
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

        // --- Assembly using Native Reddit Classes ---
        const panelBody = el('div', { id: 'tm-raf-body', className: 'content' }, [
            basicSection,
            advancedToggle,
            advancedContainer,
            footerSection
        ]);

        const headerToggle = el('div', {
            className: 'title',
            style: 'display: flex; justify-content: space-between; align-items: center; user-select: none;'
        }, [
            el('h1', { textContent: 'Post Filters', style: 'margin: 0;' }),
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

        const searchBox = sidebar.querySelector(CONFIG.SELECTORS.SEARCH_BOX);
        if (searchBox && searchBox.parentNode) {
            searchBox.parentNode.insertAdjacentElement('afterend', panel);
        } else {
            sidebar.prepend(panel);
        }

        const emptyStateContainer = el('div', { id: 'tm-raf-empty-state', className: 'tm-raf-empty-state' }, [
            el('h3', { textContent: 'No posts match your filters.' }),
            el('p', { textContent: 'Adjust your date range, score, or blocklists to see content.' }),
            el('button', { className: 'btn', textContent: 'Clear All Filters', onClick: resetFilters })
        ]);

        siteTable.parentNode.insertBefore(emptyStateContainer, siteTable);
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
