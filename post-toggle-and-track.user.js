// ==UserScript==
// @name         [Reddit] Post Toggle & Track
// @namespace    https://github.com/myouisaur/Reddit
// @icon         https://www.reddit.com/favicon.ico
// @version      4.4
// @description  Adds a toggle button to cleanly collapse posts and a tracker for downloaded posts.
// @author       Xiv
// @match        *://*.reddit.com/*
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @connect      *
// @run-at       document-idle
// @updateURL    https://myouisaur.github.io/Reddit/post-toggle-and-track.user.js
// @downloadURL  https://myouisaur.github.io/Reddit/post-toggle-and-track.user.js
// ==/UserScript==

(function () {
    'use strict';

    if (document.querySelector('shreddit-app, #AppRouter-main-content')) {
        console.log('[Reddit Post Collapser] New Reddit detected. Script safely disabled.');
        return;
    }

    if (window.location.pathname.includes('/comments/')) {
        return;
    }

    if (window.__redditCollapserRunning) return;
    window.__redditCollapserRunning = true;

    // =========================================================
    // CONFIGURATION
    // =========================================================
    const CLOUD_CONFIG = {
        WORKER_URL: 'https://ig-viewed-post-marker.myouisaur.workers.dev/', // Update with your actual URL
        OWNER: 'myouisaur',
        REPO: 'Reddit',
        BRANCH: 'main',
        PATH: 'post-toggle-and-track-db.json'
    };

    const CONFIG = {
        UI_PREFIX: 'xiv-rdt',
        STORAGE_KEYS: {
            V2_DATA: 'xiv_reddit_data_v2', // Upgraded schema for cloud sync
            TOKEN: 'xiv_github_token',
            DIRTY: 'xiv_sync_dirty',
            LAST_FETCH: 'xiv_last_fetch',
            MUTEX: 'xiv_global_mutex',
            SYNC_LOCK: 'xiv_cloud_sync_lock',
            LEGACY_COLLAPSED: 'xiv_collapsed_posts',
            LEGACY_DOWNLOADED: 'xiv_downloaded_posts'
        },
        SELECTORS: {
            CONTAINER: 'div.content',
            POST: '.thing.link'
        },
        CLASSES: {
            PROCESSED: 'xiv-processed',
            COLLAPSED: 'xiv-collapsed',
            LAST_COLLAPSED: 'xiv-last-collapsed',
            ANIMATING: 'xiv-animating',
            HIDDEN_CONTENT: 'xiv-hidden-content',
            ACTION_CONTAINER: 'xiv-action-container',
            TOGGLE_BTN: 'xiv-collapse-toggle',
            DOWNLOAD_BTN: 'xiv-download-btn',
            DOWNLOADED: 'xiv-downloaded',
            ICON_OPEN: 'xiv-icon-open',
            ICON_CLOSED: 'xiv-icon-closed',
            ICON_DOWNLOAD: 'xiv-icon-download',
            COLLAPSED_TITLE: 'xiv-collapsed-title'
        },
        SVG: {
            OPEN: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
            CLOSED: 'M11.83 9L15 12.16V12a3 3 0 00-3-3h-.17zm-4.3.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.3-3.8c4.28 0 8.01 2.37 10.02 6.01-.4.72-.88 1.38-1.4 1.98l-1.52-1.52A9.55 9.55 0 0019.8 12c-1.69-3.26-5.06-5.5-8.8-5.5-1.14 0-2.23.2-3.23.56l1.62 1.62c.5-.06 1.03-.08 1.61-.08zm-9.35-1L1.27 3.73 3.65 6.1C2.33 7.71 1.45 9.75 1 12c1.73 4.39 6 7.5 11 7.5 1.83 0 3.53-.47 5.06-1.28l2.67 2.67 1.27-1.27L2.48 2z',
            DOWNLOAD: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z'
        },
        OBSERVER_DEBOUNCE_MS: 100,
        ANIMATION_MS: 300,
        COLLAPSED_HEIGHT: 36,
        CLOUD_HISTORY_THROTTLE_MS: 30000,
        CLOUD_FOCUS_THROTTLE_MS: 5000
    };

    let debounceTimer = null;

    // =========================================================
    // CLOUD API ENGINE
    // =========================================================
    const CloudAPI = {
        getToken() {
            return (GM_getValue(CONFIG.STORAGE_KEYS.TOKEN, '') || '').trim();
        },

        async promptForToken() {
            const currentToken = this.getToken();
            const newToken = window.prompt('[Reddit Post Toggle & Track]\n\nEnter your GitHub Personal Access Token to enable cloud sync:\n\n(Leave blank to remove your token)', currentToken);

            if (newToken !== null) {
                const trimmedToken = newToken.trim();
                if (trimmedToken === '') {
                    GM_setValue(CONFIG.STORAGE_KEYS.TOKEN, '');
                    UI.showAuthToast('GitHub Token removed. Sync disabled.', 'error');
                    return false;
                }
                GM_setValue(CONFIG.STORAGE_KEYS.TOKEN, trimmedToken);
                try {
                    await Storage.fetchCloudBackground(true);
                    UI.showAuthToast('GitHub Token authenticated and synced successfully!', 'success');
                } catch (e) {
                    console.warn(`[Reddit Tracker] Initial sync failed:`, e);
                }
                return true;
            }
            return false;
        },

        getHeaders() {
            return {
                'X-GitHub-Token': this.getToken(),
                'X-GitHub-Owner': CLOUD_CONFIG.OWNER,
                'X-GitHub-Repo': CLOUD_CONFIG.REPO,
                'X-GitHub-Path': CLOUD_CONFIG.PATH,
                'X-GitHub-Branch': CLOUD_CONFIG.BRANCH
            };
        },

        fetch() {
            return new Promise((resolve, reject) => {
                if (!this.getToken()) return resolve({});
                const cacheBusterUrl = `${CLOUD_CONFIG.WORKER_URL}?t=${Date.now()}`;

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: cacheBusterUrl,
                    headers: this.getHeaders(),
                    responseType: 'json',
                    timeout: 10000,
                    onload: (res) => {
                        if (res.status === 401 || res.status === 403 || res.status === 400) {
                            UI.showAuthToast('GitHub Sync: Invalid or expired token. Click to update.', 'error');
                            return resolve({});
                        }
                        if (res.status === 200) {
                            let data = res.response;
                            if (typeof data === 'string') {
                                try { data = JSON.parse(data); } catch (e) { resolve({}); return; }
                            }
                            resolve(data);
                        } else if (res.status === 404) {
                            resolve({});
                        } else {
                            reject(new Error(`Fetch failed: ${res.status}`));
                        }
                    },
                    onerror: reject,
                    ontimeout: reject
                });
            });
        },

        put(payloadData) {
            return new Promise((resolve, reject) => {
                if (!this.getToken()) return reject(new Error('No GitHub token configured.'));

                GM_xmlhttpRequest({
                    method: 'PUT',
                    url: CLOUD_CONFIG.WORKER_URL,
                    headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
                    data: JSON.stringify(payloadData),
                    responseType: 'json',
                    timeout: 10000,
                    onload: (res) => {
                        if (res.status === 401 || res.status === 403 || res.status === 400) {
                            UI.showAuthToast('GitHub Sync: Invalid or expired token. Click to update.', 'error');
                            return reject(new Error(`Token rejected by server.`));
                        }
                        if (res.status >= 200 && res.status < 300) resolve();
                        else reject(new Error(`Upload failed: ${res.status}`));
                    },
                    onerror: reject,
                    ontimeout: reject
                });
            });
        }
    };

    // =========================================================
    // STORAGE & SYNC MODULE
    // =========================================================
    const Storage = {
        data: {},
        _taskQueue: Promise.resolve(),

        async init() {
            this.loadLocal();
            this.setupCrossTabSync();
            this.setupDirtyListener();

            if (!CloudAPI.getToken()) {
                UI.showAuthToast('GitHub Sync: Token missing. Click to add.', 'error');
            } else {
                this.fetchCloudBackground(true);
            }
        },

        _queueTask(taskFn) {
            this._taskQueue = this._taskQueue.then(taskFn).catch(e => {
                console.error('[Reddit Tracker] Task queue exception', e);
            });
            return this._taskQueue;
        },

        async _withLock(callback) {
            const lockKey = CONFIG.STORAGE_KEYS.MUTEX;
            const myId = Math.random().toString(36).substring(2, 10);
            let attempts = 0;

            while (attempts < 200) {
                const lockStr = GM_getValue(lockKey, null);
                let currentLock = null;
                try { currentLock = lockStr ? JSON.parse(lockStr) : null; } catch(e) {}

                const now = Date.now();
                if (!currentLock || (now - currentLock.time > 3000)) {
                    GM_setValue(lockKey, JSON.stringify({ id: myId, time: now }));
                    await new Promise(r => setTimeout(r, 20));

                    const verifyStr = GM_getValue(lockKey, null);
                    let verifyLock = null;
                    try { verifyLock = verifyStr ? JSON.parse(verifyStr) : null; } catch(e) {}

                    if (verifyLock && verifyLock.id === myId) {
                        try { return await callback(); }
                        finally {
                            await new Promise(r => setTimeout(r, 75));
                            GM_setValue(lockKey, null);
                        }
                    }
                }
                const jitter = Math.floor(Math.random() * 40) + 20;
                await new Promise(r => setTimeout(r, jitter));
                attempts++;
            }
            console.warn('[Reddit Tracker] Global mutex timeout. Forcing execution.');
            return await callback();
        },

        setupDirtyListener() {
            if (typeof GM_addValueChangeListener === 'function') {
                GM_addValueChangeListener(CONFIG.STORAGE_KEYS.DIRTY, (key, oldValue, newValue, remote) => {
                    if (newValue === true && document.visibilityState === 'visible') {
                        setTimeout(() => this.pushToCloud(), 200);
                    }
                });
            }
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && GM_getValue(CONFIG.STORAGE_KEYS.DIRTY, false)) {
                    setTimeout(() => this.pushToCloud(), 200);
                }
            });
        },

        async fetchCloudBackground(force = false, isFocusEvent = false) {
            if (!CloudAPI.getToken()) return;

            const now = Date.now();
            const lastFetch = GM_getValue(CONFIG.STORAGE_KEYS.LAST_FETCH, 0);
            const isDirty = GM_getValue(CONFIG.STORAGE_KEYS.DIRTY, false);

            if (!force && !isDirty) {
                if (isFocusEvent && (now - lastFetch < CONFIG.CLOUD_FOCUS_THROTTLE_MS)) return;
                if (!isFocusEvent && (now - lastFetch < CONFIG.CLOUD_HISTORY_THROTTLE_MS)) return;
            }

            GM_setValue(CONFIG.STORAGE_KEYS.LAST_FETCH, now);

            try {
                const cloudData = await CloudAPI.fetch();
                if (cloudData && Object.keys(cloudData).length > 0) {
                    await this._queueTask(() => this._withLock(async () => {
                        this.loadLocal();
                        this.mergeData(cloudData);
                    }));
                }
                if (isDirty) {
                    await this.pushToCloud();
                }
            } catch (e) {
                console.warn(`[Reddit Tracker] Background sync failed:`, e);
            }
        },

        loadLocal() {
            try {
                const rawV2 = GM_getValue(CONFIG.STORAGE_KEYS.V2_DATA, null);
                if (rawV2) {
                    this.data = JSON.parse(rawV2);
                } else {
                    // One-Time V1 Array Migration
                    let legacyCollapsed = [];
                    let legacyDownloaded = [];
                    try { legacyCollapsed = JSON.parse(GM_getValue(CONFIG.STORAGE_KEYS.LEGACY_COLLAPSED, '[]')); } catch(e){}
                    try { legacyDownloaded = JSON.parse(GM_getValue(CONFIG.STORAGE_KEYS.LEGACY_DOWNLOADED, '[]')); } catch(e){}

                    const migrated = {};
                    const now = Date.now();

                    legacyCollapsed.forEach(id => {
                        if (!migrated[id]) migrated[id] = { c: false, d: false, t: now };
                        migrated[id].c = true;
                    });
                    legacyDownloaded.forEach(id => {
                        if (!migrated[id]) migrated[id] = { c: false, d: false, t: now };
                        migrated[id].d = true;
                    });

                    this.data = migrated;
                    this.saveLocal();
                }
            } catch (e) {
                this.data = {};
            }
        },

        saveLocal() {
            setTimeout(() => {
                GM_setValue(CONFIG.STORAGE_KEYS.V2_DATA, JSON.stringify(this.data));
            }, 0);
        },

        mergeData(remoteData) {
            let changed = false;
            for (const [id, remoteState] of Object.entries(remoteData)) {
                const localState = this.data[id];
                if (!localState || remoteState.t > localState.t) {
                    this.data[id] = remoteState;
                    changed = true;
                    document.dispatchEvent(new CustomEvent(`${CONFIG.UI_PREFIX}-sync`, {
                        detail: { id: id, state: remoteState }
                    }));
                }
            }
            if (changed) this.saveLocal();
        },

        setupCrossTabSync() {
            if (typeof GM_addValueChangeListener === 'function') {
                GM_addValueChangeListener(CONFIG.STORAGE_KEYS.V2_DATA, (key, oldValue, newValue, remote) => {
                    if (remote) {
                        try {
                            const newObj = JSON.parse(newValue || '{}');
                            this.mergeData(newObj);
                        } catch (e) {}
                    }
                });
            }
        },

        async pushToCloud() {
            if (!CloudAPI.getToken()) return 'skipped';
            const syncLockKey = CONFIG.STORAGE_KEYS.SYNC_LOCK;
            let shouldUpload = false;

            await this._withLock(async () => {
                if (Date.now() - GM_getValue(syncLockKey, 0) < 5000) {
                    GM_setValue(CONFIG.STORAGE_KEYS.DIRTY, true);
                    shouldUpload = false;
                } else {
                    GM_setValue(syncLockKey, Date.now());
                    GM_setValue(CONFIG.STORAGE_KEYS.DIRTY, false);
                    shouldUpload = true;
                }
            });

            if (!shouldUpload) return 'queued';

            try {
                const latestCloudData = await CloudAPI.fetch();
                await this._queueTask(() => this._withLock(async () => {
                    this.loadLocal();
                    if (latestCloudData && Object.keys(latestCloudData).length > 0) {
                        this.mergeData(latestCloudData);
                    }
                }));

                await CloudAPI.put(this.data);

                await this._withLock(async () => { GM_setValue(syncLockKey, 0); });
                return 'synced';
            } catch (e) {
                await this._withLock(async () => {
                    GM_setValue(syncLockKey, 0);
                    GM_setValue(CONFIG.STORAGE_KEYS.DIRTY, true);
                });
                throw e;
            }
        },

        toggleCollapsed(id) {
            const current = this.data[id] || { c: false, d: false };
            const newState = !current.c;

            this.data[id] = { ...current, c: newState, t: Date.now() };
            document.dispatchEvent(new CustomEvent(`${CONFIG.UI_PREFIX}-sync`, {
                detail: { id: id, state: this.data[id] }
            }));

            this.saveLocal();
            GM_setValue(CONFIG.STORAGE_KEYS.DIRTY, true);
        },

        toggleDownloaded(id) {
            const current = this.data[id] || { c: false, d: false };
            const newState = !current.d;

            this.data[id] = { ...current, d: newState, t: Date.now() };
            document.dispatchEvent(new CustomEvent(`${CONFIG.UI_PREFIX}-sync`, {
                detail: { id: id, state: this.data[id] }
            }));

            this.saveLocal();
            GM_setValue(CONFIG.STORAGE_KEYS.DIRTY, true);
        },

        getState(id) {
            return this.data[id] || { c: false, d: false };
        }
    };

    // =========================================================
    // DOM MANIPULATION & UI FUNCTIONS
    // =========================================================
    function collapsePost(post) {
        post.style.maxHeight = post.scrollHeight + 'px';
        post.classList.add(CONFIG.CLASSES.ANIMATING);
        post.classList.remove(CONFIG.CLASSES.HIDDEN_CONTENT);

        void post.offsetHeight; // Force reflow

        post.classList.add(CONFIG.CLASSES.COLLAPSED);
        post.style.maxHeight = `${CONFIG.COLLAPSED_HEIGHT}px`;

        clearTimeout(post.__xivAnimTimer);
        post.__xivAnimTimer = setTimeout(() => {
            if (post.classList.contains(CONFIG.CLASSES.COLLAPSED)) {
                post.classList.remove(CONFIG.CLASSES.ANIMATING);
                post.classList.add(CONFIG.CLASSES.HIDDEN_CONTENT);
            }
        }, CONFIG.ANIMATION_MS);
    }

    function expandPost(post) {
        post.classList.remove(CONFIG.CLASSES.HIDDEN_CONTENT);
        post.style.maxHeight = 'none';
        const targetHeight = post.scrollHeight;

        post.style.maxHeight = `${CONFIG.COLLAPSED_HEIGHT}px`;
        post.classList.add(CONFIG.CLASSES.ANIMATING);

        void post.offsetHeight; // Force reflow

        post.classList.remove(CONFIG.CLASSES.COLLAPSED);
        post.style.maxHeight = targetHeight + 'px';

        clearTimeout(post.__xivAnimTimer);
        post.__xivAnimTimer = setTimeout(() => {
            if (!post.classList.contains(CONFIG.CLASSES.COLLAPSED)) {
                post.classList.remove(CONFIG.CLASSES.ANIMATING);
                post.style.maxHeight = '';
            }
        }, CONFIG.ANIMATION_MS);
    }

    function createSVGIcon(pathData, className) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('fill', 'currentColor');
        svg.classList.add(className);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        svg.appendChild(path);
        return svg;
    }

    function getAdjacentPost(postElement, direction) {
        let sibling = direction === 'next' ? postElement.nextElementSibling : postElement.previousElementSibling;
        while (sibling) {
            if (sibling.matches && sibling.matches(CONFIG.SELECTORS.POST)) return sibling;
            sibling = direction === 'next' ? sibling.nextElementSibling : sibling.previousElementSibling;
        }
        return null;
    }

    function updateGapState(post) {
        if (!post) return;
        const nextPost = getAdjacentPost(post, 'next');

        if (post.classList.contains(CONFIG.CLASSES.COLLAPSED)) {
            if (!nextPost || !nextPost.classList.contains(CONFIG.CLASSES.COLLAPSED)) {
                post.classList.add(CONFIG.CLASSES.LAST_COLLAPSED);
            } else {
                post.classList.remove(CONFIG.CLASSES.LAST_COLLAPSED);
            }
        } else {
            post.classList.remove(CONFIG.CLASSES.LAST_COLLAPSED);
        }
    }

    function getRelativeTime(date) {
        const diffInSeconds = Math.floor((new Date() - date) / 1000);
        if (diffInSeconds < 60) return 'just now';

        const diffInMinutes = Math.floor(diffInSeconds / 60);
        if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes === 1 ? '' : 's'} ago`;

        const diffInHours = Math.floor(diffInMinutes / 60);
        if (diffInHours < 24) return `${diffInHours} hour${diffInHours === 1 ? '' : 's'} ago`;

        const diffInDays = Math.floor(diffInHours / 24);
        if (diffInDays < 30) return `${diffInDays} day${diffInDays === 1 ? '' : 's'} ago`;

        const diffInMonths = Math.floor(diffInDays / 30);
        if (diffInMonths < 12) return `${diffInMonths} month${diffInMonths === 1 ? '' : 's'} ago`;

        const diffInYears = Math.floor(diffInDays / 365);
        return `${diffInYears} year${diffInYears === 1 ? '' : 's'} ago`;
    }

    function createCollapsedTitle(postElement) {
        const parts = [];
        const titleAnchor = postElement.querySelector('a.title');
        parts.push(titleAnchor ? titleAnchor.textContent : 'Post');

        const subElem = postElement.querySelector('.subreddit');
        if (subElem) parts.push(subElem.textContent);

        const commentsElem = postElement.querySelector('.comments');
        if (commentsElem) parts.push(commentsElem.textContent);

        const timeElem = postElement.querySelector('time.live-timestamp, time');
        if (timeElem) {
            const dtString = timeElem.getAttribute('datetime');
            if (dtString) {
                try {
                    const dateObj = new Date(dtString);
                    if (!isNaN(dateObj.getTime())) {
                        parts.push(getRelativeTime(dateObj));
                    }
                } catch (error) {
                    console.warn('[Reddit Post Collapser] Date parsing failed.');
                }
            }
        }

        const combinedText = parts.join(' • ');
        const span = document.createElement('span');
        span.className = CONFIG.CLASSES.COLLAPSED_TITLE;
        span.textContent = combinedText;
        span.setAttribute('title', combinedText);

        return span;
    }

    function createToggleButton(postElement, postId, isInitiallyCollapsed) {
        const btn = document.createElement('button');
        btn.className = CONFIG.CLASSES.TOGGLE_BTN;
        btn.setAttribute('aria-label', 'Toggle Post Visibility');
        btn.setAttribute('title', isInitiallyCollapsed ? 'Expand Post' : 'Collapse Post');

        btn.appendChild(createSVGIcon(CONFIG.SVG.OPEN, CONFIG.CLASSES.ICON_OPEN));
        btn.appendChild(createSVGIcon(CONFIG.SVG.CLOSED, CONFIG.CLASSES.ICON_CLOSED));
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            Storage.toggleCollapsed(postId);
        });
        return btn;
    }

    function createDownloadButton(postElement, postId, isInitiallyDownloaded) {
        const btn = document.createElement('button');
        btn.className = CONFIG.CLASSES.DOWNLOAD_BTN;
        btn.setAttribute('aria-label', 'Toggle Download Status');
        btn.setAttribute('title', isInitiallyDownloaded ? 'Mark as Not Downloaded' : 'Mark as Downloaded');

        btn.appendChild(createSVGIcon(CONFIG.SVG.DOWNLOAD, CONFIG.CLASSES.ICON_DOWNLOAD));
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            Storage.toggleDownloaded(postId);
        });
        return btn;
    }

    const UI = {
        injectStyles() {
            const style = document.createElement('style');
            style.textContent = `
                .thing.${CONFIG.CLASSES.PROCESSED} {
                    position: relative !important;
                    border-left: 3px solid rgba(128, 128, 128, 0.4) !important;
                    padding-left: 6px !important;
                    overflow: hidden !important;
                    transition: background-color 0.2s ease !important;
                }

                .thing.${CONFIG.CLASSES.DOWNLOADED} {
                    background-color: rgba(34, 197, 94, 0.08) !important;
                }

                .thing.${CONFIG.CLASSES.ANIMATING} {
                    transition: max-height ${CONFIG.ANIMATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1), margin-bottom ${CONFIG.ANIMATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1) !important;
                }

                .${CONFIG.CLASSES.ACTION_CONTAINER} {
                    float: left;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    margin: 8px 8px 8px 0;
                }

                .${CONFIG.CLASSES.TOGGLE_BTN}, .${CONFIG.CLASSES.DOWNLOAD_BTN} {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 20px;
                    height: 20px;
                    background: transparent;
                    border: none;
                    cursor: pointer;
                    color: inherit;
                    opacity: 0.5;
                    border-radius: 4px;
                    transition: background-color 0.2s ease, outline 0.2s ease, opacity 0.2s ease, color 0.2s ease;
                    padding: 0;
                }

                .${CONFIG.CLASSES.TOGGLE_BTN}:hover, .${CONFIG.CLASSES.DOWNLOAD_BTN}:hover {
                    background: rgba(128, 128, 128, 0.2);
                    opacity: 0.9;
                }

                .${CONFIG.CLASSES.TOGGLE_BTN}:focus-visible, .${CONFIG.CLASSES.DOWNLOAD_BTN}:focus-visible {
                    outline: 2px solid rgba(128, 128, 128, 0.8);
                    outline-offset: 2px;
                    opacity: 1;
                }

                .thing.${CONFIG.CLASSES.DOWNLOADED} .${CONFIG.CLASSES.DOWNLOAD_BTN} {
                    color: #22c55e !important;
                    opacity: 1 !important;
                }

                /* Hides the download button completely when the post is collapsed */
                .thing.${CONFIG.CLASSES.COLLAPSED} .${CONFIG.CLASSES.DOWNLOAD_BTN} {
                    display: none !important;
                }

                .${CONFIG.CLASSES.TOGGLE_BTN} .${CONFIG.CLASSES.ICON_CLOSED} { display: none; }
                .thing.${CONFIG.CLASSES.COLLAPSED} .${CONFIG.CLASSES.TOGGLE_BTN} .${CONFIG.CLASSES.ICON_OPEN} { display: none; }
                .thing.${CONFIG.CLASSES.COLLAPSED} .${CONFIG.CLASSES.TOGGLE_BTN} .${CONFIG.CLASSES.ICON_CLOSED} { display: block; }

                .${CONFIG.CLASSES.COLLAPSED_TITLE} {
                    position: absolute;
                    left: 36px;
                    top: 0;
                    height: ${CONFIG.COLLAPSED_HEIGHT}px;
                    display: flex;
                    align-items: center;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.2s ease;
                    font-size: x-small;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    right: 8px;
                }

                .thing.${CONFIG.CLASSES.COLLAPSED} .${CONFIG.CLASSES.COLLAPSED_TITLE} {
                    opacity: 0.8;
                    pointer-events: auto;
                }

                .thing > *:not(.${CONFIG.CLASSES.ACTION_CONTAINER}):not(.${CONFIG.CLASSES.COLLAPSED_TITLE}) {
                    transition: opacity 0.2s ease;
                }

                .thing.${CONFIG.CLASSES.COLLAPSED} > *:not(.${CONFIG.CLASSES.ACTION_CONTAINER}):not(.${CONFIG.CLASSES.COLLAPSED_TITLE}) {
                    opacity: 0 !important;
                    pointer-events: none !important;
                }

                .thing.${CONFIG.CLASSES.HIDDEN_CONTENT} > *:not(.${CONFIG.CLASSES.ACTION_CONTAINER}):not(.${CONFIG.CLASSES.COLLAPSED_TITLE}) {
                    display: none !important;
                }

                .thing.${CONFIG.CLASSES.COLLAPSED} {
                    min-height: ${CONFIG.COLLAPSED_HEIGHT}px !important;
                    background-color: transparent !important;
                }

                .thing.${CONFIG.CLASSES.LAST_COLLAPSED} {
                    margin-bottom: 8px !important;
                }

                /* ----------------- TOAST STYLES ----------------- */
                .${CONFIG.UI_PREFIX}-toast {
                    position: fixed;
                    bottom: 2rem;
                    right: 2rem;
                    background: rgba(20, 20, 20, 0.95);
                    backdrop-filter: blur(10px);
                    border: 1px solid transparent;
                    border-left: 4px solid transparent;
                    color: #fff;
                    padding: 1rem 1.2rem;
                    border-radius: 0.6rem;
                    font-size: 0.9rem;
                    font-weight: 500;
                    box-shadow: 0 8px 16px rgba(0,0,0,0.5);
                    display: flex;
                    align-items: center;
                    gap: 1.5rem;
                    z-index: 999999;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    animation: tmToastFadeIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
                    transition: background 0.2s;
                }
                .${CONFIG.UI_PREFIX}-toast.error {
                    border-color: #e57373;
                    border-left-color: #e57373;
                    cursor: pointer;
                }
                .${CONFIG.UI_PREFIX}-toast.success {
                    border-color: #4ade80;
                    border-left-color: #4ade80;
                    cursor: default;
                }
                .${CONFIG.UI_PREFIX}-toast.error:hover { background: rgba(40, 40, 40, 0.95); }
                .${CONFIG.UI_PREFIX}-toast button {
                    background: transparent; border: none; color: #aaa;
                    font-size: 1.2rem; cursor: pointer; padding: 0;
                    line-height: 1; transition: color 0.2s; outline: none;
                }
                .${CONFIG.UI_PREFIX}-toast button:hover { color: #fff; }
                @keyframes tmToastFadeIn {
                    from { opacity: 0; transform: translateX(20px) scale(0.95); }
                    to { opacity: 1; transform: translateX(0) scale(1); }
                }
                @keyframes tmToastFadeOut {
                    from { opacity: 1; transform: translateX(0) scale(1); }
                    to { opacity: 0; transform: translateX(20px) scale(0.95); }
                }
            `;
            document.head.appendChild(style);

            // Cross-device DOM UI Listener
            document.addEventListener(`${CONFIG.UI_PREFIX}-sync`, (e) => {
                const { id, state } = e.detail;
                const post = document.querySelector(`[data-fullname="${id}"]`);
                if (!post) return;

                const isCurrentlyCollapsed = post.classList.contains(CONFIG.CLASSES.COLLAPSED);
                const toggleBtn = post.querySelector(`.${CONFIG.CLASSES.TOGGLE_BTN}`);
                if (state.c && !isCurrentlyCollapsed) {
                    collapsePost(post);
                    if (toggleBtn) toggleBtn.setAttribute('title', 'Expand Post');
                } else if (!state.c && isCurrentlyCollapsed) {
                    expandPost(post);
                    if (toggleBtn) toggleBtn.setAttribute('title', 'Collapse Post');
                }

                const dlBtn = post.querySelector(`.${CONFIG.CLASSES.DOWNLOAD_BTN}`);
                if (state.d) {
                    post.classList.add(CONFIG.CLASSES.DOWNLOADED);
                    if (dlBtn) dlBtn.setAttribute('title', 'Mark as Not Downloaded');
                } else {
                    post.classList.remove(CONFIG.CLASSES.DOWNLOADED);
                    if (dlBtn) dlBtn.setAttribute('title', 'Mark as Downloaded');
                }

                updateGapState(post);
                updateGapState(getAdjacentPost(post, 'prev'));
            });
        },

        showAuthToast(message, type = 'error') {
            this.removeAuthToast(null, true);
            const toast = document.createElement('div');
            toast.id = `${CONFIG.UI_PREFIX}-auth-toast`;
            toast.className = `${CONFIG.UI_PREFIX}-toast ${type}`;

            const text = document.createElement('span');
            text.textContent = message;
            toast.appendChild(text);

            if (type === 'error') {
                const closeBtn = document.createElement('button');
                closeBtn.innerHTML = '✕';
                closeBtn.title = "Dismiss";
                closeBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.removeAuthToast(toast);
                };
                toast.appendChild(closeBtn);
                toast.onclick = () => CloudAPI.promptForToken();
            } else if (type === 'success') {
                setTimeout(() => this.removeAuthToast(toast), 3000);
            }
            document.body.appendChild(toast);
        },

        removeAuthToast(specificToast = null, immediate = false) {
            const toast = specificToast || document.getElementById(`${CONFIG.UI_PREFIX}-auth-toast`);
            if (toast) {
                if (immediate) {
                    toast.remove();
                    return;
                }
                toast.style.animation = 'tmToastFadeOut 0.3s forwards';
                setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
            }
        }
    };

    function processPosts(root = document) {
        try {
            const posts = [];
            if (root.matches && root.matches(CONFIG.SELECTORS.POST) && !root.classList.contains(CONFIG.CLASSES.PROCESSED)) {
                posts.push(root);
            }

            if (root.querySelectorAll) {
                const children = root.querySelectorAll(`${CONFIG.SELECTORS.POST}:not(.${CONFIG.CLASSES.PROCESSED})`);
                posts.push(...children);
            }

            if (!posts.length) return;

            requestAnimationFrame(() => {
                posts.forEach(post => {
                    if (post.querySelector(`.${CONFIG.CLASSES.TOGGLE_BTN}`)) {
                        post.classList.add(CONFIG.CLASSES.PROCESSED);
                        return;
                    }
                    post.classList.add(CONFIG.CLASSES.PROCESSED);

                    const postId = post.getAttribute('data-fullname');
                    const state = Storage.getState(postId);

                    if (state.d) {
                        post.classList.add(CONFIG.CLASSES.DOWNLOADED);
                    }

                    const actionContainer = document.createElement('div');
                    actionContainer.className = CONFIG.CLASSES.ACTION_CONTAINER;

                    const btn = createToggleButton(post, postId, state.c);
                    const dlBtn = createDownloadButton(post, postId, state.d);
                    const collapsedTitle = createCollapsedTitle(post);

                    actionContainer.appendChild(btn);
                    actionContainer.appendChild(dlBtn);

                    const rankElem = post.querySelector('.rank');
                    if (rankElem) {
                        post.insertBefore(actionContainer, rankElem);
                        post.insertBefore(collapsedTitle, rankElem);
                    } else if (post.firstChild) {
                        post.insertBefore(actionContainer, post.firstChild);
                        post.insertBefore(collapsedTitle, actionContainer.nextSibling);
                    } else {
                        post.appendChild(actionContainer);
                        post.appendChild(collapsedTitle);
                    }

                    if (state.c) {
                        post.classList.add(CONFIG.CLASSES.COLLAPSED);
                        post.classList.add(CONFIG.CLASSES.HIDDEN_CONTENT);
                        post.style.maxHeight = `${CONFIG.COLLAPSED_HEIGHT}px`;
                    }

                    updateGapState(post);
                });
            });
        } catch (error) {
            console.error('[Reddit Post Collapser] Error processing posts:', error);
        }
    }

    function scheduleProcessing(root = document) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            processPosts(root);
        }, CONFIG.OBSERVER_DEBOUNCE_MS);
    }

    // =========================================================
    // DOM OBSERVER & APP LIFECYCLE
    // =========================================================
    const App = {
        observer: null,

        start() {
            this.bindEvents();
            this.startScanner();
        },

        bindEvents() {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    Storage.fetchCloudBackground(false, true);
                }
            });

            setInterval(() => {
                if (document.visibilityState === 'visible') {
                    Storage.fetchCloudBackground(false, false);
                }
            }, CONFIG.CLOUD_HISTORY_THROTTLE_MS);

            window.addEventListener('neverEndingLoad', () => {
                scheduleProcessing(document);
            }, { passive: true });
        },

        startScanner() {
            processPosts();
            const container = document.body;
            if (!container) return;

            this.observer = new MutationObserver((mutations) => {
                const nodesToProcess = new Set();
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (
                                node.classList.contains('thing') ||
                                node.classList.contains('sitetable') ||
                                (node.id && node.id.startsWith('siteTable'))
                            ) {
                                nodesToProcess.add(node);
                            }
                        }
                    }
                }
                if (nodesToProcess.size > 0) {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        nodesToProcess.forEach(n => processPosts(n));
                    }, CONFIG.OBSERVER_DEBOUNCE_MS);
                }
            });
            this.observer.observe(container, { childList: true, subtree: true });
        }
    };

    // =========================================================
    // BOOTSTRAP
    // =========================================================
    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Update GitHub Token', () => {
            CloudAPI.promptForToken();
        });
    }

    function init() {
        try {
            UI.injectStyles();
            Storage.init().then(() => App.start());
        } catch (error) {
            console.error('[Reddit Post Collapser] Fatal initialization error:', error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
