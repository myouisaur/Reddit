// ==UserScript==
// @name         [Reddit] Action Bar
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      2.0
// @description  Adds quick links to the action bar.
// @author       Xiv
// @match        *://*.reddit.com/*
// @match        *://*.archive.org/*
// @match        *://*.rapidsave.com/*
// @noframes
// @run-at       document-start
// @updateURL    https://myouisaur.github.io/Reddit/action-bar.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/action-bar.user.js
// ==/UserScript==

// ==========================================
// INJECTED ACTION BAR BUTTONS
// 1. archive[save/view]
// 2. DL vid
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
            rsSuccessText: '#ffffff',
            rsProcessingBg: '#ff9800'
        },
        selectors: {
            redditButtons: 'ul.flat-list.buttons:not(.action-bar-processed), div[data-click-id="background"] > div:last-child:not(.action-bar-processed)',
            redditCommentLink: '.bylink.comments, a[data-click-id="comments"]',
            resLcButton: 'a[data-text="[l+c]"]',

            archiveSaveInput: '#web-save-url-input',
            archiveViewInput: 'input.rbt-input-main',
            archiveSubmitBtn: 'button[type="submit"], input[type="submit"], button.web-save-button',

            rsDownloadBtn: 'a.downloadbutton[href*="download.php"]',
            rsUrlInput: '#url',
            rsSubmitBtn: '#download',

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

            const targetUrl = commentLinkEl.href;
            const isOldReddit = list.tagName === 'UL';
            const nativeStyles = sampleNativeAnchorStyles(list, commentLinkEl);

            const fragment = document.createDocumentFragment();
            fragment.appendChild(createArchiveUi(targetUrl, isOldReddit, nativeStyles));
            fragment.appendChild(createDownloadUi(targetUrl, isOldReddit, nativeStyles));

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

    function createDownloadUi(targetUrl, isOldReddit, nativeStyles) {
        const wrapper = document.createElement(isOldReddit ? 'li' : 'div');
        if (!isOldReddit) wrapper.style.display = 'inline-block';

        const downloadUrl = `https://rapidsave.com/?reddit_action=download&url=${encodeURIComponent(targetUrl)}`;
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
    // RAPIDSAVE AUTOMATION
    // ==========================================

    async function setupRapidSaveAutomation() {
        const params = new URLSearchParams(window.location.search);

        const startHuntingForDownload = async () => {
            try {
                const btn = await waitForElement(CONFIG.selectors.rsDownloadBtn);
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
                        console.error('[Reddit Action Bar] Error clicking RS download.', clickError);
                    }
                }, CONFIG.timeouts.clickDelay);
            } catch (error) {
                console.warn('[Reddit Action Bar] Failed to find RapidSave download button.', error.message);
            }
        };

        const targetUrl = params.get('url');

        if (params.get('reddit_action') === 'download' && isValidRedditUrl(targetUrl)) {
            try {
                const urlInput = await waitForElement(CONFIG.selectors.rsUrlInput);
                const submitBtn = await waitForElement(CONFIG.selectors.rsSubmitBtn);

                if (urlInput && submitBtn) {
                    urlInput.value = targetUrl;
                    urlInput.dispatchEvent(new Event('input', { bubbles: true }));

                    sessionStorage.setItem('rs_auto_download', 'true');
                    submitBtn.style.backgroundColor = CONFIG.colors.rsProcessingBg;
                    submitBtn.textContent = 'Script Clicking...';

                    setTimeout(() => {
                        if (document.body.contains(submitBtn)) {
                            submitBtn.click();
                            startHuntingForDownload();
                        }
                    }, CONFIG.timeouts.clickDelay);
                }
            } catch (error) {
                console.warn('[Reddit Action Bar] Submit elements not found on RapidSave.', error.message);
            }
        } else if (sessionStorage.getItem('rs_auto_download') === 'true') {
            sessionStorage.removeItem('rs_auto_download');
            startHuntingForDownload();
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

    function debounce(fn, delay) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), delay);
        };
    }

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
