// WebDAV客户端实现 - 重新编写版本

class WebDAVClient {
    constructor(config) {
        this.config = {
            url: config.url,
            username: config.username || '',
            password: config.password || '',
            timeout: config.timeout || 10000
        };
        
        // 确保URL以斜杠结尾
        if (!this.config.url.endsWith('/')) {
            this.config.url += '/';
        }
    }
    
    // 生成认证头
    getAuthHeaders() {
        if (this.config.username && this.config.password) {
            const auth = btoa(`${this.config.username}:${this.config.password}`);
            return { 'Authorization': `Basic ${auth}` };
        }
        return {};
    }
    
    // 构建请求选项
    buildRequestOptions(method, body = null, contentType = null) {
        const headers = {
            ...this.getAuthHeaders()
        };
        
        if (contentType) {
            headers['Content-Type'] = contentType;
        }
        
        const options = {
            method: method,
            headers: headers
        };
        
        if (body) {
            options.body = typeof body === 'string' ? body : JSON.stringify(body);
        }
        
        return options;
    }
    
    // 发送请求
    async sendRequest(path, options) {
        const url = `${this.config.url}${path}`;
        let timeoutId; // 将timeoutId声明移到try块外部
        
        try {
            // 创建AbortController用于超时控制
            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
            
            // 构建完整的请求选项
            const fetchOptions = {
                ...options,
                signal: controller.signal,
                mode: 'cors',
                credentials: 'omit'
            };
            
            // 发送请求
            const response = await fetch(url, fetchOptions);
            
            // 清除超时定时器
            clearTimeout(timeoutId);
            
            // 检查响应状态
            if (!response.ok) {
                const errorInfo = this._classifyError(response.status, response.statusText);
                
                // 尝试获取更详细的错误信息
                let detailMessage = '';
                try {
                    const errorText = await response.text();
                    if (errorText) {
                        detailMessage = errorText;
                    }
                } catch (e) {
                    // 如果无法获取错误文本，忽略
                }
                
                const error = new Error(errorInfo.message + (detailMessage ? ` - ${detailMessage}` : ''));
                error.type = errorInfo.type;
                error.status = response.status;
                throw error;
            }
            
            // 对于204 No Content响应，直接返回null
            if (response.status === 204) {
                return null;
            }
            
            // 尝试解析JSON，失败则返回文本
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            } else {
                return await response.text();
            }
        } catch (error) {
            // 清除超时定时器
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            
            // 如果错误已经被分类，直接抛出
            if (error.type) {
                throw error;
            }
            
            // 处理不同类型的网络错误
            if (error.name === 'AbortError') {
                const timeoutError = new Error('请求超时，请检查网络连接或增加超时时间');
                timeoutError.type = 'TIMEOUT';
                throw timeoutError;
            } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
                const networkError = new Error('网络连接失败，请检查服务器地址和网络连接');
                networkError.type = 'NETWORK';
                throw networkError;
            } else if (error.message.includes('CORS')) {
                const corsError = new Error('CORS跨域请求被拒绝，请检查服务器配置');
                corsError.type = 'CORS';
                throw corsError;
            } else {
                error.type = 'UNKNOWN';
                throw error;
            }
        }
    }

    // 错误分类方法
    _classifyError(status, statusText) {
        switch (status) {
            case 401:
                return {
                    type: 'AUTH',
                    message: '认证失败，请检查用户名和密码'
                };
            case 403:
                return {
                    type: 'FORBIDDEN',
                    message: '权限不足，无法访问该资源'
                };
            case 404:
                return {
                    type: 'NOT_FOUND',
                    message: '请求的资源不存在'
                };
            case 405:
                return {
                    type: 'METHOD_NOT_ALLOWED',
                    message: '服务器不支持该操作，请检查WebDAV是否已启用'
                };
            case 409:
                return {
                    type: 'CONFLICT',
                    message: '资源冲突，请检查目录结构'
                };
            case 500:
                return {
                    type: 'SERVER_ERROR',
                    message: '服务器内部错误'
                };
            case 503:
                return {
                    type: 'SERVICE_UNAVAILABLE',
                    message: '服务不可用，请稍后重试'
                };
            case 507:
                return {
                    type: 'INSUFFICIENT_STORAGE',
                    message: '存储空间不足'
                };
            default:
                return {
                    type: 'HTTP_ERROR',
                    message: `WebDAV请求失败: ${status} ${statusText}`
                };
        }
    }

    // 测试连接
    async testConnection() {
        try {
            const propfindOptions = this.buildRequestOptions('PROPFIND', null, 'application/xml');
            propfindOptions.headers['Depth'] = '0';
            
            await this.sendRequest('', propfindOptions);
            return { success: true, message: '连接成功' };
        } catch (error) {
            console.error('PROPFIND请求失败：', error);
            
            // 提供更详细的错误信息
            let errorMessage = error.message;
            
            if (error.message.includes('401')) {
                errorMessage = '认证失败：用户名或密码错误';
            } else if (error.message.includes('403')) {
                errorMessage = '权限不足：无法访问WebDAV目录';
            } else if (error.message.includes('404')) {
                errorMessage = '服务器地址错误或WebDAV目录不存在';
            } else if (error.message.includes('CORS')) {
                errorMessage = '跨域请求被拒绝，请检查服务器CORS配置';
            } else if (error.message.includes('fetch')) {
                errorMessage = '网络连接失败，请检查服务器地址和网络连接';
            } else if (error.message.includes('timeout')) {
                errorMessage = '连接超时：服务器响应缓慢或网络不稳定';
            } else if (error.message.includes('500')) {
                errorMessage = '服务器内部错误：WebDAV服务可能未正常运行';
            } else if (error.message.includes('502') || error.message.includes('503') || error.message.includes('504')) {
                errorMessage = '服务器暂时不可用：请检查服务器状态';
            } else if (error.name === 'AbortError') {
                errorMessage = '连接超时：服务器响应时间过长';
            } else if (error.name === 'TypeError') {
                errorMessage = '网络错误：无法连接到服务器，请检查网络设置和服务器地址';
            } else {
                errorMessage = `连接失败：${error.message}`;
            }
            
            return { success: false, message: errorMessage };
        }
    }
    
    // 获取文件内容
    async getFile(path) {
        try {
            const options = this.buildRequestOptions('GET');
            return await this.sendRequest(path, options);
        } catch (error) {
            throw new Error(`获取文件失败: ${error.message}`);
        }
    }
    
    // 上传文件
    async putFile(path, content, contentType = null) {
        try {
            const options = this.buildRequestOptions('PUT', content, contentType);
            await this.sendRequest(path, options);
            return { success: true, message: '文件上传成功' };
        } catch (error) {
            throw new Error(`上传文件失败: ${error.message}`);
        }
    }
    
    // 删除文件
    async deleteFile(path) {
        try {
            const options = this.buildRequestOptions('DELETE');
            await this.sendRequest(path, options);
            return { success: true, message: '文件删除成功' };
        } catch (error) {
            throw new Error(`删除文件失败: ${error.message}`);
        }
    }
    
    // 检查文件是否存在
    async exists(path) {
        try {
            const options = this.buildRequestOptions('HEAD');
            await this.sendRequest(path, options);
            return true;
        } catch (error) {
            return false;
        }
    }

    // 获取文件信息（包括修改时间）
    async getFileInfo(path) {
        try {
            const options = this.buildRequestOptions('PROPFIND');
            options.headers['Depth'] = '0';

            const responseText = await this.sendRequest(path, options);

            // 解析XML响应
            const parser = new DOMParser();
            const doc = parser.parseFromString(responseText, 'application/xml');
            const response = doc.getElementsByTagName('d:response')[0];

            if (!response) {
                throw new Error('无法获取文件信息');
            }

            const href = response.getElementsByTagName('d:href')[0]?.textContent || '';
            const isCollection = response.getElementsByTagName('d:collection').length > 0;

            // 提取修改时间
            let modified = null;
            let size = 0;
            const propstat = response.getElementsByTagName('d:propstat')[0];
            if (propstat) {
                const prop = propstat.getElementsByTagName('d:prop')[0];
                if (prop) {
                    const modifiedElement = prop.getElementsByTagName('d:getlastmodified')[0];
                    if (modifiedElement) {
                        modified = modifiedElement.textContent;
                    }
                    const sizeElement = prop.getElementsByTagName('d:getcontentlength')[0];
                    if (sizeElement) {
                        size = parseInt(sizeElement.textContent) || 0;
                    }
                }
            }

            return {
                name: path.split('/').filter(Boolean).pop(),
                path: href,
                isDirectory: isCollection,
                modified: modified,
                size: size
            };
        } catch (error) {
            throw new Error(`获取文件信息失败: ${error.message}`);
        }
    }
    
    // 创建目录
    async createDirectory(path) {
        try {
            const options = this.buildRequestOptions('MKCOL');
            await this.sendRequest(path, options);
            return { success: true, message: '目录创建成功' };
        } catch (error) {
            throw new Error(`创建目录失败: ${error.message}`);
        }
    }
    
    // 列出目录内容
    async listDirectory(path = '') {
        try {
            const options = this.buildRequestOptions('PROPFIND');
            options.headers['Depth'] = '1';
            
            const responseText = await this.sendRequest(path, options);
            // 解析XML响应，提取文件列表
            return this.parseDirectoryListing(responseText);
        } catch (error) {
            throw new Error(`列出目录失败: ${error.message}`);
        }
    }
    
    // 解析WebDAV目录列表XML响应
    parseDirectoryListing(xmlText) {
        // 简单的XML解析，提取文件名和属性
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, 'application/xml');
        const response = doc.getElementsByTagName('d:response');
        
        const items = [];
        
        for (let i = 0; i < response.length; i++) {
            const href = response[i].getElementsByTagName('d:href')[0]?.textContent || '';
            const isCollection = response[i].getElementsByTagName('d:collection').length > 0;
            
            // 跳过当前目录和父目录
            if (href === '' || href === '../') continue;
            
            // 提取文件名
            const fileName = href.split('/').filter(Boolean).pop();
            
            // 提取修改时间
            let modified = null;
            const propstat = response[i].getElementsByTagName('d:propstat')[0];
            if (propstat) {
                const prop = propstat.getElementsByTagName('d:prop')[0];
                if (prop) {
                    const modifiedElement = prop.getElementsByTagName('d:getlastmodified')[0];
                    if (modifiedElement) {
                        modified = modifiedElement.textContent;
                    }
                }
            }
            
            if (fileName) {
                items.push({
                    name: fileName,
                    path: href,
                    isDirectory: isCollection,
                    modified: modified
                });
            }
        }
        
        return items;
    }
}

export default WebDAVClient;