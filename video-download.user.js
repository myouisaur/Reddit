// ==UserScript==
// @name         [Reddit] Video Downloader
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      2.3
// @description  Downloads reddit videos through RapidSave.
// @author       Xiv
// @match        *://*.reddit.com/*
// @match        *://*.rapidsave.com/*
// @noframes
// @updateURL    https://myouisaur.github.io/Reddit/video-download.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/video-download.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // CONFIGURATION
    // ==========================================
    const CONFIG = {
        colors: {
            redditBtnText: '#E53935',
            successBg: '#4CAF50',
            successText: '#ffffff',
            processingBg: '#ff9800'
        },
        intervals: {
            poll: 500,
            submitWait: 200,
            clickDelay: 500
        },
        maxRetries: 30 // Stops polling after 15 seconds (30 * 500ms) to prevent infinite loops
    };

    const host = window.location.hostname;

    // ==========================================
    // UTILITIES
    // ==========================================

    /**
     * Waits for an element to appear in the DOM.
     */
    const waitForElement = (selector, interval, maxAttempts) => {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const check = setInterval(() => {
                attempts++;
                const el = document.querySelector(selector);
                if (el) {
                    clearInterval(check);
                    resolve(el);
                } else if (attempts >= maxAttempts) {
                    clearInterval(check);
                    reject(new Error(`Element ${selector} not found after ${maxAttempts} attempts.`));
                }
            }, interval);
        });
    };

    /**
     * Limits how often a function can fire (debouncing).
     */
    const debounce = (func, wait) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    };

    // ==========================================
    // STEP 1: Reddit - Inject New-Tab Button
    // ==========================================
    if (host.includes('reddit.com')) {
        const injectRedditButtons = () => {
            try {
                // Selectors currently target Old Reddit layout structures.
                const buttonLists = document.querySelectorAll('ul.flat-list.buttons:not(.rs-processed)');

                buttonLists.forEach(list => {
                    list.classList.add('rs-processed');

                    const commentLink = list.querySelector('.bylink.comments');
                    if (commentLink && commentLink.href) {
                        const li = document.createElement('li');
                        const a = document.createElement('a');

                        a.textContent = 'download video';
                        a.style.color = CONFIG.colors.redditBtnText;
                        a.style.fontWeight = 'bold';
                        a.target = '_blank';
                        a.href = `https://rapidsave.com/?reddit_action=download&url=${encodeURIComponent(commentLink.href)}`;

                        li.appendChild(a);
                        list.appendChild(li);
                    }
                });
            } catch (error) {
                console.error('RapidSave Downloader: Error injecting buttons.', error);
            }
        };

        injectRedditButtons();

        // Use debounced observer to prevent performance degradation on heavy DOM updates
        const observer = new MutationObserver(debounce(injectRedditButtons, 300));
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ==========================================
    // STEP 2 & 3: RapidSave Automation
    // ==========================================
    else if (host.includes('rapidsave.com')) {
        const params = new URLSearchParams(window.location.search);

        const startHuntingForDownload = async () => {
            try {
                const btn = await waitForElement('a.downloadbutton[href*="download.php"]', CONFIG.intervals.poll, CONFIG.maxRetries);

                // 1. Remove adblock-breaking analytics
                btn.removeAttribute('onclick');

                // 2. VISUAL CONFIRMATION
                btn.style.backgroundColor = CONFIG.colors.successBg;
                btn.style.borderColor = CONFIG.colors.successBg;
                btn.style.color = CONFIG.colors.successText;

                // Securely construct the DOM instead of using innerHTML
                btn.textContent = '';
                const icon = document.createElement('i');
                icon.className = 'fa fa-check';
                btn.appendChild(icon);
                btn.appendChild(document.createTextNode(' Forcing Download...'));

                // 3. Click the button directly
                setTimeout(() => {
                    try {
                        btn.click();
                        // NOTE: The aggressive window.location.assign fallback was removed
                        // so it doesn't interrupt native browser file-saving behaviors.
                    } catch (clickError) {
                        console.error('RapidSave Downloader: Error clicking download.', clickError);
                    }
                }, CONFIG.intervals.clickDelay);

            } catch (error) {
                console.warn('RapidSave Downloader:', error.message);
            }
        };

        // STEP 2: We just arrived from Reddit (Paste & Submit)
        if (params.get('reddit_action') === 'download') {
            const initSubmit = async () => {
                try {
                    const urlInput = await waitForElement('#url', CONFIG.intervals.submitWait, CONFIG.maxRetries);
                    const submitBtn = document.getElementById('download');

                    if (urlInput && submitBtn) {
                        // Paste link and register it with the site
                        urlInput.value = params.get('url');
                        urlInput.dispatchEvent(new Event('input', { bubbles: true }));

                        // Flag memory in case RapidSave does a hard page reload
                        sessionStorage.setItem('rs_auto_download', 'true');

                        submitBtn.style.backgroundColor = CONFIG.colors.processingBg;
                        submitBtn.textContent = 'Script Clicking...';

                        setTimeout(() => {
                            submitBtn.click();
                            // Immediately start hunting for the result in case they use AJAX (no page reload)
                            startHuntingForDownload();
                        }, CONFIG.intervals.clickDelay);
                    }
                } catch (error) {
                    console.warn('RapidSave Downloader: Submit elements not found.', error.message);
                }
            };

            initSubmit();
        }

        // STEP 3: Handle hard-navigation (URL changes to /info)
        else if (sessionStorage.getItem('rs_auto_download') === 'true') {
            sessionStorage.removeItem('rs_auto_download');
            startHuntingForDownload();
        }
    }
})();
