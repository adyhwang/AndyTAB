// AndyTAB 新标签页主逻辑
import storageManager from '../utils/storage.js';
import imageCacheManager from '../utils/imageCache.js';

// 常量定义
const STORAGE_KEYS = {
    SHORTCUTS: 'andy_tab_shortcuts',
    SETTINGS: 'andy_tab_settings',
    WEBDAV_CONFIG: 'andy_tab_webdav_config',
    SEARCH_ENGINES: 'andy_tab_search_engines',
    OFFLINE_CACHE: 'andy_tab_offline_cache',
    TODOS: 'andy_tab_todos',
    NOTES: 'andy_tab_notes',
    SYNC_LAST_TIMESTAMP: 'andy_tab_sync_lasttimestamp'
};

// 全局变量
let isEditMode = false;
let allShortcuts = [];
let currentPage = 1;
let totalPages = 1;
let itemsPerPage = 0;
let isRenderingShortcuts = false; // 防止renderShortcuts函数重入的锁
let todos = [];
let notes = '';
let isTodoEnabled = false;
let isNotesEnabled = false;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    // 初始化所有功能
    init();
});

// 主初始化函数
async function init() {
    // 并行执行图片缓存管理器和存储管理器的初始化
    await Promise.all([
        imageCacheManager.init(),
        storageManager.init()
    ]);
    
    // 加载并应用设置
    await loadAndApplySettings();
    
    // 初始化时间日期显示
    initTimeDate();
    
    // 初始化搜索功能
    await initSearch();
    
    // 初始化快捷方式管理
    await initShortcuts();
    
    // 初始化设置按钮
    initSettings();
    
    // 延迟执行非关键操作
    setTimeout(async () => {
        // 清除过期缓存
        imageCacheManager.clearExpiredCache();
        
        // 预加载背景图片
        const settings = await getSettings();
        if (settings.backgroundType === 'image' && settings.backgroundImage) {
            imageCacheManager.preloadBackgroundImage(settings.backgroundImage);
        }
    }, 1000);
    
    // 监听设置变化
    chrome.storage.onChanged.addListener((changes, areaName) => {
        // 处理各个key的变化
        if (areaName === 'local') {
            if (changes[STORAGE_KEYS.SETTINGS]) {
                loadAndApplySettings();
            }
            if (changes[STORAGE_KEYS.SEARCH_ENGINES]) {
                renderEngineDropdown();
            }
            if (changes[STORAGE_KEYS.SHORTCUTS]) {
                // 快捷方式数据变化时重新渲染
                if (changes[STORAGE_KEYS.SHORTCUTS].newValue) {
                    allShortcuts = changes[STORAGE_KEYS.SHORTCUTS].newValue;
                    renderShortcuts(changes[STORAGE_KEYS.SHORTCUTS].newValue);
                }
            }
            if (changes[STORAGE_KEYS.TODOS]) {
                // 待办事项数据变化时重新渲染
                if (changes[STORAGE_KEYS.TODOS].newValue) {
                    todos = changes[STORAGE_KEYS.TODOS].newValue;
                    renderTodoList();
                }
            }
            if (changes[STORAGE_KEYS.NOTES]) {
                // 笔记数据变化时更新内容
                if (changes[STORAGE_KEYS.NOTES].newValue) {
                    notes = changes[STORAGE_KEYS.NOTES].newValue;
                    document.getElementById('notes-content').value = notes;
                }
            }
            
            // 检查是否是同步数据相关的key变化
            const syncableKeys = [
                STORAGE_KEYS.SHORTCUTS,
                STORAGE_KEYS.SETTINGS,
                STORAGE_KEYS.SEARCH_ENGINES,
                STORAGE_KEYS.TODOS,
                STORAGE_KEYS.NOTES
            ];
            
            // 检查是否有同步数据相关的key发生变化
            const hasSyncableChange = Object.keys(changes).some(key => 
                syncableKeys.includes(key) && key !== STORAGE_KEYS.SYNC_LAST_TIMESTAMP
            );
            
            if (hasSyncableChange) {
                storageManager.uploadSyncDataWithDebounce();
            }
        }
    });
    
    // 初始化待办事项和笔记功能
    await initTodos();
    await initNotes();
    
    // 初始化同步检查
    await initSyncCheck();
}

// 初始化同步检查
async function initSyncCheck() {
    try {        
        // 获取本地最后同步时间戳
        const localLastTimestamp = await storageManager.getData('andy_tab_sync_lasttimestamp', null);
        
        // 获取云端最新同步文件
        const latestSyncFile = await storageManager.getLatestSyncFile();
        
        if (!latestSyncFile) {
            return;
        }
        
        // 从文件名中提取云端同步时间戳
        const cloudTimestampMatch = latestSyncFile.name.match(/[_-]([0-9]+)\.json$/);
        if (!cloudTimestampMatch) {
            console.error('无法从文件名提取云端时间戳：', latestSyncFile.name);
            return;
        }
        
        const cloudTimestamp = parseInt(cloudTimestampMatch[1]);        
        // 情况1：云端时间戳较新或者本地没有同步记录，直接下载云端数据
        if (!localLastTimestamp||localLastTimestamp < cloudTimestamp) {
            console.log('云端时间戳较新或者本地没有同步记录，直接下载云端数据');
            await storageManager.downloadAndApplySyncData(latestSyncFile.name);
            // 重新加载页面以应用新数据
            location.reload();
            return;
        }
        
        // 情况2：时间戳相同，不进行操作
        if (localLastTimestamp === cloudTimestamp) {
            console.log('本地和云端时间戳相同，无需同步');
            return;
        }
        
        // 情况3：时间戳不同，显示冲突解决对话框
        console.log('本地和云端时间戳不同，显示冲突解决对话框');
        showSyncConflictDialog(latestSyncFile.name, localLastTimestamp, cloudTimestamp);
        
    } catch (error) {
        console.error('初始化同步检查失败：', error);
    }
}

// 显示同步冲突对话框
function showSyncConflictDialog(cloudFileName, localTimestamp, cloudTimestamp) {
    // 创建对话框元素
    const dialog = document.createElement('div');
    dialog.className = 'sync-conflict-dialog';
    dialog.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
        font-family: Arial, sans-serif;
    `;
    
    // 创建对话框内容
    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
        background-color: white;
        padding: 24px;
        border-radius: 8px;
        width: 90%;
        max-width: 500px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    `;
    
    // 创建标题
    const title = document.createElement('h2');
    title.textContent = '检测到数据不一致';
    title.style.cssText = `
        margin-top: 0;
        margin-bottom: 16px;
        color: #333;
        font-size: 20px;
    `;
    dialogContent.appendChild(title);
    
    // 创建提示文本
    const message = document.createElement('p');
    message.textContent = '检测到云端数据和本地数据不一致，请选择操作：';
    message.style.cssText = `
        margin-bottom: 20px;
        color: #666;
        line-height: 1.5;
    `;
    dialogContent.appendChild(message);
    
    // 创建选项容器
    const optionsContainer = document.createElement('div');
    optionsContainer.style.cssText = `
        margin-bottom: 24px;
    `;
    
    // 创建单选按钮组
    const options = [
        { id: 'use-local', label: '使用本地数据', value: 'local' },
        { id: 'use-cloud', label: '使用云端数据', value: 'cloud' },
        { id: 'merge-data', label: '合并本地和云端数据', value: 'merge' }
    ];
    
    // 存储选中的值
    let selectedOption = 'local';
    
    options.forEach(option => {
        const optionDiv = document.createElement('div');
        optionDiv.style.cssText = `
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            cursor: pointer;
        `;
        
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.id = option.id;
        radio.name = 'sync-conflict-option';
        radio.value = option.value;
        radio.checked = option.value === selectedOption;
        radio.style.marginRight = '12px';
        
        radio.addEventListener('change', () => {
            selectedOption = option.value;
        });
        
        const label = document.createElement('label');
        label.htmlFor = option.id;
        label.textContent = option.label;
        label.style.cssText = `
            cursor: pointer;
            user-select: none;
            color: #333;
        `;
        
        optionDiv.appendChild(radio);
        optionDiv.appendChild(label);
        optionsContainer.appendChild(optionDiv);
    });
    
    dialogContent.appendChild(optionsContainer);
    
    // 创建按钮容器
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        justify-content: flex-end;
        gap: 12px;
    `;
    
    // 创建确定按钮
    const confirmButton = document.createElement('button');
    confirmButton.textContent = '确定';
    confirmButton.style.cssText = `
        padding: 10px 20px;
        background-color: #4CAF50;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
    `;
    
    confirmButton.addEventListener('click', async () => {
        try {            
            switch (selectedOption) {
                case 'local':
                    // 使用本地数据，上传到云端覆盖
                    await storageManager.uploadSyncData();
                    break;
                    
                case 'cloud':
                    // 使用云端数据，下载并覆盖本地
                    await storageManager.downloadAndApplySyncData(cloudFileName);
                    // 重新加载页面以应用新数据
                    location.reload();
                    break;
                    
                case 'merge':
                    // 合并数据（简单合并：云端数据为主，本地数据为辅）
                    // 先下载云端数据
                    const cloudDataStr = await storageManager.webdavClient.getFile(`AndyTab/${cloudFileName}`);
                    const cloudData = JSON.parse(cloudDataStr);
                    
                    // 获取本地数据
                    const localData = await storageManager.getAllData();
                    
                    // 合并数据（云端数据为主，本地数据为辅）
                    const mergedData = {
                        // 快捷方式：合并并去重
                        shortcuts: [...new Map([...cloudData.shortcuts, ...localData.shortcuts].map(item => [item.url, item])).values()],
                        // 设置：云端优先
                        settings: { ...localData.settings, ...cloudData.settings },
                        // 搜索引擎：云端优先
                        searchEngines: { ...localData.searchEngines, ...cloudData.searchEngines },
                        // 待办事项：合并并去重
                        todos: [...new Map([...cloudData.todos, ...localData.todos].map(item => [item.id, item])).values()],
                        // 笔记：云端优先
                        notes: cloudData.notes || localData.notes
                    };
                    
                    // 保存合并后的数据
                    await storageManager.saveAllData(mergedData);
                    
                    // 上传到云端
                    await storageManager.uploadSyncData();
                    
                    // 重新加载页面以应用新数据
                    location.reload();
                    break;
            }
            
            // 关闭对话框
            dialog.remove();
            
        } catch (error) {
            console.error('处理同步冲突失败：', error);
            alert('处理同步冲突失败：' + error.message);
        }
    });
    
    buttonContainer.appendChild(confirmButton);
    dialogContent.appendChild(buttonContainer);
    
    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);
}

// 加载并应用设置
async function loadAndApplySettings() {
    const settings = await getSettings();
    
    await applyBackgroundSettings(settings);
    applyTimeDateSettings(settings);
    applySearchEngineSettings(settings);
    applyIconLayoutFontSettings(settings);
    await applyTodoNotesSettings(settings);
    
    console.log('设置已应用:', settings);
}

// 更新背景设置项的可见性
function updateBackgroundSettingsVisibility(backgroundType) {
    const gradientSettings = document.querySelectorAll('.background-gradient-setting');
    const solidSettings = document.querySelectorAll('.background-color-setting');
    const imageSettings = document.querySelectorAll('.background-image-setting');
    
    switch (backgroundType) {
        case 'gradient':
            gradientSettings.forEach(item => item.style.display = 'block');
            solidSettings.forEach(item => item.style.display = 'none');
            imageSettings.forEach(item => item.style.display = 'none');
            break;
        case 'solid':
            gradientSettings.forEach(item => item.style.display = 'none');
            solidSettings.forEach(item => item.style.display = 'block');
            imageSettings.forEach(item => item.style.display = 'none');
            break;
        case 'image':
            gradientSettings.forEach(item => item.style.display = 'none');
            solidSettings.forEach(item => item.style.display = 'none');
            imageSettings.forEach(item => item.style.display = 'block');
            break;
        case 'bing':
            // Bing壁纸不需要特殊设置项，隐藏所有特定设置
            gradientSettings.forEach(item => item.style.display = 'none');
            solidSettings.forEach(item => item.style.display = 'none');
            imageSettings.forEach(item => item.style.display = 'none');
            break;
        default:
            gradientSettings.forEach(item => item.style.display = 'block');
            solidSettings.forEach(item => item.style.display = 'none');
            imageSettings.forEach(item => item.style.display = 'none');
            break;
    }
}

// 获取设置（异步）
async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.SETTINGS], function(result) {
            resolve(result[STORAGE_KEYS.SETTINGS] || {});
        });
    });
}

// 获取设置（同步）- 用于分页计算
function getSettingsSync() {
    // 使用缓存的设置，如果没有则返回默认值
    if (window.cachedSettings) {
        return window.cachedSettings;
    }
    
    // 返回默认设置
    return {
        columns: 6,
        rows: 3,
        columnGap: '20px',
        rowGap: '20px'
    };
}

// 应用背景设置
async function applyBackgroundSettings(settings) {
    const body = document.body;
    
    // 根据背景类型应用不同设置
    switch (settings.backgroundType) {
        case 'solid':
            // 纯色背景
            body.style.background = settings.backgroundColor || '#667eea';
            body.style.backgroundImage = 'none';
            break;
        case 'image':
            // 自定义图片背景
            if (settings.backgroundImage) {
                // 先使用原始URL作为快速回退
                body.style.background = `url(${settings.backgroundImage}) center/cover no-repeat`;
                body.style.backgroundImage = `url(${settings.backgroundImage})`;
                
                // 在后台尝试获取缓存的图片（非阻塞）
                try {
                    // 异步加载缓存图片，不影响页面渲染
                    setTimeout(async () => {
                        try {
                            const cachedImage = await imageCacheManager.getOrCacheImage(settings.backgroundImage, true);
                            if (cachedImage) {
                                // 只有在图片成功缓存后才更新样式
                                body.style.background = `url(${cachedImage}) center/cover no-repeat`;
                                body.style.backgroundImage = `url(${cachedImage})`;
                            }
                        } catch (error) {
                            console.error('后台加载背景图片失败:', error);
                            // 发生错误时不改变现有样式，保持原始URL
                        }
                    }, 0);
                } catch (error) {
                    console.error('启动后台背景图片加载失败:', error);
                    // 启动后台加载失败时，仍使用原始URL
                    body.style.background = `url(${settings.backgroundImage}) center/cover no-repeat`;
                    body.style.backgroundImage = `url(${settings.backgroundImage})`;
                }
            } else {
                // 默认渐变背景
                body.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                body.style.backgroundImage = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            }
            break;
        case 'bing':
            // Bing每日壁纸
            // 先使用默认渐变背景作为快速回退
            body.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            body.style.backgroundImage = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            
            // 在后台获取Bing壁纸并应用
            try {
                setTimeout(async () => {
                    try {
                        // 先尝试从缓存获取今天的Bing壁纸
                        const bingCacheKey = 'bing_wallpaper_today';
                        const cachedImage = await imageCacheManager.getCachedImage(bingCacheKey, false, true);
                        
                        if (cachedImage) {
                            // 如果有缓存，直接使用缓存的图片
                            document.body.style.background = `url(${cachedImage}) center/cover no-repeat`;
                            document.body.style.backgroundImage = `url(${cachedImage})`;
                        } else {
                            // 如果没有缓存，获取新的Bing壁纸
                            const bingImageUrl = await getBingWallpaperUrl();
                            if (bingImageUrl) {
                                // 先设置原始URL作为快速回退
                                document.body.style.background = `url(${bingImageUrl}) center/cover no-repeat`;
                                document.body.style.backgroundImage = `url(${bingImageUrl})`;
                                
                                // 然后下载并缓存图片，使用固定的缓存键
                                await imageCacheManager.cacheImageWithKey(bingImageUrl, bingCacheKey, true);
                                
                                // 再次尝试获取缓存的图片
                                const newCachedImage = await imageCacheManager.getCachedImage(bingCacheKey, false, true);
                                if (newCachedImage) {
                                    document.body.style.background = `url(${newCachedImage}) center/cover no-repeat`;
                                    document.body.style.backgroundImage = `url(${newCachedImage})`;
                                }
                            }
                        }
                    } catch (error) {
                        console.error('加载Bing每日壁纸失败:', error);
                        // 发生错误时不改变现有样式
                    }
                }, 0);
            } catch (error) {
                console.error('启动Bing壁纸加载失败:', error);
            }
            break;
        case 'gradient':
        default:
            // 自定义渐变背景
            const gradientType = settings.gradientType || 'linear';
            const gradientDirection = settings.gradientDirection || 'to bottom right';
            const color1 = settings.gradientColor1 || '#667eea';
            const color2 = settings.gradientColor2 || '#764ba2';
            
            let gradientValue;
            if (gradientType === 'linear') {
                // 线性渐变 - 优先使用方向关键词，如果没有则使用角度
                const direction = gradientDirection || 'to bottom right';
                gradientValue = `linear-gradient(${direction}, ${color1} 0%, ${color2} 100%)`;
            } else {
                // 径向渐变
                gradientValue = `radial-gradient(circle, ${color1} 0%, ${color2} 100%)`;
            }
            
            body.style.background = gradientValue;
            body.style.backgroundImage = gradientValue;
            break;
    }
    
    // 应用遮罩浓度
    if (settings.overlayOpacity !== undefined) {
        body.style.setProperty('--overlay-opacity', settings.overlayOpacity);
    } else {
        body.style.setProperty('--overlay-opacity', '0.3');
    }
    
    // 应用模糊度
    if (settings.backgroundBlur !== undefined) {
        body.style.setProperty('--background-blur', settings.backgroundBlur + 'px');
    } else {
        body.style.setProperty('--background-blur', '5px');
    }
}

// 获取Bing每日壁纸URL
async function getBingWallpaperUrl() {
    try {
        const response = await fetch('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            }
        });
        
        if (!response.ok) {
            return null;
        }
        
        const data = await response.json();
        if (data && data.images && data.images.length > 0) {
            return 'https://www.bing.com' + data.images[0].url;
        } else {
            throw new Error('Bing壁纸API返回数据格式异常');
        }
    } catch (error) {
        console.error('获取Bing每日壁纸失败:', error);
        return null;
    }
}

// 应用搜索引擎设置
async function applySearchEngineSettings(settings) {
    // 保存当前搜索引擎，供搜索功能使用
    window.searchEngine = settings.searchEngine || 'bing';
    
    // 更新UI显示
    await updateEngineUI();
}

// 应用图标、布局和字体设置
function applyIconLayoutFontSettings(settings) {
    // 缓存设置供同步函数使用
    window.cachedSettings = settings;
    
    const shortcutsContainer = document.getElementById('shortcuts-container');
    const shortcutsGrid = shortcutsContainer?.querySelector('.shortcuts-grid');
    
    // 应用布局设置
    if (shortcutsGrid) {
        if (settings.columns) {
            shortcutsGrid.style.gridTemplateColumns = `repeat(${settings.columns}, auto)`;
        }
        if (settings.columnGap) {
            shortcutsGrid.style.columnGap = settings.columnGap;
        }
        if (settings.rowGap) {
            shortcutsGrid.style.rowGap = settings.rowGap;
        }
    }
    
    // 应用图标和字体设置到现有图标
    const shortcutItems = document.querySelectorAll('.shortcut-item');
    shortcutItems.forEach(item => {
        const icon = item.querySelector('.shortcut-icon');
        const name = item.querySelector('.shortcut-name');
        
        // 应用图标设置
        if (settings.hideIconNames) {
            name.style.display = 'none';
        } else {
            name.style.display = 'block';
        }
        
        if (settings.iconShadow) {
            item.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
        } else {
            item.style.boxShadow = 'none';
        }
        
        if (settings.iconBorderRadius) {
            icon.style.borderRadius = settings.iconBorderRadius;
        }
        
        if (settings.iconOpacity) {
            icon.style.opacity = settings.iconOpacity;
        }
        
        if (settings.iconSize) {
            item.style.width = settings.iconSize;
            // 保持正方形比例，不需要设置height，因为有aspect-ratio: 1
            
            // 纯色模式下，图标文字随快捷方式大小变化
            // 检查是否是纯色图标（没有img元素或者有default-icon类）
            const hasCustomIcon = icon.querySelector('img');
            const isDefaultIcon = icon.classList.contains('default-icon');
            
            if (!hasCustomIcon || isDefaultIcon) {
                const iconSizeValue = parseInt(settings.iconSize.replace('px', ''));
                // 根据图标大小计算合适的文字大小（约为图标大小的40%）
                const textSize = Math.max(12, Math.min(60, iconSizeValue * 0.8));
                icon.style.fontSize = textSize + 'px';
            }
        }
        
        // 应用字体设置
        if (settings.fontShadow) {
            name.style.textShadow = '3px 3px 6px rgba(0, 0, 0, 0.8)';
        } else {
            name.style.textShadow = 'none';
        }
        
        if (settings.fontSize) {
            name.style.fontSize = settings.fontSize;
        }
        
        if (settings.fontColor) {
            name.style.color = settings.fontColor;
        }
    });
}

// 应用待办事项和笔记设置
async function applyTodoNotesSettings(settings) {
    // 获取待办事项和笔记的启用状态
    isTodoEnabled = settings.enableTodo || false;
    isNotesEnabled = settings.enableNotes || false;
    
    // 更新UI开关状态
    const todoToggle = document.getElementById('enable-todo');
    const notesToggle = document.getElementById('enable-notes');
    
    if (todoToggle) {
        todoToggle.checked = isTodoEnabled;
    }
    if (notesToggle) {
        notesToggle.checked = isNotesEnabled;
    }
    
    // 更新功能按钮显示
    const todoBtn = document.getElementById('todo-btn');
    const notesBtn = document.getElementById('notes-btn');
    
    if (todoBtn) {
        todoBtn.style.display = isTodoEnabled ? 'flex' : 'none';
    }
    if (notesBtn) {
        notesBtn.style.display = isNotesEnabled ? 'flex' : 'none';
    }
    
    // 监听开关变化
    if (todoToggle) {
        todoToggle.onchange = async () => {
            settings.enableTodo = todoToggle.checked;
            await saveSettings(settings);
            await applyTodoNotesSettings(settings);
        };
    }
    if (notesToggle) {
        notesToggle.onchange = async () => {
            settings.enableNotes = notesToggle.checked;
            await saveSettings(settings);
            await applyTodoNotesSettings(settings);
        };
    }
}

// 初始化待办事项功能
async function initTodos() {
    // 加载待办事项数据
    todos = await storageManager.getData(STORAGE_KEYS.TODOS, []);
    
    // 获取DOM元素
    const todoBtn = document.getElementById('todo-btn');
    const todoModal = document.getElementById('todo-modal');
    const addTodoBtn = document.getElementById('add-todo-btn');
    const todoList = document.getElementById('todo-list');
    const closeBtn = todoModal.querySelector('.close');
    
    // 渲染待办事项列表
    renderTodoList();
    
    // 绑定事件
    if (todoBtn) {
        todoBtn.addEventListener('click', () => {
            todoModal.classList.add('show');
        });
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            todoModal.classList.remove('show');
        });
    }
    
    // 点击添加待办事项按钮
    if (addTodoBtn) {
        addTodoBtn.addEventListener('click', async () => {
            // 创建新的待办事项
            const newTodo = {
                text: '',
                completed: false,
                id: Date.now()
            };
            
            // 添加到数组
            todos.push(newTodo);
            await storageManager.saveData(STORAGE_KEYS.TODOS, todos);
            
            // 重新渲染列表
            renderTodoList();
            
            // 进入编辑模式
            setTimeout(() => {
                editTodo(todos.length - 1);
            }, 100);
        });
    }
    
    // 点击模态框外部关闭
    window.addEventListener('click', (e) => {
        if (e.target === todoModal) {
            todoModal.classList.remove('show');
        }
    });
}

// 初始化笔记功能
async function initNotes() {
    // 加载笔记数据
    notes = await storageManager.getData(STORAGE_KEYS.NOTES, '');
    
    // 获取DOM元素
    const notesBtn = document.getElementById('notes-btn');
    const notesModal = document.getElementById('notes-modal');
    const notesContent = document.getElementById('notes-content');
    const saveNotesBtn = document.getElementById('save-notes-btn');
    const closeBtn = notesModal.querySelector('.close');
    
    // 设置笔记内容
    if (notesContent) {
        notesContent.value = notes;
    }
    
    // 绑定事件
    if (notesBtn) {
        notesBtn.addEventListener('click', () => {
            notesModal.classList.add('show');
        });
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            notesModal.classList.remove('show');
        });
    }
    
    if (saveNotesBtn) {
        saveNotesBtn.addEventListener('click', async () => {
            await saveNotes();
        });
    }
    
    // 点击模态框外部关闭
    window.addEventListener('click', (e) => {
        if (e.target === notesModal) {
            notesModal.classList.remove('show');
        }
    });
}

// 渲染待办事项列表
function renderTodoList() {
    const todoList = document.getElementById('todo-list');
    if (!todoList) return;
    
    todoList.innerHTML = '';
    
    todos.forEach((todo, index) => {
        const todoItem = document.createElement('div');
        todoItem.className = `todo-item ${todo.completed ? 'completed' : ''}`;
        
        // 创建复选框
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'todo-item-checkbox';
        checkbox.checked = todo.completed;
        checkbox.onchange = () => toggleTodo(index);
        
        // 创建文本
        const text = document.createElement('div');
        text.className = 'todo-item-text';
        text.textContent = todo.text;
        
        // 创建操作按钮
        const actions = document.createElement('div');
        actions.className = 'todo-item-actions';
        
        // 编辑按钮
        const editBtn = document.createElement('button');
        editBtn.className = 'todo-item-edit';
        editBtn.textContent = '编辑';
        editBtn.onclick = () => editTodo(index);
        
        // 删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'todo-item-delete';
        deleteBtn.textContent = '删除';
        deleteBtn.onclick = () => deleteTodo(index);
        
        // 组装元素
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        
        todoItem.appendChild(checkbox);
        todoItem.appendChild(text);
        todoItem.appendChild(actions);
        
        todoList.appendChild(todoItem);
    });
}

// 切换待办事项完成状态
async function toggleTodo(index) {
    todos[index].completed = !todos[index].completed;
    await storageManager.saveData(STORAGE_KEYS.TODOS, todos);
    renderTodoList();
}

// 编辑待办事项
async function editTodo(index) {
    const todoItem = document.querySelector(`.todo-item:nth-child(${index + 1})`);
    const textElement = todoItem.querySelector('.todo-item-text');
    const currentText = textElement.textContent;
    
    // 创建输入框
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'todo-item-edit-input';
    input.value = currentText;
    
    // 创建保存按钮
    const saveBtn = document.createElement('button');
    saveBtn.className = 'todo-item-edit';
    saveBtn.textContent = '保存';
    
    // 创建取消按钮
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'todo-item-delete';
    cancelBtn.textContent = '取消';
    
    // 替换元素
    const actions = todoItem.querySelector('.todo-item-actions');
    todoItem.replaceChild(input, textElement);
    actions.innerHTML = '';
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    
    // 聚焦输入框
    input.focus();
    
    // 绑定事件
    saveBtn.onclick = async () => {
        if (input.value.trim()) {
            todos[index].text = input.value.trim();
            await storageManager.saveData(STORAGE_KEYS.TODOS, todos);
            renderTodoList();
        }
    };
    
    cancelBtn.onclick = () => {
        renderTodoList();
    };
    
    // 回车保存，ESC取消
    input.onkeydown = async (e) => {
        if (e.key === 'Enter') {
            saveBtn.click();
        } else if (e.key === 'Escape') {
            cancelBtn.click();
        }
    };
    
    // 失去焦点时自动保存
    input.onblur = () => {
        if (input.value.trim()) {
            saveBtn.click();
        }
    };
}

// 删除待办事项
async function deleteTodo(index) {
    todos.splice(index, 1);
    await storageManager.saveData(STORAGE_KEYS.TODOS, todos);
    renderTodoList();
}

// 保存笔记
async function saveNotes() {
    const notesContent = document.getElementById('notes-content');
    if (notesContent) {
        notes = notesContent.value;
        await storageManager.saveData(STORAGE_KEYS.NOTES, notes);
        
        // 显示保存状态
        const saveStatus = document.createElement('div');
        saveStatus.className = 'notes-save-status';
        saveStatus.textContent = '笔记已保存';
        saveStatus.style.display = 'block';
        
        const notesContainer = document.querySelector('.notes-container');
        notesContainer.appendChild(saveStatus);
        
        // 2秒后隐藏状态
        setTimeout(() => {
            saveStatus.remove();
        }, 2000);
    }
}

// 应用时间日期设置
function applyTimeDateSettings(settings) {
    const timeElement = document.getElementById('time');
    const dateElement = document.getElementById('date');
    
    // 应用时间设置
    if (settings.showTime !== false) {
        timeElement.style.display = 'block';
        timeElement.style.color = settings.timeColor || '#ffffff';
        timeElement.style.fontSize = settings.timeSize || '36px';
        // 应用字体阴影
        if (settings.fontShadow) {
            timeElement.style.textShadow = '3px 3px 6px rgba(0, 0, 0, 0.8)';
        } else {
            timeElement.style.textShadow = 'none';
        }
    } else {
        timeElement.style.display = 'none';
    }
    
    // 应用日期设置
    if (settings.showDate !== false) {
        dateElement.style.display = 'block';
        dateElement.style.color = settings.dateColor || '#ffffff';
        dateElement.style.fontSize = settings.dateSize || '18px';
        // 应用字体阴影
        if (settings.fontShadow) {
            dateElement.style.textShadow = '3px 3px 6px rgba(0, 0, 0, 0.8)';
        } else {
            dateElement.style.textShadow = 'none';
        }
    } else {
        dateElement.style.display = 'none';
    }
}

// 格式化时间
function formatTime(date, format) {
    if (!format) format = 'hh:mm:ss';
    
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    
    return format
        .replace('hh', String(hours).padStart(2, '0'))
        .replace('mm', String(minutes).padStart(2, '0'))
        .replace('ss', String(seconds).padStart(2, '0'));
}

// 格式化日期
function formatDate(date, format) {
    if (!format) format = 'YYYY年MM月DD日';
    
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    
    return format
        .replace('YYYY', String(year))
        .replace('MM', String(month).padStart(2, '0'))
        .replace('DD', String(day).padStart(2, '0'));
}

// 初始化时间日期显示
function initTimeDate() {
    async function updateTimeDate() {
        const now = new Date();
        const settings = await getSettings();
        
        const timeElement = document.getElementById('time');
        if (settings.showTime !== false) {
            const timeStr = formatTime(now, settings.timeFormat);
            timeElement.textContent = timeStr;
            timeElement.style.display = 'block';
        } else {
            timeElement.style.display = 'none';
        }
        
        const dateElement = document.getElementById('date');
        if (settings.showDate !== false) {
            const dateStr = formatDate(now, settings.dateFormat);
            dateElement.textContent = dateStr;
            dateElement.style.display = 'block';
        } else {
            dateElement.style.display = 'none';
        }
    }
    
    updateTimeDate();
    setInterval(updateTimeDate, 1000);
}

// 更新搜索引擎UI
async function updateEngineUI() {
    const currentEngineName = document.getElementById('current-engine-name');
    if (!currentEngineName) return;
    
    const engines = await getSearchEngines();
    const engine = window.searchEngine || 'bing';
    
    if (engines[engine]) {
        currentEngineName.textContent = engines[engine].name;
    }
    
    // 更新下拉菜单中的选中状态
    const engineItems = document.querySelectorAll('.engine-item');
    engineItems.forEach(item => {
        item.classList.remove('active');
        if (item.dataset.engine === engine) {
            item.classList.add('active');
        }
    });
}

// 获取搜索引擎列表
async function getSearchEngines() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['andy_tab_search_engines'], function(result) {
            const engines = result['andy_tab_search_engines'] || {};
            resolve(engines);
        });
    });
}

// 渲染搜索引擎下拉菜单
async function renderEngineDropdown() {
    const engineDropdown = document.getElementById('engine-dropdown');
    const engines = await getSearchEngines();
    
    engineDropdown.innerHTML = '';
    
    for (const [key, engine] of Object.entries(engines)) {
        const engineItem = document.createElement('div');
        engineItem.className = 'engine-item';
        engineItem.dataset.engine = key;
        engineItem.textContent = engine.name;
        
        // 添加点击事件
        engineItem.addEventListener('click', async function() {
            const engine = this.dataset.engine;
            
            // 更新当前搜索引擎
            window.searchEngine = engine;
            
            // 保存到设置
            const settings = await getSettings();
            settings.searchEngine = engine;
            chrome.storage.local.set({
                [STORAGE_KEYS.SETTINGS]: settings
            });
            
            // 更新UI
            await updateEngineUI();
            
            // 关闭下拉菜单
            const engineSelectBtn = document.getElementById('search-engine-select');
            engineSelectBtn.classList.remove('active');
            engineDropdown.classList.remove('show');
        });
        
        engineDropdown.appendChild(engineItem);
    }
}

// 初始化搜索功能
async function initSearch() {
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const engineSelectBtn = document.getElementById('search-engine-select');
    const engineDropdown = document.getElementById('engine-dropdown');
    
    // 渲染搜索引擎下拉菜单
    await renderEngineDropdown();
    
    // 搜索函数
    async function performSearch() {
        const query = searchInput.value.trim();
        if (query) {
            // 获取当前搜索引擎
            const engine = window.searchEngine || 'bing';
            const engines = await getSearchEngines();
            const settings = await getSettings();
            
            if (engines[engine]) {
                const searchUrl = engines[engine].url.replace('%s', encodeURIComponent(query));
                const target = settings.openSearchInNewTab !== false ? '_blank' : '_self';
                window.open(searchUrl, target);
            }
        }
    }
    
    // 切换搜索引擎下拉菜单
    engineSelectBtn.addEventListener('click', function(e) {
        e.stopPropagation(); // 防止事件冒泡
        this.classList.toggle('active');
        engineDropdown.classList.toggle('show');
    });
    
    // 点击页面其他地方关闭下拉菜单
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.search-engine-selector')) {
            engineSelectBtn.classList.remove('active');
            engineDropdown.classList.remove('show');
        }
    });
    
    // 阻止下拉菜单内部点击事件冒泡
    engineDropdown.addEventListener('click', function(e) {
        e.stopPropagation();
    });
    
    // 点击搜索按钮
    searchBtn.addEventListener('click', performSearch);
    
    // 回车键搜索
    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            performSearch();
        }
    });
    
    // 初始加载搜索引擎设置
    const settings = await getSettings();
    window.searchEngine = settings.searchEngine || 'bing';
    await updateEngineUI();
    
    // 自动聚焦到搜索栏
    searchInput.focus();
}

// 初始化快捷方式管理
async function initShortcuts() {
    const addShortcutBtn = document.getElementById('add-shortcut');
    const editShortcutsBtn = document.getElementById('edit-shortcuts');
    const shortcutModal = document.getElementById('add-shortcut-modal');
    const shortcutForm = document.getElementById('shortcut-form');
    const closeModal = shortcutModal.querySelector('.close');
    const shortcutsGrid = document.getElementById('shortcuts-grid');
    const fetchInfoBtn = document.getElementById('fetch-info-btn');
    const iconTypeSelect = document.getElementById('shortcut-icon-type');
    const customIconGroup = document.getElementById('custom-icon-group');
    const settingsPanel = document.getElementById('settings-panel');
    
    // 标签页相关元素（仅快捷方式弹窗内的）
    const tabContainer = shortcutModal.querySelector('.tab-container');
    const tabBtns = tabContainer.querySelectorAll('.tab-btn');
    const tabPanes = tabContainer.querySelectorAll('.tab-pane');
    
    // 从收藏夹/历史记录选择相关元素
    const dataSourceBtns = tabContainer.querySelectorAll('.data-source-btn');
    const browserDataSearch = tabContainer.querySelector('#browser-data-search');
    const websiteList = tabContainer.querySelector('#website-list');
    const addSelectedBtn = tabContainer.querySelector('#add-selected-btn');
    const cancelBrowserDataBtn = tabContainer.querySelector('#cancel-browser-data-btn');
    
    // 文件上传相关元素
    const uploadIconBtn = document.getElementById('upload-icon-btn');
    const iconFileInput = document.getElementById('icon-file-input');
    
    // 变量定义
    let currentDataSource = 'bookmarks';
    let allBrowserItems = [];
    let filteredBrowserItems = [];
    let selectedItems = new Set();
    let editingIndex = null; // 记录当前编辑的快捷方式索引
    let isEditMode = false; // 区分添加模式和编辑模式
    
    // 标签页切换功能
    function initTabSwitching() {
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.dataset.tab;
                
                // 更新按钮状态
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // 更新标签页内容
                tabPanes.forEach(pane => {
                    pane.classList.remove('active');
                    if (pane.id === `${targetTab}-tab`) {
                        pane.classList.add('active');
                    }
                });
                
                // 如果切换到浏览器数据标签，加载数据
                if (targetTab === 'browser-data') {
                    loadBrowserData();
                }
            });
        });
    }
    
    // 加载浏览器数据（收藏夹或历史记录）
    async function loadBrowserData() {
        websiteList.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">加载中...</div>';
        
        try {
            if (currentDataSource === 'bookmarks') {
                allBrowserItems = await getBookmarks();
            } else {
                allBrowserItems = await getHistory();
            }
            
            filteredBrowserItems = [...allBrowserItems];
            renderWebsiteList(filteredBrowserItems);
        } catch (error) {
            console.error('加载浏览器数据失败:', error);
            websiteList.innerHTML = '<div style="text-align: center; padding: 20px; color: #dc3545;">加载失败，请检查权限</div>';
        }
    }
    
    // 获取收藏夹数据
    async function getBookmarks() {
        return new Promise((resolve) => {
            chrome.bookmarks.getTree((bookmarkTreeNodes) => {
                const bookmarks = [];
                
                // 递归遍历收藏夹树
                function traverseBookmarks(nodes) {
                    nodes.forEach(node => {
                        if (node.url) {
                            // 只添加有URL的书签
                            bookmarks.push({
                                id: node.id,
                                title: node.title || new URL(node.url).hostname,
                                url: node.url,
                                type: 'bookmark'
                            });
                        }
                        if (node.children) {
                            traverseBookmarks(node.children);
                        }
                    });
                }
                
                traverseBookmarks(bookmarkTreeNodes);
                resolve(bookmarks);
            });
        });
    }
    
    // 获取历史记录数据
    async function getHistory() {
        return new Promise((resolve) => {
            // 获取最近访问的50条历史记录
            chrome.history.search({ text: '', maxResults: 50 }, (historyItems) => {
                const historyData = historyItems.map(item => ({
                    id: item.id,
                    title: item.title || new URL(item.url).hostname,
                    url: item.url,
                    type: 'history'
                }));
                resolve(historyData);
            });
        });
    }
    
    // 渲染网站列表
    function renderWebsiteList(items) {
        if (items.length === 0) {
            websiteList.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">暂无数据</div>';
            return;
        }
        
        websiteList.innerHTML = items.map(item => `
            <div class="website-item" data-id="${item.id}">
                <input type="checkbox" class="website-checkbox" data-id="${item.id}">
                <div class="website-info">
                    <div class="website-title">${item.title}</div>
                    <div class="website-url">${item.url}</div>
                </div>
            </div>
        `).join('');
        
        // 添加事件监听
        addWebsiteItemListeners();
    }
    
    // 添加网站项事件监听
    function addWebsiteItemListeners() {
        const websiteItems = document.querySelectorAll('.website-item');
        const checkboxes = document.querySelectorAll('.website-checkbox');
        
        // 网站项点击事件
        websiteItems.forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.type !== 'checkbox') {
                    const checkbox = item.querySelector('.website-checkbox');
                    checkbox.checked = !checkbox.checked;
                    updateSelectedItems(checkbox);
                }
            });
        });
        
        // 复选框点击事件
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                updateSelectedItems(checkbox);
            });
        });
    }
    
    // 更新选中项
    function updateSelectedItems(checkbox) {
        const id = checkbox.dataset.id;
        
        if (checkbox.checked) {
            selectedItems.add(id);
        } else {
            selectedItems.delete(id);
        }
        
        // 更新按钮状态
        addSelectedBtn.disabled = selectedItems.size === 0;
        
        // 更新网站项样式
        const websiteItem = document.querySelector(`.website-item[data-id="${id}"]`);
        if (checkbox.checked) {
            websiteItem.classList.add('selected');
        } else {
            websiteItem.classList.remove('selected');
        }
    }
    
    // 加载快捷方式
    async function loadShortcuts() {
        const result = await chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]);
        const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
        currentPage = 1; // 重载后总是显示第一页
        
        // 计算每页显示的图标数量，确保不会出现空行
        const settings = await getSettings();
        const userRows = parseInt(settings.rows) || 3;
        const userColumns = parseInt(settings.columns) || 6;
        const maxItemsPerPage = userRows * userColumns;
        
        // 计算第一页实际需要的行数
        const firstPageItemCount = Math.min(shortcuts.length, maxItemsPerPage);
        const actualRowsNeeded = Math.ceil(firstPageItemCount / userColumns);
        
        // 取用户设置行数和实际需要行数的最小值
        const effectiveRows = Math.min(userRows, actualRowsNeeded);
        
        // 重新计算每页项目数
        itemsPerPage = effectiveRows * userColumns;
        totalPages = Math.ceil(shortcuts.length / itemsPerPage);
        
        await renderShortcuts(shortcuts);
    }
    


// 保存快捷方式（全局函数）
async function saveShortcuts(shortcuts) {
    await chrome.storage.local.set({
        [STORAGE_KEYS.SHORTCUTS]: shortcuts
    });
    console.log('快捷方式已保存');
}



// 编辑快捷方式（全局函数）
function editShortcut(index) {
    const shortcutModal = document.getElementById('add-shortcut-modal');
    const shortcutForm = document.getElementById('shortcut-form');
    
    chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS], function(result) {
        const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
        const shortcut = shortcuts[index];
        
        if (shortcut) {
            // 重置所有状态
            resetBrowserDataState();
            
            // 填充表单
            document.getElementById('shortcut-name').value = shortcut.name;
            document.getElementById('shortcut-url').value = shortcut.url;
            document.getElementById('shortcut-icon-type').value = shortcut.iconType || 'auto';
            document.getElementById('shortcut-custom-color').value = shortcut.customColor || '#6366f1';
            document.getElementById('shortcut-icon').value = shortcut.icon || '';
            
            // 显示自定义图标组
            if (shortcut.iconType === 'custom') {
                document.getElementById('custom-icon-group').style.display = 'block';
                document.getElementById('solid-color-group').style.display = 'none';
            } else {
                document.getElementById('custom-icon-group').style.display = 'none';
                document.getElementById('solid-color-group').style.display = 'block';
            }
            
            // 修改表单标题和按钮
            shortcutModal.querySelector('h3').textContent = '编辑快捷方式';
            shortcutForm.querySelector('button[type="submit"]').textContent = '保存';
            
            // 存储正在编辑的索引
            shortcutForm.dataset.editingIndex = index;
            
            // 记录编辑状态
            editingIndex = index;
            isEditMode = true;
            
            // 显示弹窗
            shortcutModal.classList.add('show');
        }
    });
}

// 确认删除快捷方式（带二次确认）
function confirmDeleteShortcut(index, name) {
    if (confirm(`确定要删除快捷方式 "${name}" 吗？`)) {
        deleteShortcut(index);
    }
}

// 删除快捷方式（全局函数）
async function deleteShortcut(index) {
    const result = await chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]);
    const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
    shortcuts.splice(index, 1);
    await saveShortcuts(shortcuts);
    await renderShortcuts(shortcuts);
}



// 全局renderShortcuts函数
async function renderShortcuts(shortcuts, isPreview = false) {
    // 防止重入，如果正在渲染则直接返回
    if (isRenderingShortcuts) {
        return;
    }
    
    // 设置渲染状态
    isRenderingShortcuts = true;
    
    try {
        // 如果不是预览模式，更新全局快捷方式数组
        if (!isPreview) {
            allShortcuts = shortcuts;
        }
        // 在渲染前预加载所有自定义图标
        const customIconUrls = shortcuts
            .filter(shortcut => shortcut.iconType === 'custom' && shortcut.icon)
            .map(shortcut => shortcut.icon);
        
        if (customIconUrls.length > 0) {
            // 使用批量预加载提高效率
            imageCacheManager.preloadIcons(customIconUrls);
        }
        
        const shortcutsContainer = document.getElementById('shortcuts-container');
        if (!shortcutsContainer) return;
        
        // 清空现有内容
        shortcutsContainer.innerHTML = '';
        
        // 获取当前设置
        const settings = await getSettings();
        
        // 计算每页显示的图标数量，确保不会出现空行
        const userRows = parseInt(settings.rows) || 3;
        const userColumns = parseInt(settings.columns) || 6;
        const maxItemsPerPage = userRows * userColumns;
        
        // 计算第一页实际需要的行数
        const firstPageItemCount = Math.min(shortcuts.length, maxItemsPerPage);
        const actualRowsNeeded = Math.ceil(firstPageItemCount / userColumns);
        
        // 取用户设置行数和实际需要行数的最小值
        const effectiveRows = Math.min(userRows, actualRowsNeeded);
        
        // 重新计算每页项目数
        itemsPerPage = effectiveRows * userColumns;
        totalPages = Math.ceil(shortcuts.length / itemsPerPage);
        
        // 确保当前页码有效
        if (currentPage > totalPages) {
            currentPage = Math.max(1, totalPages);
        }
        
        // 创建快捷方式容器
        const shortcutsWrapper = document.createElement('div');
        shortcutsWrapper.className = 'shortcuts-wrapper';
        shortcutsWrapper.style.position = 'relative';
        shortcutsWrapper.style.width = '100%';
        shortcutsWrapper.style.display = 'flex';
        shortcutsWrapper.style.flexDirection = 'column';
        shortcutsWrapper.style.alignItems = 'center';
        
        // 创建swiper容器（用于页面滚动）
        const swiperContainer = document.createElement('div');
        swiperContainer.className = 'swiper-container';
        swiperContainer.style.position = 'relative';
        swiperContainer.style.width = '100%';
        swiperContainer.style.overflow = 'hidden';
        swiperContainer.style.height = 'auto';
        swiperContainer.style.boxSizing = 'border-box';
        
        // 创建swiper滑块容器
        const swiperWrapper = document.createElement('div');
        swiperWrapper.className = 'swiper-wrapper';
        swiperWrapper.style.display = 'flex';
        swiperWrapper.style.transition = 'transform 0.5s ease';
        swiperWrapper.style.transform = `translateX(${(currentPage - 1) * -100}%)`;
        swiperWrapper.style.width = '100%';
        swiperWrapper.style.height = '100%';
        swiperWrapper.style.flexWrap = 'nowrap'; // 禁止换行，确保幻灯片在同一行
        swiperWrapper.style.boxSizing = 'border-box';
        
        // 渲染所有页面
        for (let page = 1; page <= totalPages; page++) {
            // 创建页面元素
            const pageElement = document.createElement('div');
            pageElement.className = 'swiper-slide';
            pageElement.style.flex = '0 0 100%'; // 固定宽度，不增长不收缩
            pageElement.style.width = '100%';
            pageElement.style.height = '100%';
            pageElement.style.display = 'flex';
            pageElement.style.justifyContent = 'center';
            pageElement.style.alignItems = 'flex-start';
            pageElement.style.overflow = 'hidden'; // 防止内容溢出
            pageElement.style.boxSizing = 'border-box';
            pageElement.style.flexShrink = '0'; // 确保不被压缩
            pageElement.style.minWidth = '100%'; // 确保最小宽度为100%，防止重叠
            
            // 创建快捷方式网格
            const shortcutsGrid = document.createElement('div');
            shortcutsGrid.className = 'shortcuts-grid';
            shortcutsGrid.dataset.page = page;
            
            // 立即应用布局设置
            if (settings.columns) {
                shortcutsGrid.style.gridTemplateColumns = `repeat(${settings.columns}, auto)`;
            }
            if (settings.columnGap) {
                shortcutsGrid.style.columnGap = settings.columnGap;
            }
            if (settings.rowGap) {
                shortcutsGrid.style.rowGap = settings.rowGap;
            }
            
            // 添加拖拽排序功能
            shortcutsGrid.draggable = false;
            
            // 计算当前页显示的快捷方式
            const startIndex = (page - 1) * itemsPerPage;
            const endIndex = startIndex + itemsPerPage;
            const currentPageShortcuts = shortcuts.slice(startIndex, endIndex);
            
            // 渲染当前页的快捷方式
            for (const [pageIndex, shortcut] of currentPageShortcuts.entries()) {
                const globalIndex = startIndex + pageIndex;
                const shortcutItem = document.createElement('a');
                shortcutItem.className = 'shortcut-item' + (isEditMode ? ' edit-mode' : '');
                shortcutItem.title = `${shortcut.name}\n${shortcut.url}`;
                shortcutItem.dataset.index = globalIndex;
                shortcutItem.dataset.pageIndex = pageIndex;
                shortcutItem.href = shortcut.url;
                
                // 添加拖拽属性
                shortcutItem.draggable = true; // 始终可拖拽
                shortcutItem.addEventListener('dragstart', handleDragStart);
                shortcutItem.addEventListener('dragover', handleDragOver);
                shortcutItem.addEventListener('dragleave', handleDragLeave);
                shortcutItem.addEventListener('drop', handleDrop);
                shortcutItem.addEventListener('dragend', handleDragEnd);
                
                // 创建图标
                const icon = document.createElement('div');
                icon.className = 'shortcut-icon';
                
                // 根据图标类型处理
                if (shortcut.iconType === 'custom' && shortcut.icon) {
                    // 自定义图标
                    const img = document.createElement('img');
                    
                    // 优先使用同步缓存获取，减少异步请求阻塞
                    const cachedIcon = await imageCacheManager.getCachedImage(shortcut.icon, false);
                    if (cachedIcon) {
                        img.src = cachedIcon;
                    } else {
                        // 异步缓存未命中的图标，不阻塞渲染流程
                        img.src = shortcut.icon;
                        // 在后台缓存图片
                        imageCacheManager.cacheImage(shortcut.icon, false).catch(err => {
                            console.warn(`后台缓存图标失败: ${shortcut.icon}`, err);
                        });
                    }
                    
                    img.alt = shortcut.name;
                    img.onerror = function() {
                        // 图标加载失败时显示名称首字
                        this.style.display = 'none';
                        icon.innerHTML = getNameInitial(shortcut.name);
                        icon.classList.add('default-icon');
                        
                        // 应用纯色模式下的文字缩放
                        const settings = window.cachedSettings || getSettingsSync();
                        if (settings.iconSize) {
                            const iconSizeValue = parseInt(settings.iconSize.replace('px', ''));
                            const textSize = Math.max(12, Math.min(60, iconSizeValue * 0.4));
                            icon.style.fontSize = textSize + 'px';
                        }
                    };
                    icon.appendChild(img);
                } else {
                    // 纯色图标（默认）- 显示名称首字
                    icon.innerHTML = getNameInitial(shortcut.name);
                    icon.classList.add('default-icon');
                
                    // 使用自定义颜色或根据名称生成颜色
                    const color = shortcut.customColor || generateNameColor(shortcut.name);
                    icon.style.backgroundColor = color;
                }
                
                // 创建名称
                const name = document.createElement('div');
                name.className = 'shortcut-name';
                name.textContent = shortcut.name;
                
                // 创建遮罩层（仅在编辑模式下显示）
                const overlay = document.createElement('div');
                overlay.className = 'shortcut-overlay';
                
                // 创建新的编辑按钮（在遮罩层上方居中显示）
                const editButton = document.createElement('button');
                editButton.className = 'shortcut-edit-button';
                editButton.innerHTML = '✏️';
                editButton.title = '编辑快捷方式';
                
                // 创建删除图标（仅在编辑模式下显示）
                const deleteIcon = document.createElement('button');
                deleteIcon.className = 'shortcut-delete-icon';
                deleteIcon.innerHTML = '❌';
                deleteIcon.title = '删除快捷方式';
                
                // 组合元素
                shortcutItem.appendChild(icon);
                shortcutItem.appendChild(name);
                shortcutItem.appendChild(overlay);
                shortcutItem.appendChild(editButton);
                shortcutItem.appendChild(deleteIcon);
                
                // 添加鼠标事件监听器，控制overlay和edit-button的显示/隐藏
                // 预览模式下不添加鼠标事件，避免闪烁
                if (isEditMode && !isPreview) {
                    shortcutItem.addEventListener('mouseenter', () => {
                        // 拖拽过程中不显示overlay和edit-button
                        if (!isDragging) {
                            overlay.style.display = 'block';
                            editButton.style.display = 'flex';
                        }
                    });
                    
                    shortcutItem.addEventListener('mouseleave', () => {
                        overlay.style.display = 'none';
                        editButton.style.display = 'none';
                    });
                }
                
                // 应用图标和字体设置
                // 应用图标设置
                if (settings.hideIconNames) {
                    name.style.display = 'none';
                }
                
                if (settings.iconShadow) {
                    shortcutItem.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
                } else {
                    shortcutItem.style.boxShadow = 'none';
                }
                
                if (settings.iconBorderRadius) {
                    icon.style.borderRadius = settings.iconBorderRadius;
                }
                
                if (settings.iconOpacity) {
                    icon.style.opacity = settings.iconOpacity;
                }
                
                if (settings.iconSize) {
                    shortcutItem.style.width = settings.iconSize;
                    // 保持正方形比例，不需要设置height，因为有aspect-ratio: 1
                    
                    // 纯色模式下，图标文字随快捷方式大小变化
                    if (shortcut.iconType !== 'custom' || !shortcut.icon) {
                        const iconSizeValue = parseInt(settings.iconSize.replace('px', ''));
                        // 根据图标大小计算合适的文字大小（约为图标大小的40%）
                        const textSize = Math.max(12, Math.min(48, iconSizeValue * 0.4));
                        icon.style.fontSize = textSize + 'px';
                    }
                }
                
                // 应用字体设置
                if (settings.fontShadow) {
                    name.style.textShadow = '3px 3px 6px rgba(0, 0, 0, 0.8)';
                }
                
                if (settings.fontSize) {
                    name.style.fontSize = settings.fontSize;
                }
                
                if (settings.fontColor) {
                    name.style.color = settings.fontColor;
                }
                
                // 点击打开网站（仅在非编辑模式下）
            if (!isEditMode) {
                // 长按检测相关变量 - 移到循环内部确保每个快捷方式都有独立的计时器
                let longPressTimer;
                let startTime;
                let startX;
                let startY;
                const LONG_PRESS_DURATION = 500; // 长按时间阈值（毫秒）
                const MOVE_THRESHOLD = 10; // 允许的最大移动阈值（像素）
                
                shortcutItem.addEventListener('click', async (e) => {
                    e.preventDefault();
                    const settings = await getSettings();
                    const target = settings.openWebsitesInNewTab !== false ? '_blank' : '_self';
                    window.open(shortcut.url, target);
                });
                
                // 长按事件监听
                shortcutItem.addEventListener('mousedown', (e) => {
                    // 记录起始时间和位置
                    startTime = Date.now();
                    startX = e.clientX;
                    startY = e.clientY;
                    
                    // 清除之前的计时器
                    clearTimeout(longPressTimer);
                    
                    // 设置新的计时器
                    longPressTimer = setTimeout(async () => {
                        // 检查是否正在拖拽，如果是则不触发长按
                        if (isDragging) {
                            return;
                        }
                        
                        // 进入编辑模式
                        isEditMode = true;
                        const editShortcutsBtn = document.getElementById('edit-shortcuts');
                        if (editShortcutsBtn) {
                            editShortcutsBtn.textContent = '完成编辑';
                        }
                        
                        // 重新渲染快捷方式以应用编辑模式
                        const result = await chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]);
                        const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
                        await renderShortcuts(shortcuts);
                        
                        // 添加全局点击监听器
                        setTimeout(() => {
                            document.addEventListener('click', handleGlobalClickInEditMode);
                        }, 0);
                    }, LONG_PRESS_DURATION);
                });
                
                // 鼠标抬起或离开时清除计时器
                shortcutItem.addEventListener('mouseup', () => {
                    clearTimeout(longPressTimer);
                });
                
                shortcutItem.addEventListener('mouseleave', () => {
                    clearTimeout(longPressTimer);
                });
                
                // 重新添加mousemove事件监听器，但只有在移动超过阈值时才取消长按
                shortcutItem.addEventListener('mousemove', (e) => {
                    if (startX !== undefined && startY !== undefined) {
                        const dx = Math.abs(e.clientX - startX);
                        const dy = Math.abs(e.clientY - startY);
                        
                        // 只有当移动超过阈值时才取消长按
                        if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
                            clearTimeout(longPressTimer);
                        }
                    }
                });
            } 
            else {
                // 编辑模式下点击快捷方式项将弹出编辑框
                shortcutItem.addEventListener('click', async (e) => {
                    // 如果点击的是删除按钮，不触发快捷方式项的点击事件
                    if (e.target.closest('.shortcut-delete-icon')) {
                        return;
                    }
                    
                    e.preventDefault();
                    e.stopPropagation();
                    // 弹出编辑框
                    editShortcut(globalIndex);
                });
            }
                
                // 新的编辑按钮点击事件
                editButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    editShortcut(globalIndex);
                });
                
                // 删除图标点击事件（带确认）
                deleteIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    confirmDeleteShortcut(globalIndex, shortcut.name);
                });
                
                shortcutsGrid.appendChild(shortcutItem);
            }
            
            // 添加占位符，确保每页布局一致
            if (currentPageShortcuts.length < itemsPerPage) {
                const placeholderCount = itemsPerPage - currentPageShortcuts.length;
                for (let i = 0; i < placeholderCount; i++) {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'shortcut-placeholder';
                    placeholder.style.width = settings.iconSize || '50px';
                    placeholder.style.height = 'auto';
                    placeholder.style.aspectRatio = '1';
                    shortcutsGrid.appendChild(placeholder);
                }
            }
            
            // 将网格添加到页面
            pageElement.appendChild(shortcutsGrid);
            
            // 将页面添加到滑块容器
            swiperWrapper.appendChild(pageElement);
        }
        
        // 将滑块容器添加到swiper容器
        swiperContainer.appendChild(swiperWrapper);
        
        // 将swiper容器添加到快捷方式包装器
        shortcutsWrapper.appendChild(swiperContainer);
        
        // 添加分页导航
        if (totalPages > 1) {
            const pagination = createPagination();
            shortcutsWrapper.appendChild(pagination);
        }
        
        // 将快捷方式包装器添加到容器
        shortcutsContainer.appendChild(shortcutsWrapper);
        
        // 添加滚轮事件监听，实现翻页
        document.addEventListener('wheel', handleWheelNavigation);
        
        // 保存swiper元素到全局，方便后续操作
        window.swiperWrapper = swiperWrapper;
        

    } finally {
        // 无论成功失败，都重置渲染状态
        isRenderingShortcuts = false;
        
        // 应用缩放以确保shortcuts-grid不会超出页面宽度
        applyShortcutsGridScaling();
    }
}

// 创建分页导航
function createPagination() {
    const pagination = document.createElement('div');
    pagination.className = 'pagination';
    
    // 只在有多页时显示分页控件
    if (totalPages <= 1) {
        return pagination;
    }
    
    // 创建页码点
    for (let i = 1; i <= totalPages; i++) {
        const pageButton = document.createElement('button');
        pageButton.className = `pagination-btn ${i === currentPage ? 'active' : ''}`;
        pageButton.title = `第 ${i} 页`;
        pageButton.addEventListener('click', () => changePage(i));
        pagination.appendChild(pageButton);
    }
    
    return pagination;
}

// 切换页面
async function changePage(page) {
    if (page < 1 || page > totalPages) return;
    
    currentPage = page;
    
    // 使用swiper平滑滚动切换页面
    if (window.swiperWrapper) {
        window.swiperWrapper.style.transform = `translateX(${(currentPage - 1) * -100}%)`;
    }
    
    // 更新分页按钮状态
    updatePaginationButtons();
}

// 更新分页按钮状态
function updatePaginationButtons() {
    const paginationBtns = document.querySelectorAll('.pagination-btn');
    paginationBtns.forEach((btn, index) => {
        const page = index + 1;
        if (page === currentPage) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// 应用shortcuts-grid缩放以确保不会超出页面宽度
function applyShortcutsGridScaling() {
    const shortcutsGrids = document.querySelectorAll('.shortcuts-grid');
    if (shortcutsGrids.length === 0) return;
    
    // 获取第一个shortcuts-grid作为参考
    const firstGrid = shortcutsGrids[0];
    
    // 获取页面宽度（考虑padding和margin）
    const pageWidth = window.innerWidth;
    
    // 获取shortcuts-container的宽度
    const shortcutsContainer = document.getElementById('shortcuts-container');
    if (!shortcutsContainer) return;
    
    const containerWidth = shortcutsContainer.clientWidth;
    
    // 获取第一个shortcuts-grid的实际宽度
    const gridWidth = firstGrid.scrollWidth;
    
    // 计算缩放比例，确保grid不会超出容器
    // 添加一些边距（20px）以确保不会紧贴边缘
    const availableWidth = containerWidth - 40;
    let scale = 1;
    
    if (gridWidth > availableWidth) {
        scale = availableWidth / gridWidth;
        // 限制最小缩放比例，避免过小
        scale = Math.max(scale, 0.5);
    }
    
    // 应用缩放到所有shortcuts-grid
    shortcutsGrids.forEach(grid => {
        // 保存原始transform
        const originalTransform = grid.style.transform;
        
        // 应用缩放，保持原有的transform
        if (originalTransform && !originalTransform.includes('scale')) {
            grid.style.transform = `${originalTransform} scale(${scale})`;
        } else {
            grid.style.transform = `scale(${scale})`;
        }
        
        // 调整transform-origin以确保从中心缩放
        grid.style.transformOrigin = 'center center';
        
        // 由于缩放可能导致下方出现空白，需要调整margin
        if (scale < 1) {
            const scaleDifference = 1 - scale;
            const marginBottom = scaleDifference * grid.offsetHeight / 2;
            grid.style.marginBottom = `${marginBottom}px`;
        } else {
            grid.style.marginBottom = '';
        }
    });
}

// 添加窗口大小变化监听器，以便重新计算shortcuts-grid缩放
window.addEventListener('resize', () => {
    // 使用防抖来避免频繁调用
    clearTimeout(window.resizeTimeout);
    window.resizeTimeout = setTimeout(() => {
        applyShortcutsGridScaling();
    }, 200);
});

// 处理滚轮导航
async function handleWheelNavigation(e) {
    // 检查是否有弹窗或设置面板打开
    const settingsPanel = document.getElementById('settings-panel');
    const addShortcutModal = document.getElementById('add-shortcut-modal');
    const manageEnginesModal = document.getElementById('manage-engines-modal');
    
    const isSettingsOpen = settingsPanel?.classList.contains('open');
    const isAddShortcutModalOpen = addShortcutModal?.classList.contains('show');
    const isManageEnginesModalOpen = manageEnginesModal?.classList.contains('show');
    
    // 如果有弹窗或设置面板打开，不执行翻页
    if (isSettingsOpen || isAddShortcutModalOpen || isManageEnginesModalOpen) {
        return;
    }
    
    if (totalPages <= 1) return;
    
    // 检测水平滚动（使用deltaX），如果没有水平滚动则使用deltaY（上下滚动转为左右滚动）
    let deltaX = e.deltaX;
    
    // 如果是上下滚动，将其转换为左右滚动
    if (Math.abs(deltaX) < Math.abs(e.deltaY)) {
        deltaX = e.deltaY;
    }
    
    if (deltaX > 0 && currentPage < totalPages) {
        // 向右滚动或向下滚动，下一页
        await changePage(currentPage + 1);
    } else if (deltaX < 0 && currentPage > 1) {
        // 向左滚动或向上滚动，上一页
        await changePage(currentPage - 1);
    }
}

// 拖拽排序相关变量
let draggedItem = null;
let draggedFromIndex = null;
let draggedFromPage = null;
let draggedShortcutUrl = null; // 存储拖拽的快捷方式URL，用于非编辑模式
let isDragging = false;
let isChangingPage = false; // 标记是否正在执行翻页操作
let previewShortcuts = []; // 预览状态的快捷方式数组
let isPreviewing = false; // 是否正在预览
let lastDropTarget = null; // 上一次的放置目标

// 处理拖拽开始
function handleDragStart(e) {
    // 设置拖拽状态标志
    isDragging = true;
    isPreviewing = true;
    lastDropTarget = null;
    
    draggedItem = this;
    draggedFromIndex = parseInt(this.dataset.index);
    draggedFromPage = currentPage;
    
    // 初始化预览状态
    previewShortcuts = [...allShortcuts];
    
    // 存储快捷方式URL，用于非编辑模式下的拖拽
    draggedShortcutUrl = this.href;
    
    if (isEditMode) {
        // 编辑模式下的拖拽处理
        // 清除所有元素的hover状态影响，避免页面切换时状态残留
        const allShortcutItems = document.querySelectorAll('.shortcut-item');
        allShortcutItems.forEach(item => {
            // 移除可能的hover状态影响
            const overlay = item.querySelector('.shortcut-overlay');
            const editButton = item.querySelector('.shortcut-edit-button');
            if (overlay) overlay.style.display = 'none';
            if (editButton) editButton.style.display = 'none';
        });
        
        // 设置拖拽数据
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedFromIndex.toString());
        
        // 添加拖拽样式
        this.style.opacity = '0.5';
        this.style.zIndex = '1000';
        
        // 创建拖拽预览
        const dragPreview = this.cloneNode(true);
        dragPreview.style.position = 'fixed';
        dragPreview.style.pointerEvents = 'none';
        dragPreview.style.opacity = '0.8';
        dragPreview.style.zIndex = '9999';
        
        // 设置初始位置为鼠标位置
        const rect = this.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;
        dragPreview.style.left = (e.clientX - offsetX) + 'px';
        dragPreview.style.top = (e.clientY - offsetY) + 'px';
        
        document.body.appendChild(dragPreview);
        
        e.dataTransfer.setDragImage(dragPreview, offsetX, offsetY);
        
        // 移除临时预览
        setTimeout(() => {
            document.body.removeChild(dragPreview);
        }, 0);
        
        // 创建边缘高亮元素
        createEdgeHighlights();
        
        // 添加全局拖拽经过事件监听，用于边缘翻页
        document.addEventListener('dragover', handleDragOverGlobal);
    } else {
        // 非编辑模式下的拖拽处理
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', draggedShortcutUrl);
        
        // 添加拖拽样式
        this.style.opacity = '0.5';
        this.style.zIndex = '1000';
        
        // 添加全局拖拽事件监听，用于检测拖拽到非快捷方式区域
        document.addEventListener('dragover', handleDragOverGlobalNonEditMode);
        document.addEventListener('drop', handleDropGlobalNonEditMode);
    }
}

// 创建边缘高亮元素
function createEdgeHighlights() {
    // 创建左侧边缘高亮
    const leftHighlight = document.createElement('div');
    leftHighlight.id = 'left-edge-highlight';
    leftHighlight.style.position = 'fixed';
    leftHighlight.style.width = '120px';
    leftHighlight.style.height = '40px';
    leftHighlight.style.background = 'rgba(102, 126, 234, 0.9)';
    leftHighlight.style.border = '2px solid rgba(255, 255, 255, 0.8)';
    leftHighlight.style.borderRadius = '20px';
    leftHighlight.style.zIndex = '9998';
    leftHighlight.style.pointerEvents = 'none';
    leftHighlight.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    leftHighlight.style.opacity = '0';
    leftHighlight.style.display = 'flex';
    leftHighlight.style.alignItems = 'center';
    leftHighlight.style.justifyContent = 'center';
    leftHighlight.style.fontSize = '14px';
    leftHighlight.style.fontWeight = 'bold';
    leftHighlight.style.color = 'white';
    leftHighlight.style.textShadow = '0 1px 3px rgba(0,0,0,0.5)';
    leftHighlight.style.whiteSpace = 'nowrap';
    leftHighlight.innerHTML = '← 上一页';
    leftHighlight.style.transform = 'translateY(-50%)';
    document.body.appendChild(leftHighlight);
    
    // 创建右侧边缘高亮
    const rightHighlight = document.createElement('div');
    rightHighlight.id = 'right-edge-highlight';
    rightHighlight.style.position = 'fixed';
    rightHighlight.style.width = '120px';
    rightHighlight.style.height = '40px';
    rightHighlight.style.background = 'rgba(102, 126, 234, 0.9)';
    rightHighlight.style.border = '2px solid rgba(255, 255, 255, 0.8)';
    rightHighlight.style.borderRadius = '20px';
    rightHighlight.style.zIndex = '9998';
    rightHighlight.style.pointerEvents = 'none';
    rightHighlight.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    rightHighlight.style.opacity = '0';
    rightHighlight.style.display = 'flex';
    rightHighlight.style.alignItems = 'center';
    rightHighlight.style.justifyContent = 'center';
    rightHighlight.style.fontSize = '14px';
    rightHighlight.style.fontWeight = 'bold';
    rightHighlight.style.color = 'white';
    rightHighlight.style.textShadow = '0 1px 3px rgba(0,0,0,0.5)';
    rightHighlight.style.whiteSpace = 'nowrap';
    rightHighlight.innerHTML = '下一页 →';
    rightHighlight.style.transform = 'translateY(-50%)';
    document.body.appendChild(rightHighlight);
}

// 处理拖拽经过
function handleDragOver(e) {
    if (!draggedItem || !isPreviewing) return;
    
    e.preventDefault();
    
    if (isEditMode) {
        // 编辑模式下的拖拽处理
        e.dataTransfer.dropEffect = 'move';
        
        // 获取当前放置目标
        const dropTarget = this;
        const dropIndex = parseInt(dropTarget.dataset.index);
        
        // 如果目标与上一次不同，更新预览
        if (dropTarget !== lastDropTarget && dropIndex !== draggedFromIndex) {
            lastDropTarget = dropTarget;
            
            // 计算新的预览顺序
            const newPreviewShortcuts = [...previewShortcuts];
            const [draggedShortcut] = newPreviewShortcuts.splice(draggedFromIndex, 1);
            newPreviewShortcuts.splice(dropIndex, 0, draggedShortcut);
            
            // 更新预览数组
            previewShortcuts = newPreviewShortcuts;
            
            // 直接插入 DOM 元素到目标位置，避免重新渲染导致的闪烁
            insertDOMElement(draggedItem, dropTarget);
            
            // 更新所有元素的索引
            updateAllElementIndexes();
            
            // 更新拖拽元素的索引引用
            draggedFromIndex = dropIndex;
        }
        
        // 添加拖拽经过样式
        if (this !== draggedItem) {
            this.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
        }
    } else {
        // 非编辑模式下的拖拽处理
        e.dataTransfer.dropEffect = 'copy';
    }
}

// 将拖拽元素插入到目标位置
function insertDOMElement(draggedElement, targetElement) {
    if (draggedElement === targetElement) return;
    
    const parent1 = draggedElement.parentNode;
    const parent2 = targetElement.parentNode;
    
    if (parent1 !== parent2) {
        // 跨页面拖拽：将元素移动到目标页面的目标位置
        parent2.insertBefore(draggedElement, targetElement);
    } else {
        // 同页面拖拽：将元素插入到目标位置
        parent1.insertBefore(draggedElement, targetElement);
    }
}

// 更新所有元素的索引
function updateAllElementIndexes() {
    const allItems = document.querySelectorAll('.shortcut-item');
    allItems.forEach((item, index) => {
        item.dataset.index = index;
    });
}

// 处理拖拽离开
function handleDragLeave(e) {
    if (!draggedItem) return;
    
    if (isEditMode) {
        // 编辑模式下的拖拽处理
        // 清除拖拽经过样式
        this.style.backgroundColor = '';
    }
    // 非编辑模式下不需要特殊处理
}

// 处理拖拽结束
function handleDragEnd(e) {
    // 清除拖拽状态标志
    isDragging = false;
    isPreviewing = false;
    
    // 如果有预览更改，保存最终结果
    if (previewShortcuts.length > 0) {
        // 保存预览结果到存储
        saveShortcuts(previewShortcuts);
        // 更新全局快捷方式数组
        allShortcuts = [...previewShortcuts];
        // 清空预览数组
        previewShortcuts = [];
    }
    
    // 移除拖拽样式
    if (draggedItem) {
        draggedItem.style.opacity = '';
        draggedItem.style.transform = '';
        draggedItem.style.zIndex = '';
    }
    
    if (isEditMode) {
        // 编辑模式下的拖拽处理
        // 移除所有拖拽经过样式和hover状态影响
        const allItems = document.querySelectorAll('.shortcut-item');
        allItems.forEach(item => {
            item.style.backgroundColor = '';
            // 清除hover状态影响
            const overlay = item.querySelector('.shortcut-overlay');
            const editButton = item.querySelector('.shortcut-edit-button');
            if (overlay) overlay.style.display = 'none';
            if (editButton) editButton.style.display = 'none';
        });
        
        // 移除边缘高亮元素
        removeEdgeHighlights();
        
        // 移除自动翻页相关
        clearInterval(window.autoPageTimer);
        document.removeEventListener('dragover', handleDragOverGlobal);
    } else {
        // 非编辑模式下的拖拽处理
        // 移除全局拖拽事件监听
        document.removeEventListener('dragover', handleDragOverGlobalNonEditMode);
        document.removeEventListener('drop', handleDropGlobalNonEditMode);
    }
    
    // 重置拖拽变量
    draggedItem = null;
    draggedFromIndex = null;
    draggedFromPage = null;
    draggedShortcutUrl = null;
}

// 移除边缘高亮元素
function removeEdgeHighlights() {
    const leftHighlight = document.getElementById('left-edge-highlight');
    const rightHighlight = document.getElementById('right-edge-highlight');
    
    if (leftHighlight) {
        leftHighlight.remove();
    }
    if (rightHighlight) {
        rightHighlight.remove();
    }
}

// 全局拖拽经过事件，用于处理边缘翻页
function handleDragOverGlobal(e) {
    if (!isEditMode || !draggedItem) return;
    
    // 获取当前页的所有shortcut-item
    const currentPageShortcuts = document.querySelectorAll(`.swiper-slide:nth-child(${currentPage}) .shortcut-item`);
    if (currentPageShortcuts.length === 0) return;
    
    // 获取最左侧和最右侧的shortcut-item
    const leftmostItem = currentPageShortcuts[0];
    const rightmostItem = currentPageShortcuts[currentPageShortcuts.length - 1];
    
    // 获取鼠标位置
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    
    // 获取边缘高亮元素
    const leftHighlight = document.getElementById('left-edge-highlight');
    const rightHighlight = document.getElementById('right-edge-highlight');
    
    // 获取最边缘item的位置和尺寸
    const leftItemRect = leftmostItem.getBoundingClientRect();
    const rightItemRect = rightmostItem.getBoundingClientRect();
    
    // 检测鼠标是否在任何快捷方式元素上
    const elementUnderMouse = document.elementFromPoint(mouseX, mouseY);
    const isOverShortcut = elementUnderMouse && elementUnderMouse.closest('.shortcut-item');
    
    // 如果鼠标在某个快捷方式元素上，不触发翻页
    if (isOverShortcut) {
        // 隐藏边缘高亮
        if (leftHighlight) leftHighlight.style.opacity = '0';
        if (rightHighlight) rightHighlight.style.opacity = '0';
        // 清除计时器
        if (window.autoPageTimer) {
            clearTimeout(window.autoPageTimer);
            window.autoPageTimer = null;
        }
        return;
    }
    
    // 检测鼠标是否在最左侧shortcut-item的左侧，接近页面左边缘
    const isNearLeftEdge = mouseX <= leftItemRect.left;
    // 检测鼠标是否在最右侧shortcut-item的右侧，接近页面右边缘
    const isNearRightEdge = mouseX >= rightItemRect.right;
    
    // 如果正在翻页，隐藏边缘高亮
    if (isChangingPage) {
        if (leftHighlight) {
            leftHighlight.style.opacity = '0';
        }
        if (rightHighlight) {
            rightHighlight.style.opacity = '0';
        }
        return;
    }
    
    // 检查是否接近左侧边缘（上一页）
    if (isNearLeftEdge && currentPage > 1) {
        // 显示左侧边缘高亮，定位到最左侧item的左侧
        if (leftHighlight) {
            leftHighlight.style.opacity = '1';
            // 显示在最左侧item的左侧，水平居中
            leftHighlight.style.left = `${leftItemRect.left - 130}px`;
            leftHighlight.style.top = `${leftItemRect.top + leftItemRect.height / 2}px`;
            // 恢复默认尺寸
            leftHighlight.style.width = '120px';
            leftHighlight.style.height = '40px';
        }
        
        // 只有当没有活跃的计时器时，才设置新的计时器
        if (!window.autoPageTimer) {
            window.autoPageTimer = setTimeout(async () => {
                isChangingPage = true; // 设置翻页状态为正在进行
                await changePage(currentPage - 1);
                // 执行后清除计时器引用
                window.autoPageTimer = null;
                // 翻页完成，重置翻页状态
                setTimeout(() => {
                    isChangingPage = false;
                }, 300);
            }, 800);
        }
    }
    // 检查是否接近右侧边缘（下一页）
    else if (isNearRightEdge && currentPage < totalPages) {
        // 显示右侧边缘高亮，定位到最右侧item的右侧
        if (rightHighlight) {
            rightHighlight.style.opacity = '1';
            // 显示在最右侧item的右侧，水平居中
            rightHighlight.style.left = `${rightItemRect.right + 10}px`;
            rightHighlight.style.top = `${rightItemRect.top + rightItemRect.height / 2}px`;
            // 恢复默认尺寸
            rightHighlight.style.width = '120px';
            rightHighlight.style.height = '40px';
        }
        
        // 只有当没有活跃的计时器时，才设置新的计时器
        if (!window.autoPageTimer) {
            window.autoPageTimer = setTimeout(async () => {
                isChangingPage = true; // 设置翻页状态为正在进行
                await changePage(currentPage + 1);
                // 执行后清除计时器引用
                window.autoPageTimer = null;
                // 翻页完成，重置翻页状态
                setTimeout(() => {
                    isChangingPage = false;
                }, 300);
            }, 800);
        }
    }
    // 不在边缘，清除计时器和高亮
    else {
        // 隐藏边缘高亮
        if (leftHighlight) {
            leftHighlight.style.opacity = '0';
        }
        if (rightHighlight) {
            rightHighlight.style.opacity = '0';
        }
        
        // 清除计时器
        if (window.autoPageTimer) {
            clearTimeout(window.autoPageTimer);
            window.autoPageTimer = null;
        }
    }
}

// 处理拖拽放置
async function handleDrop(e) {
    if (!isEditMode || !draggedItem) return;
    
    e.preventDefault();
    
    const dropTarget = this;
    const dropIndex = parseInt(dropTarget.dataset.index);
    
    // 如果拖拽到自身，不做任何操作
    if (draggedFromIndex === dropIndex) {
        return;
    }
    
    // 预览已经在dragover时完成，这里只需要确保最终状态正确
    // 预览结果会在dragend时保存
}

// 非编辑模式下的全局拖拽经过处理函数
function handleDragOverGlobalNonEditMode(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
}

// 非编辑模式下的全局拖拽放置处理函数
function handleDropGlobalNonEditMode(e) {
    e.preventDefault();
    
    // 检查是否拖拽到非快捷方式区域
    const dropTarget = e.target;
    const isShortcutArea = dropTarget.closest('.shortcut-item') || 
                         dropTarget.closest('.shortcuts-grid') || 
                         dropTarget.closest('#shortcuts-container');
    
    // 如果不是拖拽到快捷方式区域，则在新标签中打开URL
    if (!isShortcutArea && draggedShortcutUrl) {
        window.open(draggedShortcutUrl, '_blank');
    }
}

// 将renderShortcuts函数添加到window对象，确保全局可访问
window.renderShortcuts = renderShortcuts;    
    
    // 添加快捷方式
    async function addShortcut(shortcut) {
        const result = await chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]);
        const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
        shortcuts.push(shortcut);
        await saveShortcuts(shortcuts);
        await renderShortcuts(shortcuts);
    }
    
    // 打开添加快捷方式弹窗
    addShortcutBtn.addEventListener('click', function() {
        // 重置所有状态
        resetBrowserDataState();
        
        // 重置表单
        shortcutForm.reset();
        shortcutModal.querySelector('h3').textContent = '添加常用网站';
        shortcutForm.querySelector('button[type="submit"]').textContent = '添加';
        document.getElementById('custom-icon-group').style.display = 'none';
        document.getElementById('solid-color-group').style.display = 'block';
        document.getElementById('shortcut-icon-type').value = 'auto';
        
        shortcutModal.classList.add('show');
    });
    
    // 编辑模式切换
    editShortcutsBtn.addEventListener('click', async function(e) {
        // 阻止事件冒泡，避免触发全局点击处理器
        e.stopPropagation();
        
        isEditMode = !isEditMode;
        editShortcutsBtn.textContent = isEditMode ? '完成编辑' : '编辑快捷方式';
        
        // 关闭设置面板
        settingsPanel.classList.remove('open');
        
        // 重新渲染快捷方式以应用编辑模式
        const result = await chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]);
        const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
        await renderShortcuts(shortcuts);
        
        // 如果进入编辑模式，添加全局点击监听器
        if (isEditMode) {
            // 使用setTimeout确保当前点击事件完成后再添加监听器
            setTimeout(() => {
                document.addEventListener('click', handleGlobalClickInEditMode);
            }, 0);
        } else {
            document.removeEventListener('click', handleGlobalClickInEditMode);
        }
    });
    
    // 编辑模式下的全局点击处理函数
    function handleGlobalClickInEditMode(e) {
        // 如果点击的是快捷方式容器或其中的快捷方式，则不退出编辑模式
        if (e.target.closest('#shortcuts-container') || e.target.closest('.shortcuts-grid')) {
            return;
        }
        
        // 如果点击的是编辑按钮本身，也不退出编辑模式（避免重复触发）
        if (e.target.id === 'edit-shortcuts' || e.target.closest('#edit-shortcuts')) {
            return;
        }
        
        // 如果点击的是设置面板或其他弹窗，也不退出编辑模式
        if (e.target.closest('.settings-panel') || 
            e.target.closest('.modal') || 
            e.target.classList.contains('modal')) {
            return;
        }
        
        // 退出编辑模式
        isEditMode = false;
        editShortcutsBtn.textContent = '编辑快捷方式';
        
        // 重新渲染快捷方式以应用非编辑模式
        chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]).then(result => {
            const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
            renderShortcuts(shortcuts);
        });
        
        // 移除全局点击监听器
        document.removeEventListener('click', handleGlobalClickInEditMode);
    }
    
    // 数据源切换功能
    function initDataSourceSwitching() {
        dataSourceBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const source = btn.dataset.source;
                if (source !== currentDataSource) {
                    currentDataSource = source;
                    
                    // 更新按钮状态
                    dataSourceBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    
                    // 清空搜索框和选中项
                    browserDataSearch.value = '';
                    selectedItems.clear();
                    addSelectedBtn.disabled = true;
                    
                    // 加载新数据源
                    loadBrowserData();
                }
            });
        });
    }
    
    // 搜索功能
    function initSearch() {
        browserDataSearch.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            filteredBrowserItems = allBrowserItems.filter(item => 
                item.title.toLowerCase().includes(searchTerm) || 
                item.url.toLowerCase().includes(searchTerm)
            );
            renderWebsiteList(filteredBrowserItems);
        });
    }
    
    // 添加选中项功能
    async function addSelectedItems() {
        if (selectedItems.size === 0) return;
        
        if (addSelectedBtn.disabled) {
            return;
        }
        
        addSelectedBtn.disabled = true;
        addSelectedBtn.textContent = '处理中...';
        
        // 获取选中的项目
        const itemsToAdd = allBrowserItems.filter(item => selectedItems.has(item.id));
        
        if (isEditMode) {
            // 编辑模式：只取第一个选中项替换当前快捷方式
            if (itemsToAdd.length > 0 && editingIndex !== null) {
                const item = itemsToAdd[0];
                
                try {
                    // 自动获取网站favicon
                    const websiteInfo = await fetchWebsiteInfoDirectly(item.url);
                    
                    // 创建更新后的快捷方式
                    const updatedShortcut = {
                        name: item.title,
                        url: item.url,
                        iconType: websiteInfo.success && websiteInfo.data.icon ? 'custom' : 'auto',
                        icon: websiteInfo.success ? websiteInfo.data.icon || '' : '',
                        customColor: generateNameColor(item.title),
                        id: Date.now().toString(36) + Math.random().toString(36).substr(2)
                    };
                    
                    // 获取当前快捷方式列表
                    const result = await chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]);
                    const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
                    
                    // 替换当前快捷方式
                    shortcuts[editingIndex] = updatedShortcut;
                    
                    // 保存到存储
                    await saveShortcuts(shortcuts);
                    await renderShortcuts(shortcuts);
                } catch (error) {
                    console.error('更新快捷方式失败:', error);
                }
            }
        } else {
            // 添加模式：批量添加选中的项目
            for (const item of itemsToAdd) {
                try {
                    // 自动获取网站favicon
                    const websiteInfo = await fetchWebsiteInfoDirectly(item.url);
                    
                    // 创建快捷方式
                    const shortcut = {
                        name: item.title,
                        url: item.url,
                        iconType: websiteInfo.success && websiteInfo.data.icon ? 'custom' : 'auto',
                        icon: websiteInfo.success ? websiteInfo.data.icon || '' : '',
                        customColor: generateNameColor(item.title),
                        id: Date.now().toString(36) + Math.random().toString(36).substr(2)
                    };
                    
                    // 添加到存储
                    await addShortcut(shortcut);
                } catch (error) {
                    console.error('添加快捷方式失败:', error);
                }
            }
        }
        
        // 关闭弹窗并重置状态
        shortcutModal.classList.remove('show');
        resetBrowserDataState();
        
        addSelectedBtn.disabled = false;
        addSelectedBtn.textContent = '添加选中项';
    }
    
    // 重置浏览器数据状态
    function resetBrowserDataState() {
        // 重置选中项
        selectedItems.clear();
        addSelectedBtn.disabled = true;
        
        // 重置搜索框
        browserDataSearch.value = '';
        
        // 重置数据
        allBrowserItems = [];
        filteredBrowserItems = [];
        
        // 重置编辑状态
        editingIndex = null;
        isEditMode = false;
        
        // 清空可选图标
        const iconGrid = document.querySelector('#icon-select .icon-grid');
        if (iconGrid) {
            iconGrid.innerHTML = '';
        }        
        
        // 默认激活"自定义添加"标签（仅在快捷方式弹窗内）
        const customTabBtn = tabContainer.querySelector('.tab-btn[data-tab="custom"]');
        const browserDataTabBtn = tabContainer.querySelector('.tab-btn[data-tab="browser-data"]');
        const customTab = tabContainer.querySelector('#custom-tab');
        const browserDataTab = tabContainer.querySelector('#browser-data-tab');
        
        customTabBtn.classList.add('active');
        browserDataTabBtn.classList.remove('active');
        customTab.classList.add('active');
        browserDataTab.classList.remove('active');
        
        // 重置数据源选择
        dataSourceBtns.forEach(btn => btn.classList.remove('active'));
        // 默认激活"收藏夹"数据源
        dataSourceBtns.forEach(btn => {
            if (btn.dataset.source === 'bookmarks') {
                btn.classList.add('active');
            }
        });
        currentDataSource = 'bookmarks';
        
        // 重置网站列表
        const websiteList = document.getElementById('website-list');
        websiteList.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">加载中...</div>';
    }
    
    // 取消按钮事件
    const cancelBtn = document.getElementById('cancel-shortcut-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
            shortcutModal.classList.remove('show');
            shortcutForm.reset();
            document.getElementById('custom-icon-group').style.display = 'none';
            document.getElementById('solid-color-group').style.display = 'block';
            document.getElementById('shortcut-icon-type').value = 'auto';
        });
    }
    
    // 取消浏览器数据选择
    cancelBrowserDataBtn.addEventListener('click', function() {
        shortcutModal.classList.remove('show');
        resetBrowserDataState();
    });
    
    // 关闭弹窗
    closeModal.addEventListener('click', function() {
        shortcutModal.classList.remove('show');
        shortcutForm.reset();
        document.getElementById('custom-icon-group').style.display = 'none';
        document.getElementById('solid-color-group').style.display = 'block';
        document.getElementById('shortcut-icon-type').value = 'auto';
        resetBrowserDataState();
    });

    // 切换自定义图标字段显示
    iconTypeSelect.addEventListener('change', function() {
        toggleCustomIconField();
    });
    
    // 切换自定义图标字段显示的函数
    function toggleCustomIconField() {
        const iconType = document.getElementById('shortcut-icon-type').value;
        const customIconGroup = document.getElementById('custom-icon-group');
        const solidColorGroup = document.getElementById('solid-color-group');
        
        customIconGroup.style.display = iconType === 'custom' ? 'block' : 'none';
        solidColorGroup.style.display = iconType === 'auto' ? 'block' : 'none';
    }
    
    // 初始化颜色选择器功能
    function initColorPicker() {
        const colorInput = document.getElementById('shortcut-custom-color');
        const colorPreview = document.getElementById('color-preview');
        const colorValue = document.getElementById('color-value');
        const colorPresets = document.querySelectorAll('.color-preset');
        const colorWrapper = document.querySelector('.color-input-wrapper');
        
        // 更新颜色预览和值
        function updateColorPreview(color) {
            colorPreview.style.backgroundColor = color;
            colorValue.textContent = color;
            colorInput.value = color;
            
            // 更新预设颜色的激活状态
            colorPresets.forEach(preset => {
                if (preset.dataset.color === color) {
                    preset.classList.add('active');
                } else {
                    preset.classList.remove('active');
                }
            });
        }
        
        // 监听颜色输入变化
        colorInput.addEventListener('input', (e) => {
            updateColorPreview(e.target.value);
        });
        
        // 监听预设颜色点击
        colorPresets.forEach(preset => {
            preset.addEventListener('click', () => {
                const color = preset.dataset.color;
                updateColorPreview(color);
            });
        });
        
        // 点击预览区域也能打开颜色选择器
        colorPreview.addEventListener('click', () => {
            colorInput.click();
        });
        
        // 初始化时更新一次
        updateColorPreview(colorInput.value);
    }
    
    // 初始化所有功能
    function initAllFeatures() {
        initTabSwitching();
        initDataSourceSwitching();
        initSearch();
        
        // 添加选中项按钮点击事件
        addSelectedBtn.addEventListener('click', addSelectedItems);
        
        // 初始化颜色选择器功能
        initColorPicker();
    }
    
    // 调用初始化函数
    initAllFeatures();
    
    // 文件上传按钮点击事件
    uploadIconBtn.addEventListener('click', function() {
        iconFileInput.click();
    });
    
    // 文件选择事件
    iconFileInput.addEventListener('change', handleFileSelect);
    
    // 处理文件选择
    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) {
            return;
        }
        
        // 验证文件类型
        if (!file.type.startsWith('image/')) {
            showStatusMessage('请选择图片文件', 'error');
            return;
        }
        
        // 验证文件大小（限制为2MB）
        const MAX_FILE_SIZE = 2 * 1024 * 1024;
        if (file.size > MAX_FILE_SIZE) {
            showStatusMessage('图片大小不能超过2MB', 'error');
            return;
        }
        
        // 读取文件并转换为Base64
        const reader = new FileReader();
        
        reader.onload = function(e) {
            const base64String = e.target.result;
            
            const MAX_BASE64_SIZE = 5 * 1024;
            if (base64String.length > MAX_BASE64_SIZE) {
                // 如果超过限制，尝试压缩图片
                compressImage(file, MAX_BASE64_SIZE).then(compressedBase64 => {
                    if (compressedBase64.length > MAX_BASE64_SIZE) {
                        showStatusMessage('图片过大，请选择更小的图片（建议不超过4KB）', 'error');
                        return;
                    }
                    document.getElementById('shortcut-icon').value = compressedBase64;
                    showStatusMessage('图片已成功压缩并转换为Base64格式', 'success');
                }).catch(error => {
                    console.error('图片压缩失败:', error);
                    showStatusMessage('图片过大，请选择更小的图片（建议不超过4KB）', 'error');
                });
                return;
            }
            
            document.getElementById('shortcut-icon').value = base64String;
            showStatusMessage('图片已成功转换为Base64格式', 'success');
        };
        
        reader.onerror = function() {
            showStatusMessage('图片读取失败', 'error');
        };
        
        reader.readAsDataURL(file);
        
        // 重置文件输入，允许重新选择同一文件
        e.target.value = '';
    }
    
    // 压缩图片函数
    function compressImage(file, maxSize) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = function() {
                // 创建Canvas元素
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                // 计算缩放比例，保持宽高比
                const maxDimension = 128; // 最大宽度或高度
                if (width > maxDimension || height > maxDimension) {
                    const ratio = Math.min(maxDimension / width, maxDimension / height);
                    width *= ratio;
                    height *= ratio;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                // 在Canvas上绘制图像
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // 尝试不同的质量压缩
                let quality = 0.8;
                let compressedDataUrl;
                
                do {
                    compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                    quality -= 0.1;
                } while (compressedDataUrl.length > maxSize && quality > 0.1);
                
                resolve(compressedDataUrl);
            };
            
            img.onerror = function() {
                reject(new Error('图片加载失败'));
            };
            
            // 读取文件并设置为Image的src
            const reader = new FileReader();
            reader.onload = function(e) {
                img.src = e.target.result;
            };
            
            reader.onerror = function() {
                reject(new Error('文件读取失败'));
            };
            
            reader.readAsDataURL(file);
        });
    }
    
    // 显示状态消息
    function showStatusMessage(message, type = 'info') {
        const statusElement = document.getElementById('shortcut-status');
        statusElement.textContent = message;
        statusElement.className = `status-message show ${type}`;
        
        // 3秒后自动隐藏
        setTimeout(() => {
            statusElement.classList.remove('show');
        }, 3000);
    }
    
    // 加载可选图标
    async function loadOptionalIcons(currentIcon, title) {
        const iconGrid = document.querySelector('#icon-select .icon-grid');
        iconGrid.innerHTML = '';
        
        const icons = [];
        
        // 添加当前图标作为第一个选项
        if (currentIcon) {
            icons.push(currentIcon);
        }
        
        // 从App Store 上获取更多图标
        if (title) {
            // 搜索逻辑：同时调用中国区和美国区API获取图标
            let searchIcons = [];
            const searchLengths = [8, 4, 2];
            
            for (const length of searchLengths) {
                if (searchIcons.length >= 10) break;
                
                const searchQuery = title.substring(0, length);
                
                try {
                    // 并行调用中国区和美国区API
                    const [cnResponse, usResponse] = await Promise.all([
                        fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(searchQuery)}&country=cn&entity=software&limit=6`),
                        fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(searchQuery)}&country=us&entity=software&limit=6`)
                    ]);
                    
                    const [cnData, usData] = await Promise.all([
                        cnResponse.json(),
                        usResponse.json()
                    ]);
                    
                    // 提取并合并图标URL，去重处理
                    const allResults = [...(cnData.results || []), ...(usData.results || [])];
                    const uniqueIcons = new Set();
                    
                    for (const item of allResults) {
                        if (item.artworkUrl512) {
                            uniqueIcons.add(item.artworkUrl512);
                        }
                    }
                    
                    // 转换为数组并添加到搜索结果
                    searchIcons.push(...Array.from(uniqueIcons));
                    
                    if (searchIcons.length > 0) break; // 找到结果，退出循环
                } catch (error) {
                    console.error(`获取iTunes API数据失败（${length}字符）:`, error);
                }
            }
            
            // 添加搜索到的图标
            if (searchIcons.length > 0) {
                icons.push(...searchIcons.slice(0, 10));
            }
        }
        
        // 确保最多显示12个图标
        const displayIcons = icons.slice(0, 12);
        
        // 添加图标到网格
        displayIcons.forEach((iconUrl, index) => {
            const iconItem = document.createElement('div');
            iconItem.className = 'icon-item';
            
            const img = document.createElement('img');
            img.src = iconUrl;
            img.alt = `可选图标 ${index + 1}`;
            img.onerror = () => {
                console.error('图标加载失败:', iconUrl);
                iconItem.style.display = 'none';
            };
            
            iconItem.appendChild(img);
            
            // 单击事件：填入URL
            iconItem.addEventListener('click', () => {
                document.getElementById('shortcut-icon').value = iconUrl;
            });
            
            // 双击事件：填入Base64字符串
            iconItem.addEventListener('dblclick', async () => {
                try {
                    const base64 = await convertImageToBase64(iconUrl);
                    document.getElementById('shortcut-icon').value = base64;
                } catch (error) {
                    console.error('转换为Base64失败:', error);
                    showStatusMessage('shortcut-status', '❌ 图标转换失败', 'error');
                }
            });
            
            iconGrid.appendChild(iconItem);
        });
    }
    
    // 将图片URL转换为Base64
    function convertImageToBase64(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            img.onload = function() {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                
                try {
                    const base64 = canvas.toDataURL('image/png');
                    resolve(base64);
                } catch (error) {
                    reject(error);
                }
            };
            
            img.onerror = function() {
                reject(new Error('图片加载失败'));
            };
            
            img.src = url;
        });
    }

    // 获取网站信息
    fetchInfoBtn.addEventListener('click', async function() {
        const urlInput = document.getElementById('shortcut-url');
        const nameInput = document.getElementById('shortcut-name');
        const iconInput = document.getElementById('shortcut-icon');
        const fetchBtn = document.getElementById('fetch-info-btn');
        
        const url = urlInput.value.trim();
        if (!url) {
            // 不再显示验证消息，允许用户继续
            return;
        }
        
        // 验证URL格式并自动添加协议（如果没有）
        let fullUrl = url;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            fullUrl = 'https://' + url;
        }
        
        try {
            new URL(fullUrl);
        } catch (e) {
            // 不再显示格式验证消息，允许用户继续
            return;
        }
        
        // 显示加载状态
        const originalText = fetchBtn.querySelector('.btn-text').textContent;
        fetchBtn.querySelector('.btn-text').textContent = '获取中...';
        fetchBtn.classList.add('loading');
        fetchBtn.disabled = true;
        
        try {
            // 发送消息到后台脚本获取网站信息
            if (!chrome.runtime) {
                console.error('chrome.runtime 不可用');
                showStatusMessage('shortcut-status', '❌ 扩展运行时错误，请刷新页面重试', 'error');
                return;
            }
            
            // 添加超时机制
             let response;
             try {
                 response = await Promise.race([
                     chrome.runtime.sendMessage({
                         action: 'FETCH_WEBSITE_INFO',
                         url: fullUrl
                     }),
                     new Promise((_, reject) => 
                         setTimeout(() => reject(new Error('请求超时')), 10000)
                     )
                 ]);
             } catch (messageError) {
                 console.error('后台消息发送失败:', messageError);                 
                 // 后备方案：直接尝试获取网站信息
                 response = await fetchWebsiteInfoDirectly(fullUrl);
             }
            
            if (response.success) {
                let { title, icon } = response.data;
                
                // 填充名称：如果用户已经输入了名称，则使用用户输入的值，否则使用网站返回的标题
                if (title) {
                    if (nameInput.value.trim() === '') {
                        nameInput.value = title;
                    } else {
                        // 反向赋值：使用用户输入的值作为标题
                        title = nameInput.value;
                        console.log('使用用户输入的名称作为标题:', title);
                    }
                }
                
                // 填充图标
                if (icon) {
                    // 切换到自定义图标模式
                    document.getElementById('shortcut-icon-type').value = 'custom';
                    toggleCustomIconField();
                    iconInput.value = icon;
                }
                
                // 加载可选图标
                loadOptionalIcons(icon, title);                
                showStatusMessage('shortcut-status', `✅ 获取成功！标题: ${title || '未找到标题'}`, 'success');
                
                // 成功时自动聚焦到名称输入框
                setTimeout(() => {
                    nameInput.focus();
                    nameInput.select();
                }, 100);
            } else {
                showStatusMessage('shortcut-status', '❌ 获取失败: ' + (response.error || '未知错误'), 'error');
                
                // 即使失败，也自动填充域名作为名称
                try {
                    const urlObj = new URL(fullUrl);
                    const domain = urlObj.hostname.replace('www.', '');
                    nameInput.value = domain;
                    showStatusMessage('shortcut-status', 'ℹ️ 已自动填充域名作为名称', 'info');
                } catch (autoError) {
                }
            }
        } catch (error) {            
            let errorMessage = '获取网站信息失败';
            if (error.message.includes('timeout')) {
                errorMessage = '⏱️ 请求超时，请检查网络连接';
            } else if (error.message.includes('Failed to fetch')) {
                errorMessage = '🌐 网络连接失败，请检查网络设置';
            } else if (error.message.includes('404')) {
                errorMessage = '🔍 网站未找到 (404)';
            } else if (error.message.includes('403')) {
                errorMessage = '🔒 访问被拒绝 (403)';
            } else if (error.message.includes('chrome.runtime')) {
                errorMessage = '🔧 扩展运行时错误，请检查扩展是否正确加载';
            } else {
                errorMessage = '❌ 获取失败: ' + error.message;
            }
            
            showStatusMessage('shortcut-status', errorMessage, 'error');
            
            // 即使失败，也自动填充域名作为名称
            try {
                const urlObj = new URL(fullUrl);
                const domain = urlObj.hostname.replace('www.', '');
                nameInput.value = domain;
                showStatusMessage('shortcut-status', 'ℹ️ 已自动填充域名作为名称', 'info');
            } catch (autoError) {
                console.log('自动填充域名失败:', autoError);
            }
        } finally {
            // 恢复按钮状态
            fetchBtn.querySelector('.btn-text').textContent = originalText;
            fetchBtn.classList.remove('loading');
            fetchBtn.disabled = false;
        }
    });
    
    // 提交表单添加快捷方式
    shortcutForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const submitBtn = this.querySelector('button[type="submit"]');
        
        if (submitBtn.disabled) {
            return;
        }
        
        submitBtn.disabled = true;
        submitBtn.textContent = '处理中...';
        
        const name = document.getElementById('shortcut-name').value.trim();
        let url = document.getElementById('shortcut-url').value.trim();
        const iconType = document.getElementById('shortcut-icon-type').value;
        const icon = document.getElementById('shortcut-icon').value.trim();
        const customColor = document.getElementById('shortcut-custom-color').value;
        
        if (name && url) {
            // 验证URL格式并自动添加协议（如果没有）
            let fullUrl = url;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                fullUrl = 'https://' + url;
            }
            
            const editingIndex = shortcutForm.dataset.editingIndex;
            
            if (editingIndex !== undefined) {
                    // 编辑模式
                    const result = await chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]);
                    const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
                    
                    if (editingIndex >= 0 && editingIndex < shortcuts.length) {
                        shortcuts[editingIndex] = {
                            ...shortcuts[editingIndex],
                            name: name,
                            url: fullUrl,
                            iconType: iconType,
                            icon: iconType === 'custom' ? (icon || '') : '',
                            customColor: iconType === 'auto' ? customColor : null,
                            updatedAt: new Date().toISOString()
                        };
                        
                        await saveShortcuts(shortcuts);
                        await renderShortcuts(shortcuts);
                    }
                    
                    // 清除编辑状态
                    delete shortcutForm.dataset.editingIndex;
                } else {
                // 添加模式
                const shortcut = {
                    id: Date.now().toString(),
                    name: name,
                    url: fullUrl,
                    iconType: iconType,
                    icon: iconType === 'custom' ? (icon || '') : '',
                    customColor: iconType === 'auto' ? customColor : null,
                    createdAt: new Date().toISOString()
                };
                
                await addShortcut(shortcut);
            }
            
            shortcutModal.classList.remove('show');
            shortcutForm.reset();
            document.getElementById('custom-icon-group').style.display = 'none';
            document.getElementById('solid-color-group').style.display = 'block';
            document.getElementById('shortcut-icon-type').value = 'auto';
            
            // 重置表单标题和按钮
            shortcutModal.querySelector('h3').textContent = '添加常用网站';
            shortcutForm.querySelector('button[type="submit"]').textContent = '添加';
        }
        
        submitBtn.disabled = false;
    });
    
    // 初始加载快捷方式
    await loadShortcuts();
}

// 显示状态消息
function showStatusMessage(elementId, message, type = 'info') {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    element.textContent = message;
    element.className = `status-message show ${type}`;
    
    // 只有非connection-status元素才自动隐藏
    if (elementId !== 'connection-status') {
        // 3秒后自动隐藏
        setTimeout(() => {
            element.classList.remove('show');
        }, 3000);
    }
}

// 初始化设置面板
function initSettings() {
    const openSettingsBtn = document.getElementById('open-settings');
    const settingsPanel = document.getElementById('settings-panel');
    const closeSettingsBtn = document.getElementById('close-settings');
    
    // 打开设置面板
    openSettingsBtn.addEventListener('click', function() {
        settingsPanel.classList.add('open');
    });
    
    // 关闭设置面板
    closeSettingsBtn.addEventListener('click', function() {
        settingsPanel.classList.remove('open');
    });
    
    // 点击设置面板外部关闭
    window.addEventListener('click', function(e) {
        if (e.target === settingsPanel) {
            settingsPanel.classList.remove('open');
        }
    });
    
    // 初始化设置面板标签页切换
    initSettingsTabSwitching();
    
    // 初始化设置面板内的所有功能
    initSettingsPanel();
}

// 初始化设置面板标签页切换
function initSettingsTabSwitching() {
    const settingsPanel = document.getElementById('settings-panel');
    const tabBtns = settingsPanel.querySelectorAll('.settings-sidebar .tab-btn');
    const tabPanes = settingsPanel.querySelectorAll('.settings-main .tab-pane');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.dataset.tab;
            
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            tabPanes.forEach(pane => {
                pane.classList.remove('active');
                if (pane.id === `${targetTab}-tab`) {
                    pane.classList.add('active');
                }
            });
        });
    });
}

// 初始化设置面板内的所有功能
async function initSettingsPanel() {
    await initWebDAVConfig();
    initBackupRestore();
    await initPersonalizationSettings();
    initToggleSwitches();
    await initManageEngines();
}

// 初始化Toggle开关
function initToggleSwitches() {
    const settingCheckboxes = document.querySelectorAll('.setting-checkbox');
    
    settingCheckboxes.forEach(checkboxGroup => {
        const input = checkboxGroup.querySelector('input[type="checkbox"]');
        const toggleSwitch = checkboxGroup.querySelector('.toggle-switch');
        
        if (input && toggleSwitch) {
            // 为开关添加点击事件
            toggleSwitch.addEventListener('click', (e) => {
                e.stopPropagation();
                // 切换checkbox状态
                input.checked = !input.checked;
                // 触发change事件，确保saveSettings函数被调用
                input.dispatchEvent(new Event('change'));
            });
            
            // 为checkbox添加change事件，确保样式正确更新
            input.addEventListener('change', (e) => {
                // CSS选择器会自动处理样式变化
                saveSettings();
            });
        }
    });
}

// 初始化WebDAV配置
async function initWebDAVConfig() {
    // 加载已保存的WebDAV配置
    const config = await storageManager.getWebDAVConfig();
    if (config) {
        document.getElementById('webdav-url').value = config.url || '';
        document.getElementById('webdav-username').value = config.username || '';
        document.getElementById('webdav-password').value = config.password || '';
    }
    
    // 绑定表单提交事件
    document.getElementById('webdav-form').addEventListener('submit', handleWebDAVFormSubmit);
    
    // 绑定连接测试事件
    document.getElementById('test-connection').addEventListener('click', handleTestConnection);
}

// 处理WebDAV表单提交
async function handleWebDAVFormSubmit(e) {
    e.preventDefault();
    
    const url = document.getElementById('webdav-url').value.trim();
    const username = document.getElementById('webdav-username').value.trim();
    const password = document.getElementById('webdav-password').value;
    
    // 验证URL格式
    if (!url) {
        showStatusMessage('connection-status', '请输入服务器地址', 'error');
        return;
    }
    
    // 验证URL格式
    try {
        new URL(url);
    } catch (error) {
        showStatusMessage('connection-status', '请输入有效的服务器地址（包含http://或https://）', 'error');
        return;
    }
    
    // 验证用户名和密码
    if (!username) {
        showStatusMessage('connection-status', '请输入用户名', 'error');
        return;
    }
    
    if (!password) {
        showStatusMessage('connection-status', '请输入密码', 'error');
        return;
    }
    
    const config = {
        url: url,
        username: username,
        password: password
    };
    
    try {
        // 保存配置到Chrome存储
        await storageManager.saveWebDAVConfig(config);
        showStatusMessage('connection-status', '配置保存成功！正在刷新页面...', 'success');
        
        // 保存配置后自动刷新页面
        setTimeout(() => {
            location.reload();
        }, 1000);
    } catch (error) {
        showStatusMessage('connection-status', '配置保存失败：' + error.message, 'error');
    }
}

// 处理连接测试
async function handleTestConnection() {
    const url = document.getElementById('webdav-url').value.trim();
    const username = document.getElementById('webdav-username').value.trim();
    const password = document.getElementById('webdav-password').value;
    
    // 验证URL格式
    if (!url) {
        showStatusMessage('connection-status', '请输入服务器地址', 'error');
        return;
    }
    
    // 验证URL格式
    try {
        new URL(url);
    } catch (error) {
        showStatusMessage('connection-status', '请输入有效的服务器地址（包含http://或https://）', 'error');
        return;
    }
    
    // 验证用户名和密码
    if (!username) {
        showStatusMessage('connection-status', '请输入用户名', 'error');
        return;
    }
    
    if (!password) {
        showStatusMessage('connection-status', '请输入密码', 'error');
        return;
    }
    
    const config = {
        url: url,
        username: username,
        password: password
    };
    
    // 显示测试中状态
    showStatusMessage('connection-status', '正在测试连接...', 'info');
    
    try {
        console.log('测试WebDAV连接，配置：', config);
        const result = await storageManager.testWebDAVConnection(config);
        console.log('WebDAV连接测试结果：', result);
        
        if (result.success) {
            showStatusMessage('connection-status', '连接测试成功', 'success');
        } else {
            showStatusMessage('connection-status', '连接测试失败：' + result.message, 'error');
        }
    } catch (error) {
        console.error('WebDAV连接测试失败：', error);
        showStatusMessage('connection-status', '连接测试失败：' + error.message, 'error');
    }
}

// 初始化备份和恢复功能
async function initBackupRestore() {
    // 绑定备份和恢复事件
    document.getElementById('backup-data').addEventListener('click', handleBackupData);
    document.getElementById('restore-data').addEventListener('click', handleRestoreData);
    
    // 绑定导入导出事件
    document.getElementById('export-data').addEventListener('click', handleExportData);
    document.getElementById('import-data-btn').addEventListener('click', handleImportDataClick);
    document.getElementById('import-data').addEventListener('change', handleImportData);
    
}

// 处理导出本地备份
async function handleExportData() {
    try {
        // 使用 storageManager 获取所有数据（包括书签）
        const data = await storageManager.getAllData();
        
        // 创建备份文件名
        const backupDate = new Date();
        const formattedDate = backupDate.toISOString().slice(0, 19).replace(/:/g, '-');
        const backupFileName = `andy_tab_backup_${formattedDate}.json`;
        
        // 转换为JSON字符串
        const jsonStr = JSON.stringify(data, null, 2);
        
        // 创建下载链接
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = backupFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showNotification('导出成功', `已成功导出备份文件：${backupFileName}`, 'success');
    } catch (error) {
        console.error('导出备份失败：', error);
        showNotification('导出失败', error.message, 'error');
    }
}

// 处理导入本地备份点击
function handleImportDataClick() {
    document.getElementById('import-data').click();
}

// 处理导入本地备份
async function handleImportData(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    if (!file.name.endsWith('.json')) {
        showNotification('导入失败', '请选择JSON格式的备份文件', 'error');
        return;
    }
    
    if (!confirm(`确定要导入备份文件 "${file.name}" 吗？\n此操作将覆盖当前所有数据。`)) {
        return;
    }
    
    try {
        // 使用 storageManager 从本地文件恢复数据（包括书签）
        const result = await storageManager.restoreDataFromLocalFile(file);
        
        if (result.success) {
            showNotification('导入成功', `已成功导入备份文件：${file.name}`, 'success');
            // 刷新页面
            location.reload();
        } else {
            showNotification('导入失败', result.message, 'error');
        }
    } catch (error) {
        console.error('导入备份失败：', error);
        showNotification('导入失败', error.message, 'error');
    }
}

// 初始化个性化设置
async function initPersonalizationSettings() {
    // 加载已保存的设置
    const settings = await getSettings();
    
    // 应用设置
    document.getElementById('search-engine').value = settings.searchEngine || 'bing';
    document.getElementById('background-type').value = settings.backgroundType || 'gradient';
    document.getElementById('background-color').value = settings.backgroundColor || '#667eea';
    document.getElementById('background-image-url').value = settings.backgroundImage || '';
    document.getElementById('overlay-opacity').value = settings.overlayOpacity || '0.3';
    document.getElementById('background-blur').value = settings.backgroundBlur || '5';
    
    // 应用渐变背景设置
    document.getElementById('gradient-type').value = settings.gradientType || 'linear';
    document.getElementById('gradient-direction').value = settings.gradientDirection || 'to bottom right';
    document.getElementById('gradient-color-1').value = settings.gradientColor1 || '#667eea';
    document.getElementById('gradient-color-2').value = settings.gradientColor2 || '#764ba2';
    
    // 添加渐变类型和方向的change事件监听器，保存设置
    const gradientTypeSelect = document.getElementById('gradient-type');
    if (gradientTypeSelect) {
        gradientTypeSelect.addEventListener('change', saveSettings);
    }
    
    const gradientDirectionSelect = document.getElementById('gradient-direction');
    if (gradientDirectionSelect) {
        gradientDirectionSelect.addEventListener('change', saveSettings);
    }
    
    // 添加渐变颜色的change事件监听器，保存设置
    const gradientColor1Picker = document.getElementById('gradient-color-1');
    if (gradientColor1Picker) {
        gradientColor1Picker.addEventListener('change', saveSettings);
    }
    
    const gradientColor2Picker = document.getElementById('gradient-color-2');
    if (gradientColor2Picker) {
        gradientColor2Picker.addEventListener('change', saveSettings);
    }
    
    // 添加背景类型变化事件监听器，控制不同设置项的显示/隐藏
    const backgroundTypeSelect = document.getElementById('background-type');
    if (backgroundTypeSelect) {
        backgroundTypeSelect.addEventListener('change', function() {
            updateBackgroundSettingsVisibility(this.value);
        });
        
        // 初始调用一次，确保设置项可见性正确
        updateBackgroundSettingsVisibility(backgroundTypeSelect.value);
    }
    
    // 应用时间设置
    const showTimeElement = document.getElementById('show-time');
    if (showTimeElement) {
        showTimeElement.checked = settings.showTime !== false;
    }
    // 时间大小滑块
    const timeSizeElement = document.getElementById('time-size');
    if (timeSizeElement) {
        const timeSizeValue = parseInt((settings.timeSize || '80px').replace('px', ''));
        timeSizeElement.value = timeSizeValue;
        updateTimeSizeDisplay(timeSizeValue);
    }
    const timeFormatElement = document.getElementById('time-format');
    if (timeFormatElement) {
        timeFormatElement.value = settings.timeFormat || 'hh:mm:ss';
    }
    
    // 应用日期设置
    const showDateElement = document.getElementById('show-date');
    if (showDateElement) {
        showDateElement.checked = settings.showDate !== false;
    }
    const dateColorElement = document.getElementById('date-color');
    if (dateColorElement) {
        dateColorElement.value = settings.dateColor || '#ffffff';
    }
    // 日期大小滑块
    const dateSizeElement = document.getElementById('date-size');
    if (dateSizeElement) {
        const dateSizeValue = parseInt((settings.dateSize || '30px').replace('px', ''));
        dateSizeElement.value = dateSizeValue;
        updateDateSizeDisplay(dateSizeValue);
    }
    const dateFormatElement = document.getElementById('date-format');
    if (dateFormatElement) {
        dateFormatElement.value = settings.dateFormat || 'YYYY年MM月DD日';
    }
    
    // 应用图标设置
    const hideIconNamesElement = document.getElementById('hide-icon-names');
    if (hideIconNamesElement) {
        hideIconNamesElement.checked = settings.hideIconNames || false;
    }
    const iconShadowElement = document.getElementById('icon-shadow');
    if (iconShadowElement) {
        iconShadowElement.checked = settings.iconShadow !== false;
    }
    // 图标圆角滑块
    const iconBorderRadiusElement = document.getElementById('icon-border-radius');
    if (iconBorderRadiusElement) {
        const iconBorderRadiusValue = parseInt((settings.iconBorderRadius || '8px').replace('px', ''));
        iconBorderRadiusElement.value = iconBorderRadiusValue;
        updateIconBorderRadiusDisplay(iconBorderRadiusValue);
    }
    // 图标不透明度滑块
    const iconOpacityElement = document.getElementById('icon-opacity');
    if (iconOpacityElement) {
        iconOpacityElement.value = settings.iconOpacity || '1';
        updateIconOpacityDisplay(settings.iconOpacity || '1');
    }
    // 图标大小滑块
    const iconSizeElement = document.getElementById('icon-size');
    if (iconSizeElement) {
        const iconSizeValue = parseInt((settings.iconSize || '48px').replace('px', ''));
        iconSizeElement.value = iconSizeValue;
        updateIconSizeDisplay(iconSizeValue);
    }
    
    // 应用布局设置
    // 行数滑块
    const rowsElement = document.getElementById('rows');
    if (rowsElement) {
        rowsElement.value = settings.rows || '3';
        updateRowsDisplay(settings.rows || '3');
    }
    // 列数滑块
    const columnsElement = document.getElementById('columns');
    if (columnsElement) {
        columnsElement.value = settings.columns || '6';
        updateColumnsDisplay(settings.columns || '6');
    }
    // 列间距滑块
    const columnGapElement = document.getElementById('column-gap');
    if (columnGapElement) {
        const columnGapValue = parseInt((settings.columnGap || '15px').replace('px', ''));
        columnGapElement.value = columnGapValue;
        updateColumnGapDisplay(columnGapValue);
    }
    // 行间距滑块
    const rowGapElement = document.getElementById('row-gap');
    if (rowGapElement) {
        const rowGapValue = parseInt((settings.rowGap || '15px').replace('px', ''));
        rowGapElement.value = rowGapValue;
        updateRowGapDisplay(rowGapValue);
    }
    
    // 应用字体设置
    const fontShadowElement = document.getElementById('font-shadow');
    if (fontShadowElement) {
        fontShadowElement.checked = settings.fontShadow !== false;
    }
    // 字体大小滑块
    const fontSizeElement = document.getElementById('font-size');
    if (fontSizeElement) {
        const fontSizeValue = parseInt((settings.fontSize || '12px').replace('px', ''));
        fontSizeElement.value = fontSizeValue;
        updateFontSizeDisplay(fontSizeValue);
    }
    const fontColorElement = document.getElementById('font-color');
    if (fontColorElement) {
        fontColorElement.value = settings.fontColor || '#ffffff';
    }
    
    // 应用目标打开方式设置
    const openWebsitesInNewTabElement = document.getElementById('open-websites-in-new-tab');
    if (openWebsitesInNewTabElement) {
        openWebsitesInNewTabElement.checked = settings.openWebsitesInNewTab !== false;
    }
    const openSearchInNewTabElement = document.getElementById('open-search-in-new-tab');
    if (openSearchInNewTabElement) {
        openSearchInNewTabElement.checked = settings.openSearchInNewTab !== false;
    }
    
    // 更新显示值
    initSliders();
    
    // 显示/隐藏背景设置选项
    toggleBackgroundSettings(settings.backgroundType || 'gradient');
    
    // 显示/隐藏时间日期设置选项
    toggleTimeSettings(settings.showTime !== false);
    toggleDateSettings(settings.showDate !== false);
    
    // 只绑定一次事件监听器，避免重复绑定
    if (!window.personalizationEventsBound) {
        const searchEngineElement = document.getElementById('search-engine');
        if (searchEngineElement) {
            searchEngineElement.addEventListener('change', saveSettings);
        }
        const backgroundTypeElement = document.getElementById('background-type');
        if (backgroundTypeElement) {
            backgroundTypeElement.addEventListener('change', function(e) {
                toggleBackgroundSettings(e.target.value);
                saveSettings();
            });
        }
        const backgroundColorElement = document.getElementById('background-color');
        if (backgroundColorElement) {
            backgroundColorElement.addEventListener('change', saveSettings);
        }
        const backgroundImageUrlElement = document.getElementById('background-image-url');
        if (backgroundImageUrlElement) {
            backgroundImageUrlElement.addEventListener('change', handleBackgroundImageUrlChange);
        }
        const overlayOpacityElement = document.getElementById('overlay-opacity');
        if (overlayOpacityElement) {
            overlayOpacityElement.addEventListener('input', updateOpacityDisplay);
            overlayOpacityElement.addEventListener('change', saveSettings);
        }
        const backgroundBlurElement = document.getElementById('background-blur');
        if (backgroundBlurElement) {
            backgroundBlurElement.addEventListener('input', updateBlurDisplay);
            backgroundBlurElement.addEventListener('change', saveSettings);
        }
        
        // 时间设置事件监听器
        const showTimeElement = document.getElementById('show-time');
        if (showTimeElement) {
            showTimeElement.addEventListener('change', function(e) {
                toggleTimeSettings(e.target.checked);
                saveSettings();
            });
        }
        const timeColorElement = document.getElementById('time-color');
        if (timeColorElement) {
            timeColorElement.addEventListener('change', saveSettings);
        }
        const timeSizeElement = document.getElementById('time-size');
        if (timeSizeElement) {
            timeSizeElement.addEventListener('input', function(e) {
                updateTimeSizeDisplay(e.target.value);
            });
            timeSizeElement.addEventListener('change', saveSettings);
        }
        const timeFormatElement = document.getElementById('time-format');
        if (timeFormatElement) {
            timeFormatElement.addEventListener('change', saveSettings);
        }
        
        // 日期设置事件监听器
        const showDateElement = document.getElementById('show-date');
        if (showDateElement) {
            showDateElement.addEventListener('change', function(e) {
                toggleDateSettings(e.target.checked);
                saveSettings();
            });
        }
        const dateColorElement = document.getElementById('date-color');
        if (dateColorElement) {
            dateColorElement.addEventListener('change', saveSettings);
        }
        const dateSizeElement = document.getElementById('date-size');
        if (dateSizeElement) {
            dateSizeElement.addEventListener('input', function(e) {
                updateDateSizeDisplay(e.target.value);
            });
            dateSizeElement.addEventListener('change', saveSettings);
        }
        const dateFormatElement = document.getElementById('date-format');
        if (dateFormatElement) {
            dateFormatElement.addEventListener('change', saveSettings);
        }
        
        // 图标设置事件监听器
        const hideIconNamesElement = document.getElementById('hide-icon-names');
        if (hideIconNamesElement) {
            hideIconNamesElement.addEventListener('change', saveSettings);
        }
        const iconShadowElement = document.getElementById('icon-shadow');
        if (iconShadowElement) {
            iconShadowElement.addEventListener('change', saveSettings);
        }
        const iconBorderRadiusElement = document.getElementById('icon-border-radius');
        if (iconBorderRadiusElement) {
            iconBorderRadiusElement.addEventListener('input', function(e) {
                updateIconBorderRadiusDisplay(e.target.value);
            });
            iconBorderRadiusElement.addEventListener('change', saveSettings);
        }
        const iconOpacityElement = document.getElementById('icon-opacity');
        if (iconOpacityElement) {
            iconOpacityElement.addEventListener('input', function(e) {
                updateIconOpacityDisplay(e.target.value);
            });
            iconOpacityElement.addEventListener('change', saveSettings);
        }
        const iconSizeElement = document.getElementById('icon-size');
        if (iconSizeElement) {
            iconSizeElement.addEventListener('input', function(e) {
                updateIconSizeDisplay(e.target.value);
            });
            iconSizeElement.addEventListener('change', saveSettings);
        }
        
        // 布局设置事件监听器
        const rowsElement = document.getElementById('rows');
        if (rowsElement) {
            rowsElement.addEventListener('input', function(e) {
                updateRowsDisplay(e.target.value);
            });
            rowsElement.addEventListener('change', saveSettings);
        }
        const columnsElement = document.getElementById('columns');
        if (columnsElement) {
            columnsElement.addEventListener('input', function(e) {
                updateColumnsDisplay(e.target.value);
            });
            columnsElement.addEventListener('change', saveSettings);
        }
        const columnGapElement = document.getElementById('column-gap');
        if (columnGapElement) {
            columnGapElement.addEventListener('input', function(e) {
                updateColumnGapDisplay(e.target.value);
            });
            columnGapElement.addEventListener('change', saveSettings);
        }
        const rowGapElement = document.getElementById('row-gap');
        if (rowGapElement) {
            rowGapElement.addEventListener('input', function(e) {
                updateRowGapDisplay(e.target.value);
            });
            rowGapElement.addEventListener('change', saveSettings);
        }
        
        // 字体设置事件监听器
        const fontShadowElement = document.getElementById('font-shadow');
        if (fontShadowElement) {
            fontShadowElement.addEventListener('change', saveSettings);
        }
        const fontSizeElement = document.getElementById('font-size');
        if (fontSizeElement) {
            fontSizeElement.addEventListener('input', function(e) {
                updateFontSizeDisplay(e.target.value);
            });
            fontSizeElement.addEventListener('change', saveSettings);
        }
        const fontColorElement = document.getElementById('font-color');
        if (fontColorElement) {
            fontColorElement.addEventListener('change', saveSettings);
        }
        
        // 目标打开方式事件监听器
        const openWebsitesInNewTabElement = document.getElementById('open-websites-in-new-tab');
        if (openWebsitesInNewTabElement) {
            openWebsitesInNewTabElement.addEventListener('change', saveSettings);
        }
        const openSearchInNewTabElement = document.getElementById('open-search-in-new-tab');
        if (openSearchInNewTabElement) {
            openSearchInNewTabElement.addEventListener('change', saveSettings);
        }
        
        window.personalizationEventsBound = true;
    }
}

// 切换时间设置显示
function toggleTimeSettings(show) {
    const timeSettings = document.querySelectorAll('.time-settings');
    timeSettings.forEach(setting => {
        setting.style.display = show ? 'flex' : 'none';
    });
}

// 切换日期设置显示
function toggleDateSettings(show) {
    const dateSettings = document.querySelectorAll('.date-settings');
    dateSettings.forEach(setting => {
        setting.style.display = show ? 'flex' : 'none';
    });
}

// 初始化滑块控件
function initSliders() {
    updateOpacityDisplay();
    updateBlurDisplay();
    updateIconOpacityDisplay();
}

// 保存设置
async function saveSettings() {
    const settings = {
        searchEngine: document.getElementById('search-engine')?.value || 'bing',
        backgroundType: document.getElementById('background-type')?.value || 'gradient',
        backgroundColor: document.getElementById('background-color')?.value || '#667eea',
        backgroundImage: document.getElementById('background-image-url')?.value || '',
        overlayOpacity: document.getElementById('overlay-opacity')?.value || '0.3',
        backgroundBlur: document.getElementById('background-blur')?.value || '5',
        // 渐变背景设置
        gradientType: document.getElementById('gradient-type')?.value || 'linear',
        gradientDirection: document.getElementById('gradient-direction')?.value || 'to bottom right',
        gradientColor1: document.getElementById('gradient-color-1')?.value || '#667eea',
        gradientColor2: document.getElementById('gradient-color-2')?.value || '#764ba2',
        // 时间设置
        showTime: document.getElementById('show-time')?.checked !== false,
        timeColor: document.getElementById('time-color')?.value || '#ffffff',
        timeSize: `${document.getElementById('time-size')?.value || '80'}px`,
        timeFormat: document.getElementById('time-format')?.value || 'hh:mm:ss',
        // 日期设置
        showDate: document.getElementById('show-date')?.checked !== false,
        dateColor: document.getElementById('date-color')?.value || '#ffffff',
        dateSize: `${document.getElementById('date-size')?.value || '30'}px`,
        dateFormat: document.getElementById('date-format')?.value || 'YYYY年MM月DD日',
        // 图标设置
        hideIconNames: document.getElementById('hide-icon-names')?.checked || false,
        iconShadow: document.getElementById('icon-shadow')?.checked !== false,
        iconBorderRadius: `${document.getElementById('icon-border-radius')?.value || '8'}px`,
        iconOpacity: document.getElementById('icon-opacity')?.value || '1',
        iconSize: `${document.getElementById('icon-size')?.value || '48'}px`,
        // 待办事项和笔记设置
        enableTodo: document.getElementById('enable-todo')?.checked || false,
        enableNotes: document.getElementById('enable-notes')?.checked || false,
        // 布局设置
        rows: document.getElementById('rows')?.value || '3',
        columns: document.getElementById('columns')?.value || '6',
        columnGap: `${document.getElementById('column-gap')?.value || '15'}px`,
        rowGap: `${document.getElementById('row-gap')?.value || '15'}px`,
        // 字体设置
        fontShadow: document.getElementById('font-shadow')?.checked !== false,
        fontSize: `${document.getElementById('font-size')?.value || '12'}px`,
        fontColor: document.getElementById('font-color')?.value || '#ffffff',
        // 目标打开方式设置
        openWebsitesInNewTab: document.getElementById('open-websites-in-new-tab')?.checked !== false,
        openSearchInNewTab: document.getElementById('open-search-in-new-tab')?.checked !== false
    };
    
    return new Promise((resolve) => {
        chrome.storage.local.set({
            [STORAGE_KEYS.SETTINGS]: settings
        }, async function() {
            // 更新缓存的设置
            window.cachedSettings = settings;
            
            // 重新渲染快捷方式以应用新的分页设置
            const result = await chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]);
            const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
            // 重新渲染快捷方式 - 使用window对象确保函数可访问
            if (typeof window.renderShortcuts === 'function') {
                await window.renderShortcuts(shortcuts);
            } else if (typeof renderShortcuts === 'function') {
                await renderShortcuts(shortcuts);
            } else {
                console.warn('renderShortcuts function not found, reloading shortcuts...');
                // 如果函数不可用，重新加载快捷方式
                await loadShortcuts();
            }
            
            resolve();
        });
    });
}

// 切换背景设置显示
function toggleBackgroundSettings(backgroundType) {
    const colorSetting = document.querySelector('.background-color-setting');
    const imageSetting = document.querySelector('.background-image-setting');
    
    switch (backgroundType) {
        case 'solid':
            colorSetting.style.display = 'flex';
            imageSetting.style.display = 'none';
            break;
        case 'image':
            colorSetting.style.display = 'none';
            imageSetting.style.display = 'block';
            break;
        case 'bing':
            // Bing壁纸不需要特殊设置项
            colorSetting.style.display = 'none';
            imageSetting.style.display = 'none';
            break;
        default: // gradient
            colorSetting.style.display = 'none';
            imageSetting.style.display = 'none';
            break;
    }
}

// 更新遮罩浓度显示
function updateOpacityDisplay() {
    const opacitySlider = document.getElementById('overlay-opacity');
    const opacityValue = document.getElementById('opacity-value');
    if (opacitySlider && opacityValue) {
        opacityValue.textContent = Math.round(opacitySlider.value * 100) + '%';
    }
}

// 更新模糊度显示
function updateBlurDisplay() {
    const blurSlider = document.getElementById('background-blur');
    const blurValue = document.getElementById('blur-value');
    if (blurSlider && blurValue) {
        blurValue.textContent = blurSlider.value + 'px';
    }
}

// 更新图标不透明度显示
function updateIconOpacityDisplay(value = null) {
    const opacitySlider = document.getElementById('icon-opacity');
    const opacityValue = document.getElementById('icon-opacity-value');
    if (opacityValue) {
        const currentValue = value !== null ? value : (opacitySlider?.value || 1);
        opacityValue.textContent = Math.round(currentValue * 100) + '%';
    }
}

// 更新时间大小显示
function updateTimeSizeDisplay(value = null) {
    const sizeSlider = document.getElementById('time-size');
    const sizeValue = document.getElementById('time-size-value');
    if (sizeValue) {
        const currentValue = value !== null ? value : (sizeSlider?.value || 80);
        sizeValue.textContent = currentValue + 'px';
    }
}

// 更新日期大小显示
function updateDateSizeDisplay(value = null) {
    const sizeSlider = document.getElementById('date-size');
    const sizeValue = document.getElementById('date-size-value');
    if (sizeValue) {
        const currentValue = value !== null ? value : (sizeSlider?.value || 30);
        sizeValue.textContent = currentValue + 'px';
    }
}

// 更新图标圆角显示
function updateIconBorderRadiusDisplay(value = null) {
    const radiusSlider = document.getElementById('icon-border-radius');
    const radiusValue = document.getElementById('icon-border-radius-value');
    if (radiusValue) {
        const currentValue = value !== null ? value : (radiusSlider?.value || 8);
        radiusValue.textContent = currentValue + 'px';
    }
}

// 更新图标大小显示
function updateIconSizeDisplay(value = null) {
    const sizeSlider = document.getElementById('icon-size');
    const sizeValue = document.getElementById('icon-size-value');
    if (sizeValue) {
        const currentValue = value !== null ? value : (sizeSlider?.value || 48);
        sizeValue.textContent = currentValue + 'px';
    }
}

// 更新行数显示
function updateRowsDisplay(value = null) {
    const rowsSlider = document.getElementById('rows');
    const rowsValue = document.getElementById('rows-value');
    if (rowsValue) {
        const currentValue = value !== null ? value : (rowsSlider?.value || 3);
        rowsValue.textContent = currentValue;
    }
}

// 更新列数显示
function updateColumnsDisplay(value = null) {
    const columnsSlider = document.getElementById('columns');
    const columnsValue = document.getElementById('columns-value');
    if (columnsValue) {
        const currentValue = value !== null ? value : (columnsSlider?.value || 6);
        columnsValue.textContent = currentValue;
    }
}

// 更新列间距显示
function updateColumnGapDisplay(value = null) {
    const gapSlider = document.getElementById('column-gap');
    const gapValue = document.getElementById('column-gap-value');
    if (gapValue) {
        const currentValue = value !== null ? value : (gapSlider?.value || 15);
        gapValue.textContent = currentValue + 'px';
    }
}

// 更新行间距显示
function updateRowGapDisplay(value = null) {
    const gapSlider = document.getElementById('row-gap');
    const gapValue = document.getElementById('row-gap-value');
    if (gapValue) {
        const currentValue = value !== null ? value : (gapSlider?.value || 15);
        gapValue.textContent = currentValue + 'px';
    }
}

// 更新字体大小显示
function updateFontSizeDisplay(value = null) {
    const sizeSlider = document.getElementById('font-size');
    const sizeValue = document.getElementById('font-size-value');
    if (sizeValue) {
        const currentValue = value !== null ? value : (sizeSlider?.value || 12);
        sizeValue.textContent = currentValue + 'px';
    }
}

// 处理背景图片URL变更
async function handleBackgroundImageUrlChange(e) {
    const imageUrl = e.target.value.trim();
    
    if (imageUrl) {
        // 验证URL格式
        try {
            new URL(imageUrl);
            
            // 保存到设置
            const settings = await getSettings();
            settings.backgroundImage = imageUrl;
            settings.backgroundType = 'image';
            
            chrome.storage.local.set({
                [STORAGE_KEYS.SETTINGS]: settings
            });
            
            showNotification('成功', '背景图片URL已保存', 'success');
        } catch (error) {
            showNotification('错误', '请输入有效的图片URL地址', 'error');
        }
    }
}

// 处理备份数据
async function handleBackupData() {
    try {
        const result = await storageManager.backupData();
        if (result.success) {
            showNotification('备份成功', result.message, 'success');
            // 重新加载备份列表
            loadBackupFiles();
        } else {
            showNotification('备份失败', result.message, 'error');
        }
    } catch (error) {
        console.error('备份数据失败：', error);
        showNotification('备份失败', error.message, 'error');
    }
}

// 处理恢复数据
async function handleRestoreData() {
    try {
        // 获取并显示备份列表
        await loadBackupFiles();
        
        // 绑定备份列表中的恢复按钮事件
        bindBackupListEvents();
    } catch (error) {
        console.error('获取备份列表失败:', error);
        showNotification('错误', '获取备份列表失败: ' + error.message, 'error');
    }
}

// 加载备份文件列表
async function loadBackupFiles() {
    try {
        const backupFiles = await storageManager.getBackupFiles();
        renderBackupFiles(backupFiles);
    } catch (error) {
        console.error('加载备份文件失败:', error.message);
    }
}

// 绑定备份列表事件
function bindBackupListEvents() {
    // 为恢复按钮添加事件监听器
    const backupList = document.getElementById('backup-list');
    if (backupList) {
        // 先移除之前的事件监听器，避免重复绑定
        backupList.removeEventListener('click', handleBackupListClick);
        // 添加新的事件监听器
        backupList.addEventListener('click', handleBackupListClick);
    }
}

// 处理备份列表点击事件
function handleBackupListClick(e) {
    if (e.target.classList.contains('restore-backup-btn')) {
        const backupName = e.target.getAttribute('data-backup-name');
        if (backupName) {
            restoreFromBackup(backupName);
        }
    }
}

// 渲染备份文件列表
function renderBackupFiles(backupFiles) {
    const backupList = document.getElementById('backup-list');
    
    if (backupFiles.length === 0) {
        backupList.innerHTML = '<p style="text-align: center; color: #6c757d; margin-top: 10px;">暂无备份文件</p>';
        return;
    }    
    // 按时间戳从新到旧排序
    const sortedBackupFiles = backupFiles.sort((a, b) => {
        // 尝试从文件名中提取时间戳（13位数字）
        const timestampA = a.name.match(/(\d{13})(?:\.json)?$/);
        const timestampB = b.name.match(/(\d{13})(?:\.json)?$/);
        
        // 如果都找到时间戳，按时间戳排序
        if (timestampA && timestampB) {
            const timeA = parseInt(timestampA[1]);
            const timeB = parseInt(timestampB[1]);
            return timeB - timeA; // 从新到旧排序
        }
        
        // 如果一个有时间戳，另一个没有，有时间戳的排在前面
        if (timestampA && !timestampB) return -1;
        if (!timestampA && timestampB) return 1;
        
        // 如果都没有时间戳，按文件名排序
        return b.name.localeCompare(a.name);
    });
    
    backupList.innerHTML = sortedBackupFiles.map(file => {
        // 从文件名最后的13位数字获取时间戳（不包括后缀名）
        // 格式如：bookmarks_backup_2025-12-09_1765271324477.json 或 bookmarks_sync-2025-12-10-1765329991561
        const timestampMatch = file.name.match(/(\d{13})(?:\.json)?$/);
        let date = '未知时间';
        
        if (timestampMatch) {
            const timestamp = parseInt(timestampMatch[1]); // 获取最后13位时间戳
            
            try {
                const dateObj = new Date(timestamp);
                date = dateObj.toLocaleString('zh-CN');
            } catch (e) {
                // 如果时间戳转换失败，显示原始时间戳
                date = timestampMatch[1];
            }
        }
        
        return `
            <div class="backup-item" data-backup-name="${file.name}">
                <div class="backup-info">
                    <div class="backup-filename">${file.name}</div>
                    <div class="backup-date">${date}</div>
                </div>
                <div class="backup-actions">
                    <button class="btn btn-success restore-backup-btn" data-backup-name="${file.name}">恢复</button>
                    <button class="btn btn-danger delete-backup-btn" data-backup-name="${file.name}">删除</button>
                </div>
            </div>
        `;
    }).join('');
    
    bindDeleteBackupEvents();
}

// 绑定删除备份按钮事件
function bindDeleteBackupEvents() {
    const deleteButtons = document.querySelectorAll('.delete-backup-btn');
    deleteButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const backupName = this.getAttribute('data-backup-name');
            if (backupName) {
                deleteBackup(backupName);
            }
        });
    });
}

// 删除备份
async function deleteBackup(backupName) {
    if (!confirm(`确定要删除备份文件 "${backupName}" 吗？\n此操作不可恢复。`)) {
        return;
    }
    
    try {
        const result = await storageManager.deleteBackup(backupName);
        if (result.success) {
            showNotification('删除成功', result.message, 'success');
            // 重新加载备份列表
            await loadBackupFiles();
        } else {
            showNotification('删除失败', result.message, 'error');
        }
    } catch (error) {
        console.error('删除备份失败：', error);
        showNotification('删除失败', error.message, 'error');
    }
}

// 从特定备份恢复数据
async function restoreFromBackup(backupFileName) {
    if (!confirm(`确定要从备份文件 "${backupFileName}" 恢复数据吗？\n此操作将覆盖当前所有数据。`)) {
        return;
    }
    
    try {
        const result = await storageManager.restoreData(backupFileName);
        
        if (result.success) {
            showNotification('恢复成功', result.message, 'success');
            // 刷新页面
            location.reload();
        } else {
            showNotification('恢复失败', result.message, 'error');
        }
    } catch (error) {
        console.error('恢复数据失败：', error);
        showNotification('恢复失败', error.message, 'error');
    }
}

// 显示通知
function showNotification(title, message, type = 'info') {
    // 使用Chrome的notifications API
    if (chrome.notifications) {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('src/assets/icons/icon48.png'),
            title: title,
            message: message
        });
    } else {
        // 如果notifications API不可用，使用alert
        alert(`${title}: ${message}`);
    }
}

// 初始化管理搜索引擎功能
async function initManageEngines() {
    const manageEnginesBtn = document.getElementById('manage-engines-btn');
    const manageEnginesModal = document.getElementById('manage-engines-modal');
    const closeModalBtn = manageEnginesModal.querySelector('.close');
    const addEngineBtn = document.getElementById('add-engine-btn');
    const engineFormContainer = document.getElementById('engine-form-container');
    const engineForm = document.getElementById('engine-form');
    const cancelEngineBtn = document.getElementById('cancel-engine-btn');
    const enginesList = document.getElementById('engines-list');
    
    // 初始化搜索引擎数据
    await initSearchEnginesData();
    
    // 打开管理搜索引擎弹窗
    manageEnginesBtn.addEventListener('click', async () => {
        manageEnginesModal.classList.add('show');
        await renderEnginesList();
    });
    
    // 关闭弹窗
    closeModalBtn.addEventListener('click', closeManageEnginesModal);
    cancelEngineBtn.addEventListener('click', closeEngineForm);
    
    // 添加搜索引擎按钮点击事件
    addEngineBtn.addEventListener('click', () => {
        openEngineForm();
    });
    
    // 表单提交事件
    engineForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleEngineFormSubmit();
    });
}

// 初始化搜索引擎数据
async function initSearchEnginesData() {
    const result = await chrome.storage.local.get(['andy_tab_search_engines']);
    let engines = result['andy_tab_search_engines'];
    
    // 如果没有保存的搜索引擎，使用默认配置
    if (!engines) {
        engines = {
            google: {
                name: 'Google',
                url: 'https://www.google.com/search?q=%s'
            },
            baidu: {
                name: '百度',
                url: 'https://www.baidu.com/s?wd=%s'
            },
            bing: {
                name: 'Bing',
                url: 'https://cn.bing.com/search?q=%s'
            },
            duckduckgo: {
                name: 'DuckDuckGo',
                url: 'https://duckduckgo.com/?q=%s'
            }
        };
        await chrome.storage.local.set({
            'andy_tab_search_engines': engines
        });
    }
    
    // 更新默认搜索引擎选择框
    await updateSearchEngineSelect();
}

// 更新默认搜索引擎选择框
async function updateSearchEngineSelect() {
    const searchEngineSelect = document.getElementById('search-engine');
    const engines = await getSearchEngines();
    
    // 保存当前选中的值
    const currentValue = searchEngineSelect.value;
    
    // 清空现有选项
    searchEngineSelect.innerHTML = '';
    
    // 添加新选项
    for (const [key, engine] of Object.entries(engines)) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = engine.name;
        searchEngineSelect.appendChild(option);
    }
    
    // 恢复选中值，如果不存在则选中第一个
    if (engines[currentValue]) {
        searchEngineSelect.value = currentValue;
    } else if (Object.keys(engines).length > 0) {
        searchEngineSelect.value = Object.keys(engines)[0];
    }
}

// 渲染搜索引擎列表
async function renderEnginesList() {
    const enginesList = document.getElementById('engines-list');
    const engines = await getSearchEngines();
    
    enginesList.innerHTML = '';
    
    for (const [key, engine] of Object.entries(engines)) {
        const engineItem = document.createElement('div');
        engineItem.className = 'engine-item';
        engineItem.dataset.key = key;
        
        engineItem.innerHTML = `
            <div class="engine-info">
                <div class="engine-title">${engine.name}</div>
            </div>
            <div class="engine-actions">
                <button class="btn btn-secondary btn-sm edit-engine-btn" data-key="${key}">编辑</button>
                <button class="btn btn-danger btn-sm delete-engine-btn" data-key="${key}">删除</button>
            </div>
        `;
        
        enginesList.appendChild(engineItem);
    }
    
    // 添加编辑和删除按钮事件监听
    addEngineActionsEventListeners();
}

// 添加搜索引擎操作事件监听
function addEngineActionsEventListeners() {
    // 先移除所有现有的事件监听器，防止重复绑定
    document.querySelectorAll('.edit-engine-btn').forEach(btn => {
        btn.replaceWith(btn.cloneNode(true));
    });
    
    document.querySelectorAll('.delete-engine-btn').forEach(btn => {
        btn.replaceWith(btn.cloneNode(true));
    });
    
    // 编辑按钮事件
    document.querySelectorAll('.edit-engine-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const key = e.target.dataset.key;
            await openEngineForm(key);
        });
    });
    
    // 删除按钮事件
    document.querySelectorAll('.delete-engine-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const key = e.target.dataset.key;
            await deleteEngine(key);
        });
    });
}

// 打开添加/编辑搜索引擎表单
async function openEngineForm(key = null) {
    const engineFormContainer = document.getElementById('engine-form-container');
    const engineFormTitle = document.getElementById('engine-form-title');
    const engineIdInput = document.getElementById('engine-id');
    const engineKeyInput = document.getElementById('engine-key');
    const engineNameInput = document.getElementById('engine-name');
    const engineUrlInput = document.getElementById('engine-url');
    
    // 防止重复打开
    if (engineFormContainer.style.display === 'block') {
        return;
    }
    
    engineFormContainer.style.display = 'block';
    
    if (key) {
        // 编辑模式
        engineFormTitle.textContent = '编辑搜索引擎';
        engineIdInput.value = key;
        
        const engines = await getSearchEngines();
        const engine = engines[key];
        if (engine) {
            engineKeyInput.value = key;
            engineNameInput.value = engine.name;
            engineUrlInput.value = engine.url;
        }
    } else {
        // 添加模式
        engineFormTitle.textContent = '添加搜索引擎';
        engineIdInput.value = '';
        engineKeyInput.value = '';
        engineNameInput.value = '';
        engineUrlInput.value = '';
    }
    
    // 滚动到表单
    engineFormContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 关闭引擎表单
function closeEngineForm() {
    const engineFormContainer = document.getElementById('engine-form-container');
    engineFormContainer.style.display = 'none';
    document.getElementById('engine-form').reset();
}

// 关闭管理引擎弹窗
function closeManageEnginesModal() {
    const manageEnginesModal = document.getElementById('manage-engines-modal');
    manageEnginesModal.classList.remove('show');
    closeEngineForm();
}

// 处理引擎表单提交
async function handleEngineFormSubmit() {
    const engineId = document.getElementById('engine-id').value;
    const engineKey = document.getElementById('engine-key').value.trim();
    const engineName = document.getElementById('engine-name').value.trim();
    const engineUrl = document.getElementById('engine-url').value.trim();
    
    // 验证输入
    if (!engineKey || !engineName || !engineUrl) {
        showNotification('错误', '请填写所有必填字段', 'error');
        return;
    }
    
    // 验证URL格式
    try {
        new URL(engineUrl);
    } catch (e) {
        showNotification('错误', '请输入有效的URL', 'error');
        return;
    }

    // 验证URL是否包含%s占位符
    if (!engineUrl.includes('%s')) {
        showNotification('错误', 'URL必须包含%s作为搜索关键词占位符', 'error');
        return;
    }
    
    const engines = await getSearchEngines();
    
    // 检查标识是否已存在（除了当前编辑的引擎）
    if (engineId) {
        // 编辑模式
        delete engines[engineId];
        engines[engineKey] = { name: engineName, url: engineUrl };
        showNotification('成功', '搜索引擎已更新', 'success');
    } else {
        // 添加模式
        if (engines[engineKey]) {
            showNotification('错误', '该搜索引擎标识已存在', 'error');
            return;
        }
        engines[engineKey] = { name: engineName, url: engineUrl };
        showNotification('成功', '搜索引擎已添加', 'success');
    }
    
    // 保存到存储
    await chrome.storage.local.set({
        'andy_tab_search_engines': engines
    });
    
    // 更新UI
    await renderEnginesList();
    await updateSearchEngineSelect();
    closeEngineForm();
}

// 删除搜索引擎
async function deleteEngine(key) {
    // 不能删除默认搜索引擎
    const defaultEngines = ['google', 'baidu', 'bing', 'duckduckgo'];
    if (defaultEngines.includes(key)) {
        showNotification('错误', '不能删除默认搜索引擎', 'error');
        return;
    }
    
    if (confirm(`确定要删除搜索引擎 "${key}" 吗？`)) {
        const engines = await getSearchEngines();
        delete engines[key];
        
        // 保存到存储
        await chrome.storage.local.set({
            'andy_tab_search_engines': engines
        });
        
        // 更新UI
        await renderEnginesList();
        await updateSearchEngineSelect();
        showNotification('成功', '搜索引擎已删除', 'success');
    }
}



// 获取域名首字母
function getDomainInitial(url) {
    try {
        const domain = new URL(url).hostname;
        return domain.charAt(0).toUpperCase();
    } catch (e) {
        return '?';
    }
}

// 获取名称前两个字符（中文英文都取前2个字）
function getNameInitial(name) {
    if (!name || name.trim() === '') {
        return '?';
    }
    
    const trimmedName = name.trim();
    
    // 中文、英文或其他语言，都取前两个字符
    if (trimmedName.length >= 2) {
        // 对于英文，转为大写
        if (/[a-zA-Z]/.test(trimmedName)) {
            return trimmedName.slice(0, 2).toUpperCase();
        }
        // 对于其他语言（包括中文），直接取前两个字符
        return trimmedName.slice(0, 2);
    }
    
    // 只有一个字符的情况
    return trimmedName.charAt(0);
}

// 直接获取网站信息
async function fetchWebsiteInfoDirectly(url) {
    try {        
        let icon = '';
        let title = '';
        
        try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname;
            
            // 使用Favicon服务获取图标
            icon = `https://favicon.im/${domain}?larger=true`;
            
            // 尝试获取网站标题
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                
                // console.log('直接获取 - Fetch响应状态:', response.status);
                
                if (response.ok) {
                    const html = await response.text();
                    
                    // 解析HTML获取标题
                    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
                    title = titleMatch ? titleMatch[1].trim() : domain;
                    
                    // 解析HTML获取图标
                    const iconPatterns = [
                        /<link[^>]*rel=["']?(?:shortcut\s+)?icon["']?[^>]*href=["']?([^"'>]+)["']?[^>]*>/i,
                        /<link[^>]*href=["']?([^"'>]+)["']?[^>]*rel=["']?(?:shortcut\s+)?icon["']?[^>]*>/i
                    ];
                    
                    for (const pattern of iconPatterns) {
                        const match = html.match(pattern);
                        if (match) {
                            let iconUrl = match[1];
                            
                            // 处理相对路径
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
                } else {
                    console.log('直接获取 - HTTP请求失败，状态码:', response.status);
                }
            } catch (fetchError) {
                console.log('直接获取 - 获取失败，使用域名作为标题:', fetchError.message);
            }
            
            // 如果标题还是空的，使用域名作为标题
            if (!title) {
                title = domain;
            }
            
        } catch (urlError) {
            console.error('直接获取 - URL解析失败:', urlError);
            return { 
                success: false, 
                error: '无效的网址格式: ' + urlError.message 
            };
        }
        
        const result = {
            title: title,
            icon: icon
        };
        
        // console.log('直接获取 - 网站信息获取成功:', result);
        return { success: true, data: result };
        
    } catch (error) {
        console.error('直接获取 - 获取网站信息失败:', error);
        
        // 最后的备用方案
        try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname;
            
            return { 
                success: true, 
                data: {
                    title: domain,
                    icon: `https://favicon.im/${domain}?larger=true`
                }
            };
        } catch (e) {
            return { 
                success: false, 
                error: '获取网站信息失败: ' + error.message 
            };
        }
    }
}

// 根据名称生成颜色
function generateNameColor(name) {
    if (!name || name.trim() === '') {
        return '#4CAF50';
    }
    
    let hash = 0;
    
    // 简单的哈希函数
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // 生成HSL颜色
    const hue = Math.abs(hash) % 360;
    const saturation = 60 + (Math.abs(hash) % 20); // 60-80%
    const lightness = 45 + (Math.abs(hash) % 10); // 45-55%
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}
