// 同步工具函数 - storage.js 和 background.js 共用

// HTML转义
export function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// 将快捷方式转换为 favorites.txt 格式
export function convertShortcutsToFavoritesTxt(shortcuts) {
    if (!Array.isArray(shortcuts)) return '';

    return shortcuts.map((shortcut, index) => {
        return JSON.stringify({
            title: shortcut.name || '',
            url: shortcut.url || '',
            order: index,
            iconType: shortcut.iconType || 'auto',
            icon: shortcut.icon || '',
            customColor: shortcut.customColor || null
        });
    }).join('\n');
}

// 将书签转换为 bookmarks.html 格式（Netscape Bookmark格式）
export function convertBookmarksToHtml(bookmarks) {
    const generateBookmarkHtml = (bookmark, level = 0, isBookmarkBar = false) => {
        const indent = '    '.repeat(level);

        if (bookmark.children !== undefined) {
            const addDate = bookmark.dateAdded ? Math.floor(bookmark.dateAdded / 1000) : Math.floor(Date.now() / 1000);
            const lastModified = bookmark.dateGroupModified ? Math.floor(bookmark.dateGroupModified / 1000) : 0;

            let h3Attrs = `ADD_DATE="${addDate}"`;
            if (lastModified > 0) {
                h3Attrs += ` LAST_MODIFIED="${lastModified}"`;
            }
            if (isBookmarkBar) {
                h3Attrs += ' PERSONAL_TOOLBAR_FOLDER="true"';
            }

            let html = `${indent}<DT><H3 ${h3Attrs}>${escapeHtml(bookmark.title || '未命名文件夹')}</H3>\n`;
            html += `${indent}<DL><p>\n`;
            if (bookmark.children && bookmark.children.length > 0) {
                for (const child of bookmark.children) {
                    html += generateBookmarkHtml(child, level + 1);
                }
            }
            html += `${indent}</DL><p>\n`;
            return html;
        } else {
            const addDate = bookmark.dateAdded ? Math.floor(bookmark.dateAdded / 1000) : Math.floor(Date.now() / 1000);
            let aAttrs = `HREF="${escapeHtml(bookmark.url || '')}" ADD_DATE="${addDate}"`;
            if (bookmark.icon) {
                aAttrs += ` ICON="${escapeHtml(bookmark.icon)}"`;
            }
            return `${indent}<DT><A ${aAttrs}>${escapeHtml(bookmark.title || '')}</A>\n`;
        }
    };

    let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
`;

    let bookmarkRoots = bookmarks;
    if (Array.isArray(bookmarks) && bookmarks.length === 1 && bookmarks[0].children) {
        bookmarkRoots = bookmarks[0].children;
    }

    if (Array.isArray(bookmarkRoots)) {
        for (const bookmark of bookmarkRoots) {
            const title = (bookmark.title || '').toLowerCase();
            const isBookmarkBar = bookmark.id === '1' || title.includes('书签栏') || title.includes('bookmarks bar');
            html += generateBookmarkHtml(bookmark, 1, isBookmarkBar);
        }
    }

    html += '</DL><p>';
    return html;
}
