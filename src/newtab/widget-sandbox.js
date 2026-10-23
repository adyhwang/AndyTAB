(function () {
    'use strict';

    const root = document.getElementById('widget-root');
    let currentUuid = null;
    let currentTheme = 'light';

    function reportError(message) {
        try {
            parent.postMessage({ type: 'widget-error', uuid: currentUuid, message: String(message) }, '*');
        } catch (e) {

        }
    }

    window.addEventListener('error', (ev) => {
        reportError('运行时错误：' + ((ev && ev.message) ? ev.message : 'unknown'));
    });

    window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.type === 'widget-render') {
            currentUuid = data.uuid || null;
            render(data.payload);
        } else if (data.type === 'widget-theme') {
            applyBaseStyle(data.theme);
        }
    });

    // 基础样式独立于用户样式，不参与渲染时的清空，只随主题更新
    function applyBaseStyle(theme) {
        currentTheme = theme === 'dark' ? 'dark' : 'light';
        const dark = currentTheme === 'dark';

        let base = document.getElementById('widget-base-style');
        if (!base) {
            base = document.createElement('style');
            base.id = 'widget-base-style';
            document.head.appendChild(base);
        }
        base.textContent = [
            'html,body{margin:0;padding:0;height:100%;font-family:"Segoe UI",Tahoma,sans-serif;',
            `background:${dark ? '#17191d' : '#ffffff'};color:${dark ? '#e6e8eb' : '#1f2328'};}`,
            '#widget-root{height:100%;}'
        ].join('');
    }

    function installStoreShim(initial) {
        const mem = Object.assign({}, initial || {});
        function persist() {
            try {
                parent.postMessage({ type: 'widget-store-set', uuid: currentUuid, value: mem }, '*');
            } catch (e) {

            }
        }
        const shim = {
            getItem(k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
            setItem(k, v) { mem[k] = String(v); persist(); },
            removeItem(k) { delete mem[k]; persist(); },
            clear() { Object.keys(mem).forEach((k) => delete mem[k]); persist(); },
            key(i) { return Object.keys(mem)[i] || null; },
            get length() { return Object.keys(mem).length; }
        };
        try {
            Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
        } catch (e) {

        }
    }

    function render(payload) {
        const { html = '', css = '', js = '', store = null, theme = currentTheme } = payload || {};

        installStoreShim(store);

        applyBaseStyle(theme);

        document.querySelectorAll('style[data-widget-style]').forEach((n) => n.remove());

        if (css) {
            const style = document.createElement('style');
            style.setAttribute('data-widget-style', '1');
            style.textContent = css;
            document.head.appendChild(style);
        }

        root.innerHTML = html;
        executeInlineScripts(root);

        if (js) {
            try {

                const fn = new Function(js);
                fn();
            } catch (e) {
                reportError('JS 执行错误：' + (e && e.message ? e.message : e));
            }
        }

        try {
            parent.postMessage({ type: 'widget-ready', uuid: currentUuid }, '*');
        } catch (e) {

        }
    }

    function executeInlineScripts(scope) {
        scope.querySelectorAll('script').forEach((old) => {
            const fresh = document.createElement('script');

            if (old.src) {
                reportError('注意：小组件 HTML 中的外链脚本（' + old.src.slice(0, 60) + '…）在沙箱中被禁用，请使用独立 JS 字段');
                return;
            }
            fresh.textContent = old.textContent;
            old.parentNode.replaceChild(fresh, old);
        });
    }
})();
