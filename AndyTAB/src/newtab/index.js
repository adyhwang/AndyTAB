import storageManager from '../utils/storage.js';
import imageCacheManager from '../utils/imageCache.js';

const STORAGE_KEYS = {
    SHORTCUTS: 'andy_tab_shortcuts',
    SETTINGS: 'andy_tab_settings',
    WEBDAV_CONFIG: 'andy_tab_webdav_config',
    SEARCH_ENGINES: 'andy_tab_search_engines',
    TODOS: 'andy_tab_todos',
    WIDGETS: 'andy_tab_widgets',
    ENGINE_ICONS: 'andy_tab_engine_icons',
    SYNC_LAST_TIMESTAMP: 'andy_tab_sync_lasttimestamp'
};

const WIDGET_LAYOUT_KEY = 'andy_tab_widgets_layout';

const WIDGET_STORE_KEY = 'andy_tab_widget_store';

function getWidgetStoreData(uuid) {
    const w = widgets.find((item) => item.uuid === uuid);
    return w && w.store !== undefined ? w.store : null;
}

function saveWidgetStoreData(uuid, value) {
    const w = widgets.find((item) => item.uuid === uuid);
    if (!w) return;
    w.store = value;

    saveWidgetsDebounced();
}

async function migrateWidgetStoreFromLocal() {
    try {
        const map = JSON.parse(localStorage.getItem(WIDGET_STORE_KEY) || '{}') || {};
        let changed = false;
        widgets.forEach((w) => {
            if (w.uuid && w.store === undefined && Object.prototype.hasOwnProperty.call(map, w.uuid)) {
                w.store = map[w.uuid];
                changed = true;
            }
        });
        if (!changed) {
            localStorage.removeItem(WIDGET_STORE_KEY);
            return;
        }
        widgetsSelfWrite = true;
        const toSave = widgets.map(({ layout, ...rest }) => rest);
        await chrome.storage.local.set({ [STORAGE_KEYS.WIDGETS]: toSave });

        setTimeout(() => { widgetsSelfWrite = false; }, 100);
        localStorage.removeItem(WIDGET_STORE_KEY);
    } catch (e) {

    }
}

let isEditMode = false;
let allShortcuts = [];
let currentPage = 1;
let totalPages = 1;
let itemsPerPage = 0;
let isRenderingShortcuts = false;
let todos = [];
let isTodoEnabled = false;
let widgets = [];

const TODO_LAYOUT_KEY = 'andy_tab_todo_layout';

document.addEventListener('DOMContentLoaded', function() {

    init();
});

async function init() {

    await Promise.all([
        imageCacheManager.init(),
        storageManager.init()
    ]);

    await loadAndApplySettings();

    initTimeDate();

    await initSearch();

    await initShortcuts();

    initSettings();

    setTimeout(async () => {

        imageCacheManager.clearExpiredCache();

        const settings = await getSettings();
        if (settings.backgroundType === 'image' && settings.backgroundImage) {
            imageCacheManager.preloadBackgroundImage(settings.backgroundImage);
        }
    }, 1000);

    chrome.storage.onChanged.addListener((changes, areaName) => {

        if (areaName === 'local') {
            if (changes[STORAGE_KEYS.SETTINGS]) {
                loadAndApplySettings();
            }
            if (changes[STORAGE_KEYS.SEARCH_ENGINES]) {
                renderEngineDropdown();
            }
            if (changes[STORAGE_KEYS.SHORTCUTS]) {

                if (changes[STORAGE_KEYS.SHORTCUTS].newValue) {
                    allShortcuts = changes[STORAGE_KEYS.SHORTCUTS].newValue;
                    renderShortcuts(changes[STORAGE_KEYS.SHORTCUTS].newValue);
                }
            }
            if (changes[STORAGE_KEYS.TODOS]) {

                if (changes[STORAGE_KEYS.TODOS].newValue) {
                    todos = changes[STORAGE_KEYS.TODOS].newValue;
                    renderTodoList();
                }
            }
            if (changes[STORAGE_KEYS.WIDGETS] && !widgetsSelfWrite) {

                const newVal = changes[STORAGE_KEYS.WIDGETS].newValue || [];
                widgets = newVal;

                applyWidgetLayouts();
                renderWidgets();
                renderWidgetSettingsList();
            }

        }
    });

    await initTodos();

    await initWidgets();

    await initSyncCheck();
}

async function initSyncCheck() {
    try {
        const cloudFilesInfo = await storageManager.getCloudFilesInfo();

        if (!cloudFilesInfo) {
            return;
        }

        const localTimestamps = await storageManager.getData('andy_tab_sync_lasttimestamp', {});

        const localTs = typeof localTimestamps === 'number'
            ? { favorites: localTimestamps, bookmarks: localTimestamps, sync: localTimestamps }
            : localTimestamps;

        const TIME_TOLERANCE = 3000;

        const cloudNewer = {
            favorites: false,
            bookmarks: false,
            sync: false
        };
        const localNewer = {
            favorites: false,
            bookmarks: false,
            sync: false
        };

        if (cloudFilesInfo.favorites.exists && cloudFilesInfo.favorites.modified) {
            const localFavTs = localTs.favorites || 0;
            const cloudFavTs = cloudFilesInfo.favorites.modified;
            if (cloudFavTs - localFavTs > TIME_TOLERANCE) {
                cloudNewer.favorites = true;
            } else if (localFavTs - cloudFavTs > TIME_TOLERANCE) {
                localNewer.favorites = true;
            }
        }

        if (cloudFilesInfo.bookmarks.exists && cloudFilesInfo.bookmarks.modified) {
            const localBmTs = localTs.bookmarks || 0;
            const cloudBmTs = cloudFilesInfo.bookmarks.modified;
            if (cloudBmTs - localBmTs > TIME_TOLERANCE) {
                cloudNewer.bookmarks = true;
            } else if (localBmTs - cloudBmTs > TIME_TOLERANCE) {
                localNewer.bookmarks = true;
            }
        }

        if (cloudFilesInfo.sync.exists && cloudFilesInfo.sync.modified) {
            const localSyncTs = localTs.sync || 0;
            const cloudSyncTs = cloudFilesInfo.sync.modified;
            if (cloudSyncTs - localSyncTs > TIME_TOLERANCE) {
                cloudNewer.sync = true;
            } else if (localSyncTs - cloudSyncTs > TIME_TOLERANCE) {
                localNewer.sync = true;
            }
        }

        if (cloudNewer.sync) {
            cloudNewer.favorites = false;
            cloudNewer.bookmarks = false;
        }
        if (localNewer.sync) {
            localNewer.favorites = false;
            localNewer.bookmarks = false;
        }

        const cloudNewerCount = Object.values(cloudNewer).filter(Boolean).length;
        if (cloudNewerCount > 0) {

            const syncTip = document.createElement('div');
            syncTip.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                padding: 24px 32px;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                z-index: 10000;
                font-size: 16px;
                color: #333;
                display: flex;
                align-items: center;
                gap: 12px;
            `;
            syncTip.innerHTML = '<span style="font-size:20px">🔄</span> 正在从云端同步数据...';
            document.body.appendChild(syncTip);

            try {
                await batchDownload(cloudNewer, 'overwrite');
                location.reload();
            } catch (error) {
                syncTip.innerHTML = '<span style="font-size:20px">❌</span> 同步失败: ' + error.message;
                syncTip.style.background = '#fff5f5';
                setTimeout(() => {
                    syncTip.remove();
                }, 3000);
            }
            return;
        }

        const localNewerCount = Object.values(localNewer).filter(Boolean).length;
        if (localNewerCount === 0) {
            return;
        }

        const hasNoLocalTimestamp = !localTs.favorites && !localTs.bookmarks && !localTs.sync;
        let hasLocalData = false;

        if (hasNoLocalTimestamp) {
            const localData = await storageManager.getAllData();
            hasLocalData = localData.shortcuts?.length > 0 || localData.bookmarks?.length > 0;
        }

        showSyncConflictDialog(localNewer, hasLocalData);

    } catch (error) {
        console.error('初始化同步检查失败：', error);
    }
}

async function updateSyncStatusUI() {
    const syncStatusContainer = document.getElementById('sync-status-container');
    const lastSyncTimeEl = document.getElementById('last-sync-time');
    const syncStatusIcon = document.getElementById('sync-status-icon');
    const syncStatusText = document.getElementById('sync-status-text');

    const config = await storageManager.getWebDAVConfig();
    if (!config || !config.url) {
        syncStatusContainer.style.display = 'none';
        return;
    }

    syncStatusContainer.style.display = 'block';

    const lastSyncTimestamps = await storageManager.getData('andy_tab_sync_lasttimestamp', {});

    const timestamps = typeof lastSyncTimestamps === 'number'
        ? { sync: lastSyncTimestamps }
        : lastSyncTimestamps;

    const latestTimestamp = Math.max(
        timestamps.favorites || 0,
        timestamps.bookmarks || 0,
        timestamps.sync || 0
    );

    if (latestTimestamp > 0) {
        const date = new Date(latestTimestamp);
        const timeStr = date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
        lastSyncTimeEl.textContent = `上次同步: ${timeStr}`;
        syncStatusIcon.textContent = '☁️';
        syncStatusText.textContent = '已同步';
        syncStatusContainer.classList.remove('error');
    } else {
        lastSyncTimeEl.textContent = '上次同步: 从未';
        syncStatusIcon.textContent = '⚠️';
        syncStatusText.textContent = '未同步';
    }
}

function setSyncStatus(status, message) {
    const syncStatusContainer = document.getElementById('sync-status-container');
    const syncStatusIcon = document.getElementById('sync-status-icon');
    const syncStatusText = document.getElementById('sync-status-text');
    const manualSyncBtn = document.getElementById('manual-sync-btn');

    syncStatusContainer.classList.remove('syncing', 'success', 'error');
    manualSyncBtn.disabled = status === 'syncing';

    switch (status) {
        case 'syncing':
            syncStatusContainer.classList.add('syncing');
            syncStatusIcon.textContent = '🔄';
            syncStatusText.textContent = message || '正在同步...';
            break;
        case 'success':
            syncStatusContainer.classList.add('success');
            syncStatusIcon.textContent = '✅';
            syncStatusText.textContent = message || '同步成功';
            setTimeout(() => {
                syncStatusContainer.classList.remove('success');
                updateSyncStatusUI();
            }, 3000);
            break;
        case 'error':
            syncStatusContainer.classList.add('error');
            syncStatusIcon.textContent = '❌';
            syncStatusText.textContent = message || '同步失败';
            setTimeout(() => {
                syncStatusContainer.classList.remove('error');
                updateSyncStatusUI();
            }, 5000);
            break;
        default:
            updateSyncStatusUI();
    }
}

async function handleManualSync() {
    try {
        setSyncStatus('syncing', '正在同步...');

        const result = await storageManager.uploadSyncData();

        if (result.success) {
            setSyncStatus('success', '同步成功');
            await updateSyncStatusUI();
        } else {
            setSyncStatus('error', result.message || '同步失败');
        }
    } catch (error) {
        console.error('手动同步失败：', error);
        setSyncStatus('error', error.message || '同步失败');
    }
}

function showSyncConflictDialog(needSync, hasLocalData) {
    const syncFileNames = {
        favorites: '快捷方式 (favorites.txt)',
        bookmarks: '书签 (bookmarks.html)',
        sync: '完整数据 (andy_tab_sync.json)'
    };

    const diffFiles = Object.entries(needSync)
        .filter(([, need]) => need)
        .map(([key]) => syncFileNames[key]);

    const diffCount = diffFiles.length;

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

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
        background-color: white;
        padding: 24px;
        border-radius: 8px;
        width: 90%;
        max-width: 500px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    `;

    const title = document.createElement('h2');
    title.textContent = '检测到数据不一致';
    title.style.cssText = `
        margin-top: 0;
        margin-bottom: 16px;
        color: #333;
        font-size: 20px;
    `;
    dialogContent.appendChild(title);

    const message = document.createElement('p');
    message.textContent = `检测到 ${diffCount} 个文件与云端不同：`;
    message.style.cssText = `
        margin-bottom: 12px;
        color: #666;
        line-height: 1.5;
    `;
    dialogContent.appendChild(message);

    const fileList = document.createElement('ul');
    fileList.style.cssText = `
        margin: 0 0 20px 20px;
        padding: 0;
        color: #e65100;
        font-size: 14px;
        line-height: 1.8;
    `;
    diffFiles.forEach(name => {
        const li = document.createElement('li');
        li.textContent = name;
        fileList.appendChild(li);
    });
    dialogContent.appendChild(fileList);

    const hint = document.createElement('p');
    hint.textContent = '请选择操作：';
    hint.style.cssText = `
        margin-bottom: 16px;
        color: #666;
    `;
    dialogContent.appendChild(hint);

    const optionsContainer = document.createElement('div');
    optionsContainer.style.cssText = `
        margin-bottom: 24px;
    `;

    const options = [
        { id: 'use-local', label: '使用本地数据（上传覆盖云端）', value: 'local' },
        { id: 'use-cloud', label: '使用云端数据（下载覆盖本地）', value: 'cloud' },
        { id: 'merge-data', label: '合并本地和云端数据', value: 'merge' }
    ];

    let selectedOption = hasLocalData ? 'local' : 'cloud';

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

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        justify-content: flex-end;
        gap: 12px;
    `;

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
        confirmButton.disabled = true;
        confirmButton.textContent = '处理中...';

        try {
            switch (selectedOption) {
                case 'local':
                    await storageManager.uploadSyncData();
                    break;

                case 'cloud':
                    await batchDownload(needSync, 'overwrite');
                    location.reload();
                    return;

                case 'merge':

                    if (needSync.sync) {
                        await storageManager.downloadSyncData('merge');
                    } else {
                        if (needSync.favorites) {
                            await storageManager.downloadFavorites('merge');
                        }
                        if (needSync.bookmarks) {
                            await storageManager.downloadBookmarks('merge');
                        }
                    }
                    await storageManager.uploadSyncData();
                    location.reload();
                    return;
            }

            dialog.remove();

        } catch (error) {
            console.error('处理同步冲突失败：', error);
            alert('处理同步冲突失败：' + error.message);
            confirmButton.disabled = false;
            confirmButton.textContent = '确定';
        }
    });

    buttonContainer.appendChild(confirmButton);
    dialogContent.appendChild(buttonContainer);

    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);
}

async function batchDownload(needSync, mode = 'overwrite') {

    if (needSync.sync) {
        await storageManager.downloadSyncData(mode);
        return;
    }

    if (needSync.favorites) {
        await storageManager.downloadFavorites(mode);
    }
    if (needSync.bookmarks) {
        await storageManager.downloadBookmarks(mode);
    }
}

async function loadAndApplySettings() {
    const settings = await getSettings();

    await applyBackgroundSettings(settings);
    applyTimeDateSettings(settings);
    applySearchEngineSettings(settings);
    applyIconLayoutFontSettings(settings);

    loadTodoLayout();
    await applyTodoSettings(settings);
}

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

async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.SETTINGS], function(result) {
            resolve(result[STORAGE_KEYS.SETTINGS] || {});
        });
    });
}

function getSettingsSync() {

    if (window.cachedSettings) {
        return window.cachedSettings;
    }

    return {
        columns: 6,
        rows: 3,
        columnGap: '20px',
        rowGap: '20px'
    };
}

async function applyBackgroundSettings(settings) {
    const body = document.body;

    switch (settings.backgroundType) {
        case 'solid':

            body.style.background = settings.backgroundColor || '#667eea';
            body.style.backgroundImage = 'none';
            break;
        case 'image':

            if (settings.backgroundImage) {

                body.style.background = `url(${settings.backgroundImage}) center/cover no-repeat`;
                body.style.backgroundImage = `url(${settings.backgroundImage})`;

                try {

                    setTimeout(async () => {
                        try {
                            const cachedImage = await imageCacheManager.getOrCacheImage(settings.backgroundImage, true);
                            if (cachedImage) {

                                body.style.background = `url(${cachedImage}) center/cover no-repeat`;
                                body.style.backgroundImage = `url(${cachedImage})`;
                            }
                        } catch (error) {
                            console.error('后台加载背景图片失败:', error);

                        }
                    }, 0);
                } catch (error) {
                    console.error('启动后台背景图片加载失败:', error);

                    body.style.background = `url(${settings.backgroundImage}) center/cover no-repeat`;
                    body.style.backgroundImage = `url(${settings.backgroundImage})`;
                }
            } else {

                body.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                body.style.backgroundImage = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            }
            break;
        case 'bing':

            body.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            body.style.backgroundImage = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';

            try {
                setTimeout(async () => {
                    try {

                        const bingCacheKey = 'bing_wallpaper_today';
                        const cachedImage = await imageCacheManager.getCachedImage(bingCacheKey, false, true);

                        if (cachedImage) {

                            document.body.style.background = `url(${cachedImage}) center/cover no-repeat`;
                            document.body.style.backgroundImage = `url(${cachedImage})`;
                        } else {

                            const bingImageUrl = await getBingWallpaperUrl();
                            if (bingImageUrl) {

                                document.body.style.background = `url(${bingImageUrl}) center/cover no-repeat`;
                                document.body.style.backgroundImage = `url(${bingImageUrl})`;

                                await imageCacheManager.cacheImageWithKey(bingImageUrl, bingCacheKey, true);

                                const newCachedImage = await imageCacheManager.getCachedImage(bingCacheKey, false, true);
                                if (newCachedImage) {
                                    document.body.style.background = `url(${newCachedImage}) center/cover no-repeat`;
                                    document.body.style.backgroundImage = `url(${newCachedImage})`;
                                }
                            }
                        }
                    } catch (error) {
                        console.error('加载Bing每日壁纸失败:', error);

                    }
                }, 0);
            } catch (error) {
                console.error('启动Bing壁纸加载失败:', error);
            }
            break;
        case 'gradient':
        default:

            const gradientType = settings.gradientType || 'linear';
            const gradientDirection = settings.gradientDirection || 'to bottom right';
            const color1 = settings.gradientColor1 || '#667eea';
            const color2 = settings.gradientColor2 || '#764ba2';

            let gradientValue;
            if (gradientType === 'linear') {

                const direction = gradientDirection || 'to bottom right';
                gradientValue = `linear-gradient(${direction}, ${color1} 0%, ${color2} 100%)`;
            } else {

                gradientValue = `radial-gradient(circle, ${color1} 0%, ${color2} 100%)`;
            }

            body.style.background = gradientValue;
            body.style.backgroundImage = gradientValue;
            break;
    }

    if (settings.overlayOpacity !== undefined) {
        body.style.setProperty('--overlay-opacity', settings.overlayOpacity);
    } else {
        body.style.setProperty('--overlay-opacity', '0.3');
    }

    if (settings.backgroundBlur !== undefined) {
        body.style.setProperty('--background-blur', settings.backgroundBlur + 'px');
    } else {
        body.style.setProperty('--background-blur', '5px');
    }
}

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

async function applySearchEngineSettings(settings) {

    window.searchEngine = settings.searchEngine || 'bing';

    await updateEngineUI();
}

function applyIconLayoutFontSettings(settings) {

    window.cachedSettings = settings;

    const shortcutsContainer = document.getElementById('shortcuts-container');
    const shortcutsGrid = shortcutsContainer?.querySelector('.shortcuts-grid');

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

    const shortcutItems = document.querySelectorAll('.shortcut-item');
    shortcutItems.forEach(item => {
        const icon = item.querySelector('.shortcut-icon');
        const name = item.querySelector('.shortcut-name');

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

            const hasCustomIcon = icon.querySelector('img');
            const isDefaultIcon = icon.classList.contains('default-icon');

            if (!hasCustomIcon || isDefaultIcon) {
                const iconSizeValue = parseInt(settings.iconSize.replace('px', ''));

                const textSize = Math.max(10, Math.min(48, iconSizeValue * 0.3));
                icon.style.fontSize = textSize + 'px';
            }
        }

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

async function applyTodoSettings(settings) {

    isTodoEnabled = settings.enableTodo || false;

    const todoToggle = document.getElementById('enable-todo');
    if (todoToggle) {
        todoToggle.checked = isTodoEnabled;
    }

    const todoPanel = document.getElementById('todo-panel');
    if (todoPanel) {
        todoPanel.style.display = isTodoEnabled ? 'flex' : 'none';
        if (isTodoEnabled) {

            requestAnimationFrame(measureTodoTextScroll);
        }
    }

    if (todoToggle) {
        todoToggle.onchange = async () => {
            settings.enableTodo = todoToggle.checked;
            await saveSettings(settings);
            await applyTodoSettings(settings);
        };
    }
}

async function initTodos() {

    todos = await storageManager.getData(STORAGE_KEYS.TODOS, []);

    const todoPanel = document.getElementById('todo-panel');
    if (!todoPanel) return;

    renderTodoList();

    const collapseBtn = document.getElementById('todo-collapse-btn');
    const header = document.getElementById('todo-panel-header');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            setTodoPanelCollapsed(!todoPanel.classList.contains('collapsed'));
        });
    }

    let headerDragged = false;
    if (header) {
        header.addEventListener('click', (e) => {
            if (headerDragged) return;
            if (todoPanel.classList.contains('collapsed') && !e.target.closest('.todo-collapse-btn')) {
                setTodoPanelCollapsed(false);
            }
        });

        header.addEventListener('mousedown', (e) => {

            if (e.target.closest('.todo-collapse-btn')) return;
            e.preventDefault();

            const startX = e.clientX;
            const startY = e.clientY;
            const rect = todoPanel.getBoundingClientRect();
            const startLeft = rect.left;
            const startTop = rect.top;
            headerDragged = false;

            const onMove = (ev) => {

                if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) {
                    headerDragged = true;
                }
                const left = Math.max(0, Math.min(startLeft + ev.clientX - startX, window.innerWidth - todoPanel.offsetWidth));
                const top = Math.max(0, Math.min(startTop + ev.clientY - startY, window.innerHeight - todoPanel.offsetHeight));
                todoPanel.style.left = left + 'px';
                todoPanel.style.top = top + 'px';
                todoPanel.style.right = 'auto';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (headerDragged) {
                    saveTodoLayout();
                }

                setTimeout(() => { headerDragged = false; }, 0);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    const resizeHandle = document.getElementById('todo-resize-handle');
    if (resizeHandle) {
        resizeHandle.addEventListener('mousedown', (e) => {
            if (todoPanel.classList.contains('collapsed')) return;
            e.preventDefault();
            e.stopPropagation();

            const startX = e.clientX;
            const startWidth = todoPanel.offsetWidth;

            todoPanel.style.transition = 'none';

            const onMove = (ev) => {
                const width = Math.max(280, Math.min(startWidth + ev.clientX - startX, 600));
                todoPanel.style.width = width + 'px';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                todoPanel.style.transition = '';
                saveTodoLayout();

                measureTodoTextScroll();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    const todoInput = document.getElementById('todo-input');
    const submitBtn = document.getElementById('todo-submit-btn');
    if (todoInput && submitBtn) {

        todoInput.addEventListener('input', () => {
            submitBtn.style.display = todoInput.value.trim() ? 'inline-block' : 'none';
        });

        const submitTodo = async () => {
            const text = todoInput.value.trim();
            if (!text) return;
            todos.push({ text, completed: false, id: Date.now() });
            await storageManager.saveData(STORAGE_KEYS.TODOS, todos);
            todoInput.value = '';
            submitBtn.style.display = 'none';
            renderTodoList();

            const items = document.getElementById('todo-items');
            if (items) items.scrollTop = items.scrollHeight;
        };

        submitBtn.addEventListener('click', submitTodo);
        todoInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitTodo();
        });
    }

    window.addEventListener('resize', clampTodoPanelToViewport);
}

function setTodoPanelCollapsed(collapsed) {
    const todoPanel = document.getElementById('todo-panel');
    if (!todoPanel) return;

    if (collapsed) {
        todoPanel.classList.add('collapsed');

        setTimeout(() => {
            if (todoPanel.classList.contains('collapsed')) {
                todoPanel.classList.add('collapsed-final');
                todoPanel.style.width = '40px';
            }
        }, 300);
    } else {
        todoPanel.classList.remove('collapsed');
        todoPanel.classList.remove('collapsed-final');

        const saved = JSON.parse(localStorage.getItem(TODO_LAYOUT_KEY) || 'null');
        const width = (saved && saved.width >= 280) ? saved.width : 350;
        todoPanel.style.width = width + 'px';

        requestAnimationFrame(measureTodoTextScroll);
    }

    saveTodoCollapsedState(collapsed);
}

function saveTodoCollapsedState(collapsed) {
    const todoPanel = document.getElementById('todo-panel');
    if (!todoPanel) return;
    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem(TODO_LAYOUT_KEY) || '{}') || {};
    } catch (e) {
        saved = {};
    }
    if (typeof saved.width !== 'number') {

        const rect = todoPanel.getBoundingClientRect();
        saved = { left: Math.round(rect.left), top: Math.round(rect.top), width: collapsed ? 350 : todoPanel.offsetWidth };
    }
    saved.collapsed = collapsed;
    localStorage.setItem(TODO_LAYOUT_KEY, JSON.stringify(saved));
}

function saveTodoLayout() {
    const todoPanel = document.getElementById('todo-panel');
    if (!todoPanel) return;
    const rect = todoPanel.getBoundingClientRect();
    const collapsed = todoPanel.classList.contains('collapsed');

    let width = todoPanel.offsetWidth;
    if (collapsed) {
        const saved = JSON.parse(localStorage.getItem(TODO_LAYOUT_KEY) || 'null');
        width = (saved && saved.width) ? saved.width : 350;
    }

    localStorage.setItem(TODO_LAYOUT_KEY, JSON.stringify({
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: width,
        collapsed: collapsed
    }));
}

function loadTodoLayout() {
    const todoPanel = document.getElementById('todo-panel');
    if (!todoPanel) return;
    try {
        const layout = JSON.parse(localStorage.getItem(TODO_LAYOUT_KEY) || 'null');
        if (layout && typeof layout.left === 'number' && typeof layout.top === 'number' && typeof layout.width === 'number') {
            const left = Math.max(0, Math.min(layout.left, window.innerWidth - layout.width));
            const top = Math.max(0, Math.min(layout.top, window.innerHeight - 30));
            todoPanel.style.left = left + 'px';
            todoPanel.style.top = top + 'px';

            if (layout.collapsed) {
                todoPanel.classList.add('collapsed');
                todoPanel.classList.add('collapsed-final');
                todoPanel.style.width = '40px';
            } else {

                todoPanel.style.width = (layout.width >= 280 ? layout.width : 350) + 'px';
            }
            todoPanel.style.right = 'auto';
        }
    } catch (e) {

    }
}

function clampTodoPanelToViewport() {
    const todoPanel = document.getElementById('todo-panel');
    if (!todoPanel) return;

    const width = todoPanel.offsetWidth;
    const height = todoPanel.offsetHeight;
    if (width === 0 || height === 0) return;

    const rect = todoPanel.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - width);
    const maxTop = Math.max(0, window.innerHeight - height);
    const left = Math.min(Math.max(rect.left, 0), maxLeft);
    const top = Math.min(Math.max(rect.top, 0), maxTop);

    if (left !== rect.left || top !== rect.top) {
        todoPanel.style.left = left + 'px';
        todoPanel.style.top = top + 'px';
        todoPanel.style.right = 'auto';
    }
}

function renderTodoList() {
    const todoItems = document.getElementById('todo-items');
    if (!todoItems) return;

    todoItems.innerHTML = '';

    todos.forEach((todo, index) => {
        const todoItem = document.createElement('div');
        todoItem.className = `todo-entry ${todo.completed ? 'completed' : ''}`;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'todo-entry-check';
        checkbox.checked = todo.completed;
        checkbox.onchange = () => toggleTodo(index);

        const text = document.createElement('div');
        text.className = 'todo-entry-text';
        text.title = todo.text;
        const textSpan = document.createElement('span');
        textSpan.className = 'todo-entry-text-inner';
        textSpan.textContent = todo.text;
        text.appendChild(textSpan);
        text.onclick = () => editTodo(index);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'todo-entry-delete';
        deleteBtn.textContent = '×';
        deleteBtn.title = '删除';
        deleteBtn.onclick = () => deleteTodo(index);

        todoItem.appendChild(checkbox);
        todoItem.appendChild(text);
        todoItem.appendChild(deleteBtn);
        todoItems.appendChild(todoItem);
    });

    todoItems.classList.toggle('scrollable', todos.length > 5);

    requestAnimationFrame(measureTodoTextScroll);
}

function measureTodoTextScroll() {
    document.querySelectorAll('#todo-items .todo-entry-text').forEach(el => {
        el.classList.remove('auto-scroll');
        const inner = el.querySelector('.todo-entry-text-inner');
        if (!inner) return;
        const overflow = inner.offsetWidth - el.clientWidth;
        if (overflow > 4) {

            el.style.setProperty('--scroll-distance', -(overflow + 6) + 'px');
            el.classList.add('auto-scroll');
        }
    });
}

async function toggleTodo(index) {
    todos[index].completed = !todos[index].completed;
    await storageManager.saveData(STORAGE_KEYS.TODOS, todos);
    renderTodoList();
}

async function editTodo(index) {
    const todoItems = document.getElementById('todo-items');
    if (!todoItems) return;
    const todoItem = todoItems.children[index];
    if (!todoItem || todoItem.querySelector('.todo-entry-edit-input')) return;
    const textElement = todoItem.querySelector('.todo-entry-text');
    if (!textElement) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'todo-entry-edit-input';
    input.value = todos[index].text;
    todoItem.replaceChild(input, textElement);
    input.focus();

    let done = false;
    const finish = async (save) => {
        if (done) return;
        done = true;
        const value = input.value.trim();
        if (save && value && value !== todos[index].text) {
            todos[index].text = value;
            await storageManager.saveData(STORAGE_KEYS.TODOS, todos);
        }
        renderTodoList();
    };

    input.onkeydown = (e) => {
        if (e.key === 'Enter') {
            finish(true);
        } else if (e.key === 'Escape') {
            finish(false);
        }
    };
    input.onblur = () => finish(true);
}

async function deleteTodo(index) {
    todos.splice(index, 1);
    await storageManager.saveData(STORAGE_KEYS.TODOS, todos);
    renderTodoList();
}

function applyTimeDateSettings(settings) {
    const timeElement = document.getElementById('time');
    const dateElement = document.getElementById('date');

    if (settings.showTime !== false) {
        timeElement.style.display = 'block';
        timeElement.style.color = settings.timeColor || '#ffffff';
        timeElement.style.fontSize = settings.timeSize || '36px';

        if (settings.fontShadow) {
            timeElement.style.textShadow = '3px 3px 6px rgba(0, 0, 0, 0.8)';
        } else {
            timeElement.style.textShadow = 'none';
        }
    } else {
        timeElement.style.display = 'none';
    }

    if (settings.showDate !== false) {
        dateElement.style.display = 'block';
        dateElement.style.color = settings.dateColor || '#ffffff';
        dateElement.style.fontSize = settings.dateSize || '18px';

        if (settings.fontShadow) {
            dateElement.style.textShadow = '3px 3px 6px rgba(0, 0, 0, 0.8)';
        } else {
            dateElement.style.textShadow = 'none';
        }
    } else {
        dateElement.style.display = 'none';
    }
}

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

async function updateEngineUI() {
    const currentEngineName = document.getElementById('current-engine-name');
    if (!currentEngineName) return;

    const engines = await getSearchEngines();
    const engine = window.searchEngine || 'bing';

    if (engines[engine]) {
        currentEngineName.textContent = engines[engine].name;
    }

    const engineItems = document.querySelectorAll('.engine-item');
    engineItems.forEach(item => {
        item.classList.remove('active');
        if (item.dataset.engine === engine) {
            item.classList.add('active');
        }
    });
}

async function getSearchEngines() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['andy_tab_search_engines'], function(result) {
            const engines = result['andy_tab_search_engines'] || {};
            resolve(engines);
        });
    });
}

function loadImage(src, crossOrigin, timeout = 5000) {
    return new Promise((resolve) => {
        const img = new Image();
        if (crossOrigin) {
            img.crossOrigin = 'anonymous';
        }
        const timer = setTimeout(() => resolve(null), timeout);
        img.onload = () => {
            clearTimeout(timer);
            resolve(img);
        };
        img.onerror = () => {
            clearTimeout(timer);
            resolve(null);
        };
        img.src = src;
    });
}

function fitEngineNames() {
    document.querySelectorAll('.search-engine-dropdown .engine-name').forEach(el => {
        el.style.fontSize = '';

        const measure = document.createElement('span');
        measure.textContent = el.textContent;
        measure.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:inherit;';
        el.appendChild(measure);
        const textWidth = measure.offsetWidth;
        measure.remove();

        if (textWidth <= el.clientWidth) return;

        const ratio = el.clientWidth / textWidth;
        const target = Math.max(13.6 * ratio, 9);
        el.style.fontSize = target + 'px';
    });
}

async function fetchEngineIcon(origin) {
    const iconUrl = origin + '/favicon.ico';

    const img = await loadImage(iconUrl, true);
    if (img) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 32;
            canvas.height = 32;
            canvas.getContext('2d').drawImage(img, 0, 0, 32, 32);
            return canvas.toDataURL('image/png');
        } catch (e) {

        }
    }

    const fallback = await loadImage(iconUrl, false);
    return fallback ? iconUrl : null;
}

function attachEngineIcon(placeholder, src) {
    const img = document.createElement('img');
    img.className = 'engine-icon';
    img.alt = '';
    img.onload = () => {
        if (placeholder.isConnected) {
            placeholder.replaceWith(img);
        }
    };
    img.src = src;
}

async function renderEngineDropdown() {
    const engineDropdown = document.getElementById('engine-dropdown');
    const engines = await getSearchEngines();

    engineDropdown.innerHTML = '';

    const iconCache = await storageManager.getData(STORAGE_KEYS.ENGINE_ICONS, {});
    let cacheUpdated = false;
    const fetchTasks = [];

    for (const [key, engine] of Object.entries(engines)) {
        const engineItem = document.createElement('div');
        engineItem.className = 'engine-item';
        engineItem.dataset.engine = key;

        const placeholder = document.createElement('span');
        placeholder.className = 'engine-icon engine-icon-placeholder';
        placeholder.textContent = '🔍';
        engineItem.appendChild(placeholder);

        const name = document.createElement('span');
        name.className = 'engine-name';
        name.textContent = engine.name;
        engineItem.appendChild(name);

        try {
            const origin = new URL(engine.url.replace('%s', 'q')).origin;
            const cachedIcon = iconCache[origin];
            if (cachedIcon) {

                attachEngineIcon(placeholder, cachedIcon);
            } else {

                fetchTasks.push(
                    fetchEngineIcon(origin).then(iconSrc => {
                        if (!iconSrc) return;

                        if (iconSrc.startsWith('data:')) {
                            iconCache[origin] = iconSrc;
                            cacheUpdated = true;
                        }
                        if (placeholder.isConnected) {
                            attachEngineIcon(placeholder, iconSrc);
                        }
                    })
                );
            }
        } catch (e) {

        }

        engineItem.addEventListener('click', async function() {
            const engine = this.dataset.engine;

            window.searchEngine = engine;

            const settings = await getSettings();
            settings.searchEngine = engine;
            chrome.storage.local.set({
                [STORAGE_KEYS.SETTINGS]: settings
            });

            await updateEngineUI();

            const engineSelectBtn = document.getElementById('search-engine-select');
            engineSelectBtn.classList.remove('active');
            engineDropdown.classList.remove('show');
        });

        engineDropdown.appendChild(engineItem);
    }

    Promise.all(fetchTasks).then(() => {
        if (cacheUpdated) {
            storageManager.saveData(STORAGE_KEYS.ENGINE_ICONS, iconCache);
        }
    });

    if (engineDropdown.classList.contains('show')) {
        fitEngineNames();
    }
}

async function initSearch() {
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const engineSelectBtn = document.getElementById('search-engine-select');
    const engineDropdown = document.getElementById('engine-dropdown');

    await renderEngineDropdown();

    async function performSearch() {
        const query = searchInput.value.trim();
        if (query) {

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

    engineSelectBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        this.classList.toggle('active');
        engineDropdown.classList.toggle('show');
        if (engineDropdown.classList.contains('show')) {
            fitEngineNames();
        }
    });

    document.addEventListener('click', function(e) {
        if (!e.target.closest('.search-engine-selector')) {
            engineSelectBtn.classList.remove('active');
            engineDropdown.classList.remove('show');
        }
    });

    engineDropdown.addEventListener('click', function(e) {
        e.stopPropagation();
    });

    searchBtn.addEventListener('click', performSearch);

    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    const settings = await getSettings();
    window.searchEngine = settings.searchEngine || 'bing';
    await updateEngineUI();

    searchInput.focus();
}

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

    const tabContainer = shortcutModal.querySelector('.tab-container');
    const tabBtns = tabContainer.querySelectorAll('.tab-btn');
    const tabPanes = tabContainer.querySelectorAll('.tab-pane');

    const dataSourceBtns = tabContainer.querySelectorAll('.data-source-btn');
    const browserDataSearch = tabContainer.querySelector('#browser-data-search');
    const websiteList = tabContainer.querySelector('#website-list');
    const addSelectedBtn = tabContainer.querySelector('#add-selected-btn');
    const cancelBrowserDataBtn = tabContainer.querySelector('#cancel-browser-data-btn');

    const uploadIconBtn = document.getElementById('upload-icon-btn');
    const iconFileInput = document.getElementById('icon-file-input');

    let currentDataSource = 'bookmarks';
    let allBrowserItems = [];
    let filteredBrowserItems = [];
    let selectedItems = new Set();
    let editingIndex = null;
    let isEditMode = false;

    function initTabSwitching() {
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

                if (targetTab === 'browser-data') {
                    loadBrowserData();
                }
            });
        });
    }

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

    async function getBookmarks() {
        return new Promise((resolve) => {
            chrome.bookmarks.getTree((bookmarkTreeNodes) => {
                const bookmarks = [];

                function traverseBookmarks(nodes) {
                    nodes.forEach(node => {
                        if (node.url) {

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

    async function getHistory() {
        return new Promise((resolve) => {

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

        addWebsiteItemListeners();
    }

    function addWebsiteItemListeners() {
        const websiteItems = document.querySelectorAll('.website-item');
        const checkboxes = document.querySelectorAll('.website-checkbox');

        websiteItems.forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.type !== 'checkbox') {
                    const checkbox = item.querySelector('.website-checkbox');
                    checkbox.checked = !checkbox.checked;
                    updateSelectedItems(checkbox);
                }
            });
        });

        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                updateSelectedItems(checkbox);
            });
        });
    }

    function updateSelectedItems(checkbox) {
        const id = checkbox.dataset.id;

        if (checkbox.checked) {
            selectedItems.add(id);
        } else {
            selectedItems.delete(id);
        }

        addSelectedBtn.disabled = selectedItems.size === 0;

        const websiteItem = document.querySelector(`.website-item[data-id="${id}"]`);
        if (checkbox.checked) {
            websiteItem.classList.add('selected');
        } else {
            websiteItem.classList.remove('selected');
        }
    }

    async function loadShortcuts() {
        const result = await chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]);
        const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
        currentPage = 1;

        const settings = await getSettings();
        const userRows = parseInt(settings.rows) || 3;
        const userColumns = parseInt(settings.columns) || 6;
        const maxItemsPerPage = userRows * userColumns;

        const firstPageItemCount = Math.min(shortcuts.length, maxItemsPerPage);
        const actualRowsNeeded = Math.ceil(firstPageItemCount / userColumns);

        const effectiveRows = Math.min(userRows, actualRowsNeeded);

        itemsPerPage = effectiveRows * userColumns;
        totalPages = Math.ceil(shortcuts.length / itemsPerPage);

        await renderShortcuts(shortcuts);
    }

async function saveShortcuts(shortcuts) {
    await chrome.storage.local.set({
        [STORAGE_KEYS.SHORTCUTS]: shortcuts
    });
}

function editShortcut(index) {
    const shortcutModal = document.getElementById('add-shortcut-modal');
    const shortcutForm = document.getElementById('shortcut-form');

    chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS], function(result) {
        const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
        const shortcut = shortcuts[index];

        if (shortcut) {

            resetBrowserDataState();

            document.getElementById('shortcut-name').value = shortcut.name;
            document.getElementById('shortcut-url').value = shortcut.url;
            document.getElementById('shortcut-icon-type').value = shortcut.iconType || 'auto';
            document.getElementById('shortcut-custom-color').value = shortcut.customColor || '#6366f1';
            document.getElementById('shortcut-icon').value = shortcut.icon || '';

            if (shortcut.iconType === 'custom') {
                document.getElementById('custom-icon-group').style.display = 'block';
                document.getElementById('solid-color-group').style.display = 'none';
            } else {
                document.getElementById('custom-icon-group').style.display = 'none';
                document.getElementById('solid-color-group').style.display = 'block';
            }

            shortcutModal.querySelector('h3').textContent = '编辑快捷方式';
            shortcutForm.querySelector('button[type="submit"]').textContent = '保存';

            shortcutForm.dataset.editingIndex = index;

            editingIndex = index;
            isEditMode = true;

            shortcutModal.classList.add('show');
        }
    });
}

function confirmDeleteShortcut(index, name) {
    if (confirm(`确定要删除快捷方式 "${name}" 吗？`)) {
        deleteShortcut(index);
    }
}

async function deleteShortcut(index) {
    const result = await chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]);
    const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
    shortcuts.splice(index, 1);
    await saveShortcuts(shortcuts);
    await renderShortcuts(shortcuts);
}

async function renderShortcuts(shortcuts, isPreview = false) {

    if (isRenderingShortcuts) {
        return;
    }

    isRenderingShortcuts = true;

    try {

        if (!isPreview) {
            allShortcuts = shortcuts;
        }

        const customIconUrls = shortcuts
            .filter(shortcut => shortcut.iconType === 'custom' && shortcut.icon)
            .map(shortcut => shortcut.icon);

        if (customIconUrls.length > 0) {

            imageCacheManager.preloadIcons(customIconUrls);
        }

        const shortcutsContainer = document.getElementById('shortcuts-container');
        if (!shortcutsContainer) return;

        shortcutsContainer.innerHTML = '';

        const settings = await getSettings();

        const userRows = parseInt(settings.rows) || 3;
        const userColumns = parseInt(settings.columns) || 6;
        const maxItemsPerPage = userRows * userColumns;

        const firstPageItemCount = Math.min(shortcuts.length, maxItemsPerPage);
        const actualRowsNeeded = Math.ceil(firstPageItemCount / userColumns);

        const effectiveRows = Math.min(userRows, actualRowsNeeded);

        itemsPerPage = effectiveRows * userColumns;
        totalPages = Math.ceil(shortcuts.length / itemsPerPage);

        if (currentPage > totalPages) {
            currentPage = Math.max(1, totalPages);
        }

        const shortcutsWrapper = document.createElement('div');
        shortcutsWrapper.className = 'shortcuts-wrapper';
        shortcutsWrapper.style.position = 'relative';
        shortcutsWrapper.style.width = '100%';
        shortcutsWrapper.style.display = 'flex';
        shortcutsWrapper.style.flexDirection = 'column';
        shortcutsWrapper.style.alignItems = 'center';

        const swiperContainer = document.createElement('div');
        swiperContainer.className = 'swiper-container';
        swiperContainer.style.position = 'relative';
        swiperContainer.style.width = '100%';
        swiperContainer.style.overflow = 'hidden';
        swiperContainer.style.height = 'auto';
        swiperContainer.style.boxSizing = 'border-box';

        const swiperWrapper = document.createElement('div');
        swiperWrapper.className = 'swiper-wrapper';
        swiperWrapper.style.display = 'flex';
        swiperWrapper.style.transition = 'transform 0.5s ease';
        swiperWrapper.style.transform = `translateX(${(currentPage - 1) * -100}%)`;
        swiperWrapper.style.width = '100%';
        swiperWrapper.style.height = '100%';
        swiperWrapper.style.flexWrap = 'nowrap';
        swiperWrapper.style.boxSizing = 'border-box';

        for (let page = 1; page <= totalPages; page++) {

            const pageElement = document.createElement('div');
            pageElement.className = 'swiper-slide';
            pageElement.style.flex = '0 0 100%';
            pageElement.style.width = '100%';
            pageElement.style.height = '100%';
            pageElement.style.display = 'flex';
            pageElement.style.justifyContent = 'center';
            pageElement.style.alignItems = 'flex-start';
            pageElement.style.overflow = 'hidden';
            pageElement.style.boxSizing = 'border-box';
            pageElement.style.flexShrink = '0';
            pageElement.style.minWidth = '100%';

            const shortcutsGrid = document.createElement('div');
            shortcutsGrid.className = 'shortcuts-grid';
            shortcutsGrid.dataset.page = page;

            if (settings.columns) {
                shortcutsGrid.style.gridTemplateColumns = `repeat(${settings.columns}, auto)`;
            }
            if (settings.columnGap) {
                shortcutsGrid.style.columnGap = settings.columnGap;
            }
            if (settings.rowGap) {
                shortcutsGrid.style.rowGap = settings.rowGap;
            }

            shortcutsGrid.draggable = false;

            const startIndex = (page - 1) * itemsPerPage;
            const endIndex = startIndex + itemsPerPage;
            const currentPageShortcuts = shortcuts.slice(startIndex, endIndex);

            for (const [pageIndex, shortcut] of currentPageShortcuts.entries()) {
                const globalIndex = startIndex + pageIndex;
                const shortcutItem = document.createElement('a');
                shortcutItem.className = 'shortcut-item' + (isEditMode ? ' edit-mode' : '');
                shortcutItem.title = `${shortcut.name}\n${shortcut.url}`;
                shortcutItem.dataset.index = globalIndex;
                shortcutItem.dataset.pageIndex = pageIndex;
                shortcutItem.href = shortcut.url;

                shortcutItem.draggable = true;
                shortcutItem.addEventListener('dragstart', handleDragStart);
                shortcutItem.addEventListener('dragover', handleDragOver);
                shortcutItem.addEventListener('dragleave', handleDragLeave);
                shortcutItem.addEventListener('drop', handleDrop);
                shortcutItem.addEventListener('dragend', handleDragEnd);

                const icon = document.createElement('div');
                icon.className = 'shortcut-icon';

                if (shortcut.iconType === 'custom' && shortcut.icon) {

                    const img = document.createElement('img');

                    const cachedIcon = await imageCacheManager.getCachedImage(shortcut.icon, false);
                    if (cachedIcon) {
                        img.src = cachedIcon;
                    } else {

                        img.src = shortcut.icon;

                        imageCacheManager.cacheImage(shortcut.icon, false).catch(() => {});
                    }

                    img.alt = shortcut.name;
                    img.onerror = function() {

                        this.style.display = 'none';
                        icon.innerHTML = getNameInitial(shortcut.name);
                        icon.classList.add('default-icon');

                        const settings = window.cachedSettings || getSettingsSync();
                        if (settings.iconSize) {
                            const iconSizeValue = parseInt(settings.iconSize.replace('px', ''));

                            const textSize = Math.max(10, Math.min(48, iconSizeValue * 0.3));
                            icon.style.fontSize = textSize + 'px';
                        }
                    };
                    icon.appendChild(img);
                } else {

                    icon.innerHTML = getNameInitial(shortcut.name);
                    icon.classList.add('default-icon');

                    const color = shortcut.customColor || generateNameColor(shortcut.name);
                    icon.style.backgroundColor = color;
                }

                const name = document.createElement('div');
                name.className = 'shortcut-name';
                name.textContent = shortcut.name;

                const overlay = document.createElement('div');
                overlay.className = 'shortcut-overlay';

                const editButton = document.createElement('button');
                editButton.className = 'shortcut-edit-button';
                editButton.innerHTML = '✏️';
                editButton.title = '编辑快捷方式';

                const deleteIcon = document.createElement('button');
                deleteIcon.className = 'shortcut-delete-icon';
                deleteIcon.innerHTML = '❌';
                deleteIcon.title = '删除快捷方式';

                shortcutItem.appendChild(icon);
                shortcutItem.appendChild(name);
                shortcutItem.appendChild(overlay);
                shortcutItem.appendChild(editButton);
                shortcutItem.appendChild(deleteIcon);

                if (isEditMode && !isPreview) {
                    shortcutItem.addEventListener('mouseenter', () => {

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

                    if (shortcut.iconType !== 'custom' || !shortcut.icon) {
                        const iconSizeValue = parseInt(settings.iconSize.replace('px', ''));

                        const textSize = Math.max(10, Math.min(48, iconSizeValue * 0.3));
                        icon.style.fontSize = textSize + 'px';
                    }
                }

                if (settings.fontShadow) {
                    name.style.textShadow = '3px 3px 6px rgba(0, 0, 0, 0.8)';
                }

                if (settings.fontSize) {
                    name.style.fontSize = settings.fontSize;
                }

                if (settings.fontColor) {
                    name.style.color = settings.fontColor;
                }

            if (!isEditMode) {

                let longPressTimer;
                let startTime;
                let startX;
                let startY;
                const LONG_PRESS_DURATION = 500;
                const MOVE_THRESHOLD = 10;

                shortcutItem.addEventListener('click', async (e) => {
                    e.preventDefault();
                    const settings = await getSettings();
                    const target = settings.openWebsitesInNewTab !== false ? '_blank' : '_self';
                    window.open(shortcut.url, target);
                });

                shortcutItem.addEventListener('mousedown', (e) => {

                    startTime = Date.now();
                    startX = e.clientX;
                    startY = e.clientY;

                    clearTimeout(longPressTimer);

                    longPressTimer = setTimeout(async () => {

                        if (isDragging) {
                            return;
                        }

                        isEditMode = true;
                        const editShortcutsBtn = document.getElementById('edit-shortcuts');
                        if (editShortcutsBtn) {
                            editShortcutsBtn.textContent = '完成编辑';
                        }

                        const result = await chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]);
                        const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
                        await renderShortcuts(shortcuts);

                        setTimeout(() => {
                            document.addEventListener('click', handleGlobalClickInEditMode);
                        }, 0);
                    }, LONG_PRESS_DURATION);
                });

                shortcutItem.addEventListener('mouseup', () => {
                    clearTimeout(longPressTimer);
                });

                shortcutItem.addEventListener('mouseleave', () => {
                    clearTimeout(longPressTimer);
                });

                shortcutItem.addEventListener('mousemove', (e) => {
                    if (startX !== undefined && startY !== undefined) {
                        const dx = Math.abs(e.clientX - startX);
                        const dy = Math.abs(e.clientY - startY);

                        if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
                            clearTimeout(longPressTimer);
                        }
                    }
                });
            }
            else {

                shortcutItem.addEventListener('click', async (e) => {

                    if (e.target.closest('.shortcut-delete-icon')) {
                        return;
                    }

                    e.preventDefault();
                    e.stopPropagation();

                    editShortcut(globalIndex);
                });
            }

                editButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    editShortcut(globalIndex);
                });

                deleteIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    confirmDeleteShortcut(globalIndex, shortcut.name);
                });

                shortcutsGrid.appendChild(shortcutItem);
            }

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

            pageElement.appendChild(shortcutsGrid);

            swiperWrapper.appendChild(pageElement);
        }

        swiperContainer.appendChild(swiperWrapper);

        shortcutsWrapper.appendChild(swiperContainer);

        if (totalPages > 1) {
            const pagination = createPagination();
            shortcutsWrapper.appendChild(pagination);
        }

        shortcutsContainer.appendChild(shortcutsWrapper);

        document.addEventListener('wheel', handleWheelNavigation);

        window.swiperWrapper = swiperWrapper;

    } finally {

        isRenderingShortcuts = false;

        applyShortcutsGridScaling();
    }
}

function createPagination() {
    const pagination = document.createElement('div');
    pagination.className = 'pagination';

    if (totalPages <= 1) {
        return pagination;
    }

    for (let i = 1; i <= totalPages; i++) {
        const pageButton = document.createElement('button');
        pageButton.className = `pagination-btn ${i === currentPage ? 'active' : ''}`;
        pageButton.title = `第 ${i} 页`;
        pageButton.addEventListener('click', () => changePage(i));
        pagination.appendChild(pageButton);
    }

    return pagination;
}

async function changePage(page) {
    if (page < 1 || page > totalPages) return;

    currentPage = page;

    if (window.swiperWrapper) {
        window.swiperWrapper.style.transform = `translateX(${(currentPage - 1) * -100}%)`;
    }

    updatePaginationButtons();
}

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

function applyShortcutsGridScaling() {
    const shortcutsGrids = document.querySelectorAll('.shortcuts-grid');
    if (shortcutsGrids.length === 0) return;

    const firstGrid = shortcutsGrids[0];

    const shortcutsContainer = document.getElementById('shortcuts-container');
    if (!shortcutsContainer) return;

    const containerWidth = shortcutsContainer.clientWidth;

    const gridWidth = firstGrid.scrollWidth;

    const availableWidth = containerWidth - 40;
    let scale = 1;

    if (gridWidth > availableWidth) {
        scale = availableWidth / gridWidth;

        scale = Math.max(scale, 0.5);
    }

    shortcutsGrids.forEach(grid => {

        const originalTransform = grid.style.transform;

        if (originalTransform && !originalTransform.includes('scale')) {
            grid.style.transform = `${originalTransform} scale(${scale})`;
        } else {
            grid.style.transform = `scale(${scale})`;
        }

        grid.style.transformOrigin = 'center center';

        if (scale < 1) {
            const scaleDifference = 1 - scale;
            const marginBottom = scaleDifference * grid.offsetHeight / 2;
            grid.style.marginBottom = `${marginBottom}px`;
        } else {
            grid.style.marginBottom = '';
        }

        grid.style.opacity = 1;
    });
}

window.addEventListener('resize', () => {

    clearTimeout(window.resizeTimeout);
    window.resizeTimeout = setTimeout(() => {
        applyShortcutsGridScaling();
    }, 200);
});

async function handleWheelNavigation(e) {

    const settingsPanel = document.getElementById('settings-panel');
    const addShortcutModal = document.getElementById('add-shortcut-modal');
    const manageEnginesModal = document.getElementById('manage-engines-modal');

    const isSettingsOpen = settingsPanel?.classList.contains('open');
    const isAddShortcutModalOpen = addShortcutModal?.classList.contains('show');
    const isManageEnginesModalOpen = manageEnginesModal?.classList.contains('show');

    if (isSettingsOpen || isAddShortcutModalOpen || isManageEnginesModalOpen) {
        return;
    }

    if (totalPages <= 1) return;

    let deltaX = e.deltaX;

    if (Math.abs(deltaX) < Math.abs(e.deltaY)) {
        deltaX = e.deltaY;
    }

    if (deltaX > 0 && currentPage < totalPages) {

        await changePage(currentPage + 1);
    } else if (deltaX < 0 && currentPage > 1) {

        await changePage(currentPage - 1);
    }
}

let draggedItem = null;
let draggedFromIndex = null;
let draggedFromPage = null;
let draggedShortcutUrl = null;
let isDragging = false;
let isChangingPage = false;
let previewShortcuts = [];
let isPreviewing = false;
let lastDropTarget = null;

function handleDragStart(e) {

    isDragging = true;
    isPreviewing = true;
    lastDropTarget = null;

    draggedItem = this;
    draggedFromIndex = parseInt(this.dataset.index);
    draggedFromPage = currentPage;

    previewShortcuts = [...allShortcuts];

    draggedShortcutUrl = this.href;

    if (isEditMode) {

        const allShortcutItems = document.querySelectorAll('.shortcut-item');
        allShortcutItems.forEach(item => {

            const overlay = item.querySelector('.shortcut-overlay');
            const editButton = item.querySelector('.shortcut-edit-button');
            if (overlay) overlay.style.display = 'none';
            if (editButton) editButton.style.display = 'none';
        });

        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedFromIndex.toString());

        this.style.opacity = '0.5';
        this.style.zIndex = '1000';

        const dragPreview = this.cloneNode(true);
        dragPreview.style.position = 'fixed';
        dragPreview.style.pointerEvents = 'none';
        dragPreview.style.opacity = '0.8';
        dragPreview.style.zIndex = '9999';

        const rect = this.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;
        dragPreview.style.left = (e.clientX - offsetX) + 'px';
        dragPreview.style.top = (e.clientY - offsetY) + 'px';

        document.body.appendChild(dragPreview);

        e.dataTransfer.setDragImage(dragPreview, offsetX, offsetY);

        setTimeout(() => {
            document.body.removeChild(dragPreview);
        }, 0);

        createEdgeHighlights();

        document.addEventListener('dragover', handleDragOverGlobal);
    } else {

        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', draggedShortcutUrl);

        this.style.opacity = '0.5';
        this.style.zIndex = '1000';

        document.addEventListener('dragover', handleDragOverGlobalNonEditMode);
        document.addEventListener('drop', handleDropGlobalNonEditMode);
    }
}

function createEdgeHighlights() {

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

function handleDragOver(e) {
    if (!draggedItem || !isPreviewing) return;

    e.preventDefault();

    if (isEditMode) {

        e.dataTransfer.dropEffect = 'move';

        const dropTarget = this;
        const dropIndex = parseInt(dropTarget.dataset.index);

        if (dropTarget !== lastDropTarget && dropIndex !== draggedFromIndex) {
            lastDropTarget = dropTarget;

            const newPreviewShortcuts = [...previewShortcuts];
            const [draggedShortcut] = newPreviewShortcuts.splice(draggedFromIndex, 1);
            newPreviewShortcuts.splice(dropIndex, 0, draggedShortcut);

            previewShortcuts = newPreviewShortcuts;

            insertDOMElement(draggedItem, dropTarget);

            updateAllElementIndexes();

            draggedFromIndex = dropIndex;
        }

        if (this !== draggedItem) {
            this.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
        }
    } else {

        e.dataTransfer.dropEffect = 'copy';
    }
}

function insertDOMElement(draggedElement, targetElement) {
    if (draggedElement === targetElement) return;

    const parent1 = draggedElement.parentNode;
    const parent2 = targetElement.parentNode;

    if (parent1 !== parent2) {

        parent2.insertBefore(draggedElement, targetElement);
    } else {

        parent1.insertBefore(draggedElement, targetElement);
    }
}

function updateAllElementIndexes() {
    const allItems = document.querySelectorAll('.shortcut-item');
    allItems.forEach((item, index) => {
        item.dataset.index = index;
    });
}

function handleDragLeave(e) {
    if (!draggedItem) return;

    if (isEditMode) {

        this.style.backgroundColor = '';
    }

}

function handleDragEnd(e) {

    isDragging = false;
    isPreviewing = false;

    if (previewShortcuts.length > 0) {

        saveShortcuts(previewShortcuts);

        allShortcuts = [...previewShortcuts];

        previewShortcuts = [];
    }

    if (draggedItem) {
        draggedItem.style.opacity = '';
        draggedItem.style.transform = '';
        draggedItem.style.zIndex = '';
    }

    if (isEditMode) {

        const allItems = document.querySelectorAll('.shortcut-item');
        allItems.forEach(item => {
            item.style.backgroundColor = '';

            const overlay = item.querySelector('.shortcut-overlay');
            const editButton = item.querySelector('.shortcut-edit-button');
            if (overlay) overlay.style.display = 'none';
            if (editButton) editButton.style.display = 'none';
        });

        removeEdgeHighlights();

        clearInterval(window.autoPageTimer);
        document.removeEventListener('dragover', handleDragOverGlobal);
    } else {

        document.removeEventListener('dragover', handleDragOverGlobalNonEditMode);
        document.removeEventListener('drop', handleDropGlobalNonEditMode);
    }

    draggedItem = null;
    draggedFromIndex = null;
    draggedFromPage = null;
    draggedShortcutUrl = null;
}

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

function handleDragOverGlobal(e) {
    if (!isEditMode || !draggedItem) return;

    const currentPageShortcuts = document.querySelectorAll(`.swiper-slide:nth-child(${currentPage}) .shortcut-item`);
    if (currentPageShortcuts.length === 0) return;

    const leftmostItem = currentPageShortcuts[0];
    const rightmostItem = currentPageShortcuts[currentPageShortcuts.length - 1];

    const mouseX = e.clientX;
    const mouseY = e.clientY;

    const leftHighlight = document.getElementById('left-edge-highlight');
    const rightHighlight = document.getElementById('right-edge-highlight');

    const leftItemRect = leftmostItem.getBoundingClientRect();
    const rightItemRect = rightmostItem.getBoundingClientRect();

    const elementUnderMouse = document.elementFromPoint(mouseX, mouseY);
    const isOverShortcut = elementUnderMouse && elementUnderMouse.closest('.shortcut-item');

    if (isOverShortcut) {

        if (leftHighlight) leftHighlight.style.opacity = '0';
        if (rightHighlight) rightHighlight.style.opacity = '0';

        if (window.autoPageTimer) {
            clearTimeout(window.autoPageTimer);
            window.autoPageTimer = null;
        }
        return;
    }

    const isNearLeftEdge = mouseX <= leftItemRect.left;

    const isNearRightEdge = mouseX >= rightItemRect.right;

    if (isChangingPage) {
        if (leftHighlight) {
            leftHighlight.style.opacity = '0';
        }
        if (rightHighlight) {
            rightHighlight.style.opacity = '0';
        }
        return;
    }

    if (isNearLeftEdge && currentPage > 1) {

        if (leftHighlight) {
            leftHighlight.style.opacity = '1';

            leftHighlight.style.left = `${leftItemRect.left - 130}px`;
            leftHighlight.style.top = `${leftItemRect.top + leftItemRect.height / 2}px`;

            leftHighlight.style.width = '120px';
            leftHighlight.style.height = '40px';
        }

        if (!window.autoPageTimer) {
            window.autoPageTimer = setTimeout(async () => {
                isChangingPage = true;
                await changePage(currentPage - 1);

                window.autoPageTimer = null;

                setTimeout(() => {
                    isChangingPage = false;
                }, 300);
            }, 800);
        }
    }

    else if (isNearRightEdge && currentPage < totalPages) {

        if (rightHighlight) {
            rightHighlight.style.opacity = '1';

            rightHighlight.style.left = `${rightItemRect.right + 10}px`;
            rightHighlight.style.top = `${rightItemRect.top + rightItemRect.height / 2}px`;

            rightHighlight.style.width = '120px';
            rightHighlight.style.height = '40px';
        }

        if (!window.autoPageTimer) {
            window.autoPageTimer = setTimeout(async () => {
                isChangingPage = true;
                await changePage(currentPage + 1);

                window.autoPageTimer = null;

                setTimeout(() => {
                    isChangingPage = false;
                }, 300);
            }, 800);
        }
    }

    else {

        if (leftHighlight) {
            leftHighlight.style.opacity = '0';
        }
        if (rightHighlight) {
            rightHighlight.style.opacity = '0';
        }

        if (window.autoPageTimer) {
            clearTimeout(window.autoPageTimer);
            window.autoPageTimer = null;
        }
    }
}

async function handleDrop(e) {
    if (!isEditMode || !draggedItem) return;

    e.preventDefault();

    const dropTarget = this;
    const dropIndex = parseInt(dropTarget.dataset.index);

    if (draggedFromIndex === dropIndex) {
        return;
    }

}

function handleDragOverGlobalNonEditMode(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
}

function handleDropGlobalNonEditMode(e) {
    e.preventDefault();

    const dropTarget = e.target;
    const isShortcutArea = dropTarget.closest('.shortcut-item') ||
                         dropTarget.closest('.shortcuts-grid') ||
                         dropTarget.closest('#shortcuts-container');

    if (!isShortcutArea && draggedShortcutUrl) {
        window.open(draggedShortcutUrl, '_blank');
    }
}

window.renderShortcuts = renderShortcuts;

    async function addShortcut(shortcut) {
        const result = await chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]);
        const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
        shortcuts.push(shortcut);
        await saveShortcuts(shortcuts);
        await renderShortcuts(shortcuts);
    }

    addShortcutBtn.addEventListener('click', function() {

        resetBrowserDataState();

        shortcutForm.reset();
        shortcutModal.querySelector('h3').textContent = '添加常用网站';
        shortcutForm.querySelector('button[type="submit"]').textContent = '添加';
        document.getElementById('custom-icon-group').style.display = 'none';
        document.getElementById('solid-color-group').style.display = 'block';
        document.getElementById('shortcut-icon-type').value = 'auto';

        shortcutModal.classList.add('show');
    });

    editShortcutsBtn.addEventListener('click', async function(e) {

        e.stopPropagation();

        isEditMode = !isEditMode;
        editShortcutsBtn.textContent = isEditMode ? '完成编辑' : '编辑快捷方式';

        settingsPanel.classList.remove('open');

        const result = await chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]);
        const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
        await renderShortcuts(shortcuts);

        if (isEditMode) {

            setTimeout(() => {
                document.addEventListener('click', handleGlobalClickInEditMode);
            }, 0);
        } else {
            document.removeEventListener('click', handleGlobalClickInEditMode);
        }
    });

    function handleGlobalClickInEditMode(e) {

        if (e.target.closest('#shortcuts-container') || e.target.closest('.shortcuts-grid')) {
            return;
        }

        if (e.target.id === 'edit-shortcuts' || e.target.closest('#edit-shortcuts')) {
            return;
        }

        if (e.target.closest('.settings-panel') ||
            e.target.closest('.modal') ||
            e.target.classList.contains('modal')) {
            return;
        }

        isEditMode = false;
        editShortcutsBtn.textContent = '编辑快捷方式';

        chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]).then(result => {
            const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
            renderShortcuts(shortcuts);
        });

        document.removeEventListener('click', handleGlobalClickInEditMode);
    }

    function initDataSourceSwitching() {
        dataSourceBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const source = btn.dataset.source;
                if (source !== currentDataSource) {
                    currentDataSource = source;

                    dataSourceBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    browserDataSearch.value = '';
                    selectedItems.clear();
                    addSelectedBtn.disabled = true;

                    loadBrowserData();
                }
            });
        });
    }

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

    async function addSelectedItems() {
        if (selectedItems.size === 0) return;

        if (addSelectedBtn.disabled) {
            return;
        }

        addSelectedBtn.disabled = true;
        addSelectedBtn.textContent = '处理中...';

        const itemsToAdd = allBrowserItems.filter(item => selectedItems.has(item.id));

        if (isEditMode) {

            if (itemsToAdd.length > 0 && editingIndex !== null) {
                const item = itemsToAdd[0];

                try {

                    const websiteInfo = await fetchWebsiteInfoDirectly(item.url);

                    const updatedShortcut = {
                        name: item.title,
                        url: item.url,
                        iconType: websiteInfo.success && websiteInfo.data.icon ? 'custom' : 'auto',
                        icon: websiteInfo.success ? websiteInfo.data.icon || '' : '',
                        customColor: generateNameColor(item.title),
                        id: Date.now().toString(36) + Math.random().toString(36).substr(2)
                    };

                    const result = await chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]);
                    const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];

                    shortcuts[editingIndex] = updatedShortcut;

                    await saveShortcuts(shortcuts);
                    await renderShortcuts(shortcuts);
                } catch (error) {
                    console.error('更新快捷方式失败:', error);
                }
            }
        } else {

            for (const item of itemsToAdd) {
                try {

                    const websiteInfo = await fetchWebsiteInfoDirectly(item.url);

                    const shortcut = {
                        name: item.title,
                        url: item.url,
                        iconType: websiteInfo.success && websiteInfo.data.icon ? 'custom' : 'auto',
                        icon: websiteInfo.success ? websiteInfo.data.icon || '' : '',
                        customColor: generateNameColor(item.title),
                        id: Date.now().toString(36) + Math.random().toString(36).substr(2)
                    };

                    await addShortcut(shortcut);
                } catch (error) {
                    console.error('添加快捷方式失败:', error);
                }
            }
        }

        shortcutModal.classList.remove('show');
        resetBrowserDataState();

        addSelectedBtn.disabled = false;
        addSelectedBtn.textContent = '添加选中项';
    }

    function resetBrowserDataState() {

        selectedItems.clear();
        addSelectedBtn.disabled = true;

        browserDataSearch.value = '';

        allBrowserItems = [];
        filteredBrowserItems = [];

        editingIndex = null;
        isEditMode = false;

        const iconGrid = document.querySelector('#icon-select .icon-grid');
        if (iconGrid) {
            iconGrid.innerHTML = '';
        }

        const customTabBtn = tabContainer.querySelector('.tab-btn[data-tab="custom"]');
        const browserDataTabBtn = tabContainer.querySelector('.tab-btn[data-tab="browser-data"]');
        const customTab = tabContainer.querySelector('#custom-tab');
        const browserDataTab = tabContainer.querySelector('#browser-data-tab');

        customTabBtn.classList.add('active');
        browserDataTabBtn.classList.remove('active');
        customTab.classList.add('active');
        browserDataTab.classList.remove('active');

        dataSourceBtns.forEach(btn => btn.classList.remove('active'));

        dataSourceBtns.forEach(btn => {
            if (btn.dataset.source === 'bookmarks') {
                btn.classList.add('active');
            }
        });
        currentDataSource = 'bookmarks';

        const websiteList = document.getElementById('website-list');
        websiteList.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">加载中...</div>';
    }

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

    cancelBrowserDataBtn.addEventListener('click', function() {
        shortcutModal.classList.remove('show');
        resetBrowserDataState();
    });

    closeModal.addEventListener('click', function() {
        shortcutModal.classList.remove('show');
        shortcutForm.reset();
        document.getElementById('custom-icon-group').style.display = 'none';
        document.getElementById('solid-color-group').style.display = 'block';
        document.getElementById('shortcut-icon-type').value = 'auto';
        resetBrowserDataState();
    });

    iconTypeSelect.addEventListener('change', function() {
        toggleCustomIconField();
    });

    function toggleCustomIconField() {
        const iconType = document.getElementById('shortcut-icon-type').value;
        const customIconGroup = document.getElementById('custom-icon-group');
        const solidColorGroup = document.getElementById('solid-color-group');

        customIconGroup.style.display = iconType === 'custom' ? 'block' : 'none';
        solidColorGroup.style.display = iconType === 'auto' ? 'block' : 'none';
    }

    function initColorPicker() {
        const colorInput = document.getElementById('shortcut-custom-color');
        const colorPreview = document.getElementById('color-preview');
        const colorValue = document.getElementById('color-value');
        const colorPresets = document.querySelectorAll('.color-preset');

        function updateColorPreview(color) {
            colorPreview.style.backgroundColor = color;
            colorValue.textContent = color;
            colorInput.value = color;

            colorPresets.forEach(preset => {
                if (preset.dataset.color === color) {
                    preset.classList.add('active');
                } else {
                    preset.classList.remove('active');
                }
            });
        }

        colorInput.addEventListener('input', (e) => {
            updateColorPreview(e.target.value);
        });

        colorPresets.forEach(preset => {
            preset.addEventListener('click', () => {
                const color = preset.dataset.color;
                updateColorPreview(color);
            });
        });

        colorPreview.addEventListener('click', () => {
            colorInput.click();
        });

        updateColorPreview(colorInput.value);
    }

    function initAllFeatures() {
        initTabSwitching();
        initDataSourceSwitching();
        initSearch();

        addSelectedBtn.addEventListener('click', addSelectedItems);

        initColorPicker();
    }

    initAllFeatures();

    uploadIconBtn.addEventListener('click', function() {
        iconFileInput.click();
    });

    iconFileInput.addEventListener('change', handleFileSelect);

    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) {
            return;
        }

        if (!file.type.startsWith('image/')) {
            showStatusMessage('请选择图片文件', 'error');
            return;
        }

        const MAX_FILE_SIZE = 2 * 1024 * 1024;
        if (file.size > MAX_FILE_SIZE) {
            showStatusMessage('图片大小不能超过2MB', 'error');
            return;
        }

        const reader = new FileReader();

        reader.onload = function(e) {
            const base64String = e.target.result;

            const MAX_BASE64_SIZE = 5 * 1024;
            if (base64String.length > MAX_BASE64_SIZE) {

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

        e.target.value = '';
    }

    function compressImage(file, maxSize) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = function() {

                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                const maxDimension = 128;
                if (width > maxDimension || height > maxDimension) {
                    const ratio = Math.min(maxDimension / width, maxDimension / height);
                    width *= ratio;
                    height *= ratio;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

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

    function showStatusMessage(message, type = 'info') {
        const statusElement = document.getElementById('shortcut-status');
        statusElement.textContent = message;
        statusElement.className = `status-message show ${type}`;

        setTimeout(() => {
            statusElement.classList.remove('show');
        }, 3000);
    }

    async function loadOptionalIcons(currentIcon, title) {
        const iconGrid = document.querySelector('#icon-select .icon-grid');
        iconGrid.innerHTML = '';

        const icons = [];

        if (currentIcon) {
            icons.push(currentIcon);
        }

        if (title) {

            let searchIcons = [];
            const searchLengths = [8, 4, 2];

            for (const length of searchLengths) {
                if (searchIcons.length >= 10) break;

                const searchQuery = title.substring(0, length);

                try {

                    const [cnResponse, usResponse] = await Promise.all([
                        fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(searchQuery)}&country=cn&entity=software&limit=6`),
                        fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(searchQuery)}&country=us&entity=software&limit=6`)
                    ]);

                    const [cnData, usData] = await Promise.all([
                        cnResponse.json(),
                        usResponse.json()
                    ]);

                    const allResults = [...(cnData.results || []), ...(usData.results || [])];
                    const uniqueIcons = new Set();

                    for (const item of allResults) {
                        if (item.artworkUrl512) {
                            uniqueIcons.add(item.artworkUrl512);
                        }
                    }

                    searchIcons.push(...Array.from(uniqueIcons));

                    if (searchIcons.length > 0) break;
                } catch (error) {
                    console.error(`获取iTunes API数据失败（${length}字符）:`, error);
                }
            }

            if (searchIcons.length > 0) {
                icons.push(...searchIcons.slice(0, 10));
            }
        }

        const displayIcons = icons.slice(0, 12);

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

            iconItem.addEventListener('click', () => {
                document.getElementById('shortcut-icon').value = iconUrl;
            });

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

    fetchInfoBtn.addEventListener('click', async function() {
        const urlInput = document.getElementById('shortcut-url');
        const nameInput = document.getElementById('shortcut-name');
        const iconInput = document.getElementById('shortcut-icon');
        const fetchBtn = document.getElementById('fetch-info-btn');

        const url = urlInput.value.trim();
        if (!url) {

            return;
        }

        let fullUrl = url;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            fullUrl = 'https://' + url;
        }

        try {
            new URL(fullUrl);
        } catch (e) {

            return;
        }

        const originalText = fetchBtn.querySelector('.btn-text').textContent;
        fetchBtn.querySelector('.btn-text').textContent = '获取中...';
        fetchBtn.classList.add('loading');
        fetchBtn.disabled = true;

        try {

            if (!chrome.runtime) {
                console.error('chrome.runtime 不可用');
                showStatusMessage('shortcut-status', '❌ 扩展运行时错误，请刷新页面重试', 'error');
                return;
            }

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

                response = await fetchWebsiteInfoDirectly(fullUrl);
            }

            if (!response) {
                response = await fetchWebsiteInfoDirectly(fullUrl);
            }

            if (response.success) {
                let { title, icon } = response.data;

                if (title) {
                    if (nameInput.value.trim() === '') {
                        nameInput.value = title;
                    } else {

                        title = nameInput.value;
                    }
                }

                if (icon) {

                    document.getElementById('shortcut-icon-type').value = 'custom';
                    toggleCustomIconField();
                    iconInput.value = icon;
                }

                loadOptionalIcons(icon, title);
                showStatusMessage('shortcut-status', `✅ 获取成功！标题: ${title || '未找到标题'}`, 'success');

                setTimeout(() => {
                    nameInput.focus();
                    nameInput.select();
                }, 100);
            } else {
                showStatusMessage('shortcut-status', '❌ 获取失败: ' + (response.error || '未知错误'), 'error');

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

            try {
                const urlObj = new URL(fullUrl);
                const domain = urlObj.hostname.replace('www.', '');
                nameInput.value = domain;
                showStatusMessage('shortcut-status', 'ℹ️ 已自动填充域名作为名称', 'info');
            } catch {

            }
        } finally {

            fetchBtn.querySelector('.btn-text').textContent = originalText;
            fetchBtn.classList.remove('loading');
            fetchBtn.disabled = false;
        }
    });

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

            let fullUrl = url;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                fullUrl = 'https://' + url;
            }

            const editingIndex = shortcutForm.dataset.editingIndex;

            if (editingIndex !== undefined) {

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

                    delete shortcutForm.dataset.editingIndex;
                } else {

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

            shortcutModal.querySelector('h3').textContent = '添加常用网站';
            shortcutForm.querySelector('button[type="submit"]').textContent = '添加';
        }

        submitBtn.disabled = false;
    });

    await loadShortcuts();
}

function showStatusMessage(elementId, message, type = 'info') {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.textContent = message;
    element.className = `status-message show ${type}`;

    if (elementId !== 'connection-status') {

        setTimeout(() => {
            element.classList.remove('show');
        }, 3000);
    }
}

function initSettings() {
    const openSettingsBtn = document.getElementById('open-settings');
    const settingsPanel = document.getElementById('settings-panel');
    const closeSettingsBtn = document.getElementById('close-settings');

    openSettingsBtn.addEventListener('click', function() {
        settingsPanel.classList.add('open');
    });

    closeSettingsBtn.addEventListener('click', function() {
        settingsPanel.classList.remove('open');
    });

    window.addEventListener('click', function(e) {
        if (e.target === settingsPanel) {
            settingsPanel.classList.remove('open');
        }
    });

    initSettingsTabSwitching();

    initSettingsPanel();
}

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

async function initSettingsPanel() {
    await initWebDAVConfig();
    initBackupRestore();
    await initPersonalizationSettings();
    initToggleSwitches();
    await initManageEngines();
}

function initToggleSwitches() {
    const settingCheckboxes = document.querySelectorAll('.setting-checkbox');

    settingCheckboxes.forEach(checkboxGroup => {
        const input = checkboxGroup.querySelector('input[type="checkbox"]');
        const toggleSwitch = checkboxGroup.querySelector('.toggle-switch');

        if (input && toggleSwitch) {

            toggleSwitch.addEventListener('click', (e) => {
                e.stopPropagation();

                input.checked = !input.checked;

                input.dispatchEvent(new Event('change'));
            });

            input.addEventListener('change', (e) => {

                saveSettings();
            });
        }
    });
}

async function initWebDAVConfig() {

    const config = await storageManager.getWebDAVConfig();
    if (config) {
        document.getElementById('webdav-url').value = config.url || '';
        document.getElementById('webdav-username').value = config.username || '';
        document.getElementById('webdav-password').value = config.password || '';
        document.getElementById('webdav-storage-path').value = config.storagePath || 'AndyTab';
    }

    document.getElementById('webdav-form').addEventListener('submit', handleWebDAVFormSubmit);

    document.getElementById('test-connection').addEventListener('click', handleTestConnection);

    document.getElementById('manual-sync-btn').addEventListener('click', handleManualSync);

    updateSyncStatusUI();
}

async function handleWebDAVFormSubmit(e) {
    e.preventDefault();

    const url = document.getElementById('webdav-url').value.trim();
    const username = document.getElementById('webdav-username').value.trim();
    const password = document.getElementById('webdav-password').value;
    const storagePath = document.getElementById('webdav-storage-path').value.trim() || 'AndyTab';

    if (!url) {
        showStatusMessage('connection-status', '请输入服务器地址', 'error');
        return;
    }

    try {
        new URL(url);
    } catch (error) {
        showStatusMessage('connection-status', '请输入有效的服务器地址（包含http://或https://）', 'error');
        return;
    }

    if (!username) {
        showStatusMessage('connection-status', '请输入用户名', 'error');
        return;
    }

    if (!password) {
        showStatusMessage('connection-status', '请输入密码', 'error');
        return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(storagePath)) {
        showStatusMessage('connection-status', '存储路径只能包含字母、数字、下划线和横线', 'error');
        return;
    }

    const config = {
        url: url,
        username: username,
        password: password,
        storagePath: storagePath
    };

    try {

        await storageManager.saveWebDAVConfig(config);
        showStatusMessage('connection-status', '配置保存成功！正在刷新页面...', 'success');

        setTimeout(() => {
            location.reload();
        }, 1000);
    } catch (error) {
        showStatusMessage('connection-status', '配置保存失败：' + error.message, 'error');
    }
}

async function handleTestConnection() {
    const url = document.getElementById('webdav-url').value.trim();
    const username = document.getElementById('webdav-username').value.trim();
    const password = document.getElementById('webdav-password').value;

    if (!url) {
        showStatusMessage('connection-status', '请输入服务器地址', 'error');
        return;
    }

    try {
        new URL(url);
    } catch (error) {
        showStatusMessage('connection-status', '请输入有效的服务器地址（包含http://或https://）', 'error');
        return;
    }

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

    showStatusMessage('connection-status', '正在测试连接...', 'info');

    try {
        const result = await storageManager.testWebDAVConnection(config);

        if (result.success) {
            showStatusMessage('connection-status', '连接测试成功', 'success');
        } else {
            showStatusMessage('connection-status', '连接测试失败：' + result.message, 'error');
        }
    } catch (error) {
        showStatusMessage('connection-status', '连接测试失败：' + error.message, 'error');
    }
}

async function initBackupRestore() {

    document.getElementById('backup-data').addEventListener('click', handleBackupData);
    document.getElementById('restore-data').addEventListener('click', handleRestoreData);

    document.getElementById('export-data').addEventListener('click', handleExportData);
    document.getElementById('import-data-btn').addEventListener('click', handleImportDataClick);
    document.getElementById('import-data').addEventListener('change', handleImportData);

}

async function handleExportData() {
    try {

        const data = await storageManager.getAllData();

        const backupDate = new Date();
        const formattedDate = backupDate.toISOString().slice(0, 19).replace(/:/g, '-');
        const backupFileName = `andy_tab_backup_${formattedDate}.json`;

        const jsonStr = JSON.stringify(data, null, 2);

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

function handleImportDataClick() {
    document.getElementById('import-data').click();
}

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

        const result = await storageManager.restoreDataFromLocalFile(file);

        if (result.success) {
            showNotification('导入成功', `已成功导入备份文件：${file.name}`, 'success');

            location.reload();
        } else {
            showNotification('导入失败', result.message, 'error');
        }
    } catch (error) {
        console.error('导入备份失败：', error);
        showNotification('导入失败', error.message, 'error');
    }
}

async function initPersonalizationSettings() {

    const settings = await getSettings();

    document.getElementById('search-engine').value = settings.searchEngine || 'bing';
    document.getElementById('background-type').value = settings.backgroundType || 'gradient';
    document.getElementById('background-color').value = settings.backgroundColor || '#667eea';
    document.getElementById('background-image-url').value = settings.backgroundImage || '';
    document.getElementById('overlay-opacity').value = settings.overlayOpacity || '0.3';
    document.getElementById('background-blur').value = settings.backgroundBlur || '5';

    document.getElementById('gradient-type').value = settings.gradientType || 'linear';
    document.getElementById('gradient-direction').value = settings.gradientDirection || 'to bottom right';
    document.getElementById('gradient-color-1').value = settings.gradientColor1 || '#667eea';
    document.getElementById('gradient-color-2').value = settings.gradientColor2 || '#764ba2';

    const gradientTypeSelect = document.getElementById('gradient-type');
    if (gradientTypeSelect) {
        gradientTypeSelect.addEventListener('change', saveSettings);
    }

    const gradientDirectionSelect = document.getElementById('gradient-direction');
    if (gradientDirectionSelect) {
        gradientDirectionSelect.addEventListener('change', saveSettings);
    }

    const gradientColor1Picker = document.getElementById('gradient-color-1');
    if (gradientColor1Picker) {
        gradientColor1Picker.addEventListener('change', saveSettings);
    }

    const gradientColor2Picker = document.getElementById('gradient-color-2');
    if (gradientColor2Picker) {
        gradientColor2Picker.addEventListener('change', saveSettings);
    }

    const backgroundTypeSelect = document.getElementById('background-type');
    if (backgroundTypeSelect) {
        backgroundTypeSelect.addEventListener('change', function() {
            updateBackgroundSettingsVisibility(this.value);
        });

        updateBackgroundSettingsVisibility(backgroundTypeSelect.value);
    }

    const showTimeElement = document.getElementById('show-time');
    if (showTimeElement) {
        showTimeElement.checked = settings.showTime !== false;
    }

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

    const showDateElement = document.getElementById('show-date');
    if (showDateElement) {
        showDateElement.checked = settings.showDate !== false;
    }
    const dateColorElement = document.getElementById('date-color');
    if (dateColorElement) {
        dateColorElement.value = settings.dateColor || '#ffffff';
    }

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

    const hideIconNamesElement = document.getElementById('hide-icon-names');
    if (hideIconNamesElement) {
        hideIconNamesElement.checked = settings.hideIconNames || false;
    }
    const iconShadowElement = document.getElementById('icon-shadow');
    if (iconShadowElement) {
        iconShadowElement.checked = settings.iconShadow !== false;
    }

    const iconBorderRadiusElement = document.getElementById('icon-border-radius');
    if (iconBorderRadiusElement) {
        const iconBorderRadiusValue = parseInt((settings.iconBorderRadius || '8px').replace('px', ''));
        iconBorderRadiusElement.value = iconBorderRadiusValue;
        updateIconBorderRadiusDisplay(iconBorderRadiusValue);
    }

    const iconOpacityElement = document.getElementById('icon-opacity');
    if (iconOpacityElement) {
        iconOpacityElement.value = settings.iconOpacity || '1';
        updateIconOpacityDisplay(settings.iconOpacity || '1');
    }

    const iconSizeElement = document.getElementById('icon-size');
    if (iconSizeElement) {
        const iconSizeValue = parseInt((settings.iconSize || '48px').replace('px', ''));
        iconSizeElement.value = iconSizeValue;
        updateIconSizeDisplay(iconSizeValue);
    }

    const rowsElement = document.getElementById('rows');
    if (rowsElement) {
        rowsElement.value = settings.rows || '3';
        updateRowsDisplay(settings.rows || '3');
    }

    const columnsElement = document.getElementById('columns');
    if (columnsElement) {
        columnsElement.value = settings.columns || '6';
        updateColumnsDisplay(settings.columns || '6');
    }

    const columnGapElement = document.getElementById('column-gap');
    if (columnGapElement) {
        const columnGapValue = parseInt((settings.columnGap || '15px').replace('px', ''));
        columnGapElement.value = columnGapValue;
        updateColumnGapDisplay(columnGapValue);
    }

    const rowGapElement = document.getElementById('row-gap');
    if (rowGapElement) {
        const rowGapValue = parseInt((settings.rowGap || '15px').replace('px', ''));
        rowGapElement.value = rowGapValue;
        updateRowGapDisplay(rowGapValue);
    }

    const fontShadowElement = document.getElementById('font-shadow');
    if (fontShadowElement) {
        fontShadowElement.checked = settings.fontShadow !== false;
    }

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

    const openWebsitesInNewTabElement = document.getElementById('open-websites-in-new-tab');
    if (openWebsitesInNewTabElement) {
        openWebsitesInNewTabElement.checked = settings.openWebsitesInNewTab !== false;
    }
    const openSearchInNewTabElement = document.getElementById('open-search-in-new-tab');
    if (openSearchInNewTabElement) {
        openSearchInNewTabElement.checked = settings.openSearchInNewTab !== false;
    }

    initSliders();

    toggleBackgroundSettings(settings.backgroundType || 'gradient');

    toggleTimeSettings(settings.showTime !== false);
    toggleDateSettings(settings.showDate !== false);

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

function toggleTimeSettings(show) {
    const timeSettings = document.querySelectorAll('.time-settings');
    timeSettings.forEach(setting => {
        setting.style.display = show ? 'flex' : 'none';
    });
}

function toggleDateSettings(show) {
    const dateSettings = document.querySelectorAll('.date-settings');
    dateSettings.forEach(setting => {
        setting.style.display = show ? 'flex' : 'none';
    });
}

function initSliders() {
    updateOpacityDisplay();
    updateBlurDisplay();
    updateIconOpacityDisplay();
}

async function saveSettings() {
    const settings = {
        searchEngine: document.getElementById('search-engine')?.value || 'bing',
        backgroundType: document.getElementById('background-type')?.value || 'gradient',
        backgroundColor: document.getElementById('background-color')?.value || '#667eea',
        backgroundImage: document.getElementById('background-image-url')?.value || '',
        overlayOpacity: document.getElementById('overlay-opacity')?.value || '0.3',
        backgroundBlur: document.getElementById('background-blur')?.value || '5',

        gradientType: document.getElementById('gradient-type')?.value || 'linear',
        gradientDirection: document.getElementById('gradient-direction')?.value || 'to bottom right',
        gradientColor1: document.getElementById('gradient-color-1')?.value || '#667eea',
        gradientColor2: document.getElementById('gradient-color-2')?.value || '#764ba2',

        showTime: document.getElementById('show-time')?.checked !== false,
        timeColor: document.getElementById('time-color')?.value || '#ffffff',
        timeSize: `${document.getElementById('time-size')?.value || '80'}px`,
        timeFormat: document.getElementById('time-format')?.value || 'hh:mm:ss',

        showDate: document.getElementById('show-date')?.checked !== false,
        dateColor: document.getElementById('date-color')?.value || '#ffffff',
        dateSize: `${document.getElementById('date-size')?.value || '30'}px`,
        dateFormat: document.getElementById('date-format')?.value || 'YYYY年MM月DD日',

        hideIconNames: document.getElementById('hide-icon-names')?.checked || false,
        iconShadow: document.getElementById('icon-shadow')?.checked !== false,
        iconBorderRadius: `${document.getElementById('icon-border-radius')?.value || '8'}px`,
        iconOpacity: document.getElementById('icon-opacity')?.value || '1',
        iconSize: `${document.getElementById('icon-size')?.value || '48'}px`,

        enableTodo: document.getElementById('enable-todo')?.checked || false,

        rows: document.getElementById('rows')?.value || '3',
        columns: document.getElementById('columns')?.value || '6',
        columnGap: `${document.getElementById('column-gap')?.value || '15'}px`,
        rowGap: `${document.getElementById('row-gap')?.value || '15'}px`,

        fontShadow: document.getElementById('font-shadow')?.checked !== false,
        fontSize: `${document.getElementById('font-size')?.value || '12'}px`,
        fontColor: document.getElementById('font-color')?.value || '#ffffff',

        openWebsitesInNewTab: document.getElementById('open-websites-in-new-tab')?.checked !== false,
        openSearchInNewTab: document.getElementById('open-search-in-new-tab')?.checked !== false
    };

    return new Promise((resolve) => {
        chrome.storage.local.set({
            [STORAGE_KEYS.SETTINGS]: settings
        }, async function() {

            window.cachedSettings = settings;

            const result = await chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]);
            const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];

            if (typeof window.renderShortcuts === 'function') {
                await window.renderShortcuts(shortcuts);
            } else if (typeof renderShortcuts === 'function') {
                await renderShortcuts(shortcuts);
            } else {

                await loadShortcuts();
            }

            resolve();
        });
    });
}

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

            colorSetting.style.display = 'none';
            imageSetting.style.display = 'none';
            break;
        default:
            colorSetting.style.display = 'none';
            imageSetting.style.display = 'none';
            break;
    }
}

function updateOpacityDisplay() {
    const opacitySlider = document.getElementById('overlay-opacity');
    const opacityValue = document.getElementById('opacity-value');
    if (opacitySlider && opacityValue) {
        opacityValue.textContent = Math.round(opacitySlider.value * 100) + '%';
    }
}

function updateBlurDisplay() {
    const blurSlider = document.getElementById('background-blur');
    const blurValue = document.getElementById('blur-value');
    if (blurSlider && blurValue) {
        blurValue.textContent = blurSlider.value + 'px';
    }
}

function updateIconOpacityDisplay(value = null) {
    const opacitySlider = document.getElementById('icon-opacity');
    const opacityValue = document.getElementById('icon-opacity-value');
    if (opacityValue) {
        const currentValue = value !== null ? value : (opacitySlider?.value || 1);
        opacityValue.textContent = Math.round(currentValue * 100) + '%';
    }
}

function updateTimeSizeDisplay(value = null) {
    const sizeSlider = document.getElementById('time-size');
    const sizeValue = document.getElementById('time-size-value');
    if (sizeValue) {
        const currentValue = value !== null ? value : (sizeSlider?.value || 80);
        sizeValue.textContent = currentValue + 'px';
    }
}

function updateDateSizeDisplay(value = null) {
    const sizeSlider = document.getElementById('date-size');
    const sizeValue = document.getElementById('date-size-value');
    if (sizeValue) {
        const currentValue = value !== null ? value : (sizeSlider?.value || 30);
        sizeValue.textContent = currentValue + 'px';
    }
}

function updateIconBorderRadiusDisplay(value = null) {
    const radiusSlider = document.getElementById('icon-border-radius');
    const radiusValue = document.getElementById('icon-border-radius-value');
    if (radiusValue) {
        const currentValue = value !== null ? value : (radiusSlider?.value || 8);
        radiusValue.textContent = currentValue + 'px';
    }
}

function updateIconSizeDisplay(value = null) {
    const sizeSlider = document.getElementById('icon-size');
    const sizeValue = document.getElementById('icon-size-value');
    if (sizeValue) {
        const currentValue = value !== null ? value : (sizeSlider?.value || 48);
        sizeValue.textContent = currentValue + 'px';
    }
}

function updateRowsDisplay(value = null) {
    const rowsSlider = document.getElementById('rows');
    const rowsValue = document.getElementById('rows-value');
    if (rowsValue) {
        const currentValue = value !== null ? value : (rowsSlider?.value || 3);
        rowsValue.textContent = currentValue;
    }
}

function updateColumnsDisplay(value = null) {
    const columnsSlider = document.getElementById('columns');
    const columnsValue = document.getElementById('columns-value');
    if (columnsValue) {
        const currentValue = value !== null ? value : (columnsSlider?.value || 6);
        columnsValue.textContent = currentValue;
    }
}

function updateColumnGapDisplay(value = null) {
    const gapSlider = document.getElementById('column-gap');
    const gapValue = document.getElementById('column-gap-value');
    if (gapValue) {
        const currentValue = value !== null ? value : (gapSlider?.value || 15);
        gapValue.textContent = currentValue + 'px';
    }
}

function updateRowGapDisplay(value = null) {
    const gapSlider = document.getElementById('row-gap');
    const gapValue = document.getElementById('row-gap-value');
    if (gapValue) {
        const currentValue = value !== null ? value : (gapSlider?.value || 15);
        gapValue.textContent = currentValue + 'px';
    }
}

function updateFontSizeDisplay(value = null) {
    const sizeSlider = document.getElementById('font-size');
    const sizeValue = document.getElementById('font-size-value');
    if (sizeValue) {
        const currentValue = value !== null ? value : (sizeSlider?.value || 12);
        sizeValue.textContent = currentValue + 'px';
    }
}

async function handleBackgroundImageUrlChange(e) {
    const imageUrl = e.target.value.trim();

    if (imageUrl) {

        try {
            new URL(imageUrl);

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

async function handleBackupData() {
    try {
        const result = await storageManager.backupData();
        if (result.success) {
            showNotification('备份成功', result.message, 'success');

            loadBackupFiles();
        } else {
            showNotification('备份失败', result.message, 'error');
        }
    } catch (error) {
        console.error('备份数据失败：', error);
        showNotification('备份失败', error.message, 'error');
    }
}

async function handleRestoreData() {
    try {

        await loadBackupFiles();

        bindBackupListEvents();
    } catch (error) {
        console.error('获取备份列表失败:', error);
        showNotification('错误', '获取备份列表失败: ' + error.message, 'error');
    }
}

async function loadBackupFiles() {
    try {
        const backupFiles = await storageManager.getBackupFiles();
        renderBackupFiles(backupFiles);
    } catch (error) {
        console.error('加载备份文件失败:', error.message);
    }
}

function bindBackupListEvents() {

    const backupList = document.getElementById('backup-list');
    if (backupList) {

        backupList.removeEventListener('click', handleBackupListClick);

        backupList.addEventListener('click', handleBackupListClick);
    }
}

function handleBackupListClick(e) {
    if (e.target.classList.contains('restore-backup-btn')) {
        const backupName = e.target.getAttribute('data-backup-name');
        if (backupName) {
            restoreFromBackup(backupName);
        }
    }
}

function renderBackupFiles(backupFiles) {
    const backupList = document.getElementById('backup-list');

    if (backupFiles.length === 0) {
        backupList.innerHTML = '<p style="text-align: center; color: #6c757d; margin-top: 10px;">暂无备份文件</p>';
        return;
    }

    const sortedBackupFiles = backupFiles.sort((a, b) => {
        const timeA = a.modified ? new Date(a.modified).getTime() : 0;
        const timeB = b.modified ? new Date(b.modified).getTime() : 0;
        return timeB - timeA;
    });

    backupList.innerHTML = sortedBackupFiles.map(file => {

        let date = '未知时间';

        if (file.modified) {
            try {
                const dateObj = new Date(file.modified);
                date = dateObj.toLocaleString('zh-CN');
            } catch (e) {

                date = file.modified;
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

async function deleteBackup(backupName) {
    if (!confirm(`确定要删除备份文件 "${backupName}" 吗？\n此操作不可恢复。`)) {
        return;
    }

    try {
        const result = await storageManager.deleteBackup(backupName);
        if (result.success) {
            showNotification('删除成功', result.message, 'success');

            await loadBackupFiles();
        } else {
            showNotification('删除失败', result.message, 'error');
        }
    } catch (error) {
        console.error('删除备份失败：', error);
        showNotification('删除失败', error.message, 'error');
    }
}

async function restoreFromBackup(backupFileName) {
    if (!confirm(`确定要从备份文件 "${backupFileName}" 恢复数据吗？\n此操作将覆盖当前所有数据。`)) {
        return;
    }

    try {
        const result = await storageManager.restoreData(backupFileName);

        if (result.success) {
            showNotification('恢复成功', result.message, 'success');

            location.reload();
        } else {
            showNotification('恢复失败', result.message, 'error');
        }
    } catch (error) {
        console.error('恢复数据失败：', error);
        showNotification('恢复失败', error.message, 'error');
    }
}

function showNotification(title, message, type = 'info') {

    if (chrome.notifications) {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('src/assets/icons/icon48.png'),
            title: title,
            message: message
        });
    } else {

        alert(`${title}: ${message}`);
    }
}

async function initManageEngines() {
    const manageEnginesBtn = document.getElementById('manage-engines-btn');
    const manageEnginesModal = document.getElementById('manage-engines-modal');
    const closeModalBtn = manageEnginesModal.querySelector('.close');
    const addEngineBtn = document.getElementById('add-engine-btn');
    const engineFormContainer = document.getElementById('engine-form-container');
    const engineForm = document.getElementById('engine-form');
    const cancelEngineBtn = document.getElementById('cancel-engine-btn');
    const enginesList = document.getElementById('engines-list');

    await initSearchEnginesData();

    manageEnginesBtn.addEventListener('click', async () => {
        manageEnginesModal.classList.add('show');
        await renderEnginesList();
    });

    closeModalBtn.addEventListener('click', closeManageEnginesModal);
    cancelEngineBtn.addEventListener('click', closeEngineForm);

    addEngineBtn.addEventListener('click', () => {
        openEngineForm();
    });

    engineForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleEngineFormSubmit();
    });
}

async function initSearchEnginesData() {
    const result = await chrome.storage.local.get(['andy_tab_search_engines']);
    let engines = result['andy_tab_search_engines'];

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

    await updateSearchEngineSelect();
}

async function updateSearchEngineSelect() {
    const searchEngineSelect = document.getElementById('search-engine');
    const engines = await getSearchEngines();

    const currentValue = searchEngineSelect.value;

    searchEngineSelect.innerHTML = '';

    for (const [key, engine] of Object.entries(engines)) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = engine.name;
        searchEngineSelect.appendChild(option);
    }

    if (engines[currentValue]) {
        searchEngineSelect.value = currentValue;
    } else if (Object.keys(engines).length > 0) {
        searchEngineSelect.value = Object.keys(engines)[0];
    }
}

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

    addEngineActionsEventListeners();
}

function addEngineActionsEventListeners() {

    document.querySelectorAll('.edit-engine-btn').forEach(btn => {
        btn.replaceWith(btn.cloneNode(true));
    });

    document.querySelectorAll('.delete-engine-btn').forEach(btn => {
        btn.replaceWith(btn.cloneNode(true));
    });

    document.querySelectorAll('.edit-engine-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const key = e.target.dataset.key;
            await openEngineForm(key);
        });
    });

    document.querySelectorAll('.delete-engine-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const key = e.target.dataset.key;
            await deleteEngine(key);
        });
    });
}

async function openEngineForm(key = null) {
    const engineFormContainer = document.getElementById('engine-form-container');
    const engineFormTitle = document.getElementById('engine-form-title');
    const engineIdInput = document.getElementById('engine-id');
    const engineKeyInput = document.getElementById('engine-key');
    const engineNameInput = document.getElementById('engine-name');
    const engineUrlInput = document.getElementById('engine-url');

    if (engineFormContainer.style.display === 'block') {
        return;
    }

    engineFormContainer.style.display = 'block';

    if (key) {

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

        engineFormTitle.textContent = '添加搜索引擎';
        engineIdInput.value = '';
        engineKeyInput.value = '';
        engineNameInput.value = '';
        engineUrlInput.value = '';
    }

    engineFormContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeEngineForm() {
    const engineFormContainer = document.getElementById('engine-form-container');
    engineFormContainer.style.display = 'none';
    document.getElementById('engine-form').reset();
}

function closeManageEnginesModal() {
    const manageEnginesModal = document.getElementById('manage-engines-modal');
    manageEnginesModal.classList.remove('show');
    closeEngineForm();
}

async function handleEngineFormSubmit() {
    const engineId = document.getElementById('engine-id').value;
    const engineKey = document.getElementById('engine-key').value.trim();
    const engineName = document.getElementById('engine-name').value.trim();
    const engineUrl = document.getElementById('engine-url').value.trim();

    if (!engineKey || !engineName || !engineUrl) {
        showNotification('错误', '请填写所有必填字段', 'error');
        return;
    }

    try {
        new URL(engineUrl);
    } catch (e) {
        showNotification('错误', '请输入有效的URL', 'error');
        return;
    }

    if (!engineUrl.includes('%s')) {
        showNotification('错误', 'URL必须包含%s作为搜索关键词占位符', 'error');
        return;
    }

    const engines = await getSearchEngines();

    if (engineId) {

        delete engines[engineId];
        engines[engineKey] = { name: engineName, url: engineUrl };
        showNotification('成功', '搜索引擎已更新', 'success');
    } else {

        if (engines[engineKey]) {
            showNotification('错误', '该搜索引擎标识已存在', 'error');
            return;
        }
        engines[engineKey] = { name: engineName, url: engineUrl };
        showNotification('成功', '搜索引擎已添加', 'success');
    }

    await chrome.storage.local.set({
        'andy_tab_search_engines': engines
    });

    await renderEnginesList();
    await updateSearchEngineSelect();
    closeEngineForm();
}

async function deleteEngine(key) {

    const defaultEngines = ['google', 'baidu', 'bing', 'duckduckgo'];
    if (defaultEngines.includes(key)) {
        showNotification('错误', '不能删除默认搜索引擎', 'error');
        return;
    }

    if (confirm(`确定要删除搜索引擎 "${key}" 吗？`)) {
        const engines = await getSearchEngines();
        delete engines[key];

        await chrome.storage.local.set({
            'andy_tab_search_engines': engines
        });

        await renderEnginesList();
        await updateSearchEngineSelect();
        showNotification('成功', '搜索引擎已删除', 'success');
    }
}

function getNameInitial(name) {
    if (!name || name.trim() === '') {
        return '?';
    }

    const trimmedName = name.trim();

    if (trimmedName.length >= 2) {

        if (/[a-zA-Z]/.test(trimmedName)) {
            return trimmedName.slice(0, 2).toUpperCase();
        }

        return trimmedName.slice(0, 2);
    }

    return trimmedName.charAt(0);
}

async function fetchWebsiteInfoDirectly(url) {
    try {
        let icon = '';
        let title = '';

        try {
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

        } catch (urlError) {
            return {
                success: false,
                error: '无效的网址格式: ' + urlError.message
            };
        }

        const result = {
            title: title,
            icon: icon
        };

        return { success: true, data: result };

    } catch (error) {
        console.error('直接获取 - 获取网站信息失败:', error);

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

function generateNameColor(name) {
    if (!name || name.trim() === '') {
        return '#4CAF50';
    }

    let hash = 0;

    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }

    const hue = Math.abs(hash) % 360;
    const saturation = 60 + (Math.abs(hash) % 20);
    const lightness = 45 + (Math.abs(hash) % 10);

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

let widgetObserver = null;

let widgetsSelfWrite = false;

async function initWidgets() {
    await loadWidgets();
    await migrateWidgetStoreFromLocal();
    renderWidgets();
    renderWidgetSettingsList();

    const addBtn = document.getElementById('add-widget-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => openWidgetModal(null));
    }

    const modal = document.getElementById('widget-form-modal');
    if (modal) {
        const closeBtn = modal.querySelector('.close');
        closeBtn?.addEventListener('click', closeWidgetModal);
        document.getElementById('widget-cancel-btn')?.addEventListener('click', closeWidgetModal);
        modal.addEventListener('mousedown', (e) => {
            if (e.target === modal) closeWidgetModal();
        });
    }

    document.querySelectorAll('#widget-form .widget-type-option').forEach((opt) => {
        opt.addEventListener('click', () => setWidgetFormType(opt.dataset.type));
    });

    document.getElementById('widget-example-btn')?.addEventListener('click', loadWidgetExample);

    const form = document.getElementById('widget-form');
    form?.addEventListener('submit', (e) => {
        e.preventDefault();
        handleWidgetFormSubmit();
    });

    window.addEventListener('message', (e) => {
        const data = e.data;
        if (!data || typeof data !== 'object') return;
        if (data.type === 'widget-error' && data.uuid) {
            showWidgetError(data.uuid, data.message);
        } else if (data.type === 'widget-ready' && data.uuid) {
            clearWidgetError(data.uuid);
        } else if (data.type === 'widget-store-set' && data.uuid) {

            saveWidgetStoreData(data.uuid, data.value);
        }
    });
}

async function loadWidgets() {
    try {
        const result = await chrome.storage.local.get([STORAGE_KEYS.WIDGETS]);
        widgets = Array.isArray(result[STORAGE_KEYS.WIDGETS]) ? result[STORAGE_KEYS.WIDGETS] : [];
    } catch (e) {
        widgets = [];
    }
    applyWidgetLayouts();
}

function applyWidgetLayouts() {
    try {
        const layoutMap = JSON.parse(localStorage.getItem(WIDGET_LAYOUT_KEY) || '{}') || {};
        widgets.forEach((w) => {
            const l = layoutMap[w.uuid];
            if (l && typeof l.x === 'number') {
                w.layout = { x: l.x, y: l.y, w: l.w, h: l.h, collapsed: !!l.collapsed };
            }
        });
    } catch (e) {

    }
}

function saveWidgetLayoutLocal() {
    try {
        const map = {};
        widgets.forEach((w) => {
            if (w.layout) map[w.uuid] = w.layout;
        });
        localStorage.setItem(WIDGET_LAYOUT_KEY, JSON.stringify(map));
    } catch (e) {

    }
}

let widgetsSaveTimer = null;
function saveWidgetsDebounced() {
    saveWidgetLayoutLocal();
    if (widgetsSaveTimer) clearTimeout(widgetsSaveTimer);
    widgetsSaveTimer = setTimeout(async () => {
        try {
            widgetsSelfWrite = true;
            const toSave = widgets.map((w) => {
                const { layout, ...rest } = w;
                return rest;
            });
            await chrome.storage.local.set({ [STORAGE_KEYS.WIDGETS]: toSave });

            setTimeout(() => { widgetsSelfWrite = false; }, 100);
        } catch (e) {
            widgetsSelfWrite = false;
            console.error('保存小组件数据失败:', e);
        }
    }, 500);
}

function renderWidgetIcon(icon) {
    if (!icon) return '🧩';
    if (/^(https?:|data:|chrome-extension:)/i.test(icon)) {
        return `<img class="widget-icon-img" src="${escapeHtml(icon)}" alt="">`;
    }
    return escapeHtml(icon);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderWidgets() {
    const layer = document.getElementById('widgets-layer');
    if (!layer) return;

    if (widgetObserver) {
        widgetObserver.disconnect();
        widgetObserver = null;
    }

    layer.innerHTML = '';

    const enabledWidgets = widgets.filter((w) => w.enabled !== false);
    if (!enabledWidgets.length) return;

    enabledWidgets.forEach((w, index) => {
        const card = buildWidgetCard(w, index);
        layer.appendChild(card);
    });

    if ('IntersectionObserver' in window) {
        widgetObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    const uuid = entry.target.dataset.uuid;
                    if (!entry.target.classList.contains('collapsed')) {
                        mountWidgetContent(entry.target, uuid);
                    }
                    widgetObserver.unobserve(entry.target);
                }
            });
        }, { rootMargin: '100px' });

        layer.querySelectorAll('.widget-card').forEach((c) => widgetObserver.observe(c));
    } else {

        widgets.forEach((w) => {
            if (w.layout && w.layout.collapsed) return;
            const card = layer.querySelector(`.widget-card[data-uuid="${w.uuid}"]`);
            if (card) mountWidgetContent(card, w.uuid);
        });
    }
}

let widgetZCounter = 0;
function bringWidgetCardToFront(card) {
    card.style.zIndex = ++widgetZCounter;
}

function buildWidgetCard(w, index) {
    const card = document.createElement('div');
    card.className = 'widget-card';
    card.dataset.uuid = w.uuid;

    card.addEventListener('mousedown', () => bringWidgetCardToFront(card), true);

    if (!w.layout) {
        w.layout = {
            x: 20 + (index % 5) * 24,
            y: 120 + (index % 5) * 24,
            w: 320,
            h: 220
        };
    }
    const layout = w.layout;
    const collapsed = !!layout.collapsed;
    layout.x = Math.max(0, Math.min(layout.x, window.innerWidth - 60));
    layout.y = Math.max(0, Math.min(layout.y, window.innerHeight - 40));
    card.style.left = layout.x + 'px';
    card.style.top = layout.y + 'px';
    if (collapsed) {

        card.classList.add('collapsed', 'collapsed-final');

        card.style.top = Math.max(0, layout.y - 34) + 'px';
        card.style.width = '40px';
        card.style.height = '30px';
    } else {
        card.style.width = Math.max(120, layout.w) + 'px';
        card.style.height = Math.max(80, layout.h) + 'px';
    }

    card.innerHTML = `
        <div class="widget-card-header">
            <span class="widget-card-icon">${renderWidgetIcon(w.icon)}</span>
            <span class="widget-card-title">${escapeHtml(w.name || '未命名')}</span>
            <div class="widget-actions">
                <button class="widget-action-btn widget-edit-btn" title="编辑">✎</button>
                <button class="widget-action-btn widget-delete-btn" title="删除">🗑</button>
            </div>
            <button class="widget-collapse-btn" title="收起/展开">›</button>
        </div>
        <div class="widget-card-body"></div>
        <div class="widget-resize-handle" title="拖拽调整大小"></div>
    `;

    card.querySelector('.widget-edit-btn').addEventListener('click', () => openWidgetModal(w.uuid));
    card.querySelector('.widget-delete-btn').addEventListener('click', () => deleteWidget(w.uuid));

    card.querySelector('.widget-collapse-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        setWidgetCardCollapsed(card, w, !card.classList.contains('collapsed'));
    });

    const header = card.querySelector('.widget-card-header');
    let headerDragged = false;
    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.widget-action-btn, .widget-collapse-btn')) return;
        headerDragged = false;
        startWidgetDrag(e, card, w, () => { headerDragged = true; });
    });

    header.addEventListener('click', (e) => {
        if (headerDragged) return;
        if (card.classList.contains('collapsed') && !e.target.closest('.widget-collapse-btn')) {
            setWidgetCardCollapsed(card, w, false);
        }
    });

    const resizeHandle = card.querySelector('.widget-resize-handle');
    resizeHandle.addEventListener('mousedown', (e) => {
        startWidgetResize(e, card, w);
    });

    return card;
}

function setWidgetCardCollapsed(card, w, collapsed) {
    if (collapsed) {
        card.classList.add('collapsed');
        setTimeout(() => {
            if (card.classList.contains('collapsed')) {
                card.classList.add('collapsed-final');

                card.style.top = Math.max(0, w.layout.y - 34) + 'px';
                card.style.width = '40px';
                card.style.height = '30px';
            }
        }, 300);

        setTimeout(() => {
            if (card.classList.contains('collapsed')) {
                unmountWidgetContent(card);
            }
        }, 650);
    } else {
        card.classList.remove('collapsed');
        card.classList.remove('collapsed-final');

        card.style.top = w.layout.y + 'px';
        card.style.width = Math.max(120, w.layout.w || 320) + 'px';
        card.style.height = Math.max(80, w.layout.h || 220) + 'px';

        mountWidgetContent(card, w.uuid);
    }
    w.layout.collapsed = collapsed;
    saveWidgetLayoutLocal();
}

function unmountWidgetContent(card) {
    const body = card.querySelector('.widget-card-body');
    if (!body) return;
    body.innerHTML = '';
    delete body.dataset.mounted;
    const overlay = card.querySelector('.widget-error-overlay');
    if (overlay) overlay.remove();
}

function mountWidgetContent(card, uuid) {
    const w = widgets.find((item) => item.uuid === uuid);
    if (!w) return;
    const body = card.querySelector('.widget-card-body');
    if (!body || body.dataset.mounted === '1') return;
    body.dataset.mounted = '1';

    if (w.type === 'iframe') {
        mountIframeWidget(body, w, card);
    } else if (w.type === 'customCode') {
        mountCodeWidget(body, w, card);
    }
}

function mountIframeWidget(body, w, card) {
    const iframe = document.createElement('iframe');
    iframe.className = 'widget-frame';
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    iframe.src = w.url;
    body.appendChild(iframe);
}

function mountCodeWidget(body, w, card) {
    const iframe = document.createElement('iframe');
    iframe.className = 'widget-frame';

    iframe.src = chrome.runtime.getURL('src/newtab/widget-sandbox.html');

    iframe.addEventListener('load', () => {
        try {
            iframe.contentWindow.postMessage({
                type: 'widget-render',
                uuid: w.uuid,
                payload: { html: w.html || '', css: w.css || '', js: w.js || '', store: getWidgetStoreData(w.uuid) }
            }, '*');
        } catch (e) {
            showWidgetError(w.uuid, '代码投递失败：' + e.message);
        }
    });

    body.appendChild(iframe);
}

function showWidgetError(uuid, message) {
    const card = document.querySelector(`.widget-card[data-uuid="${uuid}"]`);
    if (!card) return;
    const body = card.querySelector('.widget-card-body');
    if (!body) return;
    let overlay = card.querySelector('.widget-error-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'widget-error-overlay';
        body.appendChild(overlay);
    }
    overlay.textContent = '⚠ ' + (message || '运行出错');
    overlay.style.display = 'flex';
}

function clearWidgetError(uuid) {
    const card = document.querySelector(`.widget-card[data-uuid="${uuid}"]`);
    if (!card) return;
    const overlay = card.querySelector('.widget-error-overlay');
    if (overlay) overlay.style.display = 'none';
}

function startWidgetDrag(e, card, w, markDragged) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = card.getBoundingClientRect();
    const startLeft = rect.left;
    const startTop = rect.top;
    card.style.transition = 'none';
    card.classList.add('dragging');

    const onMove = (ev) => {

        if (markDragged && (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3)) {
            markDragged();
        }
        const left = Math.max(0, Math.min(startLeft + ev.clientX - startX, window.innerWidth - card.offsetWidth));
        const top = Math.max(0, Math.min(startTop + ev.clientY - startY, window.innerHeight - 30));
        card.style.left = left + 'px';
        card.style.top = top + 'px';
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        card.style.transition = '';
        card.classList.remove('dragging');

        const r = card.getBoundingClientRect();
        const collapsed = card.classList.contains('collapsed');
        w.layout = {
            x: Math.round(r.left),

            y: Math.round(r.top) + (collapsed ? 34 : 0),
            w: collapsed ? (w.layout.w || 320) : card.offsetWidth,
            h: collapsed ? (w.layout.h || 220) : card.offsetHeight,
            collapsed
        };
        saveWidgetLayoutLocal();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function startWidgetResize(e, card, w) {
    if (card.classList.contains('collapsed')) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = card.offsetWidth;
    const startH = card.offsetHeight;
    card.style.transition = 'none';

    const onMove = (ev) => {
        const width = Math.max(120, Math.min(startW + ev.clientX - startX, window.innerWidth - card.offsetLeft));
        const height = Math.max(80, Math.min(startH + ev.clientY - startY, window.innerHeight - card.offsetTop));
        card.style.width = width + 'px';
        card.style.height = height + 'px';
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        card.style.transition = '';
        w.layout = { x: card.offsetLeft, y: card.offsetTop, w: card.offsetWidth, h: card.offsetHeight, collapsed: false };
        saveWidgetLayoutLocal();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function renderWidgetSettingsList() {
    const list = document.getElementById('widget-settings-list');
    if (!list) return;
    list.innerHTML = '';

    if (!widgets.length) {
        list.innerHTML = '<div class="widget-list-empty">暂无小组件，点击「新增小组件」创建</div>';
        return;
    }

    widgets.forEach((w) => {
        const item = document.createElement('div');
        item.className = 'widget-list-item';
        item.dataset.uuid = w.uuid;
        item.innerHTML = `
            <input type="checkbox" class="widget-list-enabled" title="启用/停用" ${w.enabled !== false ? 'checked' : ''}>
            <span class="widget-list-icon">${renderWidgetIcon(w.icon)}</span>
            <span class="widget-list-name">${escapeHtml(w.name || '未命名')}</span>
            <span class="widget-list-type">${w.type === 'iframe' ? '网页嵌入' : '自定义代码'}</span>
            <button class="btn btn-secondary btn-sm widget-list-edit">编辑</button>
            <button class="btn btn-danger btn-sm widget-list-delete">删除</button>
        `;
        item.querySelector('.widget-list-enabled').addEventListener('change', (e) => {
            w.enabled = e.target.checked;
            saveWidgetsDebounced();
            renderWidgets();
        });
        item.querySelector('.widget-list-edit').addEventListener('click', () => openWidgetModal(w.uuid));
        item.querySelector('.widget-list-delete').addEventListener('click', () => deleteWidget(w.uuid));
        list.appendChild(item);
    });
}

function openWidgetModal(uuid) {
    const modal = document.getElementById('widget-form-modal');
    const form = document.getElementById('widget-form');
    form.reset();
    document.getElementById('widget-uuid').value = '';

    const isEdit = !!uuid;
    document.getElementById('widget-modal-title').textContent = isEdit ? '编辑小组件' : '新建小组件';
    document.getElementById('widget-submit-btn').textContent = isEdit ? '保存' : '创建';

    if (isEdit) {
        const w = widgets.find((item) => item.uuid === uuid);
        if (!w) return;
        document.getElementById('widget-uuid').value = w.uuid;
        document.getElementById('widget-name').value = w.name || '';
        document.getElementById('widget-icon').value = w.icon || '';
        setWidgetFormType(w.type);
        if (w.type === 'iframe') {
            document.getElementById('widget-url').value = w.url || '';
        } else {
            document.getElementById('widget-html').value = w.html || '';
            document.getElementById('widget-css').value = w.css || '';
            document.getElementById('widget-js').value = w.js || '';
        }
        document.getElementById('widget-width').value = w.layout ? w.layout.w : 320;
        document.getElementById('widget-height').value = w.layout ? w.layout.h : 220;
    } else {
        setWidgetFormType('iframe');
        document.getElementById('widget-width').value = 320;
        document.getElementById('widget-height').value = 220;
    }

    modal.classList.add('show');
}

function closeWidgetModal() {
    const modal = document.getElementById('widget-form-modal');
    if (modal) modal.classList.remove('show');
}

function setWidgetFormType(type) {
    document.querySelectorAll('#widget-form .widget-type-option').forEach((opt) => {
        opt.classList.toggle('active', opt.dataset.type === type);
    });
    const iframeFields = document.querySelector('.widget-field-iframe');
    const codeFields = document.querySelector('.widget-field-code');
    if (iframeFields) iframeFields.style.display = type === 'iframe' ? '' : 'none';
    if (codeFields) codeFields.style.display = type === 'customCode' ? '' : 'none';

}

function loadWidgetExample() {
    const type = document.querySelector('#widget-form .widget-type-option.active')?.dataset.type || 'iframe';
    if (type === 'iframe') {
        document.getElementById('widget-name').value = 'IP地址';
        document.getElementById('widget-icon').value = '🌐';
        document.getElementById('widget-url').value = 'https://ip111.cn';
    } else {
        document.getElementById('widget-name').value = '倒计时';
        document.getElementById('widget-icon').value = '⏳';
        document.getElementById('widget-html').value = `
<div class="cd-wrap">
  <div class="cd-top">
    <span class="cd-title">距离高考还有</span>
    <button class="cd-cfg-btn" title="设置">⚙</button>
  </div>
  <div class="cd-time">--</div>
  <div class="cd-bottom">
    <span class="cd-date"></span>
    <span class="cd-status"></span>
  </div>
  <div class="cd-panel">
    <label>事件名称<input class="cd-in-name" type="text"></label>
    <label>目标时间<input class="cd-in-date" type="datetime-local" step="1"></label>
    <label>背景颜色<input class="cd-in-bg" type="color"></label>
    <div class="cd-panel-btns">
      <button class="cd-save">保存</button>
      <button class="cd-cancel">取消</button>
    </div>
  </div>
</div>`;
        document.getElementById('widget-css').value = `
html,body{height:100%;margin:0;}
.cd-wrap{position:relative;display:flex;flex-direction:column;height:100%;padding:12px 14px;box-sizing:border-box;background:#667eea;color:#fff;font-family:'Segoe UI',Tahoma,sans-serif;}
.cd-top{display:flex;justify-content:space-between;align-items:center;font-size:14px;}
.cd-cfg-btn{background:rgba(255,255,255,0.18);border:none;color:#fff;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:13px;}
.cd-cfg-btn:hover{background:rgba(255,255,255,0.32);}
.cd-time{flex:1;display:flex;align-items:center;justify-content:center;font-size:42px;font-weight:bold;letter-spacing:2px;}
.cd-bottom{display:flex;justify-content:space-between;align-items:center;font-size:12px;opacity:0.9;}
.cd-panel{position:absolute;inset:0;background:rgba(0,0,0,0.6);display:none;flex-direction:column;justify-content:flex-start;gap:8px;padding:12px 16px;box-sizing:border-box;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;}
.cd-panel::-webkit-scrollbar{display:none;}
.cd-panel.open{display:flex;}
.cd-panel label{font-size:11px;display:flex;flex-direction:column;gap:3px;}
.cd-panel input{border:none;border-radius:6px;padding:4px 6px;font-size:12px;}
.cd-panel input[type=color]{height:26px;padding:2px;}
.cd-panel-btns{display:flex;gap:8px;justify-content:flex-end;flex-shrink:0;}
.cd-panel-btns button{border:none;border-radius:6px;padding:5px 14px;cursor:pointer;font-size:12px;}
`;
        document.getElementById('widget-js').value = `
var store = {};
function loadCfg(){ try{ var s = localStorage.getItem('cd_cfg'); if(s) store = JSON.parse(s); }catch(e){} }
function saveCfg(){ try{ localStorage.setItem('cd_cfg', JSON.stringify(store)); }catch(e){} }
loadCfg();
if(!store.name) store.name = '高考';
if(!store.date) store.date = '2027-06-07T00:00:00';
if(!store.bg) store.bg = '#667eea';
var WEEK = ['周日','周一','周二','周三','周四','周五','周六'];
function $(sel){ return document.querySelector(sel); }
function pad(n){ return (n < 10 ? '0' : '') + n; }
function render(){
  var wrap = $('.cd-wrap');
  wrap.style.background = store.bg;
  var target = new Date(store.date);
  $('.cd-title').textContent = '距离' + store.name + '还有';
  var diff = target - new Date();
  var days = Math.floor(diff / 86400000);
  var text;
  if(diff > 0){
    var rest = diff % 86400000;
    var h = Math.floor(rest / 3600000);
    var m = Math.floor(rest % 3600000 / 60000);
    var s = Math.floor(rest % 60000 / 1000);
    text = (days > 0 ? days + ' 天 ' : '') + pad(h) + ':' + pad(m) + ':' + pad(s);
  } else {
    text = '00:00:00';
  }
  $('.cd-time').textContent = text;
  var dPart = store.date.split('T')[0];
  var tPart = (store.date.split('T')[1] || '00:00:00').slice(0, 8);
  $('.cd-date').textContent = dPart + ' ' + WEEK[target.getDay()] + ' ' + tPart;
  var status = '已结束';
  if(days >= 2){ status = '进行中'; }
  else if(days >= 1){ status = '快到了'; }
  $('.cd-status').textContent = status;
}
$('.cd-cfg-btn').addEventListener('click', function(){
  $('.cd-in-name').value = store.name;
  $('.cd-in-date').value = store.date;
  $('.cd-in-bg').value = store.bg;
  $('.cd-panel').classList.add('open');
});
$('.cd-cancel').addEventListener('click', function(){
  $('.cd-panel').classList.remove('open');
});
$('.cd-save').addEventListener('click', function(){
  var n = $('.cd-in-name').value.trim();
  var d = $('.cd-in-date').value;
  var b = $('.cd-in-bg').value;
  if(n) store.name = n;
  if(d) store.date = d.length === 16 ? d + ':00' : d;
  if(b) store.bg = b;
  saveCfg();
  render();
  $('.cd-panel').classList.remove('open');
});
render();
setInterval(render, 1000);
`;
    }
}

function validateWidgetForm(data) {
    if (!data.name) {
        showNotification('错误', '请填写小组件名称', 'error');
        return false;
    }
    if (!Number.isFinite(data.w) || !Number.isFinite(data.h) || data.w < 120 || data.h < 80) {
        showNotification('错误', '请填写有效的宽高（宽≥120，高≥80）', 'error');
        return false;
    }
    if (data.type === 'iframe') {
        if (!data.url) {
            showNotification('错误', '请填写网页地址', 'error');
            return false;
        }
        try {
            const u = new URL(data.url);
            if (!/^https?:$/.test(u.protocol)) throw new Error('protocol');
        } catch (e) {
            showNotification('错误', '请输入有效的网页地址（http/https）', 'error');
            return false;
        }
    } else if (data.type === 'customCode') {
        if (!data.html) {
            showNotification('错误', '请填写 HTML 代码', 'error');
            return false;
        }
    } else {
        return false;
    }
    return true;
}

function handleWidgetFormSubmit() {
    const uuid = document.getElementById('widget-uuid').value;
    const type = document.querySelector('#widget-form .widget-type-option.active')?.dataset.type || 'iframe';
    const data = {
        type,
        name: document.getElementById('widget-name').value.trim(),
        icon: document.getElementById('widget-icon').value.trim(),
        url: document.getElementById('widget-url').value.trim(),
        html: document.getElementById('widget-html').value,
        css: document.getElementById('widget-css').value,
        js: document.getElementById('widget-js').value,
        w: parseInt(document.getElementById('widget-width').value, 10),
        h: parseInt(document.getElementById('widget-height').value, 10)
    };

    if (!validateWidgetForm(data)) return;

    if (uuid) {

        const w = widgets.find((item) => item.uuid === uuid);
        if (w) {
            w.type = data.type;
            w.name = data.name;
            w.icon = data.icon;
            if (data.type === 'iframe') {
                w.url = data.url;
                delete w.html; delete w.css; delete w.js;
            } else {
                w.html = data.html; w.css = data.css; w.js = data.js;
                delete w.url;
            }

            w.layout = { x: w.layout ? w.layout.x : 20, y: w.layout ? w.layout.y : 120, w: data.w, h: data.h, collapsed: w.layout ? !!w.layout.collapsed : false };
        }
        showNotification('成功', '小组件已更新', 'success');
    } else {

        const newWidget = {
            uuid: generateUuid(),
            type: data.type,
            name: data.name,
            icon: data.icon,
            layout: { x: 40 + (widgets.length % 5) * 24, y: 120 + (widgets.length % 5) * 24, w: data.w, h: data.h }
        };
        if (data.type === 'iframe') {
            newWidget.url = data.url;
        } else {
            newWidget.html = data.html; newWidget.css = data.css; newWidget.js = data.js;
        }
        widgets.push(newWidget);
        showNotification('成功', '小组件已创建', 'success');
    }

    saveWidgetsDebounced();
    renderWidgets();
    renderWidgetSettingsList();
    closeWidgetModal();
}

function deleteWidget(uuid) {
    const w = widgets.find((item) => item.uuid === uuid);
    if (!w) return;
    if (!confirm(`确定要删除小组件 "${w.name || '未命名'}" 吗？`)) return;
    widgets = widgets.filter((item) => item.uuid !== uuid);
    saveWidgetsDebounced();
    renderWidgets();
    renderWidgetSettingsList();
    showNotification('成功', '小组件已删除', 'success');
}

function generateUuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
