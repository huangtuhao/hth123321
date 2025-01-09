// 定义费用标准
const PEAK_STORAGE_COST = 3.63; // 10 - 12月
const OFF_PEAK_STORAGE_COST = 0.99; // 1 - 9月
const DAYS_IN_MONTH = 30;

/**
 * 解析产品库龄和库存量的信息
 */
function parseInventoryInfo(product) {
    let totalInventory = 0;
    const inventory = product.ltcQty.map((info) => {
        let ltcTime = info.key === '365+' ? [366, 100000] : info.key.split('-');
        totalInventory += info.val;
        return {
            start: parseInt(ltcTime[0]),
            end: parseInt(ltcTime[1]),
            val: info.val,
            cost: info.cost / DAYS_IN_MONTH,
            past: 0
        };
    });
    // 从大到小排序
    inventory.sort((a, b) => b.start - a.start);
    const lastInventoryInfo = inventory[inventory.length - 1];
    inventory.push({
        start: 0,
        end: lastInventoryInfo.start - 1,
        val: product.totalQty - totalInventory,
        cost: 0,
        past: 0
    })
    return inventory;
}

/**
 * 解析产品每个月的出货信息
 */
function parseShipmentData(product) {
    const shipmentInfoMap = new Map();
    const shipments = product.clearanceData.map((v) => {
        const year = parseInt(v.key.slice(0, 4));
        const month = parseInt(v.key.slice(4));
        const shipment = {
            year,
            month,
            date: parseInt(v.key),
            days: DAYS_IN_MONTH,
            val: v.val
        };
        shipmentInfoMap.set(shipment.date, shipment);
        return shipment;
    });
    shipments.sort((a, b) => a.date - b.date);

    const firstShipment = shipments[0];
    const lastShipment = shipments[shipments.length - 1];
    const totalMonths = lastShipment.year*12 + lastShipment.month - (firstShipment.year*12 + firstShipment.month) + 1;
    const completeShipmentData = [];
    for (let i = 0; i < totalMonths; i++) {
        const addYear = parseInt(i/12);
        const addMonth = parseInt(i%12);
        const year = firstShipment.year + addYear;
        const month = firstShipment.month + addMonth;
        const date = (year)*100 + month;
        const info = shipmentInfoMap.get(date);
        if (info) {
            completeShipmentData.push(info);
        } else {
            completeShipmentData.push({
                year,
                month,
                date,
                days: DAYS_IN_MONTH,
                val: 0,
                isEmpty: true
            })
        }
    }

    return completeShipmentData;
}

/**
 * 计算月度仓储费用
 */
function calculateMonthlyStorageCost(size, inventory, month, pastDays = 1) {
    const costPerUnit = (month >= 10 || month <= 12 ? PEAK_STORAGE_COST : OFF_PEAK_STORAGE_COST) / DAYS_IN_MONTH;
    return size * costPerUnit * inventory * pastDays;
}

/**
 * 计算长期仓储费用
 */
function calculateLongTermStorageCost(inventoryInfo, size, pastDays = 1, fn) {
    let totalCost = 0;
    inventoryInfo.forEach((inventory) => {
        const oneLongCost = inventory.cost * pastDays * size;
        totalCost += inventory.val * oneLongCost;
        fn && fn(oneLongCost, inventory);
    });
    return totalCost;
}

/**
 * 更新库存量信息
 */
function updateInventoryInfoOnShipment(inventoryInfo, shipment) {
    let remainingShipment = shipment;
    for (let i = 0; i < inventoryInfo.length && remainingShipment > 0; i++) {
        const inventory = inventoryInfo[i];
        if (inventory.val >= remainingShipment) {
            inventory.val -= remainingShipment;
            remainingShipment = 0;
        } else if (inventory.val > 0) {
            remainingShipment -= inventory.val;
            inventory.val = 0;
        }
    }
}


/**
 * 更新库存量的库龄信息
 */
function updateInventoryInfoOnTimePassed(inventoryInfo, pastDays = 1) {
    inventoryInfo.forEach((inventory) => {
        inventory.start += pastDays;
        inventory.end += pastDays;
        inventory.past += pastDays;
    });
}

/**
 * 计算产品的总成本
 */
function calculateTotalCost(product) {
    let totalCost = 0;
    const size = product.size;
    let inventoryInfo = parseInventoryInfo(product);
    const shipmentData = parseShipmentData(product);
    
    shipmentData.forEach((shipment) => {
        // 在出货前更新库龄信息
        updateInventoryInfoOnTimePassed(inventoryInfo, shipment.days);

        // 计算每个月的仓储费用和长期仓储费用
        const monthlyStorageCost = calculateMonthlyStorageCost(size, product.totalQty, shipment.month, shipment.days);
        const longTermStorageCost = calculateLongTermStorageCost(inventoryInfo, size, shipment.days);

        // 在出货后更新库存信息
        updateInventoryInfoOnShipment(inventoryInfo, shipment.val);

        // 累计总成本
        totalCost += monthlyStorageCost + longTermStorageCost;
    });

    return totalCost;
}

/**
 * 计算产品的总成本
 */
function calculateTotalCost2(product) {
    const size = product.size;
    let inventoryInfo = parseInventoryInfo(product);
    const shipmentData = parseShipmentData(product);
    
    let passInventory = 0;
    const inventoryCostList = [];
    inventoryInfo.forEach(inventory => {
        for (let i = 0; i < inventory.val; i++) {
            inventoryCostList.push([]);
        }
    });

    shipmentData.forEach((shipment) => {
        const interval = shipment.days / shipment.val;
        for (let i = 0; i < shipment.val; i++) {
            // 在出货前更新库龄信息
            updateInventoryInfoOnTimePassed(inventoryInfo, interval);

            // 计算每个月的仓储费用和长期仓储费用
            const oneMonthlyStorageCost = calculateMonthlyStorageCost(size, 1, shipment.month, interval);

            const longTermStorageCost = calculateLongTermStorageCost(inventoryInfo, size, interval, (oneLongCost, inventory) => {
                for (let j = 0; j < inventory.val; j++) {
                    inventoryCostList[passInventory + j].push(oneLongCost + oneMonthlyStorageCost);
                }
            });

            // 在出货后更新库存信息
            updateInventoryInfoOnShipment(inventoryInfo, 1);
            passInventory++;
        }
    });

    return inventoryCostList;
}

// 使用示例
const productInfo2 = {
    name: '产品A',
    size: 0.19, // 平均单个产品尺寸
    clearanceData: [
        { key: '202309', val: 100 },
        { key: '202310', val: 100 }
    ],
    isPaseForDay: false, // 是否按日结算，如果是false就按月结算
    totalQty: 1319, // 总库存量
    ltcQty: [ // 不同库龄的库存量
        { key: '181-210', val: 2, cost: 0.5 },
        { key: '211-240', val: 4, cost: 1 },
        { key: '241-270', val: 5, cost: 1.5 },
        { key: '271-300', val: 39, cost: 3.8 },
        { key: '301-330', val: 268, cost: 4 },
        { key: '331-365', val: 459, cost: 4.2 },
        { key: '365+', val: 542, cost: 6.9 }
    ]
}

console.log(calculateTotalCost2(productInfo2));