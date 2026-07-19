// 存储管理模块 - 处理本地存储和WebDAV同步

import WebDAVClient from './webdav.js';
import { convertShortcutsToFavoritesTxt, convertBookmarksToHtml } from './syncUtils.js';

// 存储键名常量
export const STORAGE_KEYS = {
    SETTINGS: 'andy_tab_settings',
    SHORTCUTS: 'andy_tab_shortcuts',
    WEBDAV_CONFIG: 'andy_tab_webdav_config',
    SEARCH_ENGINES: 'andy_tab_search_engines',
    OFFLINE_CACHE: 'andy_tab_offline_cache',
    TODOS: 'andy_tab_todos',
    NOTES: 'andy_tab_notes',
    SYNC_LAST_TIMESTAMP: 'andy_tab_sync_lasttimestamp'
};

class StorageManager {
    constructor() {
        this.webdavClient = null;
        this.offlineCache = new Map();
    }
    
    // 初始化
    async init() {
        // 通知 background 暂停自动上传，防止初始化写入触发误上传
        this._notifyBackground('syncStart');
        
        try {
            // 并行执行离线缓存加载和存储数据初始化，提高速度
            await Promise.all([
                this.loadOfflineCache(),
                this.initStorageData()
            ]);
        } finally {
            this._notifyBackground('syncEnd');
        }
        
        // 初始化WebDAV客户端（如果配置存在）
        await this.initWebDAVClient();
    }
    
    // 检查并初始化单个存储项
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
            // console.error(`初始化${key}失败:`, error);
        }
    }

    // 检查并初始化存储数据
    async initStorageData() {
        try {
            // 并行执行三个初始化操作，提高速度
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
            // console.error('初始化存储数据失败:', error);
        }
    }
    
    // 从options目录读取JSON文件
    async readOptionsFile(filename) {
        try {
            // 获取文件的URL
            const fileUrl = chrome.runtime.getURL(`src/options/${filename}`);
            
            // 使用fetch读取文件内容
            const response = await fetch(fileUrl);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch ${filename}: ${response.statusText}`);
            }
            
            // 解析JSON
            const data = await response.json();
            return data;
        } catch (error) {
            console.error(`读取${filename}失败:`, error);
            return null;
        }
    }
    
    // 初始化WebDAV客户端
    async initWebDAVClient() {
        try {
            const config = await this.getWebDAVConfig();
            if (config && config.url) {
                // 验证配置的有效性
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
    
    // 保存WebDAV配置
    async saveWebDAVConfig(config) {
        await chrome.storage.local.set({
            [STORAGE_KEYS.WEBDAV_CONFIG]: config
        });
        
        // 重新初始化WebDAV客户端
        await this.initWebDAVClient();
    }
    
    // 获取WebDAV配置
    async getWebDAVConfig() {
        const result = await chrome.storage.local.get([STORAGE_KEYS.WEBDAV_CONFIG]);
        return result[STORAGE_KEYS.WEBDAV_CONFIG] || null;
    }
    
    // 测试WebDAV连接
    async testWebDAVConnection(config) {
        const client = new WebDAVClient(config);
        return await client.testConnection();
    }
    
    // 保存数据到本地存储
    async saveData(key, data) {
        try {
            // 保存到Chrome本地存储（替换sync存储以避免大小限制）
            await chrome.storage.local.set({
                [key]: data
            });
            
            // 更新离线缓存
            this.offlineCache.set(key, data);
            await this.saveOfflineCache();            
            
            return { success: true };
        } catch (error) {
            console.error(`保存数据失败 (${key}):`, error);
            return { success: false, error: error.message };
        }
    }
    
    // 从本地存储获取数据
    async getData(key, defaultValue = null) {
        try {
            // 尝试从Chrome本地存储获取
            const result = await chrome.storage.local.get([key]);
            let data = result[key];
            
            // 如果Chrome存储中没有数据，尝试从离线缓存获取
            if (data === undefined) {
                data = this.offlineCache.get(key) || defaultValue;
            } else {
                // 更新离线缓存
                this.offlineCache.set(key, data);
                await this.saveOfflineCache();
            }
            
            return data;
        } catch (error) {
            console.error(`获取数据失败 (${key}):`, error);
            // 从离线缓存获取
            return this.offlineCache.get(key) || defaultValue;
        }
    }
    
    // 加载离线缓存
    async loadOfflineCache() {
        try {
            const result = await chrome.storage.local.get([STORAGE_KEYS.OFFLINE_CACHE]);
            const cache = result[STORAGE_KEYS.OFFLINE_CACHE] || {};
            
            // 将缓存转换为Map
            this.offlineCache = new Map(Object.entries(cache));
        } catch (error) {
            console.error('加载离线缓存失败:', error);
            this.offlineCache = new Map();
        }
    }
    
    // 保存离线缓存
    async saveOfflineCache() {
        try {
            // 将Map转换为对象
            const cacheObject = Object.fromEntries(this.offlineCache);
            
            await chrome.storage.local.set({
                [STORAGE_KEYS.OFFLINE_CACHE]: cacheObject
            });
        } catch (error) {
            console.error('保存离线缓存失败:', error);
        }
    }
    
    // 获取浏览器书签（保留顺序和文件夹结构）
    async _getBrowserBookmarks() {
        return new Promise((resolve) => {
            chrome.bookmarks.getTree((bookmarkTreeNodes) => {
                resolve(bookmarkTreeNodes);
            });
        });
    }
    
    // 获取所有数据（用于备份）
    async getAllData() {
        const data = {
            shortcuts: await this.getData(STORAGE_KEYS.SHORTCUTS, []),
            settings: await this.getData(STORAGE_KEYS.SETTINGS, {}),
            searchEngines: await this.getData(STORAGE_KEYS.SEARCH_ENGINES, {}),
            todos: await this.getData(STORAGE_KEYS.TODOS, []),
            notes: await this.getData(STORAGE_KEYS.NOTES, ''),
            webdavConfig: await this.getWebDAVConfig(),
            bookmarks: await this._getBrowserBookmarks()
        };
        
        return data;
    }
    
    // 检查书签是否已存在
    async _bookmarkExists(parentId, title, url = null) {
        return new Promise((resolve) => {
            chrome.bookmarks.getChildren(parentId, (children) => {
                if (!children) {
                    resolve(false);
                    return;
                }
                
                // 检查是否存在同名同类型的书签
                const exists = children.some(child => {
                    // 检查标题是否相同
                    if (child.title !== title) {
                        return false;
                    }
                    
                    // 如果是书签项，检查URL是否相同
                    if (url) {
                        return child.url === url;
                    }
                    
                    // 如果是文件夹，检查是否都是文件夹
                    return !child.url;
                });
                
                resolve(exists);
            });
        });
    }
    
    // 递归合并书签
    async _mergeBookmarks(parentId, bookmarksToMerge) {
        for (const bookmark of bookmarksToMerge) {
            if (!bookmark || !bookmark.title) {
                continue;
            }
            
            // 检查书签是否已存在
            const exists = await this._bookmarkExists(parentId, bookmark.title, bookmark.url);
            
            if (!exists) {
                // 书签不存在，创建新书签
                await new Promise((resolve) => {
                    const bookmarkData = {
                        parentId: parentId,
                        title: bookmark.title
                    };
                    
                    if (bookmark.children && bookmark.children.length > 0) {
                        // 创建文件夹
                        chrome.bookmarks.create(bookmarkData, async (createdFolder) => {
                            if (createdFolder) {
                                // 递归合并子书签
                                await this._mergeBookmarks(createdFolder.id, bookmark.children);
                            }
                            resolve();
                        });
                    } else if (bookmark.url) {
                        // 创建书签项
                        bookmarkData.url = bookmark.url;
                        chrome.bookmarks.create(bookmarkData, () => {
                            resolve();
                        });
                    } else {
                        resolve();
                    }
                });
            } else if (bookmark.children && bookmark.children.length > 0) {
                // 文件夹已存在，查找其ID并合并子书签
                await new Promise((resolve) => {
                    chrome.bookmarks.getChildren(parentId, async (children) => {
                        const existingFolder = children.find(child => 
                            child.title === bookmark.title && !child.url
                        );
                        
                        if (existingFolder) {
                            // 递归合并子书签
                            await this._mergeBookmarks(existingFolder.id, bookmark.children);
                        }
                        resolve();
                    });
                });
            }
        }
    }
    
    // 恢复浏览器书签
    // mode: 'merge' (合并模式，保留本地数据) | 'overwrite' (覆盖模式，删除本地独有数据)
    async _restoreBrowserBookmarks(bookmarks, mode = 'merge') {
        try {
            // 书签变化监听由 background.js 的 _notifyBackground('syncStart/End') 控制
            // 调用 _restoreBrowserBookmarks 的方法（saveAllData 等）已包裹通知
            try {
                if (bookmarks && bookmarks.length > 0 && bookmarks[0] && bookmarks[0].children) {
                    const importedRoots = bookmarks[0].children;
                    for (const importedRoot of importedRoots) {
                        if (!importedRoot) {
                            continue;
                        }
                        
                        // 根据title判断应该合并到哪个根文件夹
                        // Chrome默认根文件夹：书签栏(id=1)、其他书签(id=2)、移动设备书签(id=3)
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
                            // 默认根文件夹
                            if (mode === 'overwrite') {
                                // 覆盖模式：清空本地子项后重新创建
                                await this._replaceFolderChildren(targetId, importedRoot.children || []);
                            } else {
                                // 合并模式
                                if (importedRoot.children && importedRoot.children.length > 0) {
                                    await this._mergeBookmarks(targetId, importedRoot.children);
                                }
                            }
                        } else {
                            // 自定义根文件夹
                            const exists = await this._bookmarkExists('0', importedRoot.title);
                            if (!exists) {
                                // 自定义根文件夹不存在，创建文件夹及其子项
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
                                // 自定义根文件夹已存在
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
    
    // 覆盖文件夹子项：先删除本地子项，再添加云端子项
    async _replaceFolderChildren(parentId, newChildren) {
        // 1. 删除当前所有子项
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
        
        // 2. 递归创建新的子项
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
    
    // 通知 background service worker 同步操作开始/结束
    // 防止下载/恢复数据写入本地存储时触发 background 的自动上传
    _notifyBackground(type) {
        try {
            chrome.runtime.sendMessage({ type });
        } catch (e) {
            // background 未运行时可能报错，忽略
        }
    }

    // 保存所有数据（用于备份）
    // 保存所有数据（用于备份/恢复）
    // mode: 'merge' (合并模式，保留本地数据) | 'overwrite' (覆盖模式，删除本地独有数据)
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
            
            if (data.notes) {
                await this.saveData(STORAGE_KEYS.NOTES, data.notes);
            }
            
            if (data.webdavConfig) {
                await this.saveWebDAVConfig(data.webdavConfig);
            }
            
            if (data.bookmarks) {
                // 直接恢复到浏览器（根据 mode 决定是合并还是覆盖）
                // 不再写入 USER_BOOKMARKS 缓存
                await this._restoreBrowserBookmarks(data.bookmarks, mode);
            }
        } finally {
            this._notifyBackground('syncEnd');
        }
    }

    // 获取WebDAV存储路径
    async _getStoragePath() {
        const config = await this.getWebDAVConfig();
        return config?.storagePath || 'AndyTab';
    }

    // 确保存储目录存在
    async _ensureStorageDirectory() {
        try {
            const storagePath = await this._getStoragePath();
            await this.webdavClient.createDirectory(storagePath);
        } catch (error) {
            // 如果文件夹已存在，createDirectory会报错，这是正常的
        }
    }

    // 获取存储路径并确保目录存在（统一方法，减少重复代码）
    async _getStoragePathWithEnsure() {
        if (!this.webdavClient) {
            throw new Error('WebDAV未配置');
        }
        await this._ensureStorageDirectory();
        return await this._getStoragePath();
    }
    
    // 备份数据到本地文件
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
    
    // 备份数据
    async backupData() {
        try {
            const data = await this.getAllData();
            
            if (this.webdavClient) {
                // 云端备份 - 只上传andy_tab_sync.json（与自动同步的完整备份相同）
                // 获取存储路径并确保目录存在
                const storagePath = await this._getStoragePathWithEnsure();
                
                // 生成带时间戳的备份文件名
                const timestamp = Date.now();
                const dateStr = new Date().toISOString().slice(0, 10);
                const backupName = `andy_tab_backup_${dateStr}_${timestamp}.json`;
                
                // 备份到WebDAV的存储文件夹
                await this.webdavClient.putFile(`${storagePath}/${backupName}`, JSON.stringify(data, null, 2));
                
                return { success: true, message: '云端备份成功', backupName };
            } else {
                // WebDAV未配置，执行本地备份（保持原有逻辑不变）
                return await this._backupDataToLocal(data);
            }
        } catch (error) {
            return { success: false, message: error.message };
        }
    }
    
    // 从本地文件恢复数据
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
    
    // 恢复数据
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

            // 根据文件后缀名使用不同的恢复逻辑
            if (backupName.endsWith('.json')) {
                // 1. .json文件 - 完整备份，使用原有逻辑
                return await this._restoreFromJson(backupData);
            } else if (backupName === 'bookmarks.html') {
                // 2. bookmarks.html - 书签文件
                return await this._restoreFromBookmarksHtml(backupData);
            } else if (backupName === 'favorites.txt') {
                // 3. favorites.txt - 快捷方式文件
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

    // 从JSON文件恢复（完整备份）
    async _restoreFromJson(jsonData) {
        try {
            const data = JSON.parse(jsonData);
            await this.saveAllData(data);
            return { success: true, message: '完整备份恢复成功' };
        } catch (error) {
            throw new Error('JSON文件解析失败：' + error.message);
        }
    }

    // 从bookmarks.html恢复书签
    // mode: 'merge' (合并模式，保留本地数据) | 'overwrite' (覆盖模式，删除本地独有数据)
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

    // 解析bookmarks.html格式的书签（返回roots下的子元素数组）
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

    // 从favorites.txt恢复快捷方式
    // mode: 'merge' (合并模式，保留本地数据) | 'overwrite' (覆盖模式，删除本地独有数据)
    // overwrite 模式下，相同 URL 的项会用云端数据为基础，并把旧本地数据的额外字段（如颜色、图标）合并进去
    async _restoreFromFavoritesTxt(txtData, mode = 'merge') {
        try {
            const cloudShortcuts = this._parseFavoritesTxt(txtData);
            const localShortcuts = await this.getData(STORAGE_KEYS.SHORTCUTS, []);
            
            let finalShortcuts;
            if (mode === 'overwrite') {
                // 覆盖模式：以云端数据为基础，相同 URL 的项把旧本地数据的额外字段合并进去
                finalShortcuts = cloudShortcuts.map(cloudShortcut => {
                    const localShortcut = localShortcuts.find(
                        local => local.url === cloudShortcut.url
                    );
                    if (!localShortcut) {
                        return cloudShortcut;
                    }
                    // 合并：云端字段优先，本地独有的字段（云端缺失或为默认值时）从旧本地数据补回
                    return {
                        ...localShortcut,  // 先以本地为基础
                        ...cloudShortcut,  // 再用云端覆盖（云端是权威）
                        // 旧本地数据中"非默认"的字段作为补充
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
                // 合并模式：保留本地独有数据，添加云端数据
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

    // 解析favorites.txt格式的快捷方式
    // 解析所有字段（title/url/order/iconType/icon/customColor）以便完整恢复
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
                // 解析失败，忽略该行
            }
        }
        
        return shortcuts;
    }
    
    // 获取备份列表（列出所有文件，排除目录）
    async getBackupFiles() {
        try {
            const backups = [];
            
            // 只获取WebDAV备份
            if (this.webdavClient) {
                try {
                    // 获取存储路径并确保目录存在
                    const storagePath = await this._getStoragePathWithEnsure();
                    
                    // 列出存储文件夹中的文件
                    const webdavFiles = await this.webdavClient.listDirectory(storagePath);
                    for (const file of webdavFiles) {
                        // 跳过目录，只列出文件
                        if (file.isDirectory) {
                            continue;
                        }
                        // 列出所有文件，不过滤
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
    
    // 删除备份
    async deleteBackup(backupName) {
        try {
            // 获取存储路径并确保目录存在
            const storagePath = await this._getStoragePathWithEnsure();
            
            // 从存储文件夹删除备份文件
            await this.webdavClient.deleteFile(`${storagePath}/${backupName}`);
            
            return { success: true, message: '备份已删除' };
        } catch (error) {
            console.error('删除备份失败：', error);
            return { success: false, message: error.message };
        }
    }

    // 上传同步数据到云端
    async uploadSyncData() {
        try {
            if (!this.webdavClient) {
                return { success: false, message: 'WebDAV未配置，无法上传同步数据' };
            }

            const shortcuts = await this.getData(STORAGE_KEYS.SHORTCUTS, []);
            const bookmarks = await this._getBrowserBookmarks();
            const data = await this.getAllData();
            
            // 获取存储路径并确保目录存在
            const storagePath = await this._getStoragePathWithEnsure();
            
            // 1. 上传favorites.txt（快捷方式）
            const favoritesContent = convertShortcutsToFavoritesTxt(shortcuts);
            await this.webdavClient.putFile(`${storagePath}/favorites.txt`, favoritesContent);
            
            // 2. 上传bookmarks.html（书签）
            const bookmarksHtml = convertBookmarksToHtml(bookmarks);
            await this.webdavClient.putFile(`${storagePath}/bookmarks.html`, bookmarksHtml);
            
            // 3. 上传andy_tab_sync.json（完整数据备份）
            await this.webdavClient.putFile(`${storagePath}/andy_tab_sync.json`, JSON.stringify(data, null, 2));
            
            // 获取3个文件的实际修改时间
            const [favoritesInfo, bookmarksInfo, syncInfo] = await Promise.all([
                this.webdavClient.getFileInfo(`${storagePath}/favorites.txt`),
                this.webdavClient.getFileInfo(`${storagePath}/bookmarks.html`),
                this.webdavClient.getFileInfo(`${storagePath}/andy_tab_sync.json`)
            ]);
            
            // 更新最后同步时间戳（JSON格式，分别记录3个文件）
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

    // 获取云端文件信息（favorites.txt, bookmarks.html, andy_tab_sync.json）
    async getCloudFilesInfo() {
        try {
            if (!this.webdavClient) {
                return null;
            }

            const storagePath = await this._getStoragePathWithEnsure();
            
            // 并行获取3个文件的信息
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

    // 下载并应用快捷方式（favorites.txt）
    // mode: 'merge' (合并模式) | 'overwrite' (覆盖模式)
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

    // 下载并应用书签（bookmarks.html）
    // mode: 'merge' (合并模式) | 'overwrite' (覆盖模式)
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

    // 下载并应用完整同步数据（andy_tab_sync.json）
    // mode: 'merge' (合并模式) | 'overwrite' (覆盖模式)
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
            
            // andy_tab_sync.json 是超级集，包含 favorites.txt 和 bookmarks.html 的所有内容
            // 下载 sync.json 后，本地数据已经与云端一致，需要同时更新 3 个文件的时间戳
            // 避免下次启动时误判 favorites/bookmarks 也需要同步
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

// 创建单例实例
const storageManager = new StorageManager();

export default storageManager;