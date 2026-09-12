const STORAGE_KEYS = {
    SHORTCUTS: 'andy_tab_shortcuts'
};

let shortcutForm, urlInput, nameInput, iconTypeSelect, customColorInput, iconInput, fetchBtn, statusMessage;
let colorPreview, colorValue, colorPresets, uploadIconBtn, iconFileInput;

document.addEventListener('DOMContentLoaded', async function() {

    shortcutForm = document.getElementById('shortcut-form');
    urlInput = document.getElementById('shortcut-url');
    nameInput = document.getElementById('shortcut-name');
    iconTypeSelect = document.getElementById('shortcut-icon-type');
    customColorInput = document.getElementById('shortcut-custom-color');
    iconInput = document.getElementById('shortcut-icon');
    fetchBtn = document.getElementById('fetch-info-btn');
    statusMessage = document.getElementById('shortcut-status');
    uploadIconBtn = document.getElementById('upload-icon-btn');
    iconFileInput = document.getElementById('icon-file-input');

    colorPreview = document.getElementById('color-preview');
    colorValue = document.getElementById('color-value');
    colorPresets = document.querySelectorAll('.color-preset');

    await getCurrentTabInfo();

    setupEventListeners();

    toggleCustomIconField();

    initColorPicker();
});

async function getCurrentTabInfo() {
    try {

        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

        if (tabs && tabs[0]) {
            const currentTab = tabs[0];

            if (currentTab.url && !currentTab.url.startsWith('chrome://') &&
                !currentTab.url.startsWith('chrome-extension://') &&
                currentTab.url !== 'about:blank' &&
                currentTab.url !== 'about:newtab') {

                urlInput.value = currentTab.url;

                if (currentTab.title) {
                    nameInput.value = currentTab.title;
                }

                if (currentTab.favIconUrl && currentTab.favIconUrl.startsWith('http')) {
                    iconTypeSelect.value = 'custom';
                    iconInput.value = currentTab.favIconUrl;
                    toggleCustomIconField();
                }

                setTimeout(() => {
                    fetchWebsiteInfo();
                }, 500);
            }
        }
    } catch (error) {
        console.error('获取当前标签页信息失败:', error);
        showStatusMessage('无法获取当前标签页信息', 'error');
    }
}

function setupEventListeners() {

    shortcutForm.addEventListener('submit', handleFormSubmit);

    fetchBtn.addEventListener('click', fetchWebsiteInfo);

    iconTypeSelect.addEventListener('change', toggleCustomIconField);

    document.getElementById('close-popup').addEventListener('click', closePopup);

    document.getElementById('cancel-btn').addEventListener('click', closePopup);

    urlInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            fetchWebsiteInfo();
        }
    });

    uploadIconBtn.addEventListener('click', function() {
        iconFileInput.click();
    });

    iconFileInput.addEventListener('change', handleFileSelect);
}

function toggleCustomIconField() {
    const iconType = iconTypeSelect.value;
    const customIconGroup = document.getElementById('custom-icon-group');
    const solidColorGroup = document.getElementById('solid-color-group');

    if (iconType === 'custom') {
        customIconGroup.style.display = 'block';
        solidColorGroup.style.display = 'none';
    } else {
        customIconGroup.style.display = 'none';
        solidColorGroup.style.display = 'block';
    }
}

function initColorPicker() {

    function updateColorPreview(color) {
        colorPreview.style.backgroundColor = color;
        colorValue.textContent = color;
        customColorInput.value = color;

        colorPresets.forEach(preset => {
            if (preset.dataset.color === color) {
                preset.classList.add('active');
            } else {
                preset.classList.remove('active');
            }
        });
    }

    customColorInput.addEventListener('input', (e) => {
        updateColorPreview(e.target.value);
    });

    colorPresets.forEach(preset => {
        preset.addEventListener('click', () => {
            const color = preset.dataset.color;
            updateColorPreview(color);
        });
    });

    colorPreview.addEventListener('click', () => {
        customColorInput.click();
    });

    updateColorPreview(customColorInput.value);
}

async function fetchWebsiteInfo() {
    const url = urlInput.value.trim();

    if (!url) {
        showStatusMessage('请输入网址', 'error');
        return;
    }

    let fullUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        fullUrl = 'https://' + url;
    }

    try {
        new URL(fullUrl);
    } catch (e) {
        showStatusMessage('网址格式不正确', 'error');
        return;
    }

    const originalText = fetchBtn.querySelector('.btn-text').textContent;
    const loadingSpan = fetchBtn.querySelector('.btn-loading');

    fetchBtn.querySelector('.btn-text').style.display = 'none';
    loadingSpan.style.display = 'inline-block';
    fetchBtn.disabled = true;

    try {

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
        } catch {

            response = await fetchWebsiteInfoDirectly(fullUrl);
        }

        if (!response) {
            response = await fetchWebsiteInfoDirectly(fullUrl);
        }

        if (response.success) {
            let { title, icon } = response.data;

            if (title) {
                if (!nameInput.value.trim()) {
                    nameInput.value = title;
                } else {

                    title = nameInput.value;
                }
            }

            if (icon && !iconInput.value.trim()) {
                iconTypeSelect.value = 'custom';
                iconInput.value = icon;
                toggleCustomIconField();
            }

            loadOptionalIcons(icon, title);

            showStatusMessage(`✅ 获取成功！标题: ${title || '未找到标题'}`, 'success');

            setTimeout(() => {
                nameInput.focus();
                nameInput.select();
            }, 100);
        } else {
            showStatusMessage('获取失败: ' + (response.error || '未知错误'), 'error');

            try {
                const urlObj = new URL(fullUrl);
                const domain = urlObj.hostname.replace('www.', '');
                if (!nameInput.value.trim()) {
                    nameInput.value = domain;
                }
            } catch {

            }
        }
    } catch (error) {
        let errorMessage = '获取网站信息失败';
        if (error.message.includes('timeout')) {
            errorMessage = '⏱️ 请求超时，请检查网络连接';
        } else if (error.message.includes('Failed to fetch')) {
            errorMessage = '🌐 网络连接失败';
        } else if (error.message.includes('404')) {
            errorMessage = '🔍 网站未找到 (404)';
        } else if (error.message.includes('403')) {
            errorMessage = '🔒 访问被拒绝 (403)';
        } else {
            errorMessage = '❌ 获取失败: ' + error.message;
        }

        showStatusMessage(errorMessage, 'error');

        try {
            const urlObj = new URL(fullUrl);
            const domain = urlObj.hostname.replace('www.', '');
            if (!nameInput.value.trim()) {
                nameInput.value = domain;
            }
        } catch {

        }
    } finally {

        fetchBtn.querySelector('.btn-text').style.display = 'inline-block';
        loadingSpan.style.display = 'none';
        fetchBtn.disabled = false;
    }
}

async function fetchWebsiteInfoDirectly(url) {
    try {

        const response = await fetch(url, {
            method: 'GET',
            mode: 'no-cors',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const urlObj = new URL(url);
        const domain = urlObj.hostname.replace('www.', '');

        const faviconUrl = `${urlObj.protocol}//${urlObj.hostname}/favicon.ico`;

        return {
            success: true,
            data: {
                title: domain,
                icon: faviconUrl
            }
        };
    } catch (error) {
        console.error('直接获取网站信息失败:', error);

        try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname.replace('www.', '');
            const faviconUrl = `${urlObj.protocol}//${urlObj.hostname}/favicon.ico`;

            return {
                success: true,
                data: {
                    title: domain,
                    icon: faviconUrl
                }
            };
        } catch (urlError) {
            return {
                success: false,
                error: '无法解析网址'
            };
        }
    }
}

async function handleFormSubmit(e) {
    e.preventDefault();

    const name = nameInput.value.trim();
    let url = urlInput.value.trim();
    const iconType = iconTypeSelect.value;
    const customColor = customColorInput.value;
    const icon = iconInput.value.trim();

    if (!name || !url) {
        showStatusMessage('请填写必填项', 'error');
        return;
    }

    let fullUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        fullUrl = 'https://' + url;
    }

    try {
        new URL(fullUrl);
    } catch (e) {
        showStatusMessage('网址格式不正确', 'error');
        return;
    }

    const shortcut = {
        id: Date.now().toString(),
        name: name,
        url: fullUrl,
        iconType: iconType,
        icon: iconType === 'custom' ? (icon || '') : '',
        customColor: iconType === 'auto' ? customColor : null,
        createdAt: new Date().toISOString()
    };

    try {

        const result = await chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]);
        const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];

        shortcuts.push(shortcut);

        await chrome.storage.local.set({
            [STORAGE_KEYS.SHORTCUTS]: shortcuts
        });

        showStatusMessage('✅ 快捷方式添加成功！', 'success');

        setTimeout(() => {
            closePopup();
        }, 1500);

    } catch (error) {
        console.error('保存快捷方式失败:', error);
        showStatusMessage('保存快捷方式失败: ' + error.message, 'error');
    }
}

function showStatusMessage(message, type = 'info') {
    statusMessage.textContent = message;
    statusMessage.className = `status-message show ${type}`;

    setTimeout(() => {
        statusMessage.classList.remove('show');
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
            if (searchIcons.length >= 5) break;

            const searchQuery = title.substring(0, length);

            try {

                const apiUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchQuery)}&country=cn&entity=software&limit=6`;

                const response = await fetch(apiUrl);
                const data = await response.json();

                if (data.results && data.results.length > 0) {
                    const apiIcons = data.results.slice(0, 5).map(item => item.artworkUrl512);
                    searchIcons.push(...apiIcons);
                    break;
                }
            } catch {

            }
        }

        if (searchIcons.length > 0) {
            icons.push(...searchIcons.slice(0, 5));
        }
    }

    const displayIcons = icons.slice(0, 6);

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
            iconInput.value = iconUrl;
        });

        iconItem.addEventListener('dblclick', async () => {
            try {
                const base64 = await convertImageToBase64(iconUrl);
                iconInput.value = base64;
            } catch {
                showStatusMessage('❌ 图标转换失败', 'error');
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
                iconInput.value = compressedBase64;
                showStatusMessage('图片已成功压缩并转换为Base64格式', 'success');
            }).catch(error => {
                console.error('图片压缩失败:', error);
                showStatusMessage('图片过大，请选择更小的图片（建议不超过4KB）', 'error');
            });
            return;
        }

        iconInput.value = base64String;
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

function closePopup() {
    window.close();
}
