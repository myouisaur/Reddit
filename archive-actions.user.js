// ==UserScript==
// @name         [Reddit] Archive Actions
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      1.1
// @description  Adds archive save and view buttons to Reddit posts with automated Archive.org form submission.
// @author       Xiv
// @match        *://*.reddit.com/*
// @match        *://*.archive.org/*
// @updateURL    https://myouisaur.github.io/Reddit/archive-actions.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/archive-actions.user.js
// ==/UserScript==

(function () {
    'use strict';

    function init() {
        const host = location.hostname;
        if (host.includes('reddit.com')) {
            setupRedditFeatures();
        } else if (host.includes('web.archive.org')) {
            setupArchiveAutomation();
        }
    }

    // ==========================================
    // REDDIT LOGIC
    // ==========================================

    function setupRedditFeatures() {
        processRedditPosts();

        // Handle dynamically loaded posts
        const observer = new MutationObserver(debounce(processRedditPosts, 300));
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function processRedditPosts() {
        const buttonLists = document.querySelectorAll('ul.flat-list.buttons:not(.archive-processed)');
        if (!buttonLists.length) return;

        buttonLists.forEach(list => {
            list.classList.add('archive-processed');

            const commentLinkEl = list.querySelector('.bylink.comments');
            if (!commentLinkEl || !commentLinkEl.href) return;

            const targetUrl = commentLinkEl.href;

            // 1. Save to Archive Button (Green)
            const saveLi = document.createElement('li');
            const saveBtn = document.createElement('a');
            saveBtn.textContent = 'save to archive';
            saveBtn.href = `https://web.archive.org/save?reddit_action=save&url=${encodeURIComponent(targetUrl)}`;
            saveBtn.target = '_blank';
            saveBtn.style.color = '#28a745';
            saveBtn.style.fontWeight = 'bold';
            saveLi.appendChild(saveBtn);

            // 2. View Archive Button (Orange)
            const viewLi = document.createElement('li');
            const viewBtn = document.createElement('a');
            viewBtn.textContent = 'view archive';
            viewBtn.href = `https://web.archive.org/?reddit_action=view&url=${encodeURIComponent(targetUrl)}`;
            viewBtn.target = '_blank';
            viewBtn.style.color = '#ff9800';
            viewBtn.style.fontWeight = 'bold';
            viewLi.appendChild(viewBtn);

            list.appendChild(saveLi);
            list.appendChild(viewLi);
        });
    }

    // ==========================================
    // ARCHIVE.ORG AUTOMATION LOGIC
    // ==========================================

    function setupArchiveAutomation() {
        const urlParams = new URLSearchParams(window.location.search);
        const action = urlParams.get('reddit_action');
        const targetUrl = urlParams.get('url');

        if (!action || !targetUrl) return;

        if (action === 'save') {
            waitForElement('#web-save-url-input', (inputEl) => {
                simulateInputAndSubmit(inputEl, targetUrl);
            });
        } else if (action === 'view') {
            waitForElement('input.rbt-input-main', (inputEl) => {
                simulateInputAndSubmit(inputEl, targetUrl);
            });
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

    function waitForElement(selector, callback) {
        const el = document.querySelector(selector);
        if (el) {
            callback(el);
            return;
        }

        const observer = new MutationObserver((mutations, obs) => {
            const foundEl = document.querySelector(selector);
            if (foundEl) {
                obs.disconnect();
                callback(foundEl);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function simulateInputAndSubmit(inputElement, value) {
        // Bypass React setters
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(inputElement, value);
        } else {
            inputElement.value = value;
        }

        // Dispatch standard events so the UI registers the text
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));

        // Give the UI a brief moment to update state before submitting
        setTimeout(() => {
            const form = inputElement.closest('form');
            if (form) {
                // Attempt to find and click the submit button first
                const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button.web-save-button');
                if (submitBtn) {
                    submitBtn.click();
                } else {
                    // Fallback to native form submission
                    form.submit();
                }
            } else {
                // Absolute fallback to simulating 'Enter' if no form wrapper exists
                ['keydown', 'keypress', 'keyup'].forEach(eventType => {
                    inputElement.dispatchEvent(new KeyboardEvent(eventType, {
                        bubbles: true,
                        cancelable: true,
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13
                    }));
                });
            }
        }, 500);
    }

    init();
})();
