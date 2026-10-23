import WebDAVClient from './utils/webdav.js';
import { convertShortcutsToFavoritesTxt, convertBookmarksToHtml } from './utils/syncUtils.js';

const STORAGE_KEYS = {
    SETTINGS: 'andy_tab_settings',
    SHORTCUTS: 'andy_tab_shortcuts',
    WEBDAV_CONFIG: 'andy_tab_webdav_config',
    SEARCH_ENGINES: 'andy_tab_search_engines',
    TODOS: 'andy_tab_todos',
    WIDGETS: 'andy_tab_widgets',
    SYNC_LAST_TIMESTAMP: 'andy_tab_sync_lasttimestamp'
};

let syncDebounceTimer = null;
let bookmarkChangeTimer = null;

let syncInProgress = false;
let syncRefCount = 0;

async function initWebDAVClient() {
    const result = await chrome.storage.local.get([STORAGE_KEYS.WEBDAV_CONFIG]);
    const config = result[STORAGE_KEYS.WEBDAV_CONFIG];
    if (config && config.url && (config.url.startsWith('http://') || config.url.startsWith('https://'))) {
        return new WebDAVClient(config);
    }
    return null;
}

async function getStoragePath() {
    const result = await chrome.storage.local.get([STORAGE_KEYS.WEBDAV_CONFIG]);
    const config = result[STORAGE_KEYS.WEBDAV_CONFIG];
    return config?.storagePath || 'AndyTab';
}

async function ensureStorageDirectory(webdavClient) {
    try {
        const storagePath = await getStoragePath();
        await webdavClient.createDirectory(storagePath);
    } catch (error) {

    }
}

function getBrowserBookmarks() {
    return new Promise((resolve) => {
        chrome.bookmarks.getTree((bookmarkTreeNodes) => {
            resolve(bookmarkTreeNodes);
        });
    });
}

async function getAllData() {
    const result = await chrome.storage.local.get([
        STORAGE_KEYS.SHORTCUTS,
        STORAGE_KEYS.SETTINGS,
        STORAGE_KEYS.SEARCH_ENGINES,
        STORAGE_KEYS.TODOS,
        STORAGE_KEYS.WIDGETS,
        STORAGE_KEYS.WEBDAV_CONFIG
    ]);
    const bookmarks = await getBrowserBookmarks();

    return {
        shortcuts: result[STORAGE_KEYS.SHORTCUTS] || [],
        settings: result[STORAGE_KEYS.SETTINGS] || {},
        searchEngines: result[STORAGE_KEYS.SEARCH_ENGINES] || {},
        todos: result[STORAGE_KEYS.TODOS] || [],
        widgets: result[STORAGE_KEYS.WIDGETS] || [],
        webdavConfig: result[STORAGE_KEYS.WEBDAV_CONFIG] || null,
        bookmarks: bookmarks
    };
}

async function uploadSyncData() {
    if (syncInProgress) return;
    syncInProgress = true;

    try {
        const webdavClient = await initWebDAVClient();
        if (!webdavClient) {
            return;
        }

        await ensureStorageDirectory(webdavClient);
        const storagePath = await getStoragePath();

        const data = await getAllData();
        const bookmarks = await getBrowserBookmarks();

        const favoritesContent = convertShortcutsToFavoritesTxt(data.shortcuts);
        await webdavClient.putFile(`${storagePath}/favorites.txt`, favoritesContent);

        const bookmarksHtml = convertBookmarksToHtml(bookmarks);
        await webdavClient.putFile(`${storagePath}/bookmarks.html`, bookmarksHtml);

        await webdavClient.putFile(`${storagePath}/andy_tab_sync.json`, JSON.stringify(data, null, 2));

        const [lastModifiedFav, lastModifiedBm, lastModifiedSync] = await Promise.all([
            webdavClient.getLastModified(`${storagePath}/favorites.txt`),
            webdavClient.getLastModified(`${storagePath}/bookmarks.html`),
            webdavClient.getLastModified(`${storagePath}/andy_tab_sync.json`)
        ]);

        const timestamps = (await chrome.storage.local.get([STORAGE_KEYS.SYNC_LAST_TIMESTAMP]))[STORAGE_KEYS.SYNC_LAST_TIMESTAMP] || {};
        timestamps.favorites = lastModifiedFav ? new Date(lastModifiedFav).getTime() : Date.now();
        timestamps.bookmarks = lastModifiedBm ? new Date(lastModifiedBm).getTime() : Date.now();
        timestamps.sync = lastModifiedSync ? new Date(lastModifiedSync).getTime() : Date.now();
        await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_LAST_TIMESTAMP]: timestamps });

        console.log('[AndyTAB Background] 同步上传成功');
    } catch (error) {
        console.error('[AndyTAB Background] 同步上传失败：', error);
    } finally {
        syncInProgress = false;
    }
}

function uploadSyncDataWithDebounce() {
    if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
    }
    syncDebounceTimer = setTimeout(async () => {
        await uploadSyncData();
    }, 1500);
}

function isSameStorageValue(a, b) {
    try {
        return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
    } catch (e) {
        return false;
    }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    const syncableKeys = [
        STORAGE_KEYS.SHORTCUTS,
        STORAGE_KEYS.SETTINGS,
        STORAGE_KEYS.SEARCH_ENGINES,
        STORAGE_KEYS.TODOS,
        STORAGE_KEYS.WIDGETS
    ];

    const hasSyncableChange = Object.keys(changes).some(key => {
        if (!syncableKeys.includes(key) || key === STORAGE_KEYS.SYNC_LAST_TIMESTAMP) return false;
        return !isSameStorageValue(changes[key].oldValue, changes[key].newValue);
    });

    if (changes[STORAGE_KEYS.TODOS]) {
        syncTodoAlarms();
    }

    if (hasSyncableChange && !syncInProgress) {
        uploadSyncDataWithDebounce();
    }
});

function handleBookmarkChange() {
    if (syncInProgress) return;

    if (bookmarkChangeTimer) {
        clearTimeout(bookmarkChangeTimer);
    }

    bookmarkChangeTimer = setTimeout(() => {
        uploadSyncDataWithDebounce();
    }, 500);
}

chrome.bookmarks.onCreated.addListener(handleBookmarkChange);
chrome.bookmarks.onRemoved.addListener(handleBookmarkChange);
chrome.bookmarks.onChanged.addListener(handleBookmarkChange);
chrome.bookmarks.onMoved.addListener(handleBookmarkChange);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'syncStart') {
        syncRefCount++;
        syncInProgress = true;
        if (syncDebounceTimer) {
            clearTimeout(syncDebounceTimer);
            syncDebounceTimer = null;
        }
        if (bookmarkChangeTimer) {
            clearTimeout(bookmarkChangeTimer);
            bookmarkChangeTimer = null;
        }
    } else if (message.type === 'syncEnd') {
        syncRefCount = Math.max(0, syncRefCount - 1);
        if (syncRefCount === 0) {
            syncInProgress = false;
        }
    } else if (message.action === 'FETCH_WEBSITE_INFO') {
        fetchWebsiteInfo(message.url).then(sendResponse).catch(e => {
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }
});

async function fetchWebsiteInfo(url) {
    try {
        let icon = '';
        let title = '';

        const urlObj = new URL(url);
        const domain = urlObj.hostname;

        icon = `https://favicon.im/${domain}?larger=true`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (response.ok) {
                const html = await response.text();

                const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
                title = titleMatch ? titleMatch[1].trim() : domain;

                const iconPatterns = [
                    /<link[^>]*rel=["']?(?:shortcut\s+)?icon["']?[^>]*href=["']?([^"'>]+)["']?[^>]*>/i,
                    /<link[^>]*href=["']?([^"'>]+)["']?[^>]*rel=["']?(?:shortcut\s+)?icon["']?[^>]*>/i
                ];

                for (const pattern of iconPatterns) {
                    const match = html.match(pattern);
                    if (match) {
                        let iconUrl = match[1];
                        if (iconUrl && !iconUrl.startsWith('http')) {
                            if (iconUrl.startsWith('//')) {
                                iconUrl = urlObj.protocol + iconUrl;
                            } else if (iconUrl.startsWith('/')) {
                                iconUrl = urlObj.origin + iconUrl;
                            } else {
                                iconUrl = urlObj.origin + '/' + iconUrl;
                            }
                        }
                        if (iconUrl) {
                            icon = iconUrl;
                            break;
                        }
                    }
                }
            }
        } catch {
        }

        if (!title) {
            title = domain;
        }

        return { success: true, data: { title, icon } };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

const TODO_ALARM_PREFIX = 'todo_remind_';

function createTodoNotification(todo) {
    chrome.notifications.create(`todo_notify_${todo.id}_${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('src/assets/icons/icon128.png'),
        title: '待办提醒',
        message: todo.text,
        priority: 2,
        requireInteraction: true
    }, () => {
        if (chrome.runtime.lastError) {
            console.error('[AndyTAB Background] 待办通知发送失败：', chrome.runtime.lastError.message);
        }
    });
}

async function markReminderNotified(todoId, remindAt) {
    const result = await chrome.storage.local.get([STORAGE_KEYS.TODOS]);
    const todos = result[STORAGE_KEYS.TODOS] || [];
    const todo = todos.find(t => t.id === todoId);
    if (!todo || todo.remindAt !== remindAt) return;
    todo.remindNotifiedAt = remindAt;
    await chrome.storage.local.set({ [STORAGE_KEYS.TODOS]: todos });
}

async function syncTodoAlarms() {
    try {
        const todos = (await chrome.storage.local.get([STORAGE_KEYS.TODOS]))[STORAGE_KEYS.TODOS] || [];
        const pending = todos.filter(t => !t.completed && typeof t.remindAt === 'number' && t.remindAt > Date.now());
        const keepNames = new Set(pending.map(t => `${TODO_ALARM_PREFIX}${t.id}`));

        const existing = await chrome.alarms.getAll();
        for (const alarm of existing) {
            if (alarm.name.startsWith(TODO_ALARM_PREFIX) && !keepNames.has(alarm.name)) {
                chrome.alarms.clear(alarm.name);
            }
        }

        for (const todo of pending) {
            chrome.alarms.create(`${TODO_ALARM_PREFIX}${todo.id}`, { when: todo.remindAt });
        }

        const due = todos
            .filter(t => !t.completed && typeof t.remindAt === 'number' && t.remindAt <= Date.now() && t.remindNotifiedAt !== t.remindAt)
            .sort((a, b) => b.remindAt - a.remindAt)
            .slice(0, 5);

        for (const todo of due) {
            createTodoNotification(todo);
            todo.remindNotifiedAt = todo.remindAt;
        }
        if (due.length) {
            await chrome.storage.local.set({ [STORAGE_KEYS.TODOS]: todos });
        }
    } catch (error) {
        console.error('[AndyTAB Background] 同步待办提醒失败：', error);
    }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith(TODO_ALARM_PREFIX)) return;

    const todoId = Number(alarm.name.slice(TODO_ALARM_PREFIX.length));
    const result = await chrome.storage.local.get([STORAGE_KEYS.TODOS]);
    const todos = result[STORAGE_KEYS.TODOS] || [];
    const todo = todos.find(t => t.id === todoId);
    if (!todo || todo.completed) return;

    createTodoNotification(todo);
    await markReminderNotified(todoId, todo.remindAt);
});

chrome.notifications.onClicked.addListener(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/newtab/index.html') });
});

syncTodoAlarms();
