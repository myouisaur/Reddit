// ==UserScript==
// @name         [Reddit] RES Viewport-Fit Media
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      4.3
// @description  Automatically sizes expanded media to fit the visible screen space as you scroll, with a per-post button to ignore long captions.
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
        TOGGLE_CLASS: 'xiv-res-vf-toggle',
        ICON_COUNTED_CLASS: 'xiv-res-vf-icon-counted',
        ICON_IGNORED_CLASS: 'xiv-res-vf-icon-ignored',
        EXPANDO_COLLAPSED_CLASS: 'collapsed',
        EXPANDO_EXPANDED_CLASS: 'expanded',

        // Selectors
        CONTAINER_SELECTOR: '.res-media-independent',
        EXPANDO_SELECTOR: '.res-expando-box',
        EXPANDO_BUTTON_SELECTOR: '.expando-button',
        POST_ROOT_SELECTOR: '.entry',
        THING_SELECTOR: '.thing',
        OBSERVATION_ROOT_SELECTOR: '.sitetable',

        // Caption is kept separate from the other bottom chrome because only it can be ignored
        CAPTION_SELECTOR: '.res-caption',
        BOTTOM_CHROME_SELECTORS: [
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

        // Labels (human-readable UI text)
        LABELS: {
            ARIA: 'Ignore the caption when fitting media to the screen',
            TITLE_COUNTED: 'The caption is counted when fitting this post. Click to ignore it.',
            TITLE_IGNORED: 'The caption is ignored when fitting this post. Click to count it again.',
            MISSING_POST: 'Could not find the post around an expanded media item, so its caption toggle was not added. The site layout may have changed.',
            MISSING_BUTTON: 'Could not find the RES expand button for a post, so its caption toggle was not added. The site layout may have changed.',
        },

        // Icon (24x24 grid): a media box with caption lines below; when ignoring, the box grows over them
        ICON: {
            VIEW_BOX: '0 0 24 24',
            COUNTED_PATHS: ['M5 4h14v8H5z', 'M5 16h14', 'M5 20h9'],
            IGNORED_PATHS: ['M5 4h14v16H5z'],
        },
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

        // Per-post toggle (session-only by design: resets on reload). Keyed by media box.
        ignoredKeys: new Set(),
        fitKeys: new WeakMap(),
        toggleButtons: new WeakMap(),
        toggleTargets: new WeakMap(),
        warnedBoxes: new WeakSet(),
        orphanCounter: 0,

        // Observers
        mutationObserver: null,
        resizeObserver: null,
    };

    // ─── Scoped CSS ──────────────────────────────────────────────────────────────
    function injectStyles() {
        try {
            GM_addStyle(`
                /* Native media: perfectly scaled and strictly hardware-accelerated via GPU */
                img.${CONFIG.MANAGED_CLASS},
                video.${CONFIG.MANAGED_CLASS} {
                    max-width: 100% !important;
                    max-height: none !important;
                    object-fit: contain !important;
                    box-sizing: border-box !important;
                    will-change: height, width !important;
                    transform: translateZ(0) !important;
                    backface-visibility: hidden !important;
                }

                /* iFrames (RedGIFs): Handled strictly via JS height to preserve RES width controls */
                iframe.${CONFIG.MANAGED_CLASS} {
                    max-height: none !important;
                    box-sizing: border-box !important;
                    will-change: height !important;
                    transform: translateZ(0) !important;
                }

                /* Per-post caption toggle: a gray circle with a white icon, like RES's expand button */
                .${CONFIG.TOGGLE_CLASS} {
                    --xiv-toggle-bg: #c9c9c9;
                    --xiv-toggle-bg-hover: #a9a9a9;
                    --xiv-toggle-fg: #ffffff;
                    --xiv-toggle-focus: #2f6fd6;
                    appearance: none;
                    box-sizing: border-box;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    vertical-align: top;
                    flex: none;
                    float: var(--xiv-toggle-float, left);
                    width: var(--xiv-toggle-w, clamp(1.3rem, 1.2rem + 0.5vw, 1.7rem));
                    height: var(--xiv-toggle-h, clamp(1.3rem, 1.2rem + 0.5vw, 1.7rem));
                    margin: var(--xiv-toggle-margin, 0 0.35rem 0 0);
                    padding: 0;
                    border: 0;
                    border-radius: 50%;
                    background: var(--xiv-toggle-bg);
                    color: var(--xiv-toggle-fg);
                    cursor: pointer;
                    transition: background-color 0.15s ease, transform 0.15s ease;
                }
                .res-nightmode .${CONFIG.TOGGLE_CLASS} {
                    --xiv-toggle-bg: #5a5d63;
                    --xiv-toggle-bg-hover: #7a7e86;
                    --xiv-toggle-fg: #f0f1f3;
                    --xiv-toggle-focus: #6aa4ff;
                }
                .${CONFIG.TOGGLE_CLASS}:hover {
                    background: var(--xiv-toggle-bg-hover);
                }
                .${CONFIG.TOGGLE_CLASS}:active {
                    transform: scale(0.92);
                }
                .${CONFIG.TOGGLE_CLASS}:focus-visible {
                    outline: 0.125rem solid var(--xiv-toggle-focus);
                    outline-offset: 0.125rem;
                }
                .${CONFIG.TOGGLE_CLASS} svg {
                    width: 62%;
                    height: 62%;
                    fill: none;
                    stroke: currentColor;
                    stroke-width: 2.2;
                    stroke-linecap: round;
                    stroke-linejoin: round;
                    pointer-events: none;
                }
                /* The icon's shape changes with state, so it never relies on color alone */
                .${CONFIG.TOGGLE_CLASS} .${CONFIG.ICON_IGNORED_CLASS} {
                    display: none;
                }
                .${CONFIG.TOGGLE_CLASS}[aria-pressed="true"] .${CONFIG.ICON_COUNTED_CLASS} {
                    display: none;
                }
                .${CONFIG.TOGGLE_CLASS}[aria-pressed="true"] .${CONFIG.ICON_IGNORED_CLASS} {
                    display: inline;
                }
                /* Hide the toggle while the post is collapsed */
                ${CONFIG.EXPANDO_BUTTON_SELECTOR}.${CONFIG.EXPANDO_COLLAPSED_CLASS} + .${CONFIG.TOGGLE_CLASS} {
                    display: none !important;
                }
                @media (prefers-reduced-motion: reduce) {
                    .${CONFIG.TOGGLE_CLASS} {
                        transition: none;
                    }
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

        getBottomChromeHeight: (container, ignoreCaption) => {
            try {
                const expando = container.closest(CONFIG.EXPANDO_SELECTOR);
                if (!expando) return 0;

                const selectors = ignoreCaption
                    ? CONFIG.BOTTOM_CHROME_SELECTORS
                    : [CONFIG.CAPTION_SELECTOR, ...CONFIG.BOTTOM_CHROME_SELECTORS];

                return selectors.reduce((total, sel) => {
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

            if (el.tagName === 'IFRAME') {
                // RES attaches the source video dimensions as HTML attributes on the iframe
                const w = parseInt(el.getAttribute('width'), 10);
                const h = parseInt(el.getAttribute('height'), 10);
                if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
                    return { w, h };
                }
            }

            return { w: Infinity, h: Infinity };
        },

        // Posts keep the expand button in the title block, not next to the media box,
        // so after the sibling walk we search the whole post
        findExpandoButton: (box, root) => {
            let node = box;
            while (node && node !== root) {
                let sibling = node.previousElementSibling;
                while (sibling) {
                    if (sibling.matches(CONFIG.EXPANDO_BUTTON_SELECTOR)) return sibling;
                    sibling = sibling.previousElementSibling;
                }
                node = node.parentElement;
            }

            const candidates = Array.from(root.querySelectorAll(CONFIG.EXPANDO_BUTTON_SELECTOR));
            const expanded = candidates.find((btn) => btn.classList.contains(CONFIG.EXPANDO_EXPANDED_CLASS));
            return expanded || candidates[0] || null;
        },
    };

    // ─── Core Logic ──────────────────────────────────────────────────────────────
    const Core = {
        computeTargetState: (el, container, ignoreCaption) => {
            const rect = el.getBoundingClientRect();
            const effectiveTop = Math.max(rect.top, 0);
            const bottomChrome = Utils.getBottomChromeHeight(container, ignoreCaption);

            const availableVertical = window.innerHeight - effectiveTop - bottomChrome - CONFIG.VIEWPORT_PADDING;
            const dims = Utils.getNaturalDimensions(el);

            let aspectRatio = 0;
            let containerWidth = Infinity;
            let widthConstrainedHeight = Infinity;

            // Strict Iframe Isolation: Never calculate horizontal constraints for iframes.
            if (el.tagName !== 'IFRAME' && dims.w !== Infinity && dims.h !== Infinity && dims.w > 0 && dims.h > 0) {
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
                    Core.unmanageElement(el);
                    continue;
                }

                try {
                    const container = el.closest(CONFIG.CONTAINER_SELECTOR);
                    if (!container) continue;

                    const ignoreCaption = FitToggle.isIgnored(FitToggle.getBox(container));
                    const state = Core.computeTargetState(el, container, ignoreCaption);
                    const currentHeight = State.displayedHeights.get(el) ?? state.targetHeight;

                    let nextHeight = Utils.lerp(currentHeight, state.targetHeight, CONFIG.LERP_FACTOR);

                    // Smart Clamping for rapid container width shrinking (Native media only)
                    if (el.tagName !== 'IFRAME' && state.aspectRatio > 0 && (nextHeight * state.aspectRatio) > state.containerWidth) {
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

            // 2. Write Phase: Apply all style changes in a single batch
            for (const update of updates) {
                State.displayedHeights.set(update.el, update.renderedHeight);
                update.el.style.height = `${update.renderedHeight}px`;

                // Strict Iframe Isolation: We completely ignore width for iframes, handing control to RES.
                if (update.el.tagName !== 'IFRAME') {
                    if (update.renderedWidth !== null) {
                        update.el.style.width = `${update.renderedWidth}px`;
                    } else {
                        update.el.style.width = 'auto';
                    }
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

            // Button creation is idempotent, so it is safe to call on every registration pass
            FitToggle.ensureButton(container);

            // Check actual State set, not just DOM class, to prevent false ignores on reattached elements
            if (State.managedElements.has(el)) return;

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

        // Stops managing an element and strips the managed class so it can't freeze on reattach
        unmanageElement: (el) => {
            el.classList.remove(CONFIG.MANAGED_CLASS);
            State.managedElements.delete(el);
            State.displayedHeights.delete(el);

            const stableParent = State.elementParents.get(el);
            if (stableParent && State.resizeObserver) {
                State.resizeObserver.unobserve(stableParent);
            }
            State.elementParents.delete(el);
            log.info('Cleanup', 'Stopped managing media element and unobserved parent.');
        },

        scanForContainers: (root = document) => {
            try {
                root.querySelectorAll(CONFIG.CONTAINER_SELECTOR).forEach(Core.registerContainer);
            } catch (err) {
                log.error('Scanner', 'scanForContainers failed', err);
            }
        },
    };

    // ─── Per-Post Caption Toggle ─────────────────────────────────────────────────
    const FitToggle = {
        // The media box is the per-post anchor; fall back to the container if RES omits it
        getBox: (container) => container.closest(CONFIG.EXPANDO_SELECTOR) || container,

        // Key = post id + index of the box inside it, so one post never affects another
        getKey: (box) => {
            const cached = State.fitKeys.get(box);
            if (cached) return cached;

            const thing = box.closest(CONFIG.THING_SELECTOR);
            const thingId = thing ? thing.getAttribute('data-fullname') : null;

            let key;
            if (thingId) {
                const own = Array.from(thing.querySelectorAll(CONFIG.EXPANDO_SELECTOR))
                    .filter((candidate) => candidate.closest(CONFIG.THING_SELECTOR) === thing);
                key = `${thingId}:${own.indexOf(box)}`;
            } else {
                State.orphanCounter += 1;
                key = `xiv-orphan-${State.orphanCounter}`;
            }

            State.fitKeys.set(box, key);
            return key;
        },

        isIgnored: (box) => State.ignoredKeys.has(FitToggle.getKey(box)),

        warnOnce: (box, message) => {
            if (State.warnedBoxes.has(box)) return;
            State.warnedBoxes.add(box);
            log.warn('Toggle', message);
        },

        buildIconGroup: (className, paths) => {
            const svgNs = 'http://www.w3.org/2000/svg';
            const group = document.createElementNS(svgNs, 'g');
            group.setAttribute('class', className);

            for (const d of paths) {
                const path = document.createElementNS(svgNs, 'path');
                path.setAttribute('d', d);
                group.appendChild(path);
            }

            return group;
        },

        buildIcon: () => {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', CONFIG.ICON.VIEW_BOX);
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('focusable', 'false');
            svg.appendChild(FitToggle.buildIconGroup(CONFIG.ICON_COUNTED_CLASS, CONFIG.ICON.COUNTED_PATHS));
            svg.appendChild(FitToggle.buildIconGroup(CONFIG.ICON_IGNORED_CLASS, CONFIG.ICON.IGNORED_PATHS));
            return svg;
        },

        // Copy the RES button's size and spacing so ours lines up with it.
        // The radius is not copied: RES draws its circle with a background image.
        copyMetrics: (source, target) => {
            const cs = getComputedStyle(source);
            const width = parseFloat(cs.width);
            const height = parseFloat(cs.height);

            if (width > 0 && height > 0) {
                target.style.setProperty('--xiv-toggle-w', `${width}px`);
                target.style.setProperty('--xiv-toggle-h', `${height}px`);
            }
            if (cs.margin) target.style.setProperty('--xiv-toggle-margin', cs.margin);
            if (cs.cssFloat) target.style.setProperty('--xiv-toggle-float', cs.cssFloat);
        },

        render: (button, ignored) => {
            button.setAttribute('aria-pressed', String(ignored));
            button.title = ignored ? CONFIG.LABELS.TITLE_IGNORED : CONFIG.LABELS.TITLE_COUNTED;
        },

        build: (expandoButton) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = CONFIG.TOGGLE_CLASS;
            button.setAttribute('aria-label', CONFIG.LABELS.ARIA);
            button.appendChild(FitToggle.buildIcon());
            FitToggle.copyMetrics(expandoButton, button);
            return button;
        },

        ensureButton: (container) => {
            try {
                const box = FitToggle.getBox(container);
                const existing = State.toggleButtons.get(box);
                if (existing && existing.isConnected) return;

                const root = box.closest(CONFIG.POST_ROOT_SELECTOR) || box.closest(CONFIG.THING_SELECTOR);
                if (!root) {
                    FitToggle.warnOnce(box, CONFIG.LABELS.MISSING_POST);
                    return;
                }

                const expandoButton = Utils.findExpandoButton(box, root);
                if (!expandoButton) {
                    FitToggle.warnOnce(box, CONFIG.LABELS.MISSING_BUTTON);
                    return;
                }

                const button = FitToggle.build(expandoButton);
                FitToggle.render(button, FitToggle.isIgnored(box));
                State.toggleButtons.set(box, button);
                State.toggleTargets.set(button, box);
                expandoButton.insertAdjacentElement('afterend', button);
            } catch (err) {
                log.error('Toggle', 'Could not add the caption button to a post.', err);
            }
        },

        // Auto-fit keeps running either way; the loop glides the media to its new size
        setIgnored: (box, button, ignored) => {
            const key = FitToggle.getKey(box);
            if (ignored) {
                State.ignoredKeys.add(key);
            } else {
                State.ignoredKeys.delete(key);
            }
            FitToggle.render(button, ignored);
            Core.wakeLoop();
        },

        // Single delegated listener: no per-button handlers to clean up
        onClick: (event) => {
            const target = event.target;
            const button = target instanceof Element ? target.closest(`.${CONFIG.TOGGLE_CLASS}`) : null;
            if (!button) return;

            event.preventDefault();
            event.stopPropagation();

            try {
                const box = State.toggleTargets.get(button);
                if (!box || !box.isConnected) return;
                FitToggle.setIgnored(box, button, !FitToggle.isIgnored(box));
            } catch (err) {
                log.error('Toggle', 'Could not switch the caption setting for this post. The page layout may have changed.', err);
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
                                Core.unmanageElement(el);
                            }
                        }
                    }

                    // 2. Handle source swaps across all media types
                    if (
                        mutation.type === 'attributes' &&
                        mutation.attributeName === 'src' &&
                        (mutation.target instanceof HTMLImageElement ||
                         mutation.target instanceof HTMLVideoElement ||
                         mutation.target instanceof HTMLIFrameElement) &&
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
            document.addEventListener('click', FitToggle.onClick, true);
            document.addEventListener('visibilitychange', Events.onVisibilityChange);
            Events.patchHistory();
            log.info('Init', `Initialized — v${GM_info?.script?.version || 'unknown'}`);
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
