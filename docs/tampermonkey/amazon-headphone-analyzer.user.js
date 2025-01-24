// ==UserScript==
// @name         亚马逊耳机数据分析工具
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  分析亚马逊耳机产品数据，包括价格趋势、属性分布等
// @author       Your name
// @match        https://www.amazon.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      api.keepa.com
// @require      https://cdn.jsdelivr.net/npm/chart.js
// ==/UserScript==

(function() {
    'use strict';

    // 配置
    const KEEPA_API_KEY = '你的Keepa API密钥';
    const MAX_PRODUCTS = 1000; // 最大采集产品数
    
    // 数据结构
    const productSchema = {
        asin: '',
        title: '',
        brand: '',           // 品牌
        currentData: {
            price: 0,
            listPrice: 0,    // 原价
            rating: 0,
            reviewCount: 0,
            rank: 0,
            stockStatus: '', // 库存状态
            sellerType: '',  // FBA、FBM、AMZ
            badgeInfo: [],   // Amazon's Choice、Best Seller等徽章信息
        },
        attributes: {
            // 基本规格
            type: '',              // 耳机类型：入耳式、头戴式、骨传导等
            connectionType: '',    // 连接方式：有线、无线、TWS等
            colors: [],           // 可选颜色
            weight: '',           // 重量
            dimensions: {         // 尺寸
                length: 0,
                width: 0,
                height: 0,
            },
            
            // 技术规格
            batteryLife: {        // 续航时间
                musicPlayback: 0,  // 音乐播放时间
                withCase: 0,       // 含充电盒总时间
                chargingTime: 0,   // 充电时间
            },
            bluetooth: {          // 蓝牙相关
                version: '',       // 蓝牙版本
                range: '',         // 传输距离
                multipoint: false, // 多点连接
            },
            
            // 功能特性
            noiseControl: {       // 降噪功能
                anc: false,        // 主动降噪
                transparency: false,// 通透模式
                ancLevels: 0,      // 降噪级别数
            },
            waterproof: {         // 防水性能
                rating: '',        // IPX级别
                sweatproof: false, // 防汗
            },
            
            // 音频相关
            audioFeatures: {
                frequency: '',     // 频率响应范围
                impedance: '',     // 阻抗
                sensitivity: '',   // 灵敏度
                drivers: {         // 驱动单元
                    size: '',      // 尺寸
                    type: '',      // 类型
                    count: 0,      // 数量
                },
                codec: [],         // 支持的音频编码格式
            },
            
            // 控制方式
            controls: {
                touch: false,      // 触控
                button: false,     // 按键
                voiceControl: false,// 语音控制
                appControl: false, // APP控制
            },
            
            // 其他功能
            micIncluded: false,   // 是否带麦克风
            foldable: false,      // 是否可折叠
            quickCharge: false,   // 快充功能
            multiDevice: false,   // 多设备切换
            
            // 包装内容
            inBox: [],           // 包装清单
            
            // 兼容性
            compatibility: [],    // 兼容设备类型
            
            // 保修信息
            warranty: '',         // 保修期限
        },
        historical: {
            monthly: [] // [{date: '2024-01', price: 0, rank: 0, rating: 0}]
        },
        salesData: {
            launchDate: '',      // 上市日期
            variations: {         // 变体信息
                count: 0,         // 变体数量
                types: [],        // 变体类型（颜色/尺寸等）
            },
            priceHistory: {      // 价格历史
                highest: 0,
                lowest: 0,
                average: 0,
                priceChanges: [], // 价格变化记录
            },
            rankHistory: [],     // 排名历史
            
            // 促销信息
            promotion: {
                type: '',         // 促销类型
                discount: 0,      // 折扣力度
                coupon: 0,        // 优惠券金额
                startDate: '',    // 开始时间
                endDate: '',      // 结束时间
            }
        },
        reviews: {
            summary: {
                averageRating: 0,
                totalCount: 0,
                verifiedCount: 0,
                distribution: {}, // 评分分布
            },
            keywordAnalysis: {   // 评论关键词分析
                positive: [],     // 正面关键词
                negative: [],     // 负面关键词
            },
            featureRatings: {    // 特性评分
                soundQuality: 0,
                comfort: 0,
                batteryLife: 0,
                noiseReduction: 0,
                value: 0,
            }
        }
    };

    // 添加控制面板
    function addControlPanel() {
        const panel = document.createElement('div');
        panel.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            background: white;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            width: 300px;
        `;

        panel.innerHTML = `
            <h3 style="margin: 0 0 10px 0;">耳机数据分析工具</h3>
            <div style="margin-bottom: 10px;">
                <button id="startAnalysis" style="
                    padding: 8px 15px;
                    background: #232f3e;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    width: 100%;
                ">开始数据采集</button>
            </div>
            <div id="analysisProgress" style="
                margin-top: 10px;
                font-size: 14px;
                color: #666;
            "></div>
        `;

        document.body.appendChild(panel);
        
        document.getElementById('startAnalysis').addEventListener('click', startDataCollection);
    }

    // 开始数据采集
    async function startDataCollection() {
        const progressDiv = document.getElementById('analysisProgress');
        const startButton = document.getElementById('startAnalysis');
        startButton.disabled = true;
        
        try {
            progressDiv.textContent = '正在获取产品列表...';
            
            // 获取耳机类目下排名前1000的产品
            const products = await getTopProducts();
            
            progressDiv.textContent = `找到 ${products.length} 个产品，开始详细数据采集...`;
            
            const allProductData = [];
            for (let i = 0; i < products.length; i++) {
                const product = products[i];
                progressDiv.textContent = `正在采集第 ${i + 1}/${products.length} 个产品...`;
                
                try {
                    const productData = await collectProductData(product.asin);
                    const keepaData = await getKeepaData(product.asin);
                    
                    // 合并数据
                    const completeData = {
                        ...productData,
                        historical: keepaData
                    };
                    
                    allProductData.push(completeData);
                    
                    // 每采集10个产品保存一次
                    if (allProductData.length % 10 === 0) {
                        await saveData(allProductData);
                    }
                    
                    // 防止请求过快
                    await sleep(1000);
                    
                } catch (error) {
                    console.error(`采集产品 ${product.asin} 失败:`, error);
                }
            }
            
            // 最终保存
            await saveData(allProductData);
            
            // 生成分析报告
            await generateReport(allProductData);
            
            progressDiv.textContent = '数据采集完成！正在生成分析报告...';
            
        } catch (error) {
            progressDiv.textContent = '采集过程中出错: ' + error.message;
            console.error('数据采集错误:', error);
        } finally {
            startButton.disabled = false;
        }
    }

    // 获取产品详细数据
    async function collectProductData(asin) {
        const productData = {...productSchema};
        productData.asin = asin;
        
        const response = await fetchProductPage(asin);
        const parser = new DOMParser();
        const doc = parser.parseFromString(response, 'text/html');
        
        // 提取基本信息
        productData.title = extractTitle(doc);
        productData.currentData.price = extractPrice(doc);
        productData.currentData.rating = extractRating(doc);
        productData.currentData.reviewCount = extractReviewCount(doc);
        
        // 提取属性
        productData.attributes = extractAttributes(doc);
        
        return productData;
    }

    // 工具函数
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 页面加载完成后添加控制面板
    window.addEventListener('load', addControlPanel);
})(); 