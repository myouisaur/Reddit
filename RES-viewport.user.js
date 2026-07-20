// ==UserScript==
// @name         [Reddit] RES Viewport-Fit Media
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      3.0
// @description  Automatically sizes expanded media to fit the visible screen space as you scroll.
// @author       Xiv
// @match        *://*.reddit.com/*
// @grant        GM_addStyle
// @run-at       document-start
// @noframes
// @updateURL    https://myouisaur.github.io/Reddit/RES-viewport.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/RES-viewport.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ─── Duplicate-Init Guard ────────────────────────────────────────────────────
    if (window.xivAlreadyRunning) return;
    window.xivAlreadyRunning = true;

    // ─── Configuration ───────────────────────────────────────────────────────────
    const CONFIG = {
        // Feature Flags
        DEBUG: false,

        // CSS Classes
        MANAGED_CLASS: 'xiv-res-vf-managed',

        // Selectors
        CONTAINER_SELECTOR: '.res-media-independent',
        EXPANDO_SELECTOR: '.res-expando-box',
        OBSERVATION_ROOT_SELECTOR: '.sitetable',

        BOTTOM_CHROME_SELECTORS: [
            '.res-caption',
            '.res-expando-siteAttribution',
            '.res-iframe-expando-drag-handle',
        ],
        CHROME_SELECTORS: [
            '.res-iframe-expando-drag-handle',
            '.res-expando-siteAttribution',
            '.res-media-controls',
            'cite',
        ],

        // Timing & Math
        VIEWPORT_PADDING: 16,
        MIN_HEIGHT: 80,
        LERP_FACTOR: 0.1,
        SETTLE_THRESHOLD: 0.5,
        NAVIGATION_DELAY_MS: 200,
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

        // Element Caching & Memory Management
        managedElements: new Set(),
        displayedHeights: new WeakMap(),
        elementParents: new WeakMap(),

        // Observers
        mutationObserver: null,
        resizeObserver: null,
    };

    // ─── Scoped CSS ──────────────────────────────────────────────────────────────
    function injectStyles() {
        try {
            GM_addStyle(`
                img.${CONFIG.MANAGED_CLASS},
                video.${CONFIG.MANAGED_CLASS},
                iframe.${CONFIG.MANAGED_CLASS} {
                    max-width: 100% !important;
                    max-height: none !important;
                    object-fit: contain !important;
                    box-sizing: border-box !important;
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

        getNaturalDimensions: (el) => {
            if (el.tagName === 'IMG') return { w: el.naturalWidth || Infinity, h: el.naturalHeight || Infinity };
            if (el.tagName === 'VIDEO') return { w: el.videoWidth || Infinity, h: el.videoHeight || Infinity };
            return { w: Infinity, h: Infinity };
        },
    };

    // ─── Core Logic ──────────────────────────────────────────────────────────────
    const Core = {
        computeTargetState: (el, container) => {
            const rect = el.getBoundingClientRect();
            const effectiveTop = Math.max(rect.top, 0);
            const bottomChrome = Utils.getBottomChromeHeight(container);

            const availableVertical = window.innerHeight - effectiveTop - bottomChrome - CONFIG.VIEWPORT_PADDING;
            const dims = Utils.getNaturalDimensions(el);

            let aspectRatio = 0;
            let containerWidth = Infinity;
            let widthConstrainedHeight = Infinity;

            if (dims.w !== Infinity && dims.h !== Infinity && dims.w > 0 && dims.h > 0) {
                aspectRatio = dims.w / dims.h;
                const stableParent = State.elementParents.get(el) || container;
                containerWidth = stableParent.getBoundingClientRect().width;
                widthConstrainedHeight = containerWidth / aspectRatio;
            }

            const maxAllowedHeight = Math.min(availableVertical, dims.h, widthConstrainedHeight);
            const targetHeight = Math.max(CONFIG.MIN_HEIGHT, maxAllowedHeight);

            return { targetHeight, containerWidth, aspectRatio };
        },

        animationStep: () => {
            State.rafHandle = null;
            let anyUnsettled = false;

            const updates = [];

            // 1. Read Phase: Calculate all target states without modifying the DOM
            for (const el of State.managedElements) {
                if (!el.isConnected) {
                    Core.purgeDetachedElement(el);
                    continue;
                }

                try {
                    const container = el.closest(CONFIG.CONTAINER_SELECTOR);
                    if (!container) continue;

                    const state = Core.computeTargetState(el, container);
                    const currentHeight = State.displayedHeights.get(el) ?? state.targetHeight;

                    let nextHeight = Utils.lerp(currentHeight, state.targetHeight, CONFIG.LERP_FACTOR);

                    // Smart Clamping for rapid container width shrinking
                    if (state.aspectRatio > 0 && (nextHeight * state.aspectRatio) > state.containerWidth) {
                        nextHeight = state.containerWidth / state.aspectRatio;
                    }

                    const settled = Math.abs(nextHeight - state.targetHeight) < CONFIG.SETTLE_THRESHOLD;
                    const renderedHeight = settled ? state.targetHeight : nextHeight;
                    const renderedWidth = state.aspectRatio > 0 ? (renderedHeight * state.aspectRatio) : null;

                    updates.push({ el, renderedHeight, renderedWidth });
                    if (!settled) anyUnsettled = true;
                } catch (err) {
                    log.error('Animation', 'Error calculating target state', err);
                }
            }

            // 2. Write Phase: Apply all style changes in a single batch directly (v2.3 behavior)
            for (const update of updates) {
                State.displayedHeights.set(update.el, update.renderedHeight);
                update.el.style.height = `${update.renderedHeight}px`;

                if (update.renderedWidth !== null) {
                    update.el.style.width = `${update.renderedWidth}px`;
                } else {
                    update.el.style.width = 'auto';
                }
            }

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
            if (!el) return;
            if (el.classList.contains(CONFIG.MANAGED_CLASS)) return;

            el.classList.add(CONFIG.MANAGED_CLASS);
            State.managedElements.add(el);

            const stableParent = el.closest(CONFIG.EXPANDO_SELECTOR) || container;
            State.elementParents.set(el, stableParent);

            if (State.resizeObserver) {
                State.resizeObserver.observe(stableParent);
            }

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

            log.info('Registration', `Registered ${el.tagName}`);
        },

        purgeDetachedElement: (el) => {
            State.managedElements.delete(el);
            State.displayedHeights.delete(el);

            const stableParent = State.elementParents.get(el);
            if (stableParent && State.resizeObserver) {
                State.resizeObserver.unobserve(stableParent);
            }
            State.elementParents.delete(el);
            log.info('Cleanup', 'Purged detached media element and unobserved parent.');
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
        startObservers: () => {
            if (!State.resizeObserver) {
                State.resizeObserver = new ResizeObserver(() => Core.wakeLoop());
            }

            if (State.mutationObserver) return;

            const root = document.querySelector(CONFIG.OBSERVATION_ROOT_SELECTOR) || document.body;
            if (!root) {
                log.warn('Observer', 'Observation root not found.');
                return;
            }

            State.mutationObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {

                    // 1. Handle element removals for strict garbage collection
                    if (mutation.removedNodes.length > 0) {
                        for (const node of mutation.removedNodes) {
                            if (!(node instanceof Element)) continue;

                            const removedManaged = node.matches(`.${CONFIG.MANAGED_CLASS}`)
                                ? [node]
                                : node.querySelectorAll(`.${CONFIG.MANAGED_CLASS}`);

                            for (const el of removedManaged) {
                                Core.purgeDetachedElement(el);
                            }
                        }
                    }

                    // 2. Handle image source swaps
                    if (
                        mutation.type === 'attributes' &&
                        mutation.attributeName === 'src' &&
                        mutation.target instanceof HTMLImageElement &&
                        mutation.target.classList.contains(CONFIG.MANAGED_CLASS)
                    ) {
                        Core.onMediaSrcChanged(mutation.target);
                        continue;
                    }

                    // 3. Handle newly added content
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        for (const node of mutation.addedNodes) {
                            if (!(node instanceof Element)) continue;

                            if (node.matches(CONFIG.CONTAINER_SELECTOR)) {
                                Core.registerContainer(node);
                                continue;
                            }

                            const parentContainer = node.closest(CONFIG.CONTAINER_SELECTOR);
                            if (parentContainer) {
                                Core.registerContainer(parentContainer);
                                continue;
                            }

                            if (node.querySelector(CONFIG.CONTAINER_SELECTOR)) {
                                Core.scanForContainers(node);
                            }
                        }
                    }
                }
            });

            State.mutationObserver.observe(root, {
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
            Events.startObservers();
            Core.scanForContainers();
            Events.attachListeners();
            document.addEventListener('visibilitychange', Events.onVisibilityChange);
            Events.patchHistory();
            log.info('Init', `Initialized — v${GM_info?.script?.version || '2.6'}`);
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
