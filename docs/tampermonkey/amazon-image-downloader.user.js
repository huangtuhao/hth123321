// ==UserScript==
// @name         亚马逊产品图片批量下载
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  批量下载亚马逊搜索结果中的产品图片（包括主图和附图）
// @author       Your name
// @match        https://www.amazon.com/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js
// ==/UserScript==

(function() {
    'use strict';

    // 添加一个1x1像素的空白图片base64编码
    const BLANK_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    // 添加下载控制面板
    function addDownloadPanel() {
        const panel = document.createElement('div');
        panel.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            z-index: 9999;
            padding: 15px;
            background: #fff;
            border: 1px solid #232f3e;
            border-radius: 4px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            font-size: 14px;
            min-width: 200px;
        `;

        panel.innerHTML = `
            <div style="margin-bottom: 10px;">
                <label>下载页数：</label>
                <input type="number" id="pageCount" value="3" min="1" max="20" style="width: 60px;">
            </div>
            <div style="margin-bottom: 10px;">
                <label>文件夹前缀：</label>
                <input type="text" id="folderPrefix" placeholder="可选" style="width: 120px;">
            </div>
            <div style="margin-bottom: 10px;">
                <button id="downloadBtn" style="
                    padding: 8px 15px;
                    background: #232f3e;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    width: 100%;
                    transition: all 0.3s;
                ">开始下载</button>
            </div>
            <div id="downloadProgress" style="margin-top: 10px;"></div>
        `;

        document.body.appendChild(panel);
        
        // 添加按钮禁用时的样式
        const style = document.createElement('style');
        style.textContent = `
            #downloadBtn:disabled {
                background: #cccccc !important;
                cursor: not-allowed !important;
                opacity: 0.7;
            }
            #pageCount:disabled, #folderPrefix:disabled {
                background: #f5f5f5;
                cursor: not-allowed;
            }
        `;
        document.head.appendChild(style);
        
        document.getElementById('downloadBtn').addEventListener('click', startDownload);
    }

    function getAsin(href, isDecode) {
        let asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/);
        if (!asinMatch && !isDecode) {
            return getAsin(decodeURIComponent(href), true);
        }
        return asinMatch && asinMatch[1];
    }

    // 获取指定页数的所有产品链接
    async function getAllProductLinks(pageCount) {
        const links = new Set();
        const baseUrl = window.location.href.split('&page=')[0].split('ref=')[0];
        
        for(let i = 1; i <= pageCount; i++) {
            const pageUrl = i === 1 ? baseUrl : `${baseUrl}&page=${i}`;
            try {
                const response = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: pageUrl,
                        onload: resolve,
                        onerror: reject
                    });
                });

                const html = response.responseText;
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                
                // 只获取主搜索结果中的产品链接
                const searchResults = doc.querySelector('.s-main-slot');
                if (searchResults) {
                    // 使用更精确的选择器，只获取搜索结果中的主要产品
                    const productCards = searchResults.querySelectorAll('[data-component-type="s-search-result"]');
                    
                    productCards.forEach(card => {
                        // 先找到产品标题的a标签
                        const productLink = card.querySelector('h2').closest('a')
                        if (productLink && productLink.href) {
                            const asin = getAsin(productLink.href);
                            if (asin) {
                                links.add(`https://www.amazon.com/dp/${asin}`);
                            }
                        }
                    });
                }

                // 显示每页的进度
                const progressDiv = document.getElementById('downloadProgress');
                progressDiv.textContent = `正在获取第 ${i}/${pageCount} 页的产品链接...已找到 ${links.size} 个产品`;
                
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error(`获取第${i}页数据失败:`, error);
            }
        }
        
        return Array.from(links);
    }

    // 添加获取搜索关键词的函数
    function getSearchKeyword() {
        const url = new URL(window.location.href);
        const keyword = url.searchParams.get('k') || 'unknown';
        return keyword.replace(/[^a-zA-Z0-9]/g, '_');
    }

    // 修改获取产品图片URL的函数
    async function getProductImages(url) {
        try {
            const response = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    onload: resolve,
                    onerror: reject
                });
            });

            const html = response.responseText;
            const imageUrls = [];
            
            // 查找包含图片数据的脚本
            const dataMatch = html.match(/jQuery\.parseJSON\('(.+?)'\)/);
            if (dataMatch) {
                try {
                    // 解析JSON数据
                    const jsonStr = dataMatch[1].replace(/\\'/g, "'");
                    const data = JSON.parse(jsonStr);
                    
                    // 只获取当前颜色变体的图片
                    if (data.colorImages && data.landingAsinColor) {
                        const currentColorImages = data.colorImages[data.landingAsinColor] || [];
                        currentColorImages.forEach(img => {
                            const imageUrl = img.hiRes || img.large;
                            if (imageUrl) {
                                imageUrls.push({
                                    url: imageUrl,
                                    variant: img.variant || 'main'
                                });
                            }
                        });
                    }
                } catch (e) {
                    console.error('解析图片数据失败:', e);
                }
            }

            return imageUrls;
        } catch (error) {
            console.error('获取产品图片失败:', error);
            return [];
        }
    }

    // 修改下载函数，添加去重逻辑
    async function startDownload() {
        const progressDiv = document.getElementById('downloadProgress');
        const downloadBtn = document.getElementById('downloadBtn');
        const pageCountInput = document.getElementById('pageCount');
        const folderPrefixInput = document.getElementById('folderPrefix');
        
        // 禁用所有输入和按钮
        downloadBtn.disabled = true;
        pageCountInput.disabled = true;
        folderPrefixInput.disabled = true;
        downloadBtn.textContent = '下载中...';

        const pageCount = parseInt(pageCountInput.value) || 3;
        const folderPrefix = folderPrefixInput.value.trim();
        
        progressDiv.style.display = 'block';

        try {
            // 第一步：获取产品链接
            progressDiv.textContent = '正在获取产品链接...';
            const productLinks = await getAllProductLinks(pageCount);
            
            if (productLinks.length === 0) {
                progressDiv.textContent = '未找到产品！';
                return;
            }

            const searchKeyword = getSearchKeyword();
            const timestamp = new Date().toISOString().split('T')[0];
            const baseFolder = folderPrefix 
                ? `${folderPrefix}/${searchKeyword}/`
                : `amazon_${searchKeyword}/`;

            let totalImages = 0;
            let downloadedImages = 0;
            let failedImages = 0;
            const failedDownloads = [];
            const downloadedUrls = new Set(); // 用于记录已下载的URL
            const downloadedFilenames = new Set(); // 用于记录已使用的文件名

            // 收集所有图片信息
            for (let i = 0; i < productLinks.length; i++) {
                const url = productLinks[i];
                const asin = url.match(/\/dp\/([A-Z0-9]{10})/)[1];
                
                progressDiv.textContent = `[1/2] 正在获取第 ${i+1}/${productLinks.length} 个产品的图片信息 (${asin})...`;
                const images = await getProductImages(url);
                
                if (images.length > 0) {
                    // 对当前产品的图片进行去重
                    const uniqueImages = images.filter(image => {
                        const filename = `${baseFolder}${asin}_${image.variant}.jpg`;
                        // 检查URL和文件名是否都未被使用过
                        if (!downloadedUrls.has(image.url) && !downloadedFilenames.has(filename)) {
                            downloadedUrls.add(image.url);
                            downloadedFilenames.add(filename);
                            return true;
                        }
                        return false;
                    });

                    totalImages += uniqueImages.length;
                    
                    // 下载去重后的图片
                    for (const image of uniqueImages) {
                        try {
                            const filename = `${baseFolder}${asin}_${image.variant}.jpg`;
                            
                            await new Promise((resolve, reject) => {
                                GM_download({
                                    url: image.url,
                                    name: filename,
                                    onload: () => {
                                        downloadedImages++;
                                        progressDiv.textContent = `[2/2] 下载进度: ${downloadedImages}/${totalImages} (${Math.round(downloadedImages/totalImages*100)}%) | 成功: ${downloadedImages} | 失败: ${failedImages}`;
                                        resolve();
                                    },
                                    onerror: (error) => {
                                        failedImages++;
                                        failedDownloads.push({
                                            filename: filename,
                                            originalUrl: image.url
                                        });
                                        // 下载空白图片
                                        GM_download({
                                            url: BLANK_IMAGE,
                                            name: filename,
                                            onload: () => {
                                                console.log(`已用空白图片替代: ${filename}`);
                                            }
                                        });
                                        progressDiv.textContent = `[2/2] 下载进度: ${downloadedImages}/${totalImages} (${Math.round(downloadedImages/totalImages*100)}%) | 成功: ${downloadedImages} | 失败: ${failedImages}`;
                                        resolve();
                                    }
                                });
                            });

                        } catch (error) {
                            failedImages++;
                            console.error(`下载图片失败: ${image.url}`, error);
                            continue;
                        }
                    }
                }
            }

            const successRate = Math.round((downloadedImages / totalImages) * 100);
            let resultMessage = `下载完成！成功: ${downloadedImages} | 失败: ${failedImages} | 成功率: ${successRate}%`;
            
            if (failedDownloads.length > 0) {
                console.log('失败的下载列表：');
                failedDownloads.forEach(item => {
                    console.log(`文件名: ${item.filename}`);
                    console.log(`原始URL: ${item.originalUrl}`);
                    console.log('---');
                });
                resultMessage += '\n请在控制台(F12)查看失败图片的详细信息';
            }

            progressDiv.textContent = resultMessage;
        } catch (error) {
            progressDiv.textContent = '发生错误：' + error.message;
            console.error(error);
        } finally {
            // 恢复所有输入和按钮
            downloadBtn.disabled = false;
            pageCountInput.disabled = false;
            folderPrefixInput.disabled = false;
            downloadBtn.textContent = '开始下载';
        }
    }

    // 页面加载完成后添加下载面板
    window.addEventListener('load', addDownloadPanel);
})();
