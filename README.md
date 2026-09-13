# AndyTAB
自用的极简新标签页扩展，支持WebDAV数据同步，主要是支持通过webDAV与Via浏览器的书签和首页收藏保持同步，没有其他增强功能。

<img width="927" height="954" alt="a3" src="https://github.com/user-attachments/assets/c085a421-c859-42d0-8bfd-323ae2ac29be" />
<img width="1023" height="1248" alt="a1" src="https://github.com/user-attachments/assets/da99440d-5234-4eee-8e70-8b028ad2c2b1" />
<img width="499" height="1160" alt="a2" src="https://github.com/user-attachments/assets/9f1cafca-9460-45a9-978b-efccd6317d91" />
<img width="350"  alt="2" src="https://github.com/user-attachments/assets/4710b78f-63d8-4eff-9683-14056ce92392" />
<img width="350"  alt="3" src="https://github.com/user-attachments/assets/e2f1d920-77af-49c3-b9ce-c255b0f1137f" />

---
由于新版 Chrome / Edge 已全面禁止商店外扩展直接安装，推荐优先使用 开发者模式加载解压文件夹（最稳定、永久可用、无兼容性问题）。


方法一：开发者模式加载（推荐、100% 成功）
适用于：所有新版 Chrome / Edge 浏览器
1. 将下载的 .crx后缀文件，重命名为 .zip
2. 用解压软件解压到 纯英文、无中文、无空格、无特殊字符 的文件夹路径
3. 确认解压根目录中包含manifest.json（扩展入口文件）
4. 浏览器地址栏输入并打开：chrome://extensions/
5. 打开页面右上角 开发者模式 开关
6. 点击页面左上角 加载已解压的扩展程序
7. 选中刚才解压的根目录文件夹（含 manifest.json）
8. 安装完成，打开新标签页即可使用 AndyTAB


方法二：CRX 拖拽安装（仅旧版浏览器 / 特殊启动项可用）
新版 Chrome / Edge 默认彻底禁用该方式，大概率无效，仅作备用方案
新版浏览器 拖拽安装开启方式
1. 关闭所有浏览器窗口
2. 右键浏览器快捷方式 → 属性
3. 在「目标」输入框末尾添加启动参数（前面带一个空格）：
 --enable-easy-off-store-extension-install
4. 点击确定，通过该快捷方式重新启动浏览器
5. 打开扩展页面，将 .crx 文件直接拖入页面，按提示完成安装
旧版 Chrome 专属方式
1. 打开 chrome://extensions/，开启开发者模式
2. 地址栏输入：chrome://flags/#extensions-on-chrome-urls
3. 将状态从 Disabled 修改为 Enabled，重启浏览器
4. 直接拖拽 crx 文件到扩展页面，确认添加扩展即可

---
💡 安装注意事项（必看）
- 文件夹路径 绝对不能含中文、空格、括号、特殊符号，否则扩展报错、无法加载、功能异常
- 优先使用「解压加载」方式，拖拽安装极易被新版浏览器拦截失效
- 更新扩展时，直接覆盖解压文件，在扩展页面点击刷新即可升级
