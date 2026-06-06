// ==UserScript==
// @name         [Reddit] RES Viewport-Fit Media
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      1.7
// @description  Automatically sizes expanded media to fit the visible screen space as you scroll.
// @author       Xiv
// @match        *://*.reddit.com/*
// @grant        GM_addStyle
// @noframes
// @updateURL    https://myouisaur.github.io/Reddit/RES-viewport.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/RES-viewport.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ─── Duplicate-Init Guard ────────────────────────────────────────────────────
    if (window.__scriptAlreadyRunning_RES_VF) return;
    window.__scriptAlreadyRunning_RES_VF = true;

    // ─── Configuration ───────────────────────────────────────────────────────────
    const CONFIG = {
        DEBUG: false,

        MANAGED_CLASS: 'res-vf-managed',

        VIEWPORT_PADDING: 16,
        MIN_HEIGHT: 80,
        LERP_FACTOR: 0.1,
        SETTLE_THRESHOLD: 0.5,
        NAVIGATION_DELAY_MS: 200,

        CONTAINER_SELECTOR: '.res-media-independent',
        EXPANDO_SELECTOR: '.res-expando-box',

        // All bottom chrome elements whose height is subtracted from available space.
        BOTTOM_CHROME_SELECTORS: [
            '.res-caption',
            '.res-iframe-expando-drag-handle',
        ],

        // <img> elements inside these containers are RES UI — never treat as media.
        CHROME_SELECTORS: [
            '.res-iframe-expando-drag-handle',
            '.res-expando-siteAttribution',
            '.res-media-controls',
            'cite',
        ],
    };

    // ─── Logger ──────────────────────────────────────────────────────────────────
    const log = {
        info: (module, ...args) => {
            if (CONFIG.DEBUG) console.log(`[Reddit RES Viewport-Fit Media][${module}]`, ...args);
        },
        warn: (module, ...args) => {
            console.warn(`[Reddit RES Viewport-Fit Media][${module}]`, ...args);
        },
        error: (module, ...args) => {
            console.error(`[Reddit RES Viewport-Fit Media][${module}]`, ...args);
        },
    };

    // ─── State ───────────────────────────────────────────────────────────────────
    const State = {
        rafHandle: null,
        dirty: false,
        displayedHeights: new WeakMap(), // Current rendered height for lerp interpolation
        observer: null,
    };

    // ─── Scoped CSS ──────────────────────────────────────────────────────────────
    function injectStyles() {
        try {
            GM_addStyle(`
                img.${CONFIG.MANAGED_CLASS} {
                    width: auto !important;
                    max-width: 100% !important;
                    max-height: none !important;
                }
                video.${CONFIG.MANAGED_CLASS},
                iframe.${CONFIG.MANAGED_CLASS} {
                    max-height: none !important;
                }
            `);
            log.info('Init', 'Scoped CSS injected');
        } catch (err) {
            log.error('Init', 'Failed to inject styles', err);
        }
    }

    // ─── Utilities ───────────────────────────────────────────────────────────────
    const Utils = {
        lerp: (current, target, factor) => current + (target - current) * factor,

        isInsideChrome: (el) => {
            return CONFIG.CHROME_SELECTORS.some((sel) => el.closest(sel) !== null);
        },

        getBottomChromeHeight: (container) => {
            try {
                const expando = container.closest(CONFIG.EXPANDO_SELECTOR);
                if (!expando) return 0;

                return CONFIG.BOTTOM_CHROME_SELECTORS.reduce((total, sel) => {
                    const el = expando.querySelector(sel);
                    return total + (el ? el.getBoundingClientRect().height : 0);
                }, 0);
            } catch (err) {
                log.warn('Measurement', 'Failed to calculate bottom chrome height', err);
                return 0;
            }
        },

        resolveMediaElement: (container) => {
            const video = container.querySelector('video');
            if (video) return video;

            const iframe = container.querySelector('iframe');
            if (iframe) return iframe;

            const imgs = container.querySelectorAll('img');
            for (const img of imgs) {
                if (!Utils.isInsideChrome(img)) return img;
            }

            return null;
        },

        getNaturalHeight: (el) => {
            if (el.tagName === 'IMG') return el.naturalHeight || Infinity;
            if (el.tagName === 'VIDEO') return el.videoHeight || Infinity;
            return Infinity;
        },
    };

    // ─── Core Logic ──────────────────────────────────────────────────────────────
    const Core = {
        computeTargetHeight: (el, container) => {
            const rect = el.getBoundingClientRect();
            const effectiveTop = Math.max(rect.top, 0);
            const bottomChrome = Utils.getBottomChromeHeight(container);
            const available = window.innerHeight - effectiveTop - bottomChrome - CONFIG.VIEWPORT_PADDING;

            return Math.max(CONFIG.MIN_HEIGHT, Math.min(available, Utils.getNaturalHeight(el)));
        },

        animationStep: () => {
            State.rafHandle = null;
            let anyUnsettled = false;

            const elements = document.querySelectorAll(
                `img.${CONFIG.MANAGED_CLASS}, video.${CONFIG.MANAGED_CLASS}, iframe.${CONFIG.MANAGED_CLASS}`
            );

            elements.forEach((el) => {
                try {
                    const container = el.closest(CONFIG.CONTAINER_SELECTOR);
                    if (!container) return;

                    const target = Core.computeTargetHeight(el, container);
                    const current = State.displayedHeights.get(el) ?? target;
                    const next = Utils.lerp(current, target, CONFIG.LERP_FACTOR);
                    const settled = Math.abs(next - target) < CONFIG.SETTLE_THRESHOLD;
                    const rendered = settled ? target : next;

                    State.displayedHeights.set(el, rendered);
                    el.style.height = `${rendered}px`;

                    if (!settled) anyUnsettled = true;
                } catch (err) {
                    log.error('Animation', 'Error processing element in animation loop', err);
                }
            });

            if (anyUnsettled || State.dirty) {
                State.dirty = false;
                State.rafHandle = requestAnimationFrame(Core.animationStep);
            }
        },

        wakeLoop: () => {
            State.dirty = true;
            if (!State.rafHandle) {
                State.rafHandle = requestAnimationFrame(Core.animationStep);
            }
        },

        onMediaSrcChanged: (img) => {
            log.info('Media', 'Src changed on managed img — re-measuring after load');

            State.displayedHeights.delete(img);

            if (!img.complete || img.naturalHeight === 0) {
                img.addEventListener('load', () => {
                    State.displayedHeights.delete(img);
                    Core.wakeLoop();
                }, { once: true });
            } else {
                Core.wakeLoop();
            }
        },

        registerContainer: (container) => {
            const el = Utils.resolveMediaElement(container);
            if (!el) {
                log.info('Registration', 'Container found but media element not ready yet');
                return;
            }

            if (el.classList.contains(CONFIG.MANAGED_CLASS)) return;

            el.classList.add(CONFIG.MANAGED_CLASS);

            const needsLoad =
                (el.tagName === 'IMG' && (!el.complete || el.naturalHeight === 0)) ||
                (el.tagName === 'VIDEO' && el.readyState === 0);

            if (needsLoad) {
                const eventName = el.tagName === 'VIDEO' ? 'loadedmetadata' : 'load';
                el.addEventListener(eventName, () => {
                    State.displayedHeights.delete(el);
                    Core.wakeLoop();
                }, { once: true });
            } else {
                State.displayedHeights.delete(el);
                Core.wakeLoop();
            }

            log.info('Registration', `Registered ${el.tagName} ${el.src?.slice(-40) || ''}`);
        },

        scanForContainers: (root = document) => {
            try {
                root.querySelectorAll(CONFIG.CONTAINER_SELECTOR).forEach(Core.registerContainer);
            } catch (err) {
                log.error('Scanner', 'scanForContainers failed', err);
            }
        },
    };

    // ─── Observers & Listeners ───────────────────────────────────────────────────
    const Events = {
        startObserver: () => {
            if (State.observer) return;

            const root = document.querySelector('.sitetable') || document.body;
            if (!root) {
                log.warn('Observer', 'Observation root not found.');
                return;
            }

            State.observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {

                    if (
                        mutation.type === 'attributes' &&
                        mutation.attributeName === 'src' &&
                        mutation.target instanceof HTMLImageElement &&
                        mutation.target.classList.contains(CONFIG.MANAGED_CLASS)
                    ) {
                        Core.onMediaSrcChanged(mutation.target);
                        continue;
                    }

                    if (mutation.type !== 'childList') continue;

                    for (const node of mutation.addedNodes) {
                        if (!(node instanceof Element)) continue;

                        if (node.matches(CONFIG.CONTAINER_SELECTOR)) {
                            Core.registerContainer(node);
                            continue;
                        }

                        const parentContainer = node.closest?.(CONFIG.CONTAINER_SELECTOR);
                        if (parentContainer) {
                            Core.registerContainer(parentContainer);
                            continue;
                        }

                        if (node.querySelector?.(CONFIG.CONTAINER_SELECTOR)) {
                            Core.scanForContainers(node);
                        }
                    }
                }
            });

            State.observer.observe(root, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src'],
            });

            log.info('Observer', `Started on ${root.tagName}`);
        },

        onScroll: () => Core.wakeLoop(),
        onResize: () => Core.wakeLoop(),

        attachListeners: () => {
            window.addEventListener('scroll', Events.onScroll, { passive: true });
            window.addEventListener('resize', Events.onResize);
        },

        detachListeners: () => {
            window.removeEventListener('scroll', Events.onScroll);
            window.removeEventListener('resize', Events.onResize);
        },

        onVisibilityChange: () => {
            if (document.hidden) {
                Events.detachListeners();
                if (State.rafHandle) {
                    cancelAnimationFrame(State.rafHandle);
                    State.rafHandle = null;
                }
                log.info('Lifecycle', 'Tab hidden — paused.');
            } else {
                Events.attachListeners();
                Core.wakeLoop();
                log.info('Lifecycle', 'Tab visible — resumed.');
            }
        },

        onNavigate: () => {
            log.info('Lifecycle', 'Navigation detected — rescanning.');
            setTimeout(() => {
                Core.scanForContainers();
                Core.wakeLoop();
            }, CONFIG.NAVIGATION_DELAY_MS);
        },

        patchHistory: () => {
            const wrap = (method) => {
                const orig = history[method];
                history[method] = function (...args) {
                    orig.apply(this, args);
                    Events.onNavigate();
                };
            };

            try {
                wrap('pushState');
                wrap('replaceState');
            } catch (err) {
                log.warn('Lifecycle', 'Could not patch history API.', err);
            }

            window.addEventListener('hashchange', Events.onNavigate);
            window.addEventListener('popstate', Events.onNavigate);
        },
    };

    // ─── Initialization ──────────────────────────────────────────────────────────
    function init() {
        try {
            injectStyles();
            Core.scanForContainers();
            Events.startObserver();
            Events.attachListeners();
            document.addEventListener('visibilitychange', Events.onVisibilityChange);
            Events.patchHistory();
            log.info('Init', `Initialized — v${GM_info?.script?.version || '1.7'}`);
        } catch (err) {
            log.error('Init', 'Failed during startup', err);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

})();
