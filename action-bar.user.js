// ==UserScript==
// @name         [Reddit] Action Bar
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      1.7
// @description  Adds quick links to the action bar.
// @author       Xiv
// @match        *://*.reddit.com/*
// @match        *://*.archive.org/*
// @match        *://*.rapidsave.com/*
// @noframes
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

    // Prevent duplicate initialization on SPA navigations
    if (window.__redditActionBarInit) return;
    window.__redditActionBarInit = true;

    // ==========================================
    // CENTRALIZED CONFIGURATION
    // ==========================================
    const CONFIG = {
        debounceMs: 300,
        colors: {
            textMuted: '#888888',
            archiveSave: '#28a745', // Green
            archiveView: '#ff9800', // Orange
            downloadBtn: '#E53935', // Red
            rsSuccessBg: '#4CAF50',
            rsSuccessText: '#ffffff',
            rsProcessingBg: '#ff9800'
        },
        selectors: {
            redditButtons: 'ul.flat-list.buttons:not(.action-bar-processed)',
            redditCommentLink: '.bylink.comments',
            resLcButton: 'a[data-text="[l+c]"]',
            archiveSaveInput: '#web-save-url-input',
            archiveViewInput: 'input.rbt-input-main',
            archiveSubmitBtn: 'button[type="submit"], input[type="submit"], button.web-save-button',
            rsDownloadBtn: 'a.downloadbutton[href*="download.php"]',
            rsUrlInput: '#url',
            rsSubmitBtn: '#download'
        },
        timeouts: {
            elementWait: 15000, // 15 seconds max wait for dynamic elements
            clickDelay: 500
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
        processRedditPosts();

        const observer = new MutationObserver(debounce(processRedditPosts, CONFIG.debounceMs));
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function processRedditPosts() {
        try {
            const buttonLists = document.querySelectorAll(CONFIG.selectors.redditButtons);
            if (!buttonLists.length) return;

            buttonLists.forEach(list => {
                list.classList.add('action-bar-processed');

                const commentLinkEl = list.querySelector(CONFIG.selectors.redditCommentLink);
                if (!commentLinkEl || !commentLinkEl.href) return;

                const targetUrl = commentLinkEl.href;
                const fragment = document.createDocumentFragment();

                // 1. Append the Archive component
                fragment.appendChild(createArchiveUi(targetUrl));

                // 2. Append Download component unconditionally
                fragment.appendChild(createDownloadUi(targetUrl));

                // 3. Insert into DOM cleanly, respecting RES [l+c] placement
                const resLcNode = list.querySelector(CONFIG.selectors.resLcButton);
                const insertTarget = resLcNode ? resLcNode.closest('li') : null;

                if (insertTarget) {
                    list.insertBefore(fragment, insertTarget);
                } else {
                    list.appendChild(fragment);
                }
            });
        } catch (error) {
            console.error('[Reddit Action Bar] Error processing posts:', error);
        }
    }

    // ==========================================
    // UI BUILDERS
    // ==========================================

    function createArchiveUi(targetUrl) {
        const archiveLi = document.createElement('li');
        archiveLi.style.fontWeight = 'bold';
        archiveLi.style.color = CONFIG.colors.textMuted;

        archiveLi.appendChild(document.createTextNode('archive['));

        const saveBtn = document.createElement('a');
        saveBtn.textContent = 'save';
        saveBtn.href = `https://web.archive.org/save?reddit_action=save&url=${encodeURIComponent(targetUrl)}`;
        saveBtn.target = '_blank';
        saveBtn.style.color = CONFIG.colors.archiveSave;
        saveBtn.style.cursor = 'pointer';
        archiveLi.appendChild(saveBtn);

        archiveLi.appendChild(document.createTextNode('/'));

        const viewBtn = document.createElement('a');
        viewBtn.textContent = 'view';
        viewBtn.href = `https://web.archive.org/?reddit_action=view&url=${encodeURIComponent(targetUrl)}`;
        viewBtn.target = '_blank';
        viewBtn.style.color = CONFIG.colors.archiveView;
        viewBtn.style.cursor = 'pointer';
        archiveLi.appendChild(viewBtn);

        archiveLi.appendChild(document.createTextNode(']'));

        return archiveLi;
    }

    function createDownloadUi(targetUrl) {
        const downloadLi = document.createElement('li');
        const downloadBtn = document.createElement('a');

        downloadBtn.textContent = 'DL vid';
        downloadBtn.href = `https://rapidsave.com/?reddit_action=download&url=${encodeURIComponent(targetUrl)}`;
        downloadBtn.target = '_blank';
        downloadBtn.style.color = CONFIG.colors.downloadBtn;
        downloadBtn.style.fontWeight = 'bold';

        downloadLi.appendChild(downloadBtn);
        return downloadLi;
    }

    // ==========================================
    // ARCHIVE.ORG AUTOMATION
    // ==========================================

    async function setupArchiveAutomation() {
        const urlParams = new URLSearchParams(window.location.search);
        const action = urlParams.get('reddit_action');
        const targetUrl = urlParams.get('url');

        if (!action || !targetUrl) return;

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
                        btn.click();
                    } catch (clickError) {
                        console.error('[Reddit Action Bar] Error clicking RS download.', clickError);
                    }
                }, CONFIG.timeouts.clickDelay);
            } catch (error) {
                console.warn('[Reddit Action Bar] Failed to find RapidSave download button.', error.message);
            }
        };

        if (params.get('reddit_action') === 'download') {
            try {
                const urlInput = await waitForElement(CONFIG.selectors.rsUrlInput);
                const submitBtn = document.querySelector(CONFIG.selectors.rsSubmitBtn);

                if (urlInput && submitBtn) {
                    urlInput.value = params.get('url');
                    urlInput.dispatchEvent(new Event('input', { bubbles: true }));

                    sessionStorage.setItem('rs_auto_download', 'true');
                    submitBtn.style.backgroundColor = CONFIG.colors.rsProcessingBg;
                    submitBtn.textContent = 'Script Clicking...';

                    setTimeout(() => {
                        submitBtn.click();
                        startHuntingForDownload();
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

    function debounce(fn, delay) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), delay);
        };
    }

    /**
     * Promise-based utility to wait for an element to appear in the DOM.
     * Replaces redundant recursive and interval-based implementations.
     */
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

            observer.observe(document.body, { childList: true, subtree: true });

            const timeoutId = setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element '${selector}' not found within ${timeoutMs}ms.`));
            }, timeoutMs);
        });
    }

    function simulateInputAndSubmit(inputElement, value) {
        try {
            // Bypass React/framework synthetic event traps
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
                    if (submitBtn) {
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
            }, 500);
        } catch (error) {
            console.error('[Reddit Action Bar] Failed to simulate input:', error);
        }
    }

    // Initialize Script
    init();
})();
