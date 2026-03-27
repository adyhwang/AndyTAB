// AndyTAB 浏览器扩展弹窗 JavaScript

// 存储键名常量
const STORAGE_KEYS = {
    SHORTCUTS: 'andy_tab_shortcuts'
};

// DOM元素引用
let shortcutForm, urlInput, nameInput, iconTypeSelect, customColorInput, iconInput, fetchBtn, statusMessage;
let colorPreview, colorValue, colorPresets, uploadIconBtn, iconFileInput;

// 初始化弹窗
document.addEventListener('DOMContentLoaded', async function() {
    // 获取DOM元素
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
    
    // 颜色选择器元素
    colorPreview = document.getElementById('color-preview');
    colorValue = document.getElementById('color-value');
    colorPresets = document.querySelectorAll('.color-preset');
    
    // 获取当前标签页信息
    await getCurrentTabInfo();
    
    // 设置事件监听器
    setupEventListeners();
    
    // 初始化图标类型切换
    toggleCustomIconField();
    
    // 初始化颜色选择器
    initColorPicker();
});

// 获取当前标签页信息
async function getCurrentTabInfo() {
    try {
        // 查询当前活跃标签页
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (tabs && tabs[0]) {
            const currentTab = tabs[0];
            
            // 仅当不是Chrome扩展页面或空白页面时设置URL
            if (currentTab.url && !currentTab.url.startsWith('chrome://') && 
                !currentTab.url.startsWith('chrome-extension://') &&
                currentTab.url !== 'about:blank' &&
                currentTab.url !== 'about:newtab') {
                
                urlInput.value = currentTab.url;
                
                // 如果有标题，自动填充名称
                if (currentTab.title) {
                    nameInput.value = currentTab.title;
                }
                
                // 尝试获取网站图标
                if (currentTab.favIconUrl && currentTab.favIconUrl.startsWith('http')) {
                    iconTypeSelect.value = 'custom';
                    iconInput.value = currentTab.favIconUrl;
                    toggleCustomIconField();
                }
                
                // 延迟自动获取网站信息
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

// 设置事件监听器
function setupEventListeners() {
    // 表单提交事件
    shortcutForm.addEventListener('submit', handleFormSubmit);
    
    // 获取网站信息按钮点击事件
    fetchBtn.addEventListener('click', fetchWebsiteInfo);
    
    // 图标类型变更事件
    iconTypeSelect.addEventListener('change', toggleCustomIconField);
    
    // 关闭按钮点击事件
    document.getElementById('close-popup').addEventListener('click', closePopup);
    
    // 取消按钮点击事件
    document.getElementById('cancel-btn').addEventListener('click', closePopup);
    
    // URL输入框回车事件
    urlInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            fetchWebsiteInfo();
        }
    });
    
    // 文件上传按钮点击事件
    uploadIconBtn.addEventListener('click', function() {
        iconFileInput.click();
    });
    
    // 文件选择事件
    iconFileInput.addEventListener('change', handleFileSelect);
}

// 切换自定义图标字段可见性
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

// 初始化颜色选择器功能
function initColorPicker() {
    // 更新颜色预览和值
    function updateColorPreview(color) {
        colorPreview.style.backgroundColor = color;
        colorValue.textContent = color;
        customColorInput.value = color;
        
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
    customColorInput.addEventListener('input', (e) => {
        updateColorPreview(e.target.value);
    });
    
    // 监听预设颜色点击事件
    colorPresets.forEach(preset => {
        preset.addEventListener('click', () => {
            const color = preset.dataset.color;
            updateColorPreview(color);
        });
    });
    
    // 允许点击预览区域打开颜色选择器
    colorPreview.addEventListener('click', () => {
        customColorInput.click();
    });
    
    // 初始化时更新一次
    updateColorPreview(customColorInput.value);
}

// 获取网站信息
async function fetchWebsiteInfo() {
    const url = urlInput.value.trim();
    
    if (!url) {
        showStatusMessage('请输入网址', 'error');
        return;
    }
    
    // 验证并格式化URL
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
    
    // 显示加载状态
    const originalText = fetchBtn.querySelector('.btn-text').textContent;
    const loadingSpan = fetchBtn.querySelector('.btn-loading');
    
    fetchBtn.querySelector('.btn-text').style.display = 'none';
    loadingSpan.style.display = 'inline-block';
    fetchBtn.disabled = true;
    
    try {
        // 尝试获取网站信息
        let response;
        
        try {
            // 首先尝试使用chrome.runtime.sendMessage
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
            // 备选方案：直接获取
            response = await fetchWebsiteInfoDirectly(fullUrl);
        }
        
        if (response.success) {
            let { title, icon } = response.data;
            
            // 如名称为空，自动填充标题；否则使用用户输入的值
            if (title) {
                if (!nameInput.value.trim()) {
                    nameInput.value = title;
                } else {
                    // 反向赋值：使用用户输入的值作为标题
                    title = nameInput.value;
                }
            }

            // 如有图标，自动填充图标
            if (icon && !iconInput.value.trim()) {
                iconTypeSelect.value = 'custom';
                iconInput.value = icon;
                toggleCustomIconField();
            }

            // 加载可选图标
            loadOptionalIcons(icon, title);

            showStatusMessage(`✅ 获取成功！标题: ${title || '未找到标题'}`, 'success');
            
            // 聚焦到名称输入框
            setTimeout(() => {
                nameInput.focus();
                nameInput.select();
            }, 100);
        } else {
            showStatusMessage('获取失败: ' + (response.error || '未知错误'), 'error');
            
            // 自动填充域名为名称
            try {
                const urlObj = new URL(fullUrl);
                const domain = urlObj.hostname.replace('www.', '');
                if (!nameInput.value.trim()) {
                    nameInput.value = domain;
                }
            } catch {
                // 自动填充失败，忽略错误
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

        // 自动填充域名为名称
        try {
            const urlObj = new URL(fullUrl);
            const domain = urlObj.hostname.replace('www.', '');
            if (!nameInput.value.trim()) {
                nameInput.value = domain;
            }
        } catch {
            // 自动填充失败，忽略错误
        }
    } finally {
        // 恢复按钮状态
        fetchBtn.querySelector('.btn-text').style.display = 'inline-block';
        loadingSpan.style.display = 'none';
        fetchBtn.disabled = false;
    }
}

// 直接获取网站信息（备选方法）
async function fetchWebsiteInfoDirectly(url) {
    try {
        // 简单CORS代理或直接获取
        const response = await fetch(url, {
            method: 'GET',
            mode: 'no-cors', // 尝试绕过CORS
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        // 由于使用了no-cors，无法读取响应内容
        // 尝试从URL提取信息
        const urlObj = new URL(url);
        const domain = urlObj.hostname.replace('www.', '');
        
        // 生成网站图标URL
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
        
        // 从URL提取域名
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

// 处理表单提交
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
    
    // 验证并格式化URL
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
    
    // 创建快捷方式对象
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
        // 获取现有快捷方式
        const result = await chrome.storage.local.get([STORAGE_KEYS.SHORTCUTS]);
        const shortcuts = result[STORAGE_KEYS.SHORTCUTS] || [];
        
        // 添加新快捷方式
        shortcuts.push(shortcut);
        
        // 保存到存储
        await chrome.storage.local.set({
            [STORAGE_KEYS.SHORTCUTS]: shortcuts
        });
        
        showStatusMessage('✅ 快捷方式添加成功！', 'success');
        
        // 延迟关闭弹窗
        setTimeout(() => {
            closePopup();
        }, 1500);
        
    } catch (error) {
        console.error('保存快捷方式失败:', error);
        showStatusMessage('保存快捷方式失败: ' + error.message, 'error');
    }
}

// 显示状态消息
function showStatusMessage(message, type = 'info') {
    statusMessage.textContent = message;
    statusMessage.className = `status-message show ${type}`;
    
    // 3秒后自动隐藏
    setTimeout(() => {
        statusMessage.classList.remove('show');
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
    
    // 从iTunes Search API获取更多图标
    if (title) {
        // 搜索逻辑：先搜索前8个字符，再前4个，最后前2个
        let searchIcons = [];
        const searchLengths = [8, 4, 2];
        
        for (const length of searchLengths) {
            if (searchIcons.length >= 5) break;

            const searchQuery = title.substring(0, length);

            try {
                // 使用iTunes Search API搜索图标
                const apiUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchQuery)}&country=cn&entity=software&limit=6`;

                const response = await fetch(apiUrl);
                const data = await response.json();

                // 提取图标URL
                if (data.results && data.results.length > 0) {
                    const apiIcons = data.results.slice(0, 5).map(item => item.artworkUrl512);
                    searchIcons.push(...apiIcons);
                    break; // 找到结果，退出循环
                }
            } catch {
                // 获取失败，继续尝试下一个长度
            }
        }

        // 添加搜索到的图标
        if (searchIcons.length > 0) {
            icons.push(...searchIcons.slice(0, 5));
        }
    }

    // 确保最多显示6个图标
    const displayIcons = icons.slice(0, 6);
    
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
            iconInput.value = iconUrl;
        });

        // 双击事件：填入Base64字符串
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

// 关闭弹窗
function closePopup() {
    window.close();
}