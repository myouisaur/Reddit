// ==UserScript==
// @name         [Reddit] Sidebar Toggle
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      2.0
// @description  Adds a native tabmenu toggle to show/hide the sidebar.
// @author       Xiv
// @match        *://*.reddit.com/*
// @noframes
// @run-at       document-start
// @updateURL    https://myouisaur.github.io/Reddit/sidebar-toggle.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/sidebar-toggle.user.js
// ==/UserScript==

(function () {
    'use strict';

    if (window.__tmSidebarToggleActive) return;
    window.__tmSidebarToggleActive = true;

    const CONFIG = {
        // --- USER SETTINGS ---
        // 0.5 = 50% of your screen width. Change to 0.6 for 60%, or 0 to completely disable auto-collapse.
        AUTO_COLLAPSE_RATIO: 0.5,

        // --- SYSTEM SETTINGS ---
        STORAGE_KEY: 'tm-old-reddit-sidebar-state',
        ANIMATION_SPEED: '0.35s',
        CLASSES: {
            HIDDEN_HTML: 'tm-sidebar-hidden',
            ANIMATING_HTML: 'tm-is-animating',
            TAB_LI: 'res-tabmenu-button tm-sidebar-toggle-tab'
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
            return sessionStorage.getItem(CONFIG.STORAGE_KEY) === 'true';
        } catch (error) {
            console.warn('[Reddit Sidebar Toggle] Session storage access failed.', error);
            return false;
        }
    }

    function saveState(isHidden) {
        try {
            sessionStorage.setItem(CONFIG.STORAGE_KEY, isHidden);
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

            // Calculate dynamic collapse point based on user config
            const breakpointWidth = window.screen.availWidth * CONFIG.AUTO_COLLAPSE_RATIO;
            const isSmallScreen = CONFIG.AUTO_COLLAPSE_RATIO > 0 && window.innerWidth <= breakpointWidth;

            this.isHidden = isSmallScreen ? true : this.userPreferenceHidden;
            this.isAutoCollapsed = isSmallScreen;

            this.buttonLi = null;
            this.animTimer = null;

            this.injectCSS();
            this.applyDOMState(false);
            this.waitForDOM();
            this.setupResponsive();
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
                    margin-right: 5px !important; /* Force symmetrical fill with left margin */
                    width: auto !important;
                    max-width: none !important;
                }

                /* Tabmenu specific styling */
                .tm-sidebar-toggle-tab {
                    margin-left: 8px;
                }

                .tm-sidebar-toggle-tab a {
                    cursor: pointer;
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
                const tabmenu = document.querySelector('ul.tabmenu');

                if (tabmenu && !this.buttonLi) {
                    this.buildTabButton(tabmenu);
                }

                if (tabmenu && document.body) {
                    obs.disconnect();
                }
            });

            observer.observe(document.documentElement, { childList: true, subtree: true });
        }

        buildTabButton(tabmenu) {
            this.buttonLi = document.createElement('li');
            this.buttonLi.className = CONFIG.CLASSES.TAB_LI;

            if (!this.isHidden) {
                this.buttonLi.classList.add('selected');
            }

            const a = document.createElement('a');
            a.textContent = 'show sidebar';
            a.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggle(true);
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

        // ==========================================
        // Sub-Systems
        // ==========================================

        setupResponsive() {
            if (CONFIG.AUTO_COLLAPSE_RATIO <= 0) return;

            const resizeObserver = new ResizeObserver(() => {
                const breakpointWidth = window.screen.availWidth * CONFIG.AUTO_COLLAPSE_RATIO;
                const isSmallScreen = window.innerWidth <= breakpointWidth;

                if (isSmallScreen && !this.isHidden && !this.isAutoCollapsed) {
                    this.isAutoCollapsed = true;
                    this.updateState({ hidden: true, save: false });
                }
                else if (!isSmallScreen && this.isAutoCollapsed) {
                    this.isAutoCollapsed = false;
                    this.updateState({ hidden: this.userPreferenceHidden, save: false });
                }
            });

            resizeObserver.observe(document.documentElement);
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
            }
        }
    }

    new SidebarController();

})();
