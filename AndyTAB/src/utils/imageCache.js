const IMAGE_CACHE_KEYS = {
    WEBSITE_ICONS: 'andy_tab_website_icons',
    BACKGROUND_IMAGES: 'andy_tab_background_images',
    BING_WALLPAPERS: 'andy_tab_bing_wallpapers'
};

class ImageCacheManager {
    constructor() {
        this.iconsCache = new Map();
        this.backgroundsCache = new Map();
        this.bingWallpapersCache = new Map();
        this.init();
    }

    async init() {

        await Promise.all([
            this.loadIconsCache(),
            this.loadBackgroundsCache(),
            this.loadBingWallpapersCache()
        ]);
    }

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

    shouldUpdateBackgroundImage(cacheEntry) {
        if (!cacheEntry) return true;

        const now = new Date();
        const lastUpdate = new Date(cacheEntry.timestamp);

        if (now.getHours() >= 3) {

            const isSameDay = now.toDateString() === lastUpdate.toDateString();
            return !isSameDay;
        } else {

            const isToday = now.toDateString() === lastUpdate.toDateString();
            return !isToday;
        }
    }

    shouldUpdateBingWallpaper(cacheEntry) {
        if (!cacheEntry) return true;

        const now = new Date();
        const lastUpdate = new Date(cacheEntry.timestamp);

        return now.toDateString() !== lastUpdate.toDateString();
    }

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

    async cacheImage(url, isBackground = false, isBingWallpaper = false) {
        try {
            const response = await this.fetchWithTimeout(url, 15000);
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

    async cacheImageWithKey(url, cacheKey, isBingWallpaper = false) {
        try {
            const response = await this.fetchWithTimeout(url, 15000);
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

                        this.bingWallpapersCache.clear();

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

    async getCachedImage(url, isBackground = false, isBingWallpaper = false) {
        let cacheEntry;

        if (isBingWallpaper) {
            cacheEntry = this.bingWallpapersCache.get(url);

            if (this.shouldUpdateBingWallpaper(cacheEntry)) {
                return null;
            }
        } else if (isBackground) {
            cacheEntry = this.backgroundsCache.get(url);

            if (this.shouldUpdateBackgroundImage(cacheEntry)) {
                return null;
            }
        } else {
            cacheEntry = this.iconsCache.get(url);
        }

        return cacheEntry ? cacheEntry.data : null;
    }

    async getOrCacheImage(url, isBackground = false, isBingWallpaper = false) {

        const cachedImage = await this.getCachedImage(url, isBackground, isBingWallpaper);
        if (cachedImage) {
            return cachedImage;
        }

        this.cacheImageInBackground(url, isBackground, isBingWallpaper);
        return null;
    }

    async cacheImageInBackground(url, isBackground = false, isBingWallpaper = false) {

        setTimeout(async () => {
            try {
                await this.cacheImage(url, isBackground, isBingWallpaper);
            } catch (error) {
                console.error(`后台缓存图片失败 (${url}):`, error);
            }
        }, 0);
    }

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

    async preloadIcons(urls) {
        try {
            const preloadPromises = urls.map(url => this.cacheImage(url, false));
            const results = await Promise.allSettled(preloadPromises);

            const successful = results.filter(result => result.status === 'fulfilled' && result.value !== null).length;
            const failed = results.length - successful;

            return results;
        } catch (error) {
            console.error('批量预加载图标失败:', error);
            return [];
        }
    }

    async preloadBackgroundImage(url) {
        try {

            const cachedImage = await this.getCachedImage(url, true);
            if (cachedImage) {

                return cachedImage;
            }

            const result = await this.cacheImage(url, true);
            if (result) {

            } else {

            }
            return result;
        } catch (error) {
            console.error('预加载背景图片失败:', error);
            return null;
        }
    }

    async batchCacheImages(imageUrls, isBackground = false) {
        try {

            const batchSize = 5;
            const batches = [];

            for (let i = 0; i < imageUrls.length; i += batchSize) {
                batches.push(imageUrls.slice(i, i + batchSize));
            }

            const allResults = [];

            for (const batch of batches) {
                const batchPromises = batch.map(url => this.cacheImage(url, isBackground));
                const batchResults = await Promise.allSettled(batchPromises);
                allResults.push(...batchResults);

                await new Promise(resolve => setTimeout(resolve, 100));
            }

            const successful = allResults.filter(result => result.status === 'fulfilled' && result.value !== null).length;
            const failed = allResults.length - successful;

            return allResults;
        } catch (error) {
            console.error('批量缓存图片失败:', error);
            return [];
        }
    }

    async clearExpiredCache() {
        try {

            const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
            for (const [url, entry] of this.iconsCache.entries()) {
                if (entry.timestamp < thirtyDaysAgo) {
                    this.iconsCache.delete(url);
                }
            }
            await this.saveIconsCache();

        } catch (error) {

        }
    }
}

const imageCacheManager = new ImageCacheManager();

export default imageCacheManager;
