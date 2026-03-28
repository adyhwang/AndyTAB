// 存储管理模块 - 处理本地存储和WebDAV同步

import WebDAVClient from './webdav.js';

// 存储键名常量
export const STORAGE_KEYS = {
    SETTINGS: 'andy_tab_settings',
    SHORTCUTS: 'andy_tab_shortcuts',
    WEBDAV_CONFIG: 'andy_tab_webdav_config',
    SEARCH_ENGINES: 'andy_tab_search_engines',
    OFFLINE_CACHE: 'andy_tab_offline_cache',
    TODOS: 'andy_tab_todos',
    NOTES: 'andy_tab_notes',
    SYNC_LAST_TIMESTAMP: 'andy_tab_sync_lasttimestamp',
    USER_BOOKMARKS: 'user_bookmarks'
};

class StorageManager {
    constructor() {
        this.webdavClient = null;
        this.offlineCache = new Map();
        this.syncDebounceTimer = null;
    }
    
    // 初始化用户书签
    async _initUserBookmarks() {
        try {
            // 获取浏览器书签
            const bookmarks = await this._getBrowserBookmarks();
            // 保存到本地存储
            await chrome.storage.local.set({
                [STORAGE_KEYS.USER_BOOKMARKS]: bookmarks
            });
        } catch (error) {
            console.error('初始化用户书签失败：', error);
        }
    }
    
    // 监听用户书签变化
    _listenBookmarkChanges() {
        // 防抖定时器，避免频繁触发
        let bookmarkChangeTimer = null;
        
        const handleBookmarkChange = async () => {
            // 清除之前的定时器
            if (bookmarkChangeTimer) {
                clearTimeout(bookmarkChangeTimer);
            }
            
            // 设置新的定时器，延迟500ms执行
            bookmarkChangeTimer = setTimeout(async () => {
                try {
                    await this._initUserBookmarks();
                    // 触发同步
                    await this.uploadSyncDataWithDebounce();
                } catch (error) {
                    console.error('处理书签变化失败：', error);
                }
            }, 500);
        };
        
        // 监听书签创建
        chrome.bookmarks.onCreated.addListener(handleBookmarkChange);
        
        // 监听书签删除
        chrome.bookmarks.onRemoved.addListener(handleBookmarkChange);
        
        // 监听书签更改
        chrome.bookmarks.onChanged.addListener(handleBookmarkChange);
        
        // 监听书签移动
        chrome.bookmarks.onMoved.addListener(handleBookmarkChange);
        
        // 监听书签重命名
        chrome.bookmarks.onChanged.addListener(handleBookmarkChange);
    }
    
    // 监听存储变化
    _listenStorageChanges() {
        chrome.storage.onChanged.addListener(async (changes, areaName) => {
            // 监听 user_bookmarks 变化
            if (areaName === 'local' && changes[STORAGE_KEYS.USER_BOOKMARKS]) {
                // 触发同步
                await this.uploadSyncDataWithDebounce();
            }
        });
    }
    
    // 初始化
    async init() {
        // 并行执行离线缓存加载和存储数据初始化，提高速度
        await Promise.all([
            this.loadOfflineCache(),
            this.initStorageData(),
            this._initUserBookmarks()
        ]);
        
        // 初始化WebDAV客户端（如果配置存在）
        await this.initWebDAVClient();
        
        // 监听书签变化
        this._listenBookmarkChanges();
        
        // 监听存储变化
        this._listenStorageChanges();
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
    
    // 从本地存储获取用户书签
    async _getUserBookmarksFromStorage() {
        try {
            const result = await chrome.storage.local.get([STORAGE_KEYS.USER_BOOKMARKS]);
            return result[STORAGE_KEYS.USER_BOOKMARKS] || await this._getBrowserBookmarks();
        } catch (error) {
            console.error('从本地存储获取用户书签失败：', error);
            return await this._getBrowserBookmarks();
        }
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
            bookmarks: await this._getUserBookmarksFromStorage()
        };
        
        return data;
    }
    
    // 递归创建书签
    async _createBookmark(parentId, bookmark) {
        return new Promise((resolve) => {
            // 检查书签对象是否有效
            if (!bookmark || !bookmark.title) {
                resolve();
                return;
            }
            
            const bookmarkData = {
                parentId: parentId,
                title: bookmark.title
            };
            
            // 如果是文件夹
            if (bookmark.children && bookmark.children.length > 0) {
                chrome.bookmarks.create(bookmarkData, async (createdFolder) => {
                    // 检查创建的文件夹是否有效
                    if (!createdFolder) {
                        resolve();
                        return;
                    }
                    
                    // 递归创建子书签
                    for (const child of bookmark.children) {
                        await this._createBookmark(createdFolder.id, child);
                    }
                    resolve();
                });
            } else if (bookmark.url) {
                // 如果是书签项且有URL
                bookmarkData.url = bookmark.url;
                chrome.bookmarks.create(bookmarkData, () => {
                    resolve();
                });
            } else {
                // 无效的书签项，直接返回
                resolve();
            }
        });
    }
    
    // 清空文件夹中的所有内容
    async _clearFolderContents(folderId) {
        return new Promise((resolve) => {
            chrome.bookmarks.getChildren(folderId, async (children) => {
                for (const child of children) {
                    if (child.children && child.children.length > 0) {
                        // 如果是文件夹，递归清空
                        await this._clearFolderContents(child.id);
                    }
                    // 删除书签或文件夹
                    await new Promise((resolveDelete) => {
                        chrome.bookmarks.remove(child.id, resolveDelete);
                    });
                }
                resolve();
            });
        });
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
    
    // 恢复浏览器书签（合并收藏夹）
    async _restoreBrowserBookmarks(bookmarks) {
        try {
            // 如果提供的书签数据包含默认根文件夹，则使用它们
            if (bookmarks && bookmarks.length > 0 && bookmarks[0] && bookmarks[0].children) {
                const importedRoots = bookmarks[0].children;
                for (const importedRoot of importedRoots) {
                    // 检查导入的根是否有效
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
                        // 合并到默认根文件夹
                        if (importedRoot.children && importedRoot.children.length > 0) {
                            await this._mergeBookmarks(targetId, importedRoot.children);
                        }
                    } else {
                        // 自定义根文件夹，检查是否已存在
                        const exists = await this._bookmarkExists('0', importedRoot.title);
                        if (!exists) {
                            // 自定义根文件夹不存在，创建文件夹及其子项
                            await new Promise((resolve) => {
                                const bookmarkData = {
                                    parentId: '0',
                                    title: importedRoot.title
                                };
                                
                                chrome.bookmarks.create(bookmarkData, async (createdFolder) => {
                                    if (createdFolder && importedRoot.children && importedRoot.children.length > 0) {
                                        // 递归合并子书签
                                        await this._mergeBookmarks(createdFolder.id, importedRoot.children);
                                    }
                                    resolve();
                                });
                            });
                        } else {
                            // 自定义根文件夹已存在，合并其子项
                            await new Promise((resolve) => {
                                chrome.bookmarks.getChildren('0', async (children) => {
                                    const existingFolder = children.find(child => 
                                        child.title === importedRoot.title && !child.url
                                    );
                                    
                                    if (existingFolder && importedRoot.children && importedRoot.children.length > 0) {
                                        // 递归合并子书签
                                        await this._mergeBookmarks(existingFolder.id, importedRoot.children);
                                    }
                                    resolve();
                                });
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error('恢复浏览器书签失败：', error);
        }
    }
    
    // 保存所有数据（用于备份）
    async saveAllData(data) {
        
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
                // 保存到本地存储
                await chrome.storage.local.set({
                    [STORAGE_KEYS.USER_BOOKMARKS]: data.bookmarks
                });
                // 恢复到浏览器
                await this._restoreBrowserBookmarks(data.bookmarks);
            }
        } finally {
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
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    await this.saveAllData(data);
                    resolve({ success: true, message: '本地备份恢复成功' });
                } catch (error) {
                    resolve({ success: false, message: error.message });
                }
            };
            reader.readAsText(file);
        });
    }
    
    // 恢复数据
    async restoreData(backupName) {
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

    // 从bookmarks.html恢复书签（使用合并逻辑，保持原有路径位置）
    async _restoreFromBookmarksHtml(htmlData) {
        try {
            // 解析HTML书签文件（获取roots下的子元素）
            const bookmarkRoots = this._parseBookmarksHtml(htmlData);
            
            // 将解析的数据包装成Chrome书签树格式（添加roots层级）
            const bookmarks = [{
                children: bookmarkRoots
            }];
            
            // 使用合并逻辑恢复书签（参考_saveAllData中的实现）
            await this._restoreBrowserBookmarks(bookmarks);
            
            return { success: true, message: '书签恢复成功' };
        } catch (error) {
            throw new Error('书签恢复失败：' + error.message);
        }
    }

    // 解析bookmarks.html格式的书签（返回roots下的子元素数组）
    _parseBookmarksHtml(htmlData) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlData, 'text/html');
        
        // 递归解析书签结构
        const parseDl = (dlElement) => {
            const children = [];
            const dtElements = dlElement.querySelectorAll(':scope > dt');
            
            for (const dt of dtElements) {
                const h3 = dt.querySelector(':scope > h3');
                const a = dt.querySelector(':scope > a');
                const childDl = dt.querySelector(':scope > dl');
                
                if (h3 && childDl) {
                    // 文件夹
                    const folder = {
                        title: h3.textContent || 'NoNamefolder',
                        children: parseDl(childDl)
                    };
                    children.push(folder);
                } else if (a) {
                    // 书签链接
                    const bookmark = {
                        title: a.textContent || '',
                        url: a.getAttribute('href') || ''
                    };
                    children.push(bookmark);
                }
            }
            
            return children;
        };
        
        // 从根DL开始解析，直接返回子元素数组
        const rootDl = doc.querySelector('dl');
        if (rootDl) {
            return parseDl(rootDl);
        }
        
        return [];
    }

    // 从favorites.txt恢复快捷方式（合并模式）
    async _restoreFromFavoritesTxt(txtData) {
        try {
            // 解析favorites.txt文件（云端数据）
            const cloudShortcuts = this._parseFavoritesTxt(txtData);
            
            // 获取本地现有快捷方式
            const localShortcuts = await this.getData(STORAGE_KEYS.SHORTCUTS, []);
            
            // 创建新的合并表
            const mergedShortcuts = [];
            const processedLocalUrls = new Set();
            
            // 遍历云端数据
            for (const cloudShortcut of cloudShortcuts) {
                // 在本地查找相同URL的快捷方式
                const localIndex = localShortcuts.findIndex(
                    local => local.url === cloudShortcut.url
                );
                
                if (localIndex !== -1) {
                    // 1. 本地存在相同URL的快捷方式，使用本地数据（保留原有图标、颜色等设置）
                    mergedShortcuts.push(localShortcuts[localIndex]);
                    processedLocalUrls.add(localIndex);
                } else {
                    // 2. 本地不存在相同URL的快捷方式，使用云端数据
                    mergedShortcuts.push(cloudShortcut);
                }
            }
            
            // 3. 将剩余的本地数据（本地有但云端没有的）插入到新表的最后
            for (let i = 0; i < localShortcuts.length; i++) {
                if (!processedLocalUrls.has(i)) {
                    mergedShortcuts.push(localShortcuts[i]);
                }
            }
            
            // 保存合并后的数据到本地存储
            await this.saveData(STORAGE_KEYS.SHORTCUTS, mergedShortcuts);
            
            return { 
                success: true, 
                message: `快捷方式合并成功，云端${cloudShortcuts.length}个，本地原有${localShortcuts.length}个，合并后${mergedShortcuts.length}个` 
            };
        } catch (error) {
            throw new Error('快捷方式恢复失败：' + error.message);
        }
    }

    // 解析favorites.txt格式的快捷方式
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
                        iconType: 'default',
                        customColor: null
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

    // 获取最新的同步文件（andy_tab_sync.json）
    async getLatestSyncFile() {
        try {
            // 获取存储路径并确保目录存在
            const storagePath = await this._getStoragePathWithEnsure();
            
            // 列出存储文件夹中的文件
            const webdavFiles = await this.webdavClient.listDirectory(storagePath);
            
            // 查找andy_tab_sync.json文件
            const syncFile = webdavFiles.find(file => file.name === 'andy_tab_sync.json');
            
            if (!syncFile) {
                return null;
            }
            
            return syncFile;
        } catch (error) {
            console.error('获取最新同步文件失败：', error);
            return null;
        }
    }

    // 上传同步数据到云端（带3秒防抖）
    async uploadSyncDataWithDebounce() {
        // 清除之前的防抖定时器
        if (this.syncDebounceTimer) {
            clearTimeout(this.syncDebounceTimer);
        }
        
        // 设置新的防抖定时器
        this.syncDebounceTimer = setTimeout(async () => {
            try {
                await this.uploadSyncData();
            } catch (error) {
                console.error('同步数据上传失败：', error);
            }
        }, 3000);
    }

    // 将快捷方式转换为favorites.txt格式
    _convertShortcutsToFavoritesTxt(shortcuts) {
        if (!Array.isArray(shortcuts)) return '';
        
        return shortcuts.map((shortcut, index) => {
            return JSON.stringify({
                title: shortcut.name || '',
                url: shortcut.url || '',
                order: index
            });
        }).join('\n');
    }

    // 将书签转换为bookmarks.html格式（Netscape Bookmark格式）
    // 跳过roots，直接备份roots下的子元素（bookmark_bar, other, synced等）
    _convertBookmarksToHtml(bookmarks) {
        const generateBookmarkHtml = (bookmark, level = 0) => {
            const indent = '    '.repeat(level);

            if (bookmark.children && bookmark.children.length > 0) {
                // 文件夹
                const addDate = bookmark.dateAdded ? Math.floor(bookmark.dateAdded / 1000) : Math.floor(Date.now() / 1000);
                let html = `${indent}<DT><H3 ADD_DATE="${addDate}">${this._escapeHtml(bookmark.title || 'NoNamefolder')}</H3>\n`;
                html += `${indent}<DL><p>\n`;
                for (const child of bookmark.children) {
                    html += generateBookmarkHtml(child, level + 1);
                }
                html += `${indent}</DL><p>\n`;
                return html;
            } else {
                // 书签链接
                const addDate = bookmark.dateAdded ? Math.floor(bookmark.dateAdded / 1000) : Math.floor(Date.now() / 1000);
                return `${indent}<DT><A HREF="${this._escapeHtml(bookmark.url || '')}" ADD_DATE="${addDate}">${this._escapeHtml(bookmark.title || '')}</A>\n`;
            }
        };

        let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
`;

        // 处理书签数据，跳过roots层级，直接获取其子元素
        let bookmarkRoots = bookmarks;

        // 如果bookmarks是数组且只有一个元素，且该元素有children（这是Chrome书签树的roots结构）
        if (Array.isArray(bookmarks) && bookmarks.length === 1 && bookmarks[0].children) {
            bookmarkRoots = bookmarks[0].children;
        }

        if (Array.isArray(bookmarkRoots)) {
            for (const bookmark of bookmarkRoots) {
                html += generateBookmarkHtml(bookmark, 1);
            }
        }

        html += '</DL><p>';
        return html;
    }

    // HTML转义辅助函数
    _escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // 上传同步数据到云端
    async uploadSyncData() {
        try {
            if (!this.webdavClient) {
                return { success: false, message: 'WebDAV未配置，无法上传同步数据' };
            }

            // 获取数据
            const shortcuts = await this.getData(STORAGE_KEYS.SHORTCUTS, []);
            const bookmarks = await this._getUserBookmarksFromStorage();
            const data = await this.getAllData();
            
            // 获取存储路径并确保目录存在
            const storagePath = await this._getStoragePathWithEnsure();
            
            // 1. 上传favorites.txt（快捷方式）
            const favoritesContent = this._convertShortcutsToFavoritesTxt(shortcuts);
            await this.webdavClient.putFile(`${storagePath}/favorites.txt`, favoritesContent);
            
            // 2. 上传bookmarks.html（书签）
            const bookmarksHtml = this._convertBookmarksToHtml(bookmarks);
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

    // 下载并应用云端同步数据
    async downloadAndApplySyncData(fileName) {
        try {
            // 获取存储路径（目录已存在，无需再次确保）
            const storagePath = await this._getStoragePath();

            // 从WebDAV下载同步数据
            const syncDataStr = await this.webdavClient.getFile(`${storagePath}/${fileName}`);
            const syncData = JSON.parse(syncDataStr);
            
            // 应用同步数据
            await this.saveAllData(syncData);
            
            // 获取云端文件的修改时间作为本地同步时间戳
            const fileInfo = await this.webdavClient.getFileInfo(`${storagePath}/${fileName}`);
            const timestamp = fileInfo.modified ? new Date(fileInfo.modified).getTime() : Date.now();
            
            // 更新最后同步时间戳（兼容旧格式）
            await this.saveData(STORAGE_KEYS.SYNC_LAST_TIMESTAMP, { sync: timestamp });
            
            return { success: true, message: '同步数据应用成功' };
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
    async downloadFavorites() {
        try {
            if (!this.webdavClient) {
                return { success: false, message: 'WebDAV未配置' };
            }

            const storagePath = await this._getStoragePath();
            const favoritesData = await this.webdavClient.getFile(`${storagePath}/favorites.txt`);
            
            // 使用合并模式恢复快捷方式
            const result = await this._restoreFromFavoritesTxt(favoritesData);
            
            // 更新favorites时间戳
            const fileInfo = await this.webdavClient.getFileInfo(`${storagePath}/favorites.txt`);
            const timestamps = await this.getData(STORAGE_KEYS.SYNC_LAST_TIMESTAMP, {});
            timestamps.favorites = fileInfo.modified ? new Date(fileInfo.modified).getTime() : Date.now();
            await this.saveData(STORAGE_KEYS.SYNC_LAST_TIMESTAMP, timestamps);
            
            return { success: true, message: result.message };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    // 下载并应用书签（bookmarks.html）
    async downloadBookmarks() {
        try {
            if (!this.webdavClient) {
                return { success: false, message: 'WebDAV未配置' };
            }

            const storagePath = await this._getStoragePath();
            const bookmarksData = await this.webdavClient.getFile(`${storagePath}/bookmarks.html`);
            
            // 使用合并模式恢复书签
            const result = await this._restoreFromBookmarksHtml(bookmarksData);
            
            // 更新bookmarks时间戳
            const fileInfo = await this.webdavClient.getFileInfo(`${storagePath}/bookmarks.html`);
            const timestamps = await this.getData(STORAGE_KEYS.SYNC_LAST_TIMESTAMP, {});
            timestamps.bookmarks = fileInfo.modified ? new Date(fileInfo.modified).getTime() : Date.now();
            await this.saveData(STORAGE_KEYS.SYNC_LAST_TIMESTAMP, timestamps);
            
            return { success: true, message: result.message };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    // 下载并应用完整同步数据（andy_tab_sync.json）
    async downloadSyncData() {
        try {
            if (!this.webdavClient) {
                return { success: false, message: 'WebDAV未配置' };
            }

            const storagePath = await this._getStoragePath();
            const syncDataStr = await this.webdavClient.getFile(`${storagePath}/andy_tab_sync.json`);
            const syncData = JSON.parse(syncDataStr);
            
            // 应用同步数据
            await this.saveAllData(syncData);
            
            // 更新sync时间戳
            const fileInfo = await this.webdavClient.getFileInfo(`${storagePath}/andy_tab_sync.json`);
            const timestamps = await this.getData(STORAGE_KEYS.SYNC_LAST_TIMESTAMP, {});
            timestamps.sync = fileInfo.modified ? new Date(fileInfo.modified).getTime() : Date.now();
            await this.saveData(STORAGE_KEYS.SYNC_LAST_TIMESTAMP, timestamps);
            
            return { success: true, message: '完整数据同步成功' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }
}

// 创建单例实例
const storageManager = new StorageManager();

export default storageManager;