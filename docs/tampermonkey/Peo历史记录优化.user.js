// ==UserScript==
// @name         Poe 聊天记录新标签页打开
// @name:en      Poe Chat History New Tab Opener
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  在 Poe.com 中，恢复使用鼠标中键、Ctrl/Cmd+点击、右键菜单在新标签页中打开聊天的功能。
// @description:en Restore the ability to open chats in a new tab using middle-click, Ctrl/Cmd+click, or the context menu on Poe.com.
// @author       Your AI Assistant (Final Robust Version)
// @match        https://poe.com/*
// @grant        window.open
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_ID = 'poeNewTabFix';

    function processLinks(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return;
        }

        const links = node.querySelectorAll('li a[href^="/chat/"]');

        links.forEach(link => {
            if (link.dataset[SCRIPT_ID]) {
                return;
            }
            link.dataset[SCRIPT_ID] = 'true';

            // --- 全新的、更强健的事件处理策略 ---
            link.addEventListener('mousedown', (event) => {
                // 仅当中键点击(1) 或 Ctrl/Cmd+左键点击(0) 时触发
                if (event.button === 1 || (event.button === 0 && (event.ctrlKey || event.metaKey))) {
                    // 1. 彻底阻止此事件的任何默认行为和传播
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();

                    // 2. 手动执行我们想要的操作：在新标签页打开链接
                    // window.open 会正确处理相对路径的 href
                    window.open(link.href, '_blank');
                }
            }, true); // 仍然在捕获阶段尽早拦截

            // --- 额外增强：恢复右键菜单功能 ---
            // 有些网站会禁用右键菜单，这个监听器可以阻止它，恢复浏览器的原生菜单
            link.addEventListener('contextmenu', (event) => {
                event.stopPropagation();
                event.stopImmediatePropagation();
            }, true);
        });
    }

    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            if (mutation.addedNodes.length) {
                mutation.addedNodes.forEach(node => {
                    processLinks(node);
                });
            }
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    processLinks(document.body);

    console.log('Poe 新标签页打开脚本已激活 (v1.5 - 强力模式)。');
})();