// Background Service Worker - 监听数据变动并自动触发同步上传
// 解决 newtab 未打开时无法监控快捷方式和收藏夹变动的问题

import WebDAVClient from './utils/webdav.js';
import { convertShortcutsToFavoritesTxt, convertBookmarksToHtml } from './utils/syncUtils.js';

const STORAGE_KEYS = {
    SETTINGS: 'andy_tab_settings',
    SHORTCUTS: 'andy_tab_shortcuts',
    WEBDAV_CONFIG: 'andy_tab_webdav_config',
    SEARCH_ENGINES: 'andy_tab_search_engines',
    TODOS: 'andy_tab_todos',
    NOTES: 'andy_tab_notes',
    SYNC_LAST_TIMESTAMP: 'andy_tab_sync_lasttimestamp'
};

// 防抖定时器
let syncDebounceTimer = null;
let bookmarkChangeTimer = null;
// 同步锁（支持嵌套引用计数）
let syncInProgress = false;
let syncRefCount = 0;

// 初始化 WebDAV 客户端
async function initWebDAVClient() {
    const result = await chrome.storage.local.get([STORAGE_KEYS.WEBDAV_CONFIG]);
    const config = result[STORAGE_KEYS.WEBDAV_CONFIG];
    if (config && config.url && (config.url.startsWith('http://') || config.url.startsWith('https://'))) {
        return new WebDAVClient(config);
    }
    return null;
}

// 获取存储路径
async function getStoragePath() {
    const result = await chrome.storage.local.get([STORAGE_KEYS.WEBDAV_CONFIG]);
    const config = result[STORAGE_KEYS.WEBDAV_CONFIG];
    return config?.storagePath || 'AndyTab';
}

// 确保存储目录存在
async function ensureStorageDirectory(webdavClient) {
    try {
        const storagePath = await getStoragePath();
        await webdavClient.createDirectory(storagePath);
    } catch (error) {
        // 目录已存在会报错，这是正常的
    }
}

// 获取浏览器书签
function getBrowserBookmarks() {
    return new Promise((resolve) => {
        chrome.bookmarks.getTree((bookmarkTreeNodes) => {
            resolve(bookmarkTreeNodes);
        });
    });
}

// 获取所有数据
async function getAllData() {
    const result = await chrome.storage.local.get([
        STORAGE_KEYS.SHORTCUTS,
        STORAGE_KEYS.SETTINGS,
        STORAGE_KEYS.SEARCH_ENGINES,
        STORAGE_KEYS.TODOS,
        STORAGE_KEYS.NOTES,
        STORAGE_KEYS.WEBDAV_CONFIG
    ]);
    const bookmarks = await getBrowserBookmarks();

    return {
        shortcuts: result[STORAGE_KEYS.SHORTCUTS] || [],
        settings: result[STORAGE_KEYS.SETTINGS] || {},
        searchEngines: result[STORAGE_KEYS.SEARCH_ENGINES] || {},
        todos: result[STORAGE_KEYS.TODOS] || [],
        notes: result[STORAGE_KEYS.NOTES] || '',
        webdavConfig: result[STORAGE_KEYS.WEBDAV_CONFIG] || null,
        bookmarks: bookmarks
    };
}

// 上传同步数据到云端（精简版，不依赖 DOMParser）
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

        // 获取本地数据
        const data = await getAllData();
        const bookmarks = await getBrowserBookmarks();

        // 1. 上传 favorites.txt
        const favoritesContent = convertShortcutsToFavoritesTxt(data.shortcuts);
        await webdavClient.putFile(`${storagePath}/favorites.txt`, favoritesContent);

        // 2. 上传 bookmarks.html
        const bookmarksHtml = convertBookmarksToHtml(bookmarks);
        await webdavClient.putFile(`${storagePath}/bookmarks.html`, bookmarksHtml);

        // 3. 上传 andy_tab_sync.json
        await webdavClient.putFile(`${storagePath}/andy_tab_sync.json`, JSON.stringify(data, null, 2));

        // 更新时间戳（使用当前时间，避免依赖 getFileInfo 需要 DOMParser）
        const now = Date.now();
        const timestamps = (await chrome.storage.local.get([STORAGE_KEYS.SYNC_LAST_TIMESTAMP]))[STORAGE_KEYS.SYNC_LAST_TIMESTAMP] || {};
        timestamps.favorites = now;
        timestamps.bookmarks = now;
        timestamps.sync = now;
        await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_LAST_TIMESTAMP]: timestamps });

        console.log('[AndyTAB Background] 同步上传成功');
    } catch (error) {
        console.error('[AndyTAB Background] 同步上传失败：', error);
    } finally {
        syncInProgress = false;
    }
}

// 带防抖的上传（1.5秒防抖）
function uploadSyncDataWithDebounce() {
    if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
    }
    syncDebounceTimer = setTimeout(async () => {
        await uploadSyncData();
    }, 1500);
}

// ========== 监听 chrome.storage 变化 ==========
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    const syncableKeys = [
        STORAGE_KEYS.SHORTCUTS,
        STORAGE_KEYS.SETTINGS,
        STORAGE_KEYS.SEARCH_ENGINES,
        STORAGE_KEYS.TODOS,
        STORAGE_KEYS.NOTES
    ];

    const hasSyncableChange = Object.keys(changes).some(key =>
        syncableKeys.includes(key) && key !== STORAGE_KEYS.SYNC_LAST_TIMESTAMP
    );

    if (hasSyncableChange && !syncInProgress) {
        uploadSyncDataWithDebounce();
    }
});

// ========== 监听书签变化 ==========
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

// ========== 监听来自 storage.js 的同步状态通知 ==========
// 下载/恢复数据时，storage.js 会发送 syncStart/syncEnd 消息
// 防止写入本地存储时触发误上传
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'syncStart') {
        syncRefCount++;
        syncInProgress = true;
        // 清除待执行的防抖上传
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
    }
});
