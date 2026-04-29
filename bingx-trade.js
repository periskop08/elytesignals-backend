const axios = require('axios');
const crypto = require('crypto');

const API_KEY = process.env.BINGX_API_KEY;
const API_SECRET = process.env.BINGX_API_SECRET;
const BASE_URL = 'https://open-api.bingx.com';

function getSignature(queryString, secret) {
    return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

function resolveBingxSymbol(rawSymbol) {
    if (!rawSymbol) return rawSymbol;
    
    // Dinamik Tercüman Kontrolü (scanner.js üzerinden gelen RAM Haritası)
    if (global.BINGX_SYMBOL_MAP && global.BINGX_SYMBOL_MAP[rawSymbol]) {
        return global.BINGX_SYMBOL_MAP[rawSymbol];
    }

    const ASSET_MAP = {
        'XAUUSD': 'NCCOGOLD2USD-USDT',
        'XAGUSD': 'NCCOXAG2USD-USDT',
        'EURUSD': 'NCFXEUR2USD-USDT',
        'AAPL': 'NCSKAAPL2USD-USDT',
        'TSLA': 'NCSKTSLA2USD-USDT',
        'NASDAQ': 'NCSINASDAQ1002USD-USDT',
        'SP500': 'NCSISP5002USD-USDT',
        'DOW': 'NCSIDJI2USD-USDT'
    };
    if (ASSET_MAP[rawSymbol]) return ASSET_MAP[rawSymbol];
    return rawSymbol.replace('USDT', '-USDT');
}

async function makePrivateRequest(method, endpoint, params = {}) {
    if (!API_KEY || !API_SECRET) {
        console.warn("[BINGX] API Keys not found in .env.");
        return null;
    }

    params.timestamp = Date.now();
    const sortedKeys = Object.keys(params).sort();
    let queryString = '';
    
    // BingX signature requires exact raw string without encodeURIComponent
    for (const key of sortedKeys) {
        if (params[key] !== undefined && params[key] !== null) {
            queryString += `${key}=${params[key]}&`;
        }
    }
    queryString = queryString.substring(0, queryString.length - 1); // remove last '&'
    
    const signature = getSignature(queryString, API_SECRET);
    
    // Now we must URL Encode for the actual Http request ONLY the JSON payloads if needed.
    // Actually, sending it directly attached to URL is safer for BingX Open API compatibility.
    let requestQueryString = '';
    for (const key of sortedKeys) {
        if (params[key] !== undefined && params[key] !== null) {
            requestQueryString += `${key}=${encodeURIComponent(params[key])}&`;
        }
    }
    requestQueryString = requestQueryString.substring(0, requestQueryString.length - 1);
    
    const url = `${BASE_URL}${endpoint}?${requestQueryString}&signature=${signature}`;
    
    try {
        const config = {
            method: method,
            url: url,
            headers: {
                'X-BX-APIKEY': API_KEY
            }
        };
        // BingX params in URI -> Drop content-type header to prevent body parser confusion
        const res = await axios(config);
        return res.data;
    } catch (e) {
        console.error("BingX API Error:", e.response?.data || e.message);
        throw e;
    }
}

// 1. Get Instrument Info for Precision/Tick mapping
async function getInstrumentInfo(symbol) {
    try {
        // symbol requires format like BTC-USDT
        const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v2/quote/contracts`);
        if (res.data?.data?.length > 0) {
            return res.data.data.find(c => c.symbol === symbol);
        }
    } catch(e) {
        console.error("Failed to fetch BingX instrument info", e.message);
    }
    return null;
}

// 1.5 Set Leverage (For Dynamic Fallbacks)
async function setLeverage(symbol, positionSide, leverage) {
    console.log(`[BINGX] Kaldıraç Güncelleniyor: ${symbol} -> ${leverage}x (${positionSide})`);
    const params = {
        symbol: symbol,
        leverage: leverage,
        side: positionSide
    };
    return await makePrivateRequest('POST', '/openApi/swap/v2/trade/leverage', params);
}

// 2. Place Order mapping
async function placeOrder(rawSymbol, direction, entryPrice, targetPrice, stopPrice, riskMultiplier) {
    // rawSymbol: 'BTCUSDT' -> Format to BingX 'BTC-USDT' or 'NCCOXAG2USD-USDT' for assets
    const symbol = resolveBingxSymbol(rawSymbol);
    
    const info = await getInstrumentInfo(symbol);
    if (!info) throw new Error("Instrument info not found for " + symbol);

    // --- DİNAMİK RİSK BAZLI BOYUTLANDIRMA (RISK-BASED SIZING) ---
    // Formül: Miktar (Quantity) = Riske Edilen Para ($) / (Giriş Fiyatı - Stop Fiyatı)
    const baseRisk = parseFloat(process.env.BINGX_RISK_USD || 10);
    const RISK_USD = riskMultiplier !== undefined ? (baseRisk * riskMultiplier) : baseRisk;
    const coinBasinaZarar = Math.abs(entryPrice - stopPrice);
    
    // Risk başına alınması gereken coin miktarını direkt buluruz. 
    // Kaldıraç bu matematiği değiştirmez, sadece borsanın senden kestiği teminatı düşürür.
    let rawQty = RISK_USD / coinBasinaZarar;
    
    // BingX Min Qty Kontrolü
    const tradeMinQty = parseFloat(info.tradeMinQuantity);
    if (rawQty < tradeMinQty) rawQty = tradeMinQty;
    
    // Fallback qty formatting roughly 4 decimals (Adjust based on precision in real life)
    let qtyStr = parseFloat(rawQty).toFixed(info.quantityPrecision || 4);

    const side = direction === 'LONG' ? 'BUY' : 'SELL';
    
    // Fiyat yuvarlama
    const pricePrecision = info.pricePrecision || 2;
    const fmtTp = parseFloat(targetPrice).toFixed(pricePrecision);
    const fmtSl = parseFloat(stopPrice).toFixed(pricePrecision);

    const params = {
        symbol: symbol,
        side: side,
        positionSide: direction === 'LONG' ? 'LONG' : 'SHORT',
        type: 'MARKET', // Market giris
        quantity: qtyStr,
        takeProfit: JSON.stringify({
            type: "TAKE_PROFIT_MARKET",
            stopPrice: parseFloat(fmtTp),
            workingType: "MARK_PRICE"
        }),
        stopLoss: JSON.stringify({
            type: "STOP_MARKET",
            stopPrice: parseFloat(fmtSl),
            workingType: "MARK_PRICE"
        })
    };

    console.log(`[BINGX] Gönderilen Emir:`, JSON.stringify(params));
    let response = await makePrivateRequest('POST', '/openApi/swap/v2/trade/order', params);
    
    // YENİ EK: Kaldıraç Sınırına Takılırsak Dinamik Olarak Kaldıracı İndirip Tekrar Dene
    if (response && response.code !== 0 && response.msg && response.msg.includes("maximum leverage")) {
        const match = response.msg.match(/is\s+(\d+)/);
        if (match && match[1]) {
            const allowedLeverage = parseInt(match[1], 10);
            console.log(`[BINGX OTOPİLOT] Uyarı: Parite çok yeni veya volatil! Borsa bu coine onaylamıyor. Kaldıraç otomatik olarak güvenli ${allowedLeverage}x seviyesine çekilip emir zorlanıyor...`);
            await setLeverage(symbol, direction === 'LONG' ? 'LONG' : 'SHORT', allowedLeverage);
            // İkinci Deneme
            response = await makePrivateRequest('POST', '/openApi/swap/v2/trade/order', params);
        }
    }

    if (response && response.code === 0) {
        console.log(`[BINGX] Emir Başarılı! ID: ${response.data.order.orderId}`);
        return response.data.order.orderId;
    } else {
        throw new Error(response ? `BingX Error: ${response.msg}` : "No response from BingX");
    }
}

// 3. Get Active Position
async function getPosition(rawSymbol) {
    const symbol = resolveBingxSymbol(rawSymbol);
    const response = await makePrivateRequest('GET', '/openApi/swap/v2/user/positions', {
        symbol: symbol
    });

    if (response && response.code === 0 && response.data && response.data.length > 0) {
        // Position amt check
        const pos = response.data.find(p => parseFloat(p.positionAmt) > 0);
        return pos || null;
    }
    return null;
}

// 4. Force Close (Market)
async function closePosition(rawSymbol, direction) {
    const symbol = resolveBingxSymbol(rawSymbol);
    const pos = await getPosition(rawSymbol);
    if (!pos) throw new Error("Açık pozisyon bulunamadı veya kapandı.");

    const side = pos.positionSide === 'LONG' ? 'SELL' : 'BUY';
    const params = {
        symbol: symbol,
        side: side,
        positionSide: pos.positionSide,
        type: 'MARKET',
        quantity: pos.positionAmt
    };

    const response = await makePrivateRequest('POST', '/openApi/swap/v2/trade/order', params);
    if(response && response.code === 0) {
        console.log(`[BINGX] İşlem başarıyla Kapatıldı! Symbol: ${symbol}`);
        return true;
    } else {
        throw new Error(response ? `BingX Close Error: ${response.msg}` : "Close Error");
    }
}

// 5. Update Stop Loss (Breakeven / Trailing)
async function updateStopLoss(rawSymbol, newStopLoss, currentTargetPrice) {
    const symbol = resolveBingxSymbol(rawSymbol);
    const pos = await getPosition(rawSymbol);
    if (!pos || parseFloat(pos.positionAmt) === 0) throw new Error("Açık pozisyon yok, StopLoss güncellenemez.");
    
    // 1. İptal Et (Eski Trigger ve Limit emirleri tek tek silinmeli, allOpenOrders native'leri silmiyor)
    try {
        const response = await makePrivateRequest('GET', '/openApi/swap/v2/trade/openOrders', { symbol: symbol });
        const orders = response.data.orders || [];
        for (const order of orders) {
            try {
                await makePrivateRequest('DELETE', '/openApi/swap/v2/trade/order', {
                    symbol: symbol,
                    orderId: order.orderId
                });
            } catch(e) {}
        }
    } catch (e) {
        console.log(`[BINGX] Cancel old orders failed for ${symbol}:`, e.message);
    }
    
    // 2. Yeni TP/SL Gönder
    const side = pos.positionSide === 'LONG' ? 'SELL' : 'BUY';
    const info = await getInstrumentInfo(symbol);
    const pricePrecision = info ? (info.pricePrecision || 2) : 2;
    const fmtSl = parseFloat(newStopLoss).toFixed(pricePrecision);
    
    try {
        const paramsSL = {
            symbol: symbol,
            side: side,
            positionSide: pos.positionSide,
            type: 'STOP_MARKET',
            stopPrice: fmtSl,
            quantity: Math.abs(parseFloat(pos.positionAmt)),
            workingType: 'MARK_PRICE'
        };
        await makePrivateRequest('POST', '/openApi/swap/v2/trade/order', paramsSL);
    } catch(e) {
        console.error(`[BINGX] Yeni SL Gönderilemedi: ${e.message}`);
    }

    if (currentTargetPrice) {
        try {
            const fmtTp = parseFloat(currentTargetPrice).toFixed(pricePrecision);
            const paramsTP = {
                symbol: symbol,
                side: side,
                positionSide: pos.positionSide,
                type: 'TAKE_PROFIT_MARKET',
                stopPrice: fmtTp,
                quantity: Math.abs(parseFloat(pos.positionAmt)),
                workingType: 'MARK_PRICE'
            };
            await makePrivateRequest('POST', '/openApi/swap/v2/trade/order', paramsTP);
        } catch(e) {
            console.error(`[BINGX] Yeni TP Gönderilemedi: ${e.message}`);
        }
    }
    
    console.log(`[BINGX] Update StopLoss to ${fmtSl} for ${symbol} successfully registered.`);
    return true; 
}

// 6. Get Net Income (Realized PnL + Funding + Fees)
async function getNetIncome(rawSymbol, startTimeStr) {
    // rawSymbol: 'BTCUSDT'
    const symbol = resolveBingxSymbol(rawSymbol);
    // Convert SQL Datetime to UNIX timestamp (MS)
    let startTimeMs = new Date(startTimeStr + 'Z').getTime(); // Assuming UTC
    if (isNaN(startTimeMs)) {
        startTimeMs = new Date(startTimeStr).getTime();
    }
    // Pad 5 seconds before just in case
    startTimeMs -= 5000;
    
    // Attempt to gather latest incomes
    const response = await makePrivateRequest('GET', '/openApi/swap/v2/user/income', {
        symbol: symbol,
        limit: 100 // Typically enough for a single position's multi-fills
    });

    if (response && response.code === 0 && response.data) {
        let netUsd = 0;
        // Sadece bu tarihten sonraki income kayıtlarını hesapla
        for (const item of response.data) {
            if (item.time >= startTimeMs) {
                // incomeType can be REALIZED_PNL, TRADING_FEE, FUNDING_FEE
                netUsd += parseFloat(item.income);
            }
        }
        return netUsd;
    }
    
    return null;
}

// 7. Get Account Balance (USDT)
async function getAccountBalance() {
    const response = await makePrivateRequest('GET', '/openApi/swap/v2/user/balance', {});
    if (response && response.code === 0 && response.data && response.data.balance) {
        return parseFloat(response.data.balance.balance); // Ensure float
    }
    return null;
}

module.exports = {
    placeOrder,
    getPosition,
    closePosition,
    updateStopLoss,
    getNetIncome,
    getAccountBalance,
    makePrivateRequest
};
