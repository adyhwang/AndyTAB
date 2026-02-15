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
        // 初始化方法改为手动调用，不再在构造函数中自动调用
        // this.init();
        // 防抖定时器
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
                console.log('用户书签已更新，准备同步');
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
                    if (!importedRoot || !importedRoot.id) {
                        continue;
                    }
                    
                    // 对于所有根文件夹（包括默认和自定义）
                    if (importedRoot.id === '1' || importedRoot.id === '2' || importedRoot.id === '3') {
                        // 对于默认根文件夹，合并其子项
                        if (importedRoot.children && importedRoot.children.length > 0) {
                            await this._mergeBookmarks(importedRoot.id, importedRoot.children);
                        }
                    } else {
                        // 对于自定义根文件夹，检查是否已存在
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

    // 确保AndyTab目录存在
    async _ensureAndyTabDirectory() {
        try {
            await this.webdavClient.createDirectory('AndyTab');
        } catch (error) {
            // 如果文件夹已存在，createDirectory会报错，这是正常的
        }
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
            const backupName = `bookmarks_backup_${new Date().toISOString().slice(0, 10)}_${Date.now()}.json`;
            
            if (this.webdavClient) {
                // 首先尝试创建AndyTab文件夹（如果不存在）
                await this._ensureAndyTabDirectory();
                
                // 备份到WebDAV的AndyTab文件夹
                await this.webdavClient.putFile(`AndyTab/${backupName}`, JSON.stringify(data, null, 2));
                
                return { success: true, message: '备份成功', backupName };
            } else {
                // WebDAV未配置，执行本地备份
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
            let data;
            
            if (this.webdavClient) {
                // WebDAV备份
                const backupData = await this.webdavClient.getFile(`AndyTab/${backupName}`);
                data = JSON.parse(backupData);
            } else {
                throw new Error('WebDAV未配置，无法恢复WebDAV备份');
            }
            
            if (!data) {
                throw new Error('备份不存在');
            }
            
            await this.saveAllData(data);
            return { success: true, message: '恢复成功' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }
    
    // 获取备份列表（包括所有以bookmarks_开头的文件）
    async getBackupFiles() {
        try {
            const backups = [];
            
            // 只获取WebDAV备份
            if (this.webdavClient) {
                try {
                    // 尝试创建AndyTab文件夹（如果不存在）
                    await this._ensureAndyTabDirectory();
                    
                    // 列出AndyTab文件夹中的文件
                    const webdavFiles = await this.webdavClient.listDirectory('AndyTab');
                    for (const file of webdavFiles) {
                        // 获取所有以bookmarks_开头的文件（包括bookmarks_backup、bookmarks_sync等）
                        if (file.name.startsWith('bookmarks_')) {
                            backups.push({
                                name: file.name,
                                type: 'webdav',
                                size: file.size || 0
                            });
                        }
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
            if (!this.webdavClient) {
                return { success: false, message: 'WebDAV未配置，无法删除备份' };
            }
            
            // 从AndyTab文件夹删除备份文件
            await this.webdavClient.deleteFile(`AndyTab/${backupName}`);
            
            return { success: true, message: '备份已删除' };
        } catch (error) {
            console.error('删除备份失败：', error);
            return { success: false, message: error.message };
        }
    }

    // 获取最新的同步文件
    async getLatestSyncFile() {
        try {
            if (!this.webdavClient) {
                return null;
            }

            // 尝试创建AndyTab文件夹（如果不存在）
            await this._ensureAndyTabDirectory();
            
            // 列出AndyTab文件夹中的文件
            const webdavFiles = await this.webdavClient.listDirectory('AndyTab');
            // 过滤出同步文件（支持hyphen或underscore分隔符）
            const syncFiles = webdavFiles.filter(file => file.name.startsWith('bookmarks_sync'));
            
            if (syncFiles.length === 0) {
                return null;
            }
            
            // 按文件名排序，最新的文件名（基于时间戳）会排在最后
            syncFiles.sort((a, b) => a.name.localeCompare(b.name));
            
            // 返回最新的同步文件
            return syncFiles[syncFiles.length - 1];
        } catch (error) {
            console.error('获取最新同步文件失败：', error);
            return null;
        }
    }

    // 删除旧的同步文件（只保留最新的一个）
    async deleteOldSyncFiles() {
        try {
            if (!this.webdavClient) {
                return;
            }

            // 尝试创建AndyTab文件夹（如果不存在）
            await this._ensureAndyTabDirectory();
            
            // 列出AndyTab文件夹中的文件
            const webdavFiles = await this.webdavClient.listDirectory('AndyTab');
            
            // 过滤出同步文件（支持hyphen或underscore分隔符）
            const syncFiles = webdavFiles.filter(file => file.name.startsWith('bookmarks_sync'));
            
            if (syncFiles.length <= 1) {
                return; // 只有0或1个同步文件，无需删除
            }
            
            // 按文件名排序
            syncFiles.sort((a, b) => a.name.localeCompare(b.name));
            
            // 删除除了最新的所有同步文件
            for (let i = 0; i < syncFiles.length - 1; i++) {
                await this.webdavClient.deleteFile(`AndyTab/${syncFiles[i].name}`);
                // console.log('已删除旧同步文件：', syncFiles[i].name);
            }
        } catch (error) {
            console.error('删除旧同步文件失败：', error);
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

    // 上传同步数据到云端
    async uploadSyncData() {
        try {
            if (!this.webdavClient) {
                // console.log('WebDAV未配置，跳过同步数据上传');
                return { success: false, message: 'WebDAV未配置，无法上传同步数据' };
            }

            // 获取所有数据
            const data = await this.getAllData();
            
            // 生成同步文件名（使用下划线分隔符，保持与现有文件一致）
            const timestamp = Date.now();
            const dateStr = new Date().toISOString().slice(0, 10);
            const syncFileName = `bookmarks_sync_${dateStr}_${timestamp}.json`;
            
            // 尝试创建AndyTab文件夹（如果不存在）
            await this._ensureAndyTabDirectory();
            
            // 上传到WebDAV的AndyTab文件夹
            await this.webdavClient.putFile(`AndyTab/${syncFileName}`, JSON.stringify(data, null, 2));
            console.log('同步数据已上传到云端：', syncFileName);
            
            // 更新最后同步时间戳
            await this.saveData(STORAGE_KEYS.SYNC_LAST_TIMESTAMP, timestamp);
            // console.log('已更新同步时间戳：', timestamp);
            
            // 删除旧的同步文件
            await this.deleteOldSyncFiles();
            
            return { success: true, message: '同步数据上传成功', fileName: syncFileName };
        } catch (error) {
            console.error('上传同步数据失败：', error);
            return { success: false, message: error.message };
        }
    }

    // 下载并应用云端同步数据
    async downloadAndApplySyncData(fileName) {
        try {
            if (!this.webdavClient) {
                return { success: false, message: 'WebDAV未配置，无法下载同步数据' };
            }

            // 从WebDAV下载同步数据
            const syncDataStr = await this.webdavClient.getFile(`AndyTab/${fileName}`);
            const syncData = JSON.parse(syncDataStr);
            
            // 应用同步数据
            await this.saveAllData(syncData);
            
            // 从文件名中提取时间戳（支持hyphen或underscore分隔符）
            const timestampMatch = fileName.match(/[_-]([0-9]+)\.json$/);
            if (timestampMatch) {
                const timestamp = parseInt(timestampMatch[1]);
                // 更新最后同步时间戳
                await this.saveData(STORAGE_KEYS.SYNC_LAST_TIMESTAMP, timestamp);
                // console.log('已应用云端同步数据，并更新时间戳：', timestamp);
            }
            
            return { success: true, message: '同步数据应用成功' };
        } catch (error) {
            // console.error('下载并应用同步数据失败：', error);
            return { success: false, message: error.message };
        }
    }
}

// 创建单例实例
const storageManager = new StorageManager();

export default storageManager;