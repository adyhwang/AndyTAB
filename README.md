# AndyTAB
自定义新标签页扩展，支持WebDAV数据同步，支持同步Via浏览器的书签

<img width="1278" height="1278" alt="1" src="https://github.com/user-attachments/assets/421189ff-f7da-4edf-a9ea-e50f6f97a7f9" />
<img width="350" height="1082" alt="4" src="https://github.com/user-attachments/assets/8294d7e9-97ce-4ad8-a009-5af2db8bd5b1" />
<img width="350" height="947" alt="2" src="https://github.com/user-attachments/assets/4710b78f-63d8-4eff-9683-14056ce92392" />
<img width="350" height="1268" alt="3" src="https://github.com/user-attachments/assets/e2f1d920-77af-49c3-b9ce-c255b0f1137f" />

#Chrome 安装未上架第三方扩展，主流是 开发者模式加载已解压文件夹（推荐），也可命令行/组策略。
 
一、准备工作
 
- 把扩展  .crx  用解压软件（7-Zip、WinRAR）解压到文件夹
​
- 确保文件夹里有  manifest.json （入口文件）
​
- 路径不要中文、空格、特殊字符
 
二、开启开发者模式（必做）
 
1. 打开 Chrome → 地址栏输： chrome://extensions/ 
​
2. 右上角打开 开发者模式 开关
 
 
三、加载已解压扩展（最稳）
 
1. 点 加载已解压的扩展程序
​
2. 选中刚才解压、含  manifest.json  的文件夹
​
3. 安装成功，可正常使用
 
 
四、旧版/命令行安装（.crx 拖拽）
 
新版 Chrome 已禁止直接拖 .crx。
如需：
 
- 关闭所有 Chrome
​
- 右键 Chrome 快捷方式 → 属性
​
- 目标末尾加：  --enable-easy-off-store-extension-install （前面有空格）
​
- 用此快捷方式启动 → 再拖 .crx 到扩展页
