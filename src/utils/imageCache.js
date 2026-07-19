// 图片缓存管理模块

// 图片缓存键名常量
export const IMAGE_CACHE_KEYS = {
    WEBSITE_ICONS: 'andy_tab_website_icons',
    BACKGROUND_IMAGES: 'andy_tab_background_images',
    BING_WALLPAPERS: 'andy_tab_bing_wallpapers'
};

// 图片缓存管理类
class ImageCacheManager {
    constructor() {
        this.iconsCache = new Map();
        this.backgroundsCache = new Map();
        this.bingWallpapersCache = new Map();
        this.init();
    }

    // 初始化缓存
    async init() {
        // 并行加载图标、背景和Bing壁纸缓存
        await Promise.all([
            this.loadIconsCache(),
            this.loadBackgroundsCache(),
            this.loadBingWallpapersCache()
        ]);
    }

    // 加载网站图标缓存
    async loadIconsCache() {
        try {
            const result = await chrome.storage.local.get([IMAGE_CACHE_KEYS.WEBSITE_ICONS]);
            const cache = result[IMAGE_CACHE_KEYS.WEBSITE_ICONS] || {};
            this.iconsCache = new Map(Object.entries(cache));
        } catch (error) {
            console.error('加载网站图标缓存失败:', error);
            this.iconsCache = new Map();
        }
    }

    // 保存网站图标缓存
    async saveIconsCache() {
        try {
            const cacheObject = Object.fromEntries(this.iconsCache);
            await chrome.storage.local.set({
                [IMAGE_CACHE_KEYS.WEBSITE_ICONS]: cacheObject
            });
        } catch (error) {
            console.error('保存网站图标缓存失败:', error);
        }
    }

    // 加载背景图片缓存
    async loadBackgroundsCache() {
        try {
            const result = await chrome.storage.local.get([IMAGE_CACHE_KEYS.BACKGROUND_IMAGES]);
            const cache = result[IMAGE_CACHE_KEYS.BACKGROUND_IMAGES] || {};
            this.backgroundsCache = new Map(Object.entries(cache));
        } catch (error) {
            console.error('加载背景图片缓存失败:', error);
            this.backgroundsCache = new Map();
        }
    }

    // 保存背景图片缓存
    async saveBackgroundsCache() {
        try {
            const cacheObject = Object.fromEntries(this.backgroundsCache);
            await chrome.storage.local.set({
                [IMAGE_CACHE_KEYS.BACKGROUND_IMAGES]: cacheObject
            });
        } catch (error) {
            console.error('保存背景图片缓存失败:', error);
        }
    }

    // 加载Bing壁纸缓存
    async loadBingWallpapersCache() {
        try {
            const result = await chrome.storage.local.get([IMAGE_CACHE_KEYS.BING_WALLPAPERS]);
            const cache = result[IMAGE_CACHE_KEYS.BING_WALLPAPERS] || {};
            this.bingWallpapersCache = new Map(Object.entries(cache));
        } catch (error) {
            console.error('加载Bing壁纸缓存失败:', error);
            this.bingWallpapersCache = new Map();
        }
    }

    // 保存Bing壁纸缓存
    async saveBingWallpapersCache() {
        try {
            const cacheObject = Object.fromEntries(this.bingWallpapersCache);
            await chrome.storage.local.set({
                [IMAGE_CACHE_KEYS.BING_WALLPAPERS]: cacheObject
            });
        } catch (error) {
            console.error('保存Bing壁纸缓存失败:', error);
        }
    }

    // 检查背景图片是否需要更新
    shouldUpdateBackgroundImage(cacheEntry) {
        if (!cacheEntry) return true;
        
        const now = new Date();
        const lastUpdate = new Date(cacheEntry.timestamp);
        
        // 如果今天已经过了3点，并且最后更新是昨天或更早，则需要更新
        if (now.getHours() >= 3) {
            // 检查是否是同一天
            const isSameDay = now.toDateString() === lastUpdate.toDateString();
            return !isSameDay;
        } else {
            // 今天还没到3点，检查是否是今天凌晨到3点之间更新的
            const isToday = now.toDateString() === lastUpdate.toDateString();
            return !isToday;
        }
    }

    // 检查Bing壁纸是否需要更新（基于日期）
    shouldUpdateBingWallpaper(cacheEntry) {
        if (!cacheEntry) return true;
        
        const now = new Date();
        const lastUpdate = new Date(cacheEntry.timestamp);
        
        // 检查是否是同一天，如果不是则需要更新
        return now.toDateString() !== lastUpdate.toDateString();
    }

    // 创建带超时的fetch请求
    async fetchWithTimeout(url, timeout = 10000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
            const response = await fetch(url, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`请求超时 (${timeout}ms)`);
            }
            throw error;
        }
    }

    // 缓存图片到本地
    async cacheImage(url, isBackground = false, isBingWallpaper = false) {
        try {
            const response = await this.fetchWithTimeout(url, 15000); // 15秒超时
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const blob = await response.blob();
            const reader = new FileReader();
            
            return new Promise((resolve, reject) => {
                reader.onloadend = async () => {
                    const base64Data = reader.result;
                    const cacheEntry = {
                        data: base64Data,
                        timestamp: Date.now()
                    };
                    
                    if (isBingWallpaper) {
                        this.bingWallpapersCache.set(url, cacheEntry);
                        await this.saveBingWallpapersCache();
                    } else if (isBackground) {
                        this.backgroundsCache.set(url, cacheEntry);
                        await this.saveBackgroundsCache();
                    } else {
                        this.iconsCache.set(url, cacheEntry);
                        await this.saveIconsCache();
                    }
                    
                    resolve(base64Data);
                };
                
                reader.onerror = () => {
                    reject(new Error('Failed to read blob'));
                };
                
                reader.readAsDataURL(blob);
            });
        } catch (error) {
            console.error(`缓存图片失败 (${url}):`, error);
            return null;
        }
    }

    // 使用自定义键缓存图片（用于Bing壁纸等需要固定键的场景）
    async cacheImageWithKey(url, cacheKey, isBingWallpaper = false) {
        try {
            const response = await this.fetchWithTimeout(url, 15000); // 15秒超时
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const blob = await response.blob();
            const reader = new FileReader();
            
            return new Promise((resolve, reject) => {
                reader.onloadend = async () => {
                    const base64Data = reader.result;
                    const cacheEntry = {
                        data: base64Data,
                        timestamp: Date.now()
                    };
                    
                    if (isBingWallpaper) {
                        // 清除旧的Bing壁纸缓存
                        this.bingWallpapersCache.clear();
                        
                        // 保存新的Bing壁纸
                        this.bingWallpapersCache.set(cacheKey, cacheEntry);
                        await this.saveBingWallpapersCache();
                    }
                    
                    resolve(base64Data);
                };
                
                reader.onerror = () => {
                    reject(new Error('Failed to read blob'));
                };
                
                reader.readAsDataURL(blob);
            });
        } catch (error) {
            console.error(`缓存图片失败 (${url}):`, error);
            return null;
        }
    }

    // 获取缓存的图片
    async getCachedImage(url, isBackground = false, isBingWallpaper = false) {
        let cacheEntry;
        
        if (isBingWallpaper) {
            cacheEntry = this.bingWallpapersCache.get(url);
            // 检查Bing壁纸是否需要更新
            if (this.shouldUpdateBingWallpaper(cacheEntry)) {
                return null;
            }
        } else if (isBackground) {
            cacheEntry = this.backgroundsCache.get(url);
            // 检查背景图片是否需要更新
            if (this.shouldUpdateBackgroundImage(cacheEntry)) {
                return null;
            }
        } else {
            cacheEntry = this.iconsCache.get(url);
        }
        
        return cacheEntry ? cacheEntry.data : null;
    }

    // 获取或缓存图片（非阻塞版本）
    async getOrCacheImage(url, isBackground = false, isBingWallpaper = false) {
        // 先尝试从缓存获取
        const cachedImage = await this.getCachedImage(url, isBackground, isBingWallpaper);
        if (cachedImage) {
            return cachedImage;
        }
        
        // 如果没有缓存，启动后台缓存过程但不等待它完成
        // 直接返回null表示需要使用原始URL作为后备
        this.cacheImageInBackground(url, isBackground, isBingWallpaper);
        return null;
    }
    
    // 在后台缓存图片（非阻塞）
    async cacheImageInBackground(url, isBackground = false, isBingWallpaper = false) {
        // 使用setTimeout确保不会阻塞主线程
        setTimeout(async () => {
            try {
                await this.cacheImage(url, isBackground, isBingWallpaper);
            } catch (error) {
                console.error(`后台缓存图片失败 (${url}):`, error);
            }
        }, 0);
    }

    // 清除所有缓存
    async clearAllCache() {
        try {
            await chrome.storage.local.remove([
                IMAGE_CACHE_KEYS.WEBSITE_ICONS,
                IMAGE_CACHE_KEYS.BACKGROUND_IMAGES,
                IMAGE_CACHE_KEYS.BING_WALLPAPERS
            ]);
            this.iconsCache.clear();
            this.backgroundsCache.clear();
            this.bingWallpapersCache.clear();
        } catch (error) {
            console.error('清除缓存失败:', error);
        }
    }

    // 批量预加载网站图标
    async preloadIcons(urls) {
        try {
            const preloadPromises = urls.map(url => this.cacheImage(url, false));
            const results = await Promise.allSettled(preloadPromises);
            
            // 统计成功和失败的数量
            const successful = results.filter(result => result.status === 'fulfilled' && result.value !== null).length;
            const failed = results.length - successful;
            
            // console.log(`预加载图标完成: ${successful} 成功, ${failed} 失败`);
            return results;
        } catch (error) {
            console.error('批量预加载图标失败:', error);
            return [];
        }
    }

    // 预加载背景图片
    async preloadBackgroundImage(url) {
        try {
            // 检查是否已经在缓存中且未过期
            const cachedImage = await this.getCachedImage(url, true);
            if (cachedImage) {
                // console.log('背景图片已在缓存中，无需重新加载');
                return cachedImage;
            }
            
            // 缓存背景图片
            const result = await this.cacheImage(url, true);
            if (result) {
                // console.log('背景图片预加载成功');
            } else {
                // console.warn('背景图片预加载失败');
            }
            return result;
        } catch (error) {
            console.error('预加载背景图片失败:', error);
            return null;
        }
    }

    // 批量缓存图片
    async batchCacheImages(imageUrls, isBackground = false) {
        try {
            // 分批处理，避免同时发起过多请求
            const batchSize = 5;
            const batches = [];
            
            // 将URL分成批次
            for (let i = 0; i < imageUrls.length; i += batchSize) {
                batches.push(imageUrls.slice(i, i + batchSize));
            }
            
            const allResults = [];
            
            // 逐批次处理
            for (const batch of batches) {
                const batchPromises = batch.map(url => this.cacheImage(url, isBackground));
                const batchResults = await Promise.allSettled(batchPromises);
                allResults.push(...batchResults);
                
                // 添加小延迟避免过于频繁的请求
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // 统计结果
            const successful = allResults.filter(result => result.status === 'fulfilled' && result.value !== null).length;
            const failed = allResults.length - successful;
            
            // console.log(`批量缓存图片完成: ${successful} 成功, ${failed} 失败`);
            return allResults;
        } catch (error) {
            console.error('批量缓存图片失败:', error);
            return [];
        }
    }

    // 清除过期缓存
    async clearExpiredCache() {
        try {
            // 清除30天前的网站图标缓存
            const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
            for (const [url, entry] of this.iconsCache.entries()) {
                if (entry.timestamp < thirtyDaysAgo) {
                    this.iconsCache.delete(url);
                }
            }
            await this.saveIconsCache();
            
            // 背景图片缓存由shouldUpdateBackgroundImage方法控制，不需要在此清除
        } catch (error) {
            // console.error('清除过期缓存失败:', error);
        }
    }
}

// 创建单例实例
const imageCacheManager = new ImageCacheManager();

export default imageCacheManager;