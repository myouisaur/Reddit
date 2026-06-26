// ==UserScript==
// @name         [Reddit] Action Bar
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      2.5
// @description  Adds quick links to the action bar.
// @author       Xiv
// @match        *://*.reddit.com/*
// @match        *://*.archive.org/*
// @match        *://*.rapidsave.com/*
// @match        *://*.redvid.io/*
// @noframes
// @run-at       document-start
// @updateURL    https://myouisaur.github.io/Reddit/action-bar.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/action-bar.user.js
// ==/UserScript==

// ==========================================
// INJECTED ACTION BAR BUTTONS
// 1. archive[save/view] → web.archive.org (auto-submits on arrival)
// 2. DL vid
//    - RedGifs posts → redvid.io/redgifs-downloader (uses post data-url, auto-clicks download)
//    - All other posts → rapidsave.com/info (uses Reddit permalink, auto-clicks Download HD)
// ==========================================

(function () {
    'use strict';

    if (window.__redditActionBarInit) return;
    window.__redditActionBarInit = true;

    // ==========================================
    // CENTRALIZED CONFIGURATION
    // ==========================================
    const CONFIG = {
        // Only used for follow-up mutation floods (infinite scroll, SPA nav).
        // First-seen bars are always processed synchronously with no delay.
        debounceMs: 150,

        colors: {
            archiveSave:  '#28a745',
            archiveView:  '#ff9800',
            downloadBtn:  '#E53935',
            rsSuccessBg:  '#4CAF50',
            rsSuccessText:'#ffffff'
        },

        // All external URLs in one place — change service URLs here, nowhere else
        urls: {
            archiveSave: 'https://web.archive.org/save',
            archiveView: 'https://web.archive.org/',
            rapidsave:   'https://rapidsave.com/info',
            redvid:      'https://redvid.io/redgifs-downloader'
        },

        selectors: {
            redditButtons:    'ul.flat-list.buttons:not(.action-bar-processed), div[data-click-id="background"] > div:last-child:not(.action-bar-processed)',
            redditCommentLink:'.bylink.comments, a[data-click-id="comments"]',
            resLcButton:      'a[data-text="[l+c]"]',

            archiveSaveInput: '#web-save-url-input',
            archiveViewInput: 'input.rbt-input-main',
            archiveSubmitBtn: 'button[type="submit"], input[type="submit"], button.web-save-button',

            rsDownloadBtn:    'a.downloadbutton[href*="download.php"]',

            rvUrlInput:       '#url',
            rvSubmitBtn:      '#submit-btn',
            rvDownloadBtn:    'a.download-video',

            feedContainers:   ['#siteTable', '#AppRouter-main-content', 'shreddit-app']
        },

        anchorStyleProps: [
            'color', 'fontFamily', 'fontSize', 'fontWeight',
            'letterSpacing', 'textTransform', 'lineHeight', 'textDecoration'
        ],

        timeouts: {
            elementWait:      15000, // Observer-based wait (JS-rendered elements)
            rafPollMax:        8000, // rAF poll cap (server-rendered elements)
            postFillDelay:      500, // Wait after filling an input before clicking submit
            postClickDelay:     500, // Wait after clicking a button before hunting for result
            archiveActionDelay: 500  // Wait after filling archive.org input before submitting
        }
    };

    // ==========================================
    // INIT — route by hostname
    // ==========================================

    function init() {
        try {
            const host = location.hostname;
            if (host.includes('reddit.com'))      setupRedditFeatures();
            else if (host.includes('web.archive.org')) setupArchiveAutomation();
            else if (host.includes('rapidsave.com'))   setupRapidSaveAutomation();
            else if (host.includes('redvid.io'))       setupRedVidAutomation();
        } catch (error) {
            console.error('[Reddit Action Bar] Initialization failed:', error);
        }
    }

    // ==========================================
    // REDDIT DOM INJECTION LOGIC
    // ==========================================

    function setupRedditFeatures() {
        const debouncedProcess = debounce(processRedditPosts, CONFIG.debounceMs);

        // Scan any added nodes immediately and synchronously for action bars.
        // This is the hot path — it fires per-mutation before any debounce,
        // so bars are processed the instant they land in the DOM.
        function onMutation(mutations) {
            let foundNew = false;

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;

                    if (isUnprocessedActionBar(node)) {
                        processSingleBar(node);
                        foundNew = true;
                        continue;
                    }

                    const bars = node.querySelectorAll(CONFIG.selectors.redditButtons);
                    if (bars.length) {
                        bars.forEach(processSingleBar);
                        foundNew = true;
                    }
                }
            }

            // Debounced fallback catches anything the node-scan missed
            // (e.g. attribute changes, SPA rerenders that replace existing nodes)
            if (!foundNew) debouncedProcess();
        }

        // Attach to documentElement immediately — we're at document-start so
        // document.body doesn't exist yet, but documentElement always does.
        const rootObserver = new MutationObserver(onMutation);
        rootObserver.observe(document.documentElement, { childList: true, subtree: true });

        // Immediate scan in case the script runs after some posts already rendered
        processRedditPosts();

        // Once the feed container exists, add a tighter scoped observer in parallel.
        // This doesn't replace the root observer — it adds a faster, lower-overhead
        // path for the main feed where most mutations happen.
        waitForFeedContainer().then(container => {
            if (!container) return;
            const feedObserver = new MutationObserver(onMutation);
            feedObserver.observe(container, { childList: true, subtree: true });
        }).catch(() => {
            // Feed container never appeared — root observer is sufficient fallback
        });
    }

    function isUnprocessedActionBar(el) {
        // Fast check before running the full selector query
        if (el.tagName === 'UL' && el.classList.contains('flat-list') && el.classList.contains('buttons')) {
            return !el.classList.contains('action-bar-processed');
        }
        return false;
    }

    function processSingleBar(list) {
        try {
            // Guard: already processed (handles double-firing from dual observers)
            if (list.classList.contains('action-bar-processed')) return;
            list.classList.add('action-bar-processed');

            const commentLinkEl = list.querySelector(CONFIG.selectors.redditCommentLink);
            if (!commentLinkEl || !commentLinkEl.href) return;

            const permalinkUrl = commentLinkEl.href;
            const isOldReddit  = list.tagName === 'UL';
            const nativeStyles = sampleNativeAnchorStyles(list, commentLinkEl);

            // Detect RedGifs source — old Reddit exposes it in the domain span.
            // New Reddit fallback: check data-url on the parent .thing element.
            // Use || not ?? so a false result from domainLink actually falls through
            // to the data-url check (false ?? fallback never evaluates the fallback).
            const thing      = list.closest('.thing');
            const domainLink = list.closest('.entry')?.querySelector('.domain a') ||
                               thing?.querySelector('.domain a');
            const isRedGifs  = domainLink?.href?.includes('redgifs.com') ||
                               thing?.dataset?.url?.includes('redgifs.com') ||
                               false;

            // RedGifs: pass the direct media URL to redvid.io.
            // Everything else: pass the Reddit permalink to rapidsave.com.
            const mediaUrl     = thing?.dataset?.url ?? null;
            const downloadRoute = isRedGifs && mediaUrl
                ? { service: 'redvid',    url: mediaUrl }
                : { service: 'rapidsave', url: permalinkUrl };

            const fragment = document.createDocumentFragment();
            fragment.appendChild(createArchiveUi(permalinkUrl, isOldReddit, nativeStyles));
            fragment.appendChild(createDownloadUi(downloadRoute, isOldReddit, nativeStyles));

            const resLcNode    = list.querySelector(CONFIG.selectors.resLcButton);
            const insertTarget = resLcNode ? resLcNode.closest('li') : null;

            if (insertTarget) {
                list.insertBefore(fragment, insertTarget);
            } else {
                list.appendChild(fragment);
            }
        } catch (error) {
            console.error('[Reddit Action Bar] Error processing action bar:', error);
        }
    }

    // Bulk scan — used on init and as a debounced fallback for edge cases
    function processRedditPosts() {
        try {
            const bars = document.querySelectorAll(CONFIG.selectors.redditButtons);
            bars.forEach(processSingleBar);
        } catch (error) {
            console.error('[Reddit Action Bar] Error in bulk scan:', error);
        }
    }

    // Resolves with the feed container once found, or null after timeout
    function waitForFeedContainer(timeoutMs = 10000) {
        return new Promise((resolve) => {
            for (const selector of CONFIG.selectors.feedContainers) {
                const el = document.querySelector(selector);
                if (el) return resolve(el);
            }

            const observer = new MutationObserver((_, obs) => {
                for (const selector of CONFIG.selectors.feedContainers) {
                    const el = document.querySelector(selector);
                    if (el) {
                        obs.disconnect();
                        clearTimeout(tid);
                        resolve(el);
                        return;
                    }
                }
            });

            observer.observe(document.documentElement, { childList: true, subtree: true });

            const tid = setTimeout(() => {
                observer.disconnect();
                resolve(null); // Root observer is the fallback
            }, timeoutMs);
        });
    }

    // ==========================================
    // STYLE SAMPLING
    // ==========================================

    function sampleNativeAnchorStyles(list, excludeEl) {
        const candidates = list.querySelectorAll('li a');

        for (const el of candidates) {
            if (el === excludeEl) continue;
            if (!el.textContent.trim()) continue;

            const computed  = window.getComputedStyle(el);
            const snapshot  = {};
            for (const prop of CONFIG.anchorStyleProps) {
                snapshot[prop] = computed[prop];
            }
            return snapshot;
        }

        return null;
    }

    // ==========================================
    // UI BUILDERS
    // ==========================================

    function createTextSpan(text, nativeStyles) {
        const span = document.createElement('span');
        span.textContent = text;
        if (nativeStyles) {
            for (const prop of CONFIG.anchorStyleProps) {
                if (nativeStyles[prop]) span.style[prop] = nativeStyles[prop];
            }
        }
        return span;
    }

    function createStyledLink(text, href, color, isOldReddit, nativeStyles) {
        const a = document.createElement('a');
        a.textContent = text;
        a.href        = href;
        a.target      = '_blank';
        a.className   = isOldReddit ? 'bylink' : '';

        if (nativeStyles) {
            for (const prop of CONFIG.anchorStyleProps) {
                if (nativeStyles[prop]) a.style[prop] = nativeStyles[prop];
            }
        }

        // Color override intentionally after — our branding supersedes the sampled color
        a.style.color = color;

        return a;
    }

    function createArchiveUi(targetUrl, isOldReddit, nativeStyles) {
        const wrapper = document.createElement(isOldReddit ? 'li' : 'div');
        if (!isOldReddit) wrapper.style.display     = 'inline-block';
        if (!isOldReddit) wrapper.style.marginRight = '8px';

        const saveUrl = `${CONFIG.urls.archiveSave}?reddit_action=save&url=${encodeURIComponent(targetUrl)}`;
        const viewUrl = `${CONFIG.urls.archiveView}?reddit_action=view&url=${encodeURIComponent(targetUrl)}`;

        wrapper.appendChild(createTextSpan('archive[', nativeStyles));
        wrapper.appendChild(createStyledLink('save', saveUrl, CONFIG.colors.archiveSave, isOldReddit, nativeStyles));
        wrapper.appendChild(createTextSpan('/', nativeStyles));
        wrapper.appendChild(createStyledLink('view', viewUrl, CONFIG.colors.archiveView, isOldReddit, nativeStyles));
        wrapper.appendChild(createTextSpan(']', nativeStyles));

        return wrapper;
    }

    function createDownloadUi(downloadRoute, isOldReddit, nativeStyles) {
        const wrapper = document.createElement(isOldReddit ? 'li' : 'div');
        if (!isOldReddit) wrapper.style.display = 'inline-block';

        const downloadUrl = downloadRoute.service === 'redvid'
            ? `${CONFIG.urls.redvid}?reddit_action=download&url=${encodeURIComponent(downloadRoute.url)}`
            // Link directly to the results page — RapidSave redirects there anyway
            : `${CONFIG.urls.rapidsave}?url=${encodeURIComponent(downloadRoute.url)}`;

        wrapper.appendChild(createStyledLink('DL vid', downloadUrl, CONFIG.colors.downloadBtn, isOldReddit, nativeStyles));

        return wrapper;
    }

    // ==========================================
    // ARCHIVE.ORG AUTOMATION
    // ==========================================

    async function setupArchiveAutomation() {
        const urlParams  = new URLSearchParams(window.location.search);
        const action     = urlParams.get('reddit_action');
        const targetUrl  = urlParams.get('url');

        if (!action || !isValidUrl(targetUrl, 'reddit.com')) return;

        try {
            const selector = action === 'save'
                ? CONFIG.selectors.archiveSaveInput
                : CONFIG.selectors.archiveViewInput;
            const inputEl = await waitForElementObserver(selector);
            fillInputAndSubmit(inputEl, targetUrl);
        } catch (error) {
            console.warn('[Reddit Action Bar] Archive.org automation failed:', error.message);
        }
    }

    // ==========================================
    // REDVID.IO AUTOMATION (RedGifs)
    // ==========================================

    async function setupRedVidAutomation() {
        const params    = new URLSearchParams(window.location.search);
        const targetUrl = params.get('url');

        if (params.get('reddit_action') !== 'download' || !isValidUrl(targetUrl, 'redgifs.com')) return;

        try {
            const urlInput  = await waitForElementObserver(CONFIG.selectors.rvUrlInput);
            const submitBtn = await waitForElementObserver(CONFIG.selectors.rvSubmitBtn);

            fillInput(urlInput, targetUrl);

            setTimeout(() => {
                try {
                    if (document.body.contains(submitBtn)) {
                        submitBtn.click();
                        // Page re-renders after submit — hunt for download button via observer
                        huntAndClick(CONFIG.selectors.rvDownloadBtn, waitForElementObserver);
                    }
                } catch (clickError) {
                    console.error('[Reddit Action Bar][RedVid] Error clicking submit.', clickError);
                }
            }, CONFIG.timeouts.postFillDelay);

        } catch (error) {
            console.warn(`[Reddit Action Bar][RedVid] Element not found on redvid.io — site layout may have changed. (${error.message})`);
        }
    }

    // ==========================================
    // RAPIDSAVE AUTOMATION
    // ==========================================

    async function setupRapidSaveAutomation() {
        // We link directly to rapidsave.com/info?url=... so the homepage form
        // is never visited. Detect the results page by pathname and hunt immediately.
        if (!location.pathname.startsWith('/info')) return;

        const params    = new URLSearchParams(window.location.search);
        const targetUrl = params.get('url');
        if (!isValidUrl(targetUrl, 'reddit.com')) return;

        // Results page is server-rendered but waitForElementObserver checks the DOM
        // synchronously first — so it catches the button whether it's already there
        // or arrives later. Unlike rAF polling, observers fire in background tabs.
        huntAndClick(CONFIG.selectors.rsDownloadBtn, waitForElementObserver, (btn) => {
            // Style the button before clicking to give visual confirmation
            btn.removeAttribute('onclick');
            btn.style.backgroundColor = CONFIG.colors.rsSuccessBg;
            btn.style.borderColor     = CONFIG.colors.rsSuccessBg;
            btn.style.color           = CONFIG.colors.rsSuccessText;
            btn.textContent           = '';

            const icon = document.createElement('i');
            icon.className = 'fa fa-check';
            btn.appendChild(icon);
            btn.appendChild(document.createTextNode(' Forcing Download...'));
        });
    }

    // ==========================================
    // UTILITIES
    // ==========================================

    // Unified URL validator — hostname must end with the given suffix
    function isValidUrl(url, hostname) {
        if (!url) return false;
        try {
            return new URL(url).hostname.endsWith(hostname);
        } catch {
            return false;
        }
    }

    // Fills an input using the native setter so React/Vue listeners fire correctly
    function fillInput(inputEl, value) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) {
            nativeSetter.call(inputEl, value);
        } else {
            inputEl.value = value;
        }
        inputEl.dispatchEvent(new Event('input',  { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Fills an input then submits — used by archive.org which has a real form
    function fillInputAndSubmit(inputEl, value) {
        try {
            fillInput(inputEl, value);

            setTimeout(() => {
                const form = inputEl.closest('form');
                if (form) {
                    const submitBtn = form.querySelector(CONFIG.selectors.archiveSubmitBtn);
                    if (submitBtn && document.body.contains(submitBtn)) {
                        submitBtn.click();
                    } else {
                        form.submit();
                    }
                } else {
                    ['keydown', 'keypress', 'keyup'].forEach(eventType => {
                        inputEl.dispatchEvent(new KeyboardEvent(eventType, {
                            bubbles: true, cancelable: true,
                            key: 'Enter', code: 'Enter', keyCode: 13, which: 13
                        }));
                    });
                }
            }, CONFIG.timeouts.archiveActionDelay);
        } catch (error) {
            console.error('[Reddit Action Bar] Failed to fill and submit input:', error);
        }
    }

    // Waits for an element, optionally runs a decorator on it, then clicks it.
    // waitFn is injected so callers choose observer vs rAF polling as appropriate.
    async function huntAndClick(selector, waitFn, decorateFn = null) {
        try {
            const btn = await waitFn(selector);
            if (!document.body.contains(btn)) return;
            if (decorateFn) decorateFn(btn);
            setTimeout(() => {
                try {
                    if (document.body.contains(btn)) btn.click();
                } catch (clickError) {
                    console.error(`[Reddit Action Bar] Error clicking '${selector}'.`, clickError);
                }
            }, CONFIG.timeouts.postClickDelay);
        } catch (error) {
            console.warn(`[Reddit Action Bar] Button '${selector}' did not appear.`, error.message);
        }
    }

    function debounce(fn, delay) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), delay);
        };
    }

    // Observer-based wait — best for elements injected by JS after page load.
    // May miss elements that are server-rendered into the initial HTML since
    // those arrive before the observer attaches at document-start.
    function waitForElementObserver(selector, timeoutMs = CONFIG.timeouts.elementWait) {
        return new Promise((resolve, reject) => {
            const el = document.querySelector(selector);
            if (el) return resolve(el);

            const observer = new MutationObserver((_, obs) => {
                const found = document.querySelector(selector);
                if (found) {
                    obs.disconnect();
                    clearTimeout(timeoutId);
                    resolve(found);
                }
            });

            observer.observe(document.documentElement, { childList: true, subtree: true });

            const timeoutId = setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element '${selector}' not found within ${timeoutMs}ms.`));
            }, timeoutMs);
        });
    }

    // rAF poll-based wait — for server-rendered elements that exist in the initial
    // HTML but may not be queryable yet at document-start. Polls every 3 frames
    // to reduce querySelector frequency vs every-frame polling.
    function waitForElementPoll(selector, timeoutMs = CONFIG.timeouts.rafPollMax) {
        return new Promise((resolve, reject) => {
            const start = performance.now();
            let frameCount = 0;

            function poll() {
                frameCount++;

                // Check every 3rd frame to reduce querySelector pressure
                if (frameCount % 3 === 0) {
                    const el = document.querySelector(selector);
                    if (el) return resolve(el);
                }

                if (performance.now() - start >= timeoutMs) {
                    return reject(new Error(`Element '${selector}' not found within ${timeoutMs}ms.`));
                }

                requestAnimationFrame(poll);
            }

            requestAnimationFrame(poll);
        });
    }

    init();
})();
