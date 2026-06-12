// ==UserScript==
// @name         [Reddit] Stealth Tab Opener
// @namespace    https://github.com/myouisaur/userscripts
// @icon         https://www.reddit.com/favicon.ico
// @version      2.5
// @description  Forces all links clicked on Reddit that open a new tab to do so silently in the background without stealing focus.
// @author       Xiv
// @match        *://*.reddit.com/*
// @noframes
// @run-at       document-start
// @grant        GM_openInTab
// @updateURL    https://myouisaur.github.io/Reddit/stealth-tab-opener.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/stealth-tab-opener.user.js
// ==/UserScript==

(function() {
    'use strict';

    if (window.__redditStealthTabRunning) return;
    window.__redditStealthTabRunning = true;

    const CONFIG = {
        SPAM_TIMEOUT_MS: 1500,
        AUDIO_DEBOUNCE_MS: 250,
        SHOW_TOAST: true,
        TOAST_DURATION_MS: 2500,
        PLAY_SOUND: true,
        SOUND_VOLUME: 0.15
    };

    const state = {
        spamCache: new Set(),
        lastSoundPlayed: 0
    };

    /**
     * Synthesizes a mathematically pure "Glassy Pop" using the Web Audio API.
     * Implements debouncing to prevent audio clipping on rapid clicks.
     */
    function playGlassyPop() {
        if (!CONFIG.PLAY_SOUND) return;

        const now = Date.now();
        if (now - state.lastSoundPlayed < CONFIG.AUDIO_DEBOUNCE_MS) return;
        state.lastSoundPlayed = now;

        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;

            if (!window.__xivAudioCtx) {
                window.__xivAudioCtx = new AudioContext();
            }
            const ctx = window.__xivAudioCtx;

            if (ctx.state === 'suspended') ctx.resume();

            const osc = ctx.createOscillator();
            const gainNode = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);

            gainNode.gain.setValueAtTime(0, ctx.currentTime);
            gainNode.gain.linearRampToValueAtTime(CONFIG.SOUND_VOLUME, ctx.currentTime + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

            osc.connect(gainNode);
            gainNode.connect(ctx.destination);

            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.15);
        } catch (e) {
            console.warn('[Stealth Tab Opener] Audio synthesis failed:', e);
        }
    }

    /**
     * Briefly dims the clicked link to provide tactile physical confirmation.
     */
    function provideTactileFeedback(anchor) {
        if (!anchor) return;

        const originalTransition = anchor.style.transition;
        anchor.style.transition = 'opacity 0.2s ease-out';
        anchor.style.opacity = '0.5';

        setTimeout(() => {
            anchor.style.opacity = '';
            setTimeout(() => {
                if (!anchor.style.length) anchor.removeAttribute('style');
                anchor.style.transition = originalTransition;
            }, 200);
        }, 200);
    }

    /**
     * Handles spam blocking and secure background tab routing.
     */
    function openInBackground(url, anchor) {
        if (state.spamCache.has(url)) return;

        state.spamCache.add(url);
        setTimeout(() => state.spamCache.delete(url), CONFIG.SPAM_TIMEOUT_MS);

        try {
            GM_openInTab(url, { active: false, insert: true });

            provideTactileFeedback(anchor);
            if (CONFIG.SHOW_TOAST) showToast('Opened in background');
            if (CONFIG.PLAY_SOUND) playGlassyPop();

        } catch (error) {
            console.warn('[Stealth Tab Opener] GM_openInTab failed, falling back to native window.open.', error);
            window.open(url, '_blank');
        }
    }

    /**
     * Crosses Shadow DOM boundaries to locate the true anchor tag.
     */
    function findAnchorInPath(e) {
        if (typeof e.composedPath === 'function') {
            for (const node of e.composedPath()) {
                if (node.tagName === 'A' && node.href) return node;
            }
        }

        let node = e.target;
        while (node && node.tagName !== 'A') {
            node = node.parentElement;
        }

        return (node && node.href) ? node : null;
    }

    /**
     * Determines if the link is inherently an outbound/new-tab target on Reddit.
     */
    function isRedditOutboundLink(anchor) {
        return anchor.classList.contains('may-blank') ||
               anchor.hasAttribute('data-outbound-url') ||
               (anchor.target && anchor.target.toLowerCase() === '_blank');
    }

    /**
     * Core evaluation logic. Parses absolute URLs and determines interception.
     */
    function attemptInterception(e, anchor) {
        if (e.__bgTabHandled || e.defaultPrevented) return false;

        const rawUrl = anchor.href;
        if (!rawUrl || rawUrl.startsWith('javascript:') || rawUrl.startsWith('mailto:')) return false;

        // Mathematically guarantee an absolute URL representation
        const absoluteUrl = new URL(rawUrl, window.location.href).href;

        const isMiddleClick = e.button === 1;
        const isModifierClick = e.ctrlKey || e.metaKey || e.shiftKey;
        const isStandardNewTab = e.button === 0 && isRedditOutboundLink(anchor);

        if (isMiddleClick || isModifierClick || isStandardNewTab) {
            e.__bgTabHandled = true;
            e.preventDefault();
            openInBackground(absoluteUrl, anchor);
            return true;
        }

        return false;
    }

    function handleCapturePhase(e) {
        if (e.__bgTabHandled || e.defaultPrevented) return;

        const anchor = findAnchorInPath(e);
        if (!anchor) return;

        const intercepted = attemptInterception(e, anchor);

        if (!intercepted && !e.__propagationWrapped) {
            e.__propagationWrapped = true;

            const originalStop = e.stopPropagation;
            e.stopPropagation = function() {
                attemptInterception(e, anchor);
                originalStop.apply(this, arguments);
            };

            const originalStopImm = e.stopImmediatePropagation;
            e.stopImmediatePropagation = function() {
                attemptInterception(e, anchor);
                originalStopImm.apply(this, arguments);
            };
        }
    }

    function handleBubblePhase(e) {
        if (e.__bgTabHandled || e.defaultPrevented) return;

        const anchor = findAnchorInPath(e);
        if (anchor) attemptInterception(e, anchor);
    }

    /**
     * Displays a responsive, isolated Shadow DOM Liquid Glass notification.
     */
    function showToast(message) {
        if (!document.body) return;

        let host = document.getElementById('xiv-toast-host');
        let container;

        if (!host) {
            host = document.createElement('div');
            host.id = 'xiv-toast-host';
            host.style.cssText = 'position: fixed !important; bottom: 1.5rem !important; left: 1.5rem !important; z-index: 2147483647 !important; pointer-events: none;';

            const shadow = host.attachShadow({ mode: 'closed' });

            const style = document.createElement('style');
            style.textContent = `
                .xiv-toast-container {
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                    gap: 0.625rem; /* 10px */
                }
                .xiv-toast {
                    padding: 0.625rem 1.25rem; /* 10px 20px */
                    border-radius: 2rem;
                    color: rgba(255, 255, 255, 0.96);
                    font-family: system-ui, -apple-system, sans-serif;
                    font-size: 0.8125rem; /* 13px */
                    font-weight: 600;
                    letter-spacing: -0.02em;

                    text-shadow: 0 1px 3px rgba(0,0,0,0.8), 0 1px 8px rgba(0,0,0,0.5);

                    background: rgba(255, 255, 255, 0.14);
                    backdrop-filter: blur(24px) saturate(180%) brightness(1.1);
                    -webkit-backdrop-filter: blur(24px) saturate(180%) brightness(1.1);

                    /* Shadows kept in px for mathematically precise 1:1 hardware rendering */
                    box-shadow:
                        inset 0  1.5px 0   rgba(255,255,255,0.75),
                        inset 0 -1.5px 0   rgba(255,255,255,0.06),
                        inset  1px 0   0   rgba(255,255,255,0.30),
                        inset -1px 0   0   rgba(255,255,255,0.10),
                        0 0 0 0.5px        rgba(255,255,255,0.20),
                        0 6px 20px         rgba(0,0,0,0.32),
                        0 2px  6px         rgba(0,0,0,0.20);

                    opacity: 0;
                    transform: translateX(-1.25rem); /* -20px */
                    transition: opacity 0.4s cubic-bezier(0.22, 1, 0.36, 1), transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
                }
                .xiv-toast.xiv-visible {
                    opacity: 1;
                    transform: translateX(0);
                }
            `;

            container = document.createElement('div');
            container.className = 'xiv-toast-container';

            shadow.appendChild(style);
            shadow.appendChild(container);
            document.body.appendChild(host);

            host._toastContainer = container;
        } else {
            container = host._toastContainer;
        }

        const toast = document.createElement('div');
        toast.className = 'xiv-toast';
        toast.textContent = message;
        container.appendChild(toast);

        // Trigger reflow
        void toast.offsetWidth;
        toast.classList.add('xiv-visible');

        setTimeout(() => {
            toast.classList.remove('xiv-visible');
            setTimeout(() => toast.remove(), 400);
        }, CONFIG.TOAST_DURATION_MS);
    }

    function init() {
        window.addEventListener('click', handleCapturePhase, { capture: true });
        window.addEventListener('click', handleBubblePhase, { capture: false });
        window.addEventListener('auxclick', handleCapturePhase, { capture: true });
    }

    init();

})();
