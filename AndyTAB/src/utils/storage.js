import WebDAVClient from './webdav.js';
import { convertShortcutsToFavoritesTxt, convertBookmarksToHtml } from './syncUtils.js';

export const STORAGE_KEYS = {
    SETTINGS: 'andy_tab_settings',
    SHORTCUTS: 'andy_tab_shortcuts',
    WEBDAV_CONFIG: 'andy_tab_webdav_config',
    SEARCH_ENGINES: 'andy_tab_search_engines',
    OFFLINE_CACHE: 'andy_tab_offline_cache',
    TODOS: 'andy_tab_todos',
    WIDGETS: 'andy_tab_widgets',
    SYNC_LAST_TIMESTAMP: 'andy_tab_sync_lasttimestamp'
};

class StorageManager {
    constructor() {
        this.webdavClient = null;
        this.offlineCache = new Map();
    }

    async init() {

        this._notifyBackground('syncStart');

        try {

            await Promise.all([
                this.loadOfflineCache(),
                this.initStorageData()
            ]);
        } finally {
            this._notifyBackground('syncEnd');
        }

        await this.initWebDAVClient();
    }

    async _initStorageItem(key, defaultValueCheck, filename) {
        try {
            const data = await this.getData(key);
            if (defaultValueCheck(data)) {
                const defaultData = await this.readOptionsFile(filename);
                if (defaultData) {
                    await this.saveData(key, defaultData);
                }
            }
        } catch (error) {

        }
    }

    async initStorageData() {
        try {

            await Promise.all([
                this._initStorageItem(
                    STORAGE_KEYS.SHORTCUTS,
                    (data) => !data || (Array.isArray(data) && data.length === 0),
                    'andy_tab_shortcuts.json'
                ),
                this._initStorageItem(
                    STORAGE_KEYS.SETTINGS,
                    (data) => !data || Object.keys(data).length === 0,
                    'andy_tab_settings.json'
                ),
                this._initStorageItem(
                    STORAGE_KEYS.SEARCH_ENGINES,
                    (data) => !data || Object.keys(data).length === 0,
                    'andy_tab_search_engines.json'
                )
            ]);
        } catch (error) {

        }
    }

    async readOptionsFile(filename) {
        try {

            const fileUrl = chrome.runtime.getURL(`src/options/${filename}`);

            const response = await fetch(fileUrl);

            if (!response.ok) {
                throw new Error(`Failed to fetch ${filename}: ${response.statusText}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error(`读取${filename}失败:`, error);
            return null;
        }
    }

    async initWebDAVClient() {
        try {
            const config = await this.getWebDAVConfig();
            if (config && config.url) {

                if (!config.url.startsWith('http://') && !config.url.startsWith('https://')) {
                    console.error('WebDAV URL无效：', config.url);
                    this.webdavClient = null;
                    return;
                }
                this.webdavClient = new WebDAVClient(config);
            } else {
                this.webdavClient = null;
            }
        } catch (error) {
            console.error('WebDAV客户端初始化失败：', error);
            this.webdavClient = null;
        }
    }

    async saveWebDAVConfig(config) {
        await chrome.storage.local.set({
            [STORAGE_KEYS.WEBDAV_CONFIG]: config
        });

        await this.initWebDAVClient();
    }

    async getWebDAVConfig() {
        const result = await chrome.storage.local.get([STORAGE_KEYS.WEBDAV_CONFIG]);
        return result[STORAGE_KEYS.WEBDAV_CONFIG] || null;
    }

    async testWebDAVConnection(config) {
        const client = new WebDAVClient(config);
        return await client.testConnection();
    }

    async saveData(key, data) {
        try {

            await chrome.storage.local.set({
                [key]: data
            });

            this.offlineCache.set(key, data);
            await this.saveOfflineCache();

            return { success: true };
        } catch (error) {
            console.error(`保存数据失败 (${key}):`, error);
            return { success: false, error: error.message };
        }
    }

    async getData(key, defaultValue = null) {
        try {

            const result = await chrome.storage.local.get([key]);
            let data = result[key];

            if (data === undefined) {
                data = this.offlineCache.get(key) || defaultValue;
            } else {

                this.offlineCache.set(key, data);
                await this.saveOfflineCache();
            }

            return data;
        } catch (error) {
            console.error(`获取数据失败 (${key}):`, error);

            return this.offlineCache.get(key) || defaultValue;
        }
    }

    async loadOfflineCache() {
        try {
            const result = await chrome.storage.local.get([STORAGE_KEYS.OFFLINE_CACHE]);
            const cache = result[STORAGE_KEYS.OFFLINE_CACHE] || {};

            this.offlineCache = new Map(Object.entries(cache));
        } catch (error) {
            console.error('加载离线缓存失败:', error);
            this.offlineCache = new Map();
        }
    }

    async saveOfflineCache() {
        try {

            const cacheObject = Object.fromEntries(this.offlineCache);

            await chrome.storage.local.set({
                [STORAGE_KEYS.OFFLINE_CACHE]: cacheObject
            });
        } catch (error) {
            console.error('保存离线缓存失败:', error);
        }
    }

    async _getBrowserBookmarks() {
        return new Promise((resolve) => {
            chrome.bookmarks.getTree((bookmarkTreeNodes) => {
                resolve(bookmarkTreeNodes);
            });
        });
    }

    async getAllData() {
        const data = {
            shortcuts: await this.getData(STORAGE_KEYS.SHORTCUTS, []),
            settings: await this.getData(STORAGE_KEYS.SETTINGS, {}),
            searchEngines: await this.getData(STORAGE_KEYS.SEARCH_ENGINES, {}),
            todos: await this.getData(STORAGE_KEYS.TODOS, []),
            widgets: await this.getData(STORAGE_KEYS.WIDGETS, []),
            webdavConfig: await this.getWebDAVConfig(),
            bookmarks: await this._getBrowserBookmarks()
        };

        return data;
    }

    async _bookmarkExists(parentId, title, url = null) {
        return new Promise((resolve) => {
            chrome.bookmarks.getChildren(parentId, (children) => {
                if (!children) {
                    resolve(false);
                    return;
                }

                const exists = children.some(child => {

                    if (child.title !== title) {
                        return false;
                    }

                    if (url) {
                        return child.url === url;
                    }

                    return !child.url;
                });

                resolve(exists);
            });
        });
    }

    async _mergeBookmarks(parentId, bookmarksToMerge) {
        for (const bookmark of bookmarksToMerge) {
            if (!bookmark || !bookmark.title) {
                continue;
            }

            const exists = await this._bookmarkExists(parentId, bookmark.title, bookmark.url);

            if (!exists) {

                await new Promise((resolve) => {
                    const bookmarkData = {
                        parentId: parentId,
                        title: bookmark.title
                    };

                    if (bookmark.children && bookmark.children.length > 0) {

                        chrome.bookmarks.create(bookmarkData, async (createdFolder) => {
                            if (createdFolder) {

                                await this._mergeBookmarks(createdFolder.id, bookmark.children);
                            }
                            resolve();
                        });
                    } else if (bookmark.url) {

                        bookmarkData.url = bookmark.url;
                        chrome.bookmarks.create(bookmarkData, () => {
                            resolve();
                        });
                    } else {
                        resolve();
                    }
                });
            } else if (bookmark.children && bookmark.children.length > 0) {

                await new Promise((resolve) => {
                    chrome.bookmarks.getChildren(parentId, async (children) => {
                        const existingFolder = children.find(child =>
                            child.title === bookmark.title && !child.url
                        );

                        if (existingFolder) {

                            await this._mergeBookmarks(existingFolder.id, bookmark.children);
                        }
                        resolve();
                    });
                });
            }
        }
    }

    async _restoreBrowserBookmarks(bookmarks, mode = 'merge') {
        try {

            try {
                if (bookmarks && bookmarks.length > 0 && bookmarks[0] && bookmarks[0].children) {
                    const importedRoots = bookmarks[0].children;
                    for (const importedRoot of importedRoots) {
                        if (!importedRoot) {
                            continue;
                        }

                        let targetId = null;
                        const title = (importedRoot.title || '').toLowerCase();

                        if (importedRoot.id === '1' || title.includes('书签栏') || title.includes('bookmarks bar')) {
                            targetId = '1';
                        } else if (importedRoot.id === '2' || title.includes('其他书签') || title.includes('other bookmarks')) {
                            targetId = '2';
                        } else if (importedRoot.id === '3' || title.includes('移动设备书签') || title.includes('mobile bookmarks')) {
                            targetId = '3';
                        }

                        if (targetId) {

                            if (mode === 'overwrite') {

                                await this._replaceFolderChildren(targetId, importedRoot.children || []);
                            } else {

                                if (importedRoot.children && importedRoot.children.length > 0) {
                                    await this._mergeBookmarks(targetId, importedRoot.children);
                                }
                            }
                        } else {

                            const exists = await this._bookmarkExists('0', importedRoot.title);
                            if (!exists) {

                                const createdFolderId = await new Promise((resolve) => {
                                    const bookmarkData = {
                                        parentId: '0',
                                        title: importedRoot.title
                                    };

                                    chrome.bookmarks.create(bookmarkData, (createdFolder) => {
                                        resolve(createdFolder ? createdFolder.id : null);
                                    });
                                });

                                if (createdFolderId && importedRoot.children && importedRoot.children.length > 0) {
                                    await this._mergeBookmarks(createdFolderId, importedRoot.children);
                                }
                            } else {

                                const existingFolder = await new Promise((resolve) => {
                                    chrome.bookmarks.getChildren('0', (children) => {
                                        const folder = children ? children.find(child =>
                                            child.title === importedRoot.title && !child.url
                                        ) : null;
                                        resolve(folder);
                                    });
                                });

                                if (existingFolder) {
                                    if (mode === 'overwrite') {
                                        await this._replaceFolderChildren(existingFolder.id, importedRoot.children || []);
                                    } else {
                                        if (importedRoot.children && importedRoot.children.length > 0) {
                                            await this._mergeBookmarks(existingFolder.id, importedRoot.children);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } finally {
            }
        } catch (error) {
            console.error('恢复浏览器书签失败：', error);
        }
    }

    async _replaceFolderChildren(parentId, newChildren) {

        await new Promise((resolve) => {
            chrome.bookmarks.getChildren(parentId, async (children) => {
                if (children && children.length > 0) {
                    for (const child of children) {
                        await new Promise((res) => {
                            chrome.bookmarks.removeTree(child.id, res);
                        });
                    }
                }
                resolve();
            });
        });

        for (const child of newChildren) {
            if (!child || !child.title) continue;

            const childId = await new Promise((resolve) => {
                const bookmarkData = { parentId, title: child.title };
                if (child.url) {
                    bookmarkData.url = child.url;
                }
                chrome.bookmarks.create(bookmarkData, (created) => {
                    resolve(created ? created.id : null);
                });
            });

            if (childId && child.children && child.children.length > 0) {
                await this._replaceFolderChildren(childId, child.children);
            }
        }
    }

    _notifyBackground(type) {
        try {
            chrome.runtime.sendMessage({ type });
        } catch (e) {

        }
    }

    async saveAllData(data, mode = 'merge') {
        this._notifyBackground('syncStart');
        try {
            if (data.shortcuts) {
                await this.saveData(STORAGE_KEYS.SHORTCUTS, data.shortcuts);
            }

            if (data.settings) {
                await this.saveData(STORAGE_KEYS.SETTINGS, data.settings);
            }

            if (data.searchEngines) {
                await this.saveData(STORAGE_KEYS.SEARCH_ENGINES, data.searchEngines);
            }

            if (data.todos) {
                await this.saveData(STORAGE_KEYS.TODOS, data.todos);
            }

            if (data.widgets) {
                await this._mergeWidgets(data.widgets, mode);
            }

            if (data.webdavConfig) {
                await this.saveWebDAVConfig(data.webdavConfig);
            }

            if (data.bookmarks) {

                await this._restoreBrowserBookmarks(data.bookmarks, mode);
            }
        } finally {
            this._notifyBackground('syncEnd');
        }
    }

    async _mergeWidgets(cloudWidgets, mode = 'merge') {
        try {
            if (!Array.isArray(cloudWidgets)) {
                return;
            }
            const localWidgets = await this.getData(STORAGE_KEYS.WIDGETS, []) || [];

            let finalWidgets;
            if (mode === 'overwrite') {

                finalWidgets = cloudWidgets.map(cloudWidget => {
                    const localWidget = localWidgets.find(w => w.uuid === cloudWidget.uuid);
                    if (!localWidget) {
                        return cloudWidget;
                    }

                    return { ...cloudWidget, layout: localWidget.layout || cloudWidget.layout };
                });
            } else {

                const merged = [];
                const processedLocalUuids = new Set();
                for (const cloudWidget of cloudWidgets) {
                    const localWidget = localWidgets.find(w => w.uuid === cloudWidget.uuid);
                    if (localWidget) {
                        processedLocalUuids.add(localWidget.uuid);

                        merged.push({ ...cloudWidget, layout: localWidget.layout || cloudWidget.layout });
                    } else {
                        merged.push(cloudWidget);
                    }
                }
                for (const localWidget of localWidgets) {
                    if (!processedLocalUuids.has(localWidget.uuid)) {
                        merged.push(localWidget);
                    }
                }
                finalWidgets = merged;
            }

            await this.saveData(STORAGE_KEYS.WIDGETS, finalWidgets);
        } catch (error) {
            console.error('合并小组件数据失败：', error);
        }
    }

    async _getStoragePath() {
        const config = await this.getWebDAVConfig();
        return config?.storagePath || 'AndyTab';
    }

    async _ensureStorageDirectory() {
        try {
            const storagePath = await this._getStoragePath();
            await this.webdavClient.createDirectory(storagePath);
        } catch (error) {

        }
    }

    async _getStoragePathWithEnsure() {
        if (!this.webdavClient) {
            throw new Error('WebDAV未配置');
        }
        await this._ensureStorageDirectory();
        return await this._getStoragePath();
    }

    async _backupDataToLocal(data) {
        const backupName = `bookmarks_backup_${new Date().toISOString().slice(0, 10)}_${Date.now()}.json`;
        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = backupName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return { success: true, message: '本地备份成功', backupName };
    }

    async backupData() {
        try {
            const data = await this.getAllData();

            if (this.webdavClient) {

                const storagePath = await this._getStoragePathWithEnsure();

                const timestamp = Date.now();
                const dateStr = new Date().toISOString().slice(0, 10);
                const backupName = `andy_tab_backup_${dateStr}_${timestamp}.json`;

                await this.webdavClient.putFile(`${storagePath}/${backupName}`, JSON.stringify(data, null, 2));

                return { success: true, message: '云端备份成功', backupName };
            } else {

                return await this._backupDataToLocal(data);
            }
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    async restoreDataFromLocalFile(file) {
        this._notifyBackground('syncStart');
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    await this.saveAllData(data);
                    resolve({ success: true, message: '本地备份恢复成功' });
                } catch (error) {
                    resolve({ success: false, message: error.message });
                } finally {
                    this._notifyBackground('syncEnd');
                }
            };
            reader.readAsText(file);
        });
    }

    async restoreData(backupName) {
        this._notifyBackground('syncStart');
        try {
            if (!this.webdavClient) {
                throw new Error('WebDAV未配置，无法恢复WebDAV备份');
            }

            const storagePath = await this._getStoragePath();
            const backupData = await this.webdavClient.getFile(`${storagePath}/${backupName}`);

            if (!backupData) {
                throw new Error('备份不存在');
            }

            if (backupName.endsWith('.json')) {

                return await this._restoreFromJson(backupData);
            } else if (backupName === 'bookmarks.html') {

                return await this._restoreFromBookmarksHtml(backupData);
            } else if (backupName === 'favorites.txt') {

                return await this._restoreFromFavoritesTxt(backupData);
            } else {
                throw new Error('不支持的备份文件格式');
            }
        } catch (error) {
            return { success: false, message: error.message };
        } finally {
            this._notifyBackground('syncEnd');
        }
    }

    async _restoreFromJson(jsonData) {
        try {
            const data = JSON.parse(jsonData);
            await this.saveAllData(data);
            return { success: true, message: '完整备份恢复成功' };
        } catch (error) {
            throw new Error('JSON文件解析失败：' + error.message);
        }
    }

    async _restoreFromBookmarksHtml(htmlData, mode = 'merge') {
        try {
            const bookmarkRoots = this._parseBookmarksHtml(htmlData);

            const bookmarks = [{
                children: bookmarkRoots
            }];

            await this._restoreBrowserBookmarks(bookmarks, mode);

            return { success: true, message: mode === 'overwrite' ? '书签覆盖成功' : '书签恢复成功' };
        } catch (error) {
            throw new Error('书签恢复失败：' + error.message);
        }
    }

    _parseBookmarksHtml(htmlData) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlData, 'text/html');

        const parseDl = (dlElement) => {
            const children = [];
            const dtElements = dlElement.querySelectorAll(':scope > dt');

            for (const dt of dtElements) {
                const h3 = dt.querySelector(':scope > h3');
                const a = dt.querySelector(':scope > a');
                const childDl = dt.querySelector(':scope > dl');

                if (h3) {
                    const folder = {
                        title: h3.textContent || '未命名文件夹',
                        children: childDl ? parseDl(childDl) : []
                    };

                    const addDate = h3.getAttribute('ADD_DATE');
                    if (addDate) {
                        folder.dateAdded = parseInt(addDate) * 1000;
                    }
                    const lastModified = h3.getAttribute('LAST_MODIFIED');
                    if (lastModified && parseInt(lastModified) > 0) {
                        folder.dateGroupModified = parseInt(lastModified) * 1000;
                    }
                    const personalToolbar = h3.getAttribute('PERSONAL_TOOLBAR_FOLDER');
                    if (personalToolbar === 'true') {
                        folder.id = '1';
                    }

                    children.push(folder);
                } else if (a) {
                    const bookmark = {
                        title: a.textContent || '',
                        url: a.getAttribute('href') || ''
                    };

                    const addDate = a.getAttribute('ADD_DATE');
                    if (addDate) {
                        bookmark.dateAdded = parseInt(addDate) * 1000;
                    }
                    const icon = a.getAttribute('ICON');
                    if (icon) {
                        bookmark.icon = icon;
                    }

                    children.push(bookmark);
                }
            }

            return children;
        };

        const rootDl = doc.querySelector('dl');
        if (rootDl) {
            return parseDl(rootDl);
        }

        return [];
    }

    async _restoreFromFavoritesTxt(txtData, mode = 'merge') {
        try {
            const cloudShortcuts = this._parseFavoritesTxt(txtData);
            const localShortcuts = await this.getData(STORAGE_KEYS.SHORTCUTS, []);

            let finalShortcuts;
            if (mode === 'overwrite') {

                finalShortcuts = cloudShortcuts.map(cloudShortcut => {
                    const localShortcut = localShortcuts.find(
                        local => local.url === cloudShortcut.url
                    );
                    if (!localShortcut) {
                        return cloudShortcut;
                    }

                    return {
                        ...localShortcut,
                        ...cloudShortcut,

                        iconType: cloudShortcut.iconType && cloudShortcut.iconType !== 'auto'
                            ? cloudShortcut.iconType
                            : (localShortcut.iconType || 'auto'),
                        icon: cloudShortcut.icon || localShortcut.icon || '',
                        customColor: cloudShortcut.customColor !== null && cloudShortcut.customColor !== undefined
                            ? cloudShortcut.customColor
                            : (localShortcut.customColor || null)
                    };
                });
            } else {

                const mergedShortcuts = [];
                const processedLocalUrls = new Set();

                for (const cloudShortcut of cloudShortcuts) {
                    const localIndex = localShortcuts.findIndex(
                        local => local.url === cloudShortcut.url
                    );
                    if (localIndex !== -1) {
                        mergedShortcuts.push(localShortcuts[localIndex]);
                        processedLocalUrls.add(localIndex);
                    } else {
                        mergedShortcuts.push(cloudShortcut);
                    }
                }

                for (let i = 0; i < localShortcuts.length; i++) {
                    if (!processedLocalUrls.has(i)) {
                        mergedShortcuts.push(localShortcuts[i]);
                    }
                }

                finalShortcuts = mergedShortcuts;
            }

            await this.saveData(STORAGE_KEYS.SHORTCUTS, finalShortcuts);

            return {
                success: true,
                message: mode === 'overwrite'
                    ? `快捷方式覆盖成功，共${finalShortcuts.length}个`
                    : `快捷方式合并成功，云端${cloudShortcuts.length}个，本地原有${localShortcuts.length}个，合并后${finalShortcuts.length}个`
            };
        } catch (error) {
            throw new Error('快捷方式恢复失败：' + error.message);
        }
    }

    _parseFavoritesTxt(txtData) {
        const shortcuts = [];
        const lines = txtData.split('\n');

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            try {
                const item = JSON.parse(trimmedLine);
                if (item.title && item.url) {
                    shortcuts.push({
                        id: Date.now() + Math.random().toString(36).substr(2, 9),
                        name: item.title,
                        url: item.url,
                        iconType: item.iconType || 'auto',
                        icon: item.icon || '',
                        customColor: item.customColor || null
                    });
                }
            } catch {

            }
        }

        return shortcuts;
    }

    async getBackupFiles() {
        try {
            const backups = [];

            if (this.webdavClient) {
                try {

                    const storagePath = await this._getStoragePathWithEnsure();

                    const webdavFiles = await this.webdavClient.listDirectory(storagePath);
                    for (const file of webdavFiles) {

                        if (file.isDirectory) {
                            continue;
                        }

                        backups.push({
                            name: file.name,
                            type: 'webdav',
                            size: file.size || 0,
                            modified: file.modified
                        });
                    }
                } catch (error) {
                    console.error('获取WebDAV备份列表失败：', error);
                }
            }

            return backups;
        } catch (error) {
            console.error('获取备份列表失败：', error);
            return [];
        }
    }

    async deleteBackup(backupName) {
        try {

            const storagePath = await this._getStoragePathWithEnsure();

            await this.webdavClient.deleteFile(`${storagePath}/${backupName}`);

            return { success: true, message: '备份已删除' };
        } catch (error) {
            console.error('删除备份失败：', error);
            return { success: false, message: error.message };
        }
    }

    async uploadSyncData() {
        try {
            if (!this.webdavClient) {
                return { success: false, message: 'WebDAV未配置，无法上传同步数据' };
            }

            const shortcuts = await this.getData(STORAGE_KEYS.SHORTCUTS, []);
            const bookmarks = await this._getBrowserBookmarks();
            const data = await this.getAllData();

            const storagePath = await this._getStoragePathWithEnsure();

            const favoritesContent = convertShortcutsToFavoritesTxt(shortcuts);
            await this.webdavClient.putFile(`${storagePath}/favorites.txt`, favoritesContent);

            const bookmarksHtml = convertBookmarksToHtml(bookmarks);
            await this.webdavClient.putFile(`${storagePath}/bookmarks.html`, bookmarksHtml);

            await this.webdavClient.putFile(`${storagePath}/andy_tab_sync.json`, JSON.stringify(data, null, 2));

            const [favoritesInfo, bookmarksInfo, syncInfo] = await Promise.all([
                this.webdavClient.getFileInfo(`${storagePath}/favorites.txt`),
                this.webdavClient.getFileInfo(`${storagePath}/bookmarks.html`),
                this.webdavClient.getFileInfo(`${storagePath}/andy_tab_sync.json`)
            ]);

            const timestamps = {
                favorites: favoritesInfo.modified ? new Date(favoritesInfo.modified).getTime() : Date.now(),
                bookmarks: bookmarksInfo.modified ? new Date(bookmarksInfo.modified).getTime() : Date.now(),
                sync: syncInfo.modified ? new Date(syncInfo.modified).getTime() : Date.now()
            };
            await this.saveData(STORAGE_KEYS.SYNC_LAST_TIMESTAMP, timestamps);

            return { success: true, message: '同步数据上传成功' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    async getCloudFilesInfo() {
        try {
            if (!this.webdavClient) {
                return null;
            }

            const storagePath = await this._getStoragePathWithEnsure();

            const [favoritesInfo, bookmarksInfo, syncInfo] = await Promise.all([
                this.webdavClient.getFileInfo(`${storagePath}/favorites.txt`).catch(() => null),
                this.webdavClient.getFileInfo(`${storagePath}/bookmarks.html`).catch(() => null),
                this.webdavClient.getFileInfo(`${storagePath}/andy_tab_sync.json`).catch(() => null)
            ]);

            return {
                favorites: favoritesInfo ? {
                    exists: true,
                    modified: favoritesInfo.modified ? new Date(favoritesInfo.modified).getTime() : null
                } : { exists: false, modified: null },
                bookmarks: bookmarksInfo ? {
                    exists: true,
                    modified: bookmarksInfo.modified ? new Date(bookmarksInfo.modified).getTime() : null
                } : { exists: false, modified: null },
                sync: syncInfo ? {
                    exists: true,
                    modified: syncInfo.modified ? new Date(syncInfo.modified).getTime() : null
                } : { exists: false, modified: null }
            };
        } catch (error) {
            console.error('获取云端文件信息失败：', error);
            return null;
        }
    }

    async downloadFavorites(mode = 'merge') {
        this._notifyBackground('syncStart');
        try {
            if (!this.webdavClient) {
                return { success: false, message: 'WebDAV未配置' };
            }

            const storagePath = await this._getStoragePath();
            const favoritesData = await this.webdavClient.getFile(`${storagePath}/favorites.txt`);

            const result = await this._restoreFromFavoritesTxt(favoritesData, mode);

            await this.updateSyncTimestamp('favorites');

            return { success: true, message: result.message };
        } catch (error) {
            return { success: false, message: error.message };
        } finally {
            this._notifyBackground('syncEnd');
        }
    }

    async downloadBookmarks(mode = 'merge') {
        this._notifyBackground('syncStart');
        try {
            if (!this.webdavClient) {
                return { success: false, message: 'WebDAV未配置' };
            }

            const storagePath = await this._getStoragePath();
            const bookmarksData = await this.webdavClient.getFile(`${storagePath}/bookmarks.html`);

            const result = await this._restoreFromBookmarksHtml(bookmarksData, mode);

            await this.updateSyncTimestamp('bookmarks');

            return { success: true, message: result.message };
        } catch (error) {
            return { success: false, message: error.message };
        } finally {
            this._notifyBackground('syncEnd');
        }
    }

    async downloadSyncData(mode = 'merge') {
        this._notifyBackground('syncStart');
        try {
            if (!this.webdavClient) {
                return { success: false, message: 'WebDAV未配置' };
            }

            const storagePath = await this._getStoragePath();
            const syncDataStr = await this.webdavClient.getFile(`${storagePath}/andy_tab_sync.json`);
            const syncData = JSON.parse(syncDataStr);

            await this.saveAllData(syncData, mode);

            await this.updateSyncTimestamp('sync');
            await this.updateSyncTimestamp('favorites');
            await this.updateSyncTimestamp('bookmarks');

            return { success: true, message: '完整数据同步成功' };
        } catch (error) {
            return { success: false, message: error.message };
        } finally {
            this._notifyBackground('syncEnd');
        }
    }

    async updateSyncTimestamp(fileType) {
        const fileNames = {
            favorites: 'favorites.txt',
            bookmarks: 'bookmarks.html',
            sync: 'andy_tab_sync.json'
        };
        const storagePath = await this._getStoragePath();
        const fileInfo = await this.webdavClient.getFileInfo(`${storagePath}/${fileNames[fileType]}`);
        const timestamps = await this.getData(STORAGE_KEYS.SYNC_LAST_TIMESTAMP, {});
        timestamps[fileType] = fileInfo.modified ? new Date(fileInfo.modified).getTime() : Date.now();
        await this.saveData(STORAGE_KEYS.SYNC_LAST_TIMESTAMP, timestamps);
    }
}

const storageManager = new StorageManager();

export default storageManager;
