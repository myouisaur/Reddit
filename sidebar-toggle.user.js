// ==UserScript==
// @name         [Reddit] Sidebar Toggle
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      3.0
// @description  Adds a native header tab and a floating button to show or hide the sidebar.
// @author       Xiv
// @match        *://*.reddit.com/*
// @run-at       document-start
// @noframes
// @updateURL    https://myouisaur.github.io/Reddit/sidebar-toggle.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/sidebar-toggle.user.js
// ==/UserScript==

(function () {
    'use strict';

    if (window.xivSidebarToggleActive) return;
    window.xivSidebarToggleActive = true;

    const CONFIG = {
        // --- USER SETTINGS ---
        // 0.5 = 50% of your screen width. Change to 0.6 for 60%, or 0 to disable auto-collapse.
        AUTO_COLLAPSE_RATIO: 0.5,

        // --- SYSTEM SETTINGS ---
        STORAGE_KEY: 'xiv-reddit-sidebar-state',
        ANIMATION_SPEED: '0.35s',

        // --- DOM SELECTORS ---
        SELECTORS: {
            MODERN_REDDIT: 'shreddit-app, #AppRouter-main-content',
            TAB_MENU: 'ul.tabmenu',
            SIDEBAR: '.side',
            TITLEBOX: '.titlebox'
        },

        // --- CSS CLASSES ---
        CLASSES: {
            HIDDEN_HTML: 'xiv-sidebar-hidden',
            ANIMATING_HTML: 'xiv-is-animating',
            TAB_LI: 'res-tabmenu-button xiv-sidebar-toggle-tab',
            FLOATING_BTN: 'xiv-floating-toggle',
            FLOATING_VISIBLE: 'xiv-floating-visible'
        }
    };

    // ==========================================
    // State Management Utilities
    // ==========================================

    function getInitialState() {
        try {
            const navEntries = performance.getEntriesByType('navigation');
            const isReload = navEntries.length > 0 && navEntries[0].type === 'reload';

            if (isReload) {
                sessionStorage.removeItem(CONFIG.STORAGE_KEY);
                return false;
            }

            const stored = sessionStorage.getItem(CONFIG.STORAGE_KEY);
            return stored ? JSON.parse(stored) : false;
        } catch (error) {
            console.warn('[Reddit Sidebar Toggle] Storage read failed, defaulting to false.', error);
            return false;
        }
    }

    function saveState(isHidden) {
        try {
            sessionStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(isHidden));
        } catch (error) {
            console.warn('[Reddit Sidebar Toggle] Failed to save state.', error);
        }
    }

    // ==========================================
    // Core Logic
    // ==========================================

    class SidebarController {
        constructor() {
            this.userPreferenceHidden = getInitialState();

            const breakpointWidth = window.screen.availWidth * CONFIG.AUTO_COLLAPSE_RATIO;
            const isSmallScreen = CONFIG.AUTO_COLLAPSE_RATIO > 0 && window.innerWidth <= breakpointWidth;

            this.isHidden = isSmallScreen ? true : this.userPreferenceHidden;
            this.isAutoCollapsed = isSmallScreen;

            this.buttonLi = null;
            this.floatingBtn = null;
            this.animTimer = null;
            this.intersectionObserver = null;

            this.injectCSS();
            this.applyDOMState(false);
            this.waitForDOM();
            this.setupResponsive(breakpointWidth);
        }

        injectCSS() {
            const style = document.createElement('style');
            style.textContent = `
                /* Hardware acceleration applied only during active transitions */
                html.${CONFIG.CLASSES.ANIMATING_HTML} div.content,
                html.${CONFIG.CLASSES.ANIMATING_HTML} .side {
                    will-change: margin-right, width, opacity;
                }

                div.content {
                    transition: margin-right ${CONFIG.ANIMATION_SPEED} ease !important;
                }

                /* The "Clip-Wipe" Animation */
                .side {
                    transition: width ${CONFIG.ANIMATION_SPEED} ease, min-width ${CONFIG.ANIMATION_SPEED} ease, padding ${CONFIG.ANIMATION_SPEED} ease, margin ${CONFIG.ANIMATION_SPEED} ease, opacity 0.25s ease !important;
                    overflow-x: hidden !important;
                }

                html.${CONFIG.CLASSES.HIDDEN_HTML} .side {
                    width: 0px !important;
                    min-width: 0px !important;
                    margin-left: 0px !important;
                    margin-right: 0px !important;
                    padding-left: 0px !important;
                    padding-right: 0px !important;
                    border: none !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                }

                /* Aggressively override Main Feed and RES boundaries */
                html.${CONFIG.CLASSES.HIDDEN_HTML} div.content,
                html.${CONFIG.CLASSES.HIDDEN_HTML} .width-clip,
                html.${CONFIG.CLASSES.HIDDEN_HTML} .sitetable {
                    margin-right: 5px !important;
                    width: auto !important;
                    max-width: none !important;
                }

                /* Tabmenu specific styling */
                .xiv-sidebar-toggle-tab {
                    margin-left: 0.5rem;
                }
                .xiv-sidebar-toggle-tab a {
                    cursor: pointer;
                }

                /* Floating Native Button Styling */
                .${CONFIG.CLASSES.FLOATING_BTN} {
                    appearance: none;
                    position: fixed;
                    top: 50%;
                    right: 0;
                    transform: translateY(-50%) translateX(100%);
                    width: 1.5rem;
                    height: 3.25rem;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    padding: 0;
                    margin: 0;
                    border-style: solid;
                    border-width: 1px;
                    border-right: none;
                    border-radius: 0.375rem 0 0 0.375rem;
                    z-index: 2147483647;
                    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease, filter 0.2s ease;
                    opacity: 0;
                    pointer-events: none;
                    box-shadow: -0.125rem 0 0.5rem rgba(0,0,0,0.15);
                    user-select: none;
                }
                .${CONFIG.CLASSES.FLOATING_BTN}.${CONFIG.CLASSES.FLOATING_VISIBLE} {
                    transform: translateY(-50%) translateX(0);
                    opacity: 1;
                    pointer-events: auto;
                }
                .${CONFIG.CLASSES.FLOATING_BTN}:hover,
                .${CONFIG.CLASSES.FLOATING_BTN}:focus {
                    outline: none;
                    filter: brightness(0.90);
                }

                /* Smooth Animated CSS Chevron */
                .${CONFIG.CLASSES.FLOATING_BTN}::after {
                    content: '';
                    display: block;
                    width: 0.4rem;
                    height: 0.4rem;
                    border-style: solid;
                    border-width: 0.15rem 0.15rem 0 0;
                    /* Default state: Pointing Left (Sidebar hidden, pull out) */
                    transform: translateX(0.1rem) rotate(-135deg);
                    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                html:not(.${CONFIG.CLASSES.HIDDEN_HTML}) .${CONFIG.CLASSES.FLOATING_BTN}::after {
                    /* Active state: Pointing Right (Sidebar visible, push in) */
                    transform: translateX(-0.1rem) rotate(45deg);
                }
            `;

            const insertCSS = () => {
                if (document.head) {
                    document.head.appendChild(style);
                } else {
                    requestAnimationFrame(insertCSS);
                }
            };
            insertCSS();
        }

        waitForDOM() {
            const observer = new MutationObserver((mutations, obs) => {
                if (document.querySelector(CONFIG.SELECTORS.MODERN_REDDIT)) {
                    obs.disconnect();
                    return;
                }

                const tabmenu = document.querySelector(CONFIG.SELECTORS.TAB_MENU);
                const sideEl = document.querySelector(CONFIG.SELECTORS.SIDEBAR);

                if (tabmenu && sideEl && !this.buttonLi) {
                    this.buildTabButton(tabmenu);
                    this.buildFloatingButton(sideEl);
                    this.setupIntersectionObserver(tabmenu);
                    obs.disconnect();
                }
            });

            observer.observe(document.documentElement, { childList: true, subtree: true });
        }

        // ==========================================
        // UI Construction
        // ==========================================

        buildTabButton(tabmenu) {
            this.buttonLi = document.createElement('li');
            this.buttonLi.className = CONFIG.CLASSES.TAB_LI;
            this.buttonLi.setAttribute('role', 'button');
            this.buttonLi.setAttribute('tabindex', '0');
            this.buttonLi.setAttribute('aria-label', 'Toggle Sidebar');

            if (!this.isHidden) {
                this.buttonLi.classList.add('selected');
            }

            const a = document.createElement('a');
            a.textContent = 'show sidebar';

            const toggleAction = (e) => {
                e.preventDefault();
                this.toggle(true);
            };

            a.addEventListener('click', toggleAction);
            this.buttonLi.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleAction(e);
                }
            });

            this.buttonLi.appendChild(a);
            tabmenu.appendChild(this.buttonLi);

            const orderGuard = new MutationObserver(() => {
                if (tabmenu.lastElementChild !== this.buttonLi) {
                    tabmenu.appendChild(this.buttonLi);
                }
            });
            orderGuard.observe(tabmenu, { childList: true });
        }

        buildFloatingButton(sideEl) {
            this.floatingBtn = document.createElement('button');
            this.floatingBtn.type = 'button';
            this.floatingBtn.className = CONFIG.CLASSES.FLOATING_BTN;
            this.floatingBtn.setAttribute('aria-label', 'Toggle Sidebar Floating');

            this.applyNativeStyles(sideEl, this.floatingBtn);

            this.floatingBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggle(true);
            });

            document.body.appendChild(this.floatingBtn);
        }

        applyNativeStyles(sideEl, btn) {
            requestAnimationFrame(() => {
                const titlebox = sideEl.querySelector(CONFIG.SELECTORS.TITLEBOX) || sideEl;
                const computed = window.getComputedStyle(titlebox);
                let bg = computed.backgroundColor;

                if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
                    const bodyBg = window.getComputedStyle(document.body).backgroundColor;

                    if (bodyBg === 'rgba(0, 0, 0, 0)' || bodyBg === 'transparent') {
                        // Fallback safely if body paint isn't resolved
                        const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                        bg = isDark ? '#222222' : '#ffffff';
                    } else {
                        bg = bodyBg;
                    }
                }

                btn.style.backgroundColor = bg;
                btn.style.color = computed.color || '#333333';
                btn.style.borderColor = computed.borderLeftColor && computed.borderLeftColor !== 'rgba(0, 0, 0, 0)' ? computed.borderLeftColor : '#cccccc';
            });
        }

        // ==========================================
        // Sub-Systems & Observers
        // ==========================================

        setupIntersectionObserver(target) {
            this.intersectionObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (this.floatingBtn) {
                        this.floatingBtn.classList.toggle(CONFIG.CLASSES.FLOATING_VISIBLE, !entry.isIntersecting);
                    }
                });
            }, { root: null, threshold: 0 });

            this.intersectionObserver.observe(target);
        }

        setupResponsive(breakpointWidth) {
            if (CONFIG.AUTO_COLLAPSE_RATIO <= 0) return;

            const mql = window.matchMedia(`(max-width: ${breakpointWidth}px)`);

            const handleResize = (e) => {
                if (e.matches && !this.isHidden && !this.isAutoCollapsed) {
                    this.isAutoCollapsed = true;
                    this.updateState({ hidden: true, save: false });
                }
                else if (!e.matches && this.isAutoCollapsed) {
                    this.isAutoCollapsed = false;
                    this.updateState({ hidden: this.userPreferenceHidden, save: false });
                }
            };

            mql.addEventListener('change', handleResize);
        }

        // ==========================================
        // State Execution
        // ==========================================

        toggle(isUserAction = false) {
            const newState = !this.isHidden;

            if (isUserAction) {
                this.userPreferenceHidden = newState;
                this.isAutoCollapsed = false;
            }

            this.updateState({
                hidden: newState,
                save: isUserAction
            });
        }

        updateState({ hidden, save }) {
            this.isHidden = hidden;

            if (save) saveState(this.isHidden);

            this.applyDOMState(true);
        }

        applyDOMState(animate) {
            if (animate) {
                document.documentElement.classList.add(CONFIG.CLASSES.ANIMATING_HTML);
                clearTimeout(this.animTimer);
                this.animTimer = setTimeout(() => {
                    document.documentElement.classList.remove(CONFIG.CLASSES.ANIMATING_HTML);
                }, 400);
            }

            document.documentElement.classList.toggle(CONFIG.CLASSES.HIDDEN_HTML, this.isHidden);

            if (this.buttonLi) {
                this.buttonLi.classList.toggle('selected', !this.isHidden);
                this.buttonLi.setAttribute('aria-expanded', !this.isHidden);
            }
            if (this.floatingBtn) {
                this.floatingBtn.setAttribute('aria-expanded', !this.isHidden);
            }
        }
    }

    new SidebarController();

})();
