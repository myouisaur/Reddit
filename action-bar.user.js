// ==UserScript==
// @name         [Reddit] Action Bar
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      2.3
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
// 1. archive[save/view]
// 2. DL vid
//    - RedGifs posts → redvid.io/redgifs-downloader (uses data-url)
//    - All other posts → rapidsave.com (uses Reddit permalink)
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
            archiveSave: '#28a745',
            archiveView: '#ff9800',
            downloadBtn: '#E53935',
            rsSuccessBg: '#4CAF50',
            rsSuccessText: '#ffffff'
        },
        selectors: {
            redditButtons: 'ul.flat-list.buttons:not(.action-bar-processed), div[data-click-id="background"] > div:last-child:not(.action-bar-processed)',
            redditCommentLink: '.bylink.comments, a[data-click-id="comments"]',
            resLcButton: 'a[data-text="[l+c]"]',

            archiveSaveInput: '#web-save-url-input',
            archiveViewInput: 'input.rbt-input-main',
            archiveSubmitBtn: 'button[type="submit"], input[type="submit"], button.web-save-button',

            rsDownloadBtn: 'a.downloadbutton[href*="download.php"]',

            rvUrlInput: '#url',
            rvSubmitBtn: '#submit-btn',
            rvDownloadBtn: 'a.download-video',

            feedContainers: ['#siteTable', '#AppRouter-main-content', 'shreddit-app']
        },
        anchorStyleProps: [
            'color', 'fontFamily', 'fontSize', 'fontWeight',
            'letterSpacing', 'textTransform', 'lineHeight', 'textDecoration'
        ],
        timeouts: {
            elementWait: 15000,
            clickDelay: 500,
            actionDelay: 500
        }
    };

    function init() {
        try {
            const host = location.hostname;
            if (host.includes('reddit.com')) {
                setupRedditFeatures();
            } else if (host.includes('web.archive.org')) {
                setupArchiveAutomation();
            } else if (host.includes('rapidsave.com')) {
                setupRapidSaveAutomation();
            } else if (host.includes('redvid.io')) {
                setupRedVidAutomation();
            }
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

                    // Check if the added node itself is an action bar
                    if (isUnprocessedActionBar(node)) {
                        processSingleBar(node);
                        foundNew = true;
                        continue;
                    }

                    // Check if it contains action bars (e.g. a post wrapper was added)
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
        // This means we observe from the very first DOM mutation with zero gap.
        const rootObserver = new MutationObserver(onMutation);
        rootObserver.observe(document.documentElement, { childList: true, subtree: true });

        // Also do an immediate scan in case the script runs after some posts rendered
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
            const isOldReddit = list.tagName === 'UL';
            const nativeStyles = sampleNativeAnchorStyles(list, commentLinkEl);

            // Detect RedGifs source — present in old Reddit's domain span.
            // For new Reddit, fall back to checking the post's data-url attribute.
            const thing = list.closest('.thing');
            const domainLink = list.closest('.entry')?.querySelector('.domain a') ??
                               thing?.querySelector('.domain a');
            const isRedGifs = domainLink?.href?.includes('redgifs.com') ??
                               thing?.dataset?.url?.includes('redgifs.com') ??
                               false;

            // RedGifs posts: pass the direct media URL to redvid.io.
            // All other posts: pass the Reddit permalink to rapidsave.com.
            const mediaUrl = thing?.dataset?.url ?? null;
            const downloadRoute = isRedGifs && mediaUrl
                ? { service: 'redvid', url: mediaUrl }
                : { service: 'rapidsave', url: permalinkUrl };

            const fragment = document.createDocumentFragment();
            fragment.appendChild(createArchiveUi(permalinkUrl, isOldReddit, nativeStyles));
            fragment.appendChild(createDownloadUi(downloadRoute, isOldReddit, nativeStyles));

            const resLcNode = list.querySelector(CONFIG.selectors.resLcButton);
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

    // Resolves once a feed container exists, or null after timeout
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
                resolve(null); // Resolve null — root observer is the fallback
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

            const computed = window.getComputedStyle(el);
            const snapshot = {};
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
        a.href = href;
        a.target = '_blank';
        a.className = isOldReddit ? 'bylink' : '';

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
        if (!isOldReddit) wrapper.style.display = 'inline-block';
        if (!isOldReddit) wrapper.style.marginRight = '8px';

        wrapper.appendChild(createTextSpan('archive[', nativeStyles));

        const saveUrl = `https://web.archive.org/save?reddit_action=save&url=${encodeURIComponent(targetUrl)}`;
        wrapper.appendChild(createStyledLink('save', saveUrl, CONFIG.colors.archiveSave, isOldReddit, nativeStyles));

        wrapper.appendChild(createTextSpan('/', nativeStyles));

        const viewUrl = `https://web.archive.org/?reddit_action=view&url=${encodeURIComponent(targetUrl)}`;
        wrapper.appendChild(createStyledLink('view', viewUrl, CONFIG.colors.archiveView, isOldReddit, nativeStyles));

        wrapper.appendChild(createTextSpan(']', nativeStyles));

        return wrapper;
    }

    function createDownloadUi(downloadRoute, isOldReddit, nativeStyles) {
        const wrapper = document.createElement(isOldReddit ? 'li' : 'div');
        if (!isOldReddit) wrapper.style.display = 'inline-block';

        let downloadUrl;
        if (downloadRoute.service === 'redvid') {
            downloadUrl = `https://redvid.io/redgifs-downloader?reddit_action=download&url=${encodeURIComponent(downloadRoute.url)}`;
        } else {
            // Link directly to the results page — RapidSave redirects there anyway,
            // so skipping the homepage means our script lands on the right page immediately.
            downloadUrl = `https://rapidsave.com/info?url=${encodeURIComponent(downloadRoute.url)}`;
        }

        wrapper.appendChild(createStyledLink('DL vid', downloadUrl, CONFIG.colors.downloadBtn, isOldReddit, nativeStyles));

        return wrapper;
    }

    // ==========================================
    // ARCHIVE.ORG AUTOMATION
    // ==========================================

    async function setupArchiveAutomation() {
        const urlParams = new URLSearchParams(window.location.search);
        const action = urlParams.get('reddit_action');
        const targetUrl = urlParams.get('url');

        if (!action || !targetUrl || !isValidRedditUrl(targetUrl)) return;

        try {
            const selector = action === 'save' ? CONFIG.selectors.archiveSaveInput : CONFIG.selectors.archiveViewInput;
            const inputEl = await waitForElement(selector);
            simulateInputAndSubmit(inputEl, targetUrl);
        } catch (error) {
            console.warn('[Reddit Action Bar] Archive.org automation failed:', error.message);
        }
    }

    // ==========================================
    // REDVID.IO AUTOMATION (RedGifs)
    // ==========================================

    async function setupRedVidAutomation() {
        const params = new URLSearchParams(window.location.search);

        if (params.get('reddit_action') !== 'download') return;

        const targetUrl = params.get('url');
        if (!isValidRedGifsUrl(targetUrl)) return;

        try {
            const urlInput = await waitForElement(CONFIG.selectors.rvUrlInput);
            const submitBtn = await waitForElement(CONFIG.selectors.rvSubmitBtn);

            if (!urlInput || !submitBtn) return;

            // Fill the URL field using native setter so any framework listeners fire
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeSetter) {
                nativeSetter.call(urlInput, targetUrl);
            } else {
                urlInput.value = targetUrl;
            }

            urlInput.dispatchEvent(new Event('input', { bubbles: true }));
            urlInput.dispatchEvent(new Event('change', { bubbles: true }));

            setTimeout(() => {
                try {
                    if (document.body.contains(submitBtn)) {
                        submitBtn.click();
                        startHuntingForRedVidDownload();
                    }
                } catch (clickError) {
                    console.error('[Reddit Action Bar][RedVid] Error clicking submit.', clickError);
                }
            }, CONFIG.timeouts.clickDelay);

        } catch (error) {
            console.warn('[Reddit Action Bar][RedVid] Submit elements not found on redvid.io.', error.message);
        }
    }

    async function startHuntingForRedVidDownload() {
        try {
            // The page re-renders after submit — wait for the download anchor to appear
            const btn = await waitForElement(CONFIG.selectors.rvDownloadBtn);
            if (document.body.contains(btn)) btn.click();
        } catch (error) {
            console.warn('[Reddit Action Bar][RedVid] Download button did not appear.', error.message);
        }
    }

    // ==========================================
    // RAPIDSAVE AUTOMATION
    // ==========================================

    async function setupRapidSaveAutomation() {
        // We link directly to rapidsave.com/info?url=... so the homepage form
        // is never visited. Detect the results page by pathname and hunt immediately.
        if (!location.pathname.startsWith('/info')) return;

        const params = new URLSearchParams(window.location.search);
        const targetUrl = params.get('url');
        if (!isValidRedditUrl(targetUrl)) return;

        startHuntingForDownload();
    }

    async function startHuntingForDownload() {
        try {
            // Results page is server-rendered — button may already be in the HTML.
            // waitForElementReady polls via rAF so it catches it regardless of timing.
            const btn = await waitForElementReady(CONFIG.selectors.rsDownloadBtn);

            btn.removeAttribute('onclick');
            btn.style.backgroundColor = CONFIG.colors.rsSuccessBg;
            btn.style.borderColor = CONFIG.colors.rsSuccessBg;
            btn.style.color = CONFIG.colors.rsSuccessText;
            btn.textContent = '';

            const icon = document.createElement('i');
            icon.className = 'fa fa-check';
            btn.appendChild(icon);
            btn.appendChild(document.createTextNode(' Forcing Download...'));

            setTimeout(() => {
                try {
                    if (document.body.contains(btn)) btn.click();
                } catch (clickError) {
                    console.error('[Reddit Action Bar] Error clicking RS download button.', clickError);
                }
            }, CONFIG.timeouts.clickDelay);

        } catch (error) {
            console.warn('[Reddit Action Bar] Download HD button did not appear on RapidSave results page.', error.message);
        }
    }

    // ==========================================
    // UTILITIES
    // ==========================================

    function isValidRedditUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.hostname.endsWith('reddit.com');
        } catch {
            return false;
        }
    }

    function isValidRedGifsUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.hostname.endsWith('redgifs.com');
        } catch {
            return false;
        }
    }

    function debounce(fn, delay) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), delay);
        };
    }

    // waitForElement — MutationObserver-based. Best for elements injected by JS
    // after page load. May miss elements that are server-rendered into the initial
    // HTML, since those arrive before the observer attaches at document-start.
    function waitForElement(selector, timeoutMs = CONFIG.timeouts.elementWait) {
        return new Promise((resolve, reject) => {
            const el = document.querySelector(selector);
            if (el) return resolve(el);

            const observer = new MutationObserver((mutations, obs) => {
                const foundEl = document.querySelector(selector);
                if (foundEl) {
                    obs.disconnect();
                    clearTimeout(timeoutId);
                    resolve(foundEl);
                }
            });

            observer.observe(document.documentElement, { childList: true, subtree: true });

            const timeoutId = setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element '${selector}' not found within ${timeoutMs}ms.`));
            }, timeoutMs);
        });
    }

    // waitForElementReady — rAF polling fallback for server-rendered elements.
    // Used on the RapidSave results page where the download button is in the
    // initial HTML but the script runs at document-start before the DOM is built.
    // Polls every animation frame until the element appears or timeout is reached.
    function waitForElementReady(selector, timeoutMs = CONFIG.timeouts.elementWait) {
        return new Promise((resolve, reject) => {
            const start = performance.now();

            function poll() {
                const el = document.querySelector(selector);
                if (el) return resolve(el);

                if (performance.now() - start >= timeoutMs) {
                    return reject(new Error(`Element '${selector}' not ready within ${timeoutMs}ms.`));
                }

                requestAnimationFrame(poll);
            }

            requestAnimationFrame(poll);
        });
    }

    function simulateInputAndSubmit(inputElement, value) {
        try {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            if (nativeInputValueSetter) {
                nativeInputValueSetter.call(inputElement, value);
            } else {
                inputElement.value = value;
            }

            inputElement.dispatchEvent(new Event('input', { bubbles: true }));
            inputElement.dispatchEvent(new Event('change', { bubbles: true }));

            setTimeout(() => {
                const form = inputElement.closest('form');
                if (form) {
                    const submitBtn = form.querySelector(CONFIG.selectors.archiveSubmitBtn);
                    if (submitBtn && document.body.contains(submitBtn)) {
                        submitBtn.click();
                    } else {
                        form.submit();
                    }
                } else {
                    ['keydown', 'keypress', 'keyup'].forEach(eventType => {
                        inputElement.dispatchEvent(new KeyboardEvent(eventType, {
                            bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13
                        }));
                    });
                }
            }, CONFIG.timeouts.actionDelay);
        } catch (error) {
            console.error('[Reddit Action Bar] Failed to simulate input:', error);
        }
    }

    init();
})();
