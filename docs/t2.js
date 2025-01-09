// 定义费用标准
const PEAK_STORAGE_COST = 3.63; // 10 - 12月
const OFF_PEAK_STORAGE_COST = 0.99; // 1 - 9月
const DAYS_IN_MONTH = 30;
const CUBIC_INCH_TO_FEET = 1 / 1728; // 1 ft³ = 1728 in³

/**
 * 初始化库存数组
 * @returns {number[]} 每个元素代表一个库存的库龄（天数）
 */
function initializeInventoryArray(product) {
    const inventoryArray = [];
    // 从库龄最小的开始添加
    product.ltcQty.sort((a, b) => {
        const aStart = parseInt(a.key.split('-')[0]);
        const bStart = parseInt(b.key.split('-')[0]);
        return aStart - bStart;  // 保持升序排序
    });

    // 填充库存数组，使用区间中位数作为初始库龄
    product.ltcQty.forEach(info => {
        const range = info.key.split('-');
        let medianAge;
        if (range[1] === '+') {
            // 对于365+的情况，使用380作为中位数（可以根据实际情况调整）
            medianAge = 380;
        } else {
            // 使用区间的中位数
            const start = parseInt(range[0]);
            const end = parseInt(range[1]);
            medianAge = Math.floor((start + end) / 2);
        }
        
        for (let i = 0; i < info.val; i++) {
            inventoryArray.push(medianAge);
        }
    });

    return inventoryArray;
}

/**
 * 计算单天的仓储费用
 */
function calculateDailyCost(size, date, age) {
    // 移除重复的单位转换，因为输入的size已经是立方英尺
    let cost = 0;

    // 计算月度仓储费
    const month = parseInt(date.slice(4, 6));
    const monthlyRate = (month >= 10 && month <= 12 ? PEAK_STORAGE_COST : OFF_PEAK_STORAGE_COST) / DAYS_IN_MONTH;
    cost += size * monthlyRate;

    // 计算长期仓储费
    if (age > 180) {
        let longTermRate = 0;
        if (age <= 210) longTermRate = 0.5;
        else if (age <= 240) longTermRate = 1.0;
        else if (age <= 270) longTermRate = 1.5;
        else if (age <= 300) longTermRate = 3.8;
        else if (age <= 330) longTermRate = 4.0;
        else if (age <= 365) longTermRate = 4.2;
        else longTermRate = 6.9;

        cost += size * (longTermRate / DAYS_IN_MONTH);
    }

    return cost;
}

/**
 * 计算总仓储费用（按天计算版本）
 */
function calculateTotalCost2_v2(product) {
    let inventoryArray = initializeInventoryArray(product);
    const initialInventory = inventoryArray.length;
    const costRecords = Array(initialInventory).fill().map(() => []);
    const initialAges = [...inventoryArray];
    
    // 验证总出货量是否超过初始库存
    const totalShipments = product.clearanceData.reduce((sum, shipment) => sum + shipment.val, 0);
    if (totalShipments > initialInventory) {
        alert(`警告：出货计划总量(${totalShipments}件)超过初始库存(${initialInventory}件)，将按实际库存计算`);
    }
    
    const shipments = product.clearanceData.sort((a, b) => parseInt(a.key) - parseInt(b.key));
    const startDate = shipments[0].key;
    const endDate = shipments[shipments.length - 1].key;
    const dates = generateDateRange(startDate, endDate);
    
    const monthlyStats = {};
    
    // 记录每个商品的出货日期
    const shippedDates = Array(initialInventory).fill(null);
    
    // 按天计算
    dates.forEach(date => {
        const month = date.slice(0, 6);
        if (!monthlyStats[month]) {
            monthlyStats[month] = {
                monthlyStorageCost: 0,
                longTermStorageCost: 0,
                inventoryByAge: {
                    '0-90': 0,
                    '91-180': 0,
                    '181-270': 0,
                    '271-365': 0,
                    '365+': 0
                }
            };
        }

        const shipment = shipments.find(s => s.key === date.slice(0, 6));
        let dailyShipment = shipment ? Math.ceil(shipment.val / DAYS_IN_MONTH) : 0;

        // 检查当天的出货量是否超过剩余库存
        if (dailyShipment > inventoryArray.length) {
            dailyShipment = inventoryArray.length;
        }

        // 处理出货
        if (dailyShipment > 0 && inventoryArray.length > 0) {
            // 记录出货日期
            for (let i = 0; i < dailyShipment; i++) {
                const index = initialInventory - inventoryArray.length + i;
                shippedDates[index] = date;
            }
            // 更新剩余库存
            inventoryArray = inventoryArray.slice(0, -dailyShipment);
        }

        // 计算所有商品的费用（包括已出货的）
        for (let i = 0; i < initialInventory; i++) {
            // 如果商品已经出货，且出货日期在当前日期之前，则跳过
            if (shippedDates[i] && shippedDates[i] < date) continue;
            
            // 使用初始库龄加上已经过去的天数
            const age = initialAges[i] + costRecords[i].length;
            const { monthlyCost, longTermCost } = calculateDailyCostDetailed(product.size, date, age);
            costRecords[i].push(monthlyCost + longTermCost);
            
            monthlyStats[month].monthlyStorageCost += monthlyCost;
            monthlyStats[month].longTermStorageCost += longTermCost;
        }

        // 在月末统计库存分布
        const nextDay = new Date(
            parseInt(date.slice(0, 4)),
            parseInt(date.slice(4, 6)) - 1,
            parseInt(date.slice(6, 8)) + 1
        );
        
        if (nextDay.getDate() === 1 || date === dates[dates.length - 1]) {
            // 清空之前的统计
            Object.keys(monthlyStats[month].inventoryByAge).forEach(key => {
                monthlyStats[month].inventoryByAge[key] = 0;
            });
            
            // 统计当前库存的分布情况
            for (let i = 0; i < initialInventory; i++) {
                // 只统计未出货的商品
                if (shippedDates[i] && shippedDates[i] <= date) continue;
                
                const age = initialAges[i] + costRecords[i].length;
                if (age <= 90) monthlyStats[month].inventoryByAge['0-90']++;
                else if (age <= 180) monthlyStats[month].inventoryByAge['91-180']++;
                else if (age <= 270) monthlyStats[month].inventoryByAge['181-270']++;
                else if (age <= 365) monthlyStats[month].inventoryByAge['271-365']++;
                else monthlyStats[month].inventoryByAge['365+']++;
            }
        }

        // 增加库龄
        inventoryArray = inventoryArray.map(age => age + 1);
    });

    // 添加库存统计信息
    const stats = {
        initialInventory,
        totalShipments,
        remainingInventory: inventoryArray.length,
        insufficientInventory: totalShipments > initialInventory
    };

    return {
        costRecords,
        monthlyStats,
        stats
    };
}

/**
 * 计算单天的仓储费用（分开月度和长期仓储费）
 */
function calculateDailyCostDetailed(size, date, age) {
    let monthlyCost = 0;
    let longTermCost = 0;

    // 计算月度仓储费
    const month = parseInt(date.slice(4, 6));
    const monthlyRate = (month >= 10 && month <= 12 ? PEAK_STORAGE_COST : OFF_PEAK_STORAGE_COST) / DAYS_IN_MONTH;
    monthlyCost = size * monthlyRate;

    // 计算长期仓储费
    if (age > 180) {
        let longTermRate = 0;
        if (age <= 210) longTermRate = 0.5;
        else if (age <= 240) longTermRate = 1.0;
        else if (age <= 270) longTermRate = 1.5;
        else if (age <= 300) longTermRate = 3.8;
        else if (age <= 330) longTermRate = 4.0;
        else if (age <= 365) longTermRate = 4.2;
        else longTermRate = 6.9;

        longTermCost = size * (longTermRate / DAYS_IN_MONTH);
    }

    return { monthlyCost, longTermCost };
}

/**
 * 生成日期序列
 */
function generateDateRange(startDate, endDate) {
    const dates = [];
    let currentDate = new Date(
        parseInt(startDate.slice(0, 4)),
        parseInt(startDate.slice(4, 6)) - 1,
        1
    );
    const end = new Date(
        parseInt(endDate.slice(0, 4)),
        parseInt(endDate.slice(4, 6)),
        0
    );

    while (currentDate <= end) {
        dates.push(
            currentDate.getFullYear().toString() +
            (currentDate.getMonth() + 1).toString().padStart(2, '0') +
            currentDate.getDate().toString().padStart(2, '0')
        );
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return dates;
} 