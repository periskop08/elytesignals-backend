const axios = require('axios');
const crypto = require('crypto');

const API_KEY = process.env.BYBIT_API_KEY;
const API_SECRET = process.env.BYBIT_API_SECRET;
const BASE_URL = process.env.BYBIT_TESTNET === 'true' ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';

function getSignature(parameters, secret) {
    return crypto.createHmac('sha256', secret).update(parameters).digest('hex');
}

async function makePrivateRequest(method, endpoint, params) {
    if (!API_KEY || !API_SECRET) {
        console.warn("Bybit API Keys not found in .env.");
        return null;
    }

    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    let payloadStr = '';

    if (method === 'GET') {
        const queryParams = new URLSearchParams(params).toString();
        payloadStr = timestamp + API_KEY + recvWindow + queryParams;
        const signature = getSignature(payloadStr, API_SECRET);
        
        try {
            const res = await axios.get(`${BASE_URL}${endpoint}?${queryParams}`, {
                headers: {
                    'X-BAPI-API-KEY': API_KEY,
                    'X-BAPI-TIMESTAMP': timestamp,
                    'X-BAPI-RECV-WINDOW': recvWindow,
                    'X-BAPI-SIGN': signature
                }
            });
            return res.data;
        } catch (e) {
            console.error("Bybit GET Error:", e.response?.data || e.message);
            throw e;
        }

    } else if (method === 'POST') {
        const bodyStr = JSON.stringify(params);
        payloadStr = timestamp + API_KEY + recvWindow + bodyStr;
        const signature = getSignature(payloadStr, API_SECRET);
        
        try {
            const res = await axios.post(`${BASE_URL}${endpoint}`, params, {
                headers: {
                    'X-BAPI-API-KEY': API_KEY,
                    'X-BAPI-TIMESTAMP': timestamp,
                    'X-BAPI-RECV-WINDOW': recvWindow,
                    'X-BAPI-SIGN': signature,
                    'Content-Type': 'application/json'
                }
            });
            return res.data;
        } catch (e) {
            console.error("Bybit POST Error:", e.response?.data || e.message);
            throw e;
        }
    }
}

// 1. lotSize bilgisini çek (Küsürat yuvarlaması yapmak için şart)
async function getInstrumentInfo(symbol) {
    try {
        const res = await axios.get(`https://api.bybit.com/v5/market/instruments-info?category=linear&symbol=${symbol}`);
        if(res.data?.result?.list?.length > 0) {
            return res.data.result.list[0];
        }
    } catch(e) {
        console.error("Failed to fetch instrument info", e.message);
    }
    return null;
}

// 2. Market Emri yolla (TP/SL dahil)
async function placeOrder(symbol, direction, entryPrice, targetPrice, stopPrice) {
    const info = await getInstrumentInfo(symbol);
    if(!info) throw new Error("Instrument info not found for " + symbol);

    // FIX: Varsayılan %Bakiye kullanmak yerine sabit $50 Margin hedefli ve 10x kaldıraç = $500 Volume üzerinden işlemi boyutlandır.
    // 10x Kaldıraç x $3 Sabit Margin = $30 Hacim
    const TARGET_NOTIONAL_USD = process.env.BYBIT_TRADE_USD || 30;
    
    // lotSize step'ini bul
    const qtyStep = parseFloat(info.lotSizeFilter.qtyStep);
    
    // Kaç adet coin alınacağını hesapla: Volume / Price
    const rawQty = TARGET_NOTIONAL_USD / entryPrice;
    
    // qtyStep katlarına yuvarla
    const multiplier = 1 / qtyStep;
    let qty = Math.floor(rawQty * multiplier) / multiplier;
    qty = qty.toString(); // API String bekler

    if(parseFloat(qty) < parseFloat(info.lotSizeFilter.minOrderQty)) {
        qty = info.lotSizeFilter.minOrderQty;
    }

    const side = direction === 'LONG' ? 'Buy' : 'Sell';
    
    // Fiyat yuvarlama (Fiyat tickSize basamaklarında olmalı TP SL için!)
    const tickSize = parseFloat(info.priceFilter.tickSize);
    const tickMultiplier = 1 / tickSize;
    
    const fmtTp = Math.round(targetPrice * tickMultiplier) / tickMultiplier;
    const fmtSl = Math.round(stopPrice * tickMultiplier) / tickMultiplier;

    const params = {
        category: 'linear',
        symbol: symbol,
        side: side,
        orderType: 'Market',
        qty: qty,
        takeProfit: fmtTp.toString(),
        stopLoss: fmtSl.toString(),
        tpslMode: 'Full',
        timeInForce: 'GTC'
    };

    console.log(`[BYBIT] Gönderilen Emir Parametreleri:`, JSON.stringify(params));
    const response = await makePrivateRequest('POST', '/v5/order/create', params);
    
    if(response && response.retCode === 0) {
        console.log(`[BYBIT] Emir Başarılı! ID: ${response.result.orderId}`);
        return response.result.orderId;
    } else {
        throw new Error(response ? `Bybit Error: ${response.retMsg}` : "No response from Bybit");
    }
}

// 3. Mevcut Açık Pozisyonu Getir
async function getPosition(symbol) {
    const response = await makePrivateRequest('GET', '/v5/position/list', {
        category: 'linear',
        symbol: symbol
    });

    if(response && response.retCode === 0 && response.result.list && response.result.list.length > 0) {
        // Bybit linear dönerken bazen side boş dönebiliyor (sıfır size), o yüzden size > 0 kontrolü şart
        const pos = response.result.list.find(p => parseFloat(p.size) > 0);
        return pos || null;
    }
    return null;
}

// 4. Manüel / Zorla İşlem Kapatma (Market)
async function closePosition(symbol, direction) {
    // Kapatmak için TERS yön emir girilir. (LONG'u kapatmak için SELL)
    const pos = await getPosition(symbol);
    if(!pos) throw new Error("Açık pozisyon bulunamadı veya kapandı.");

    const side = pos.side === 'Buy' ? 'Sell' : 'Buy';
    const params = {
        category: 'linear',
        symbol: symbol,
        side: side,
        orderType: 'Market',
        qty: pos.size,
        reduceOnly: true, // Çok önemli! Yeni pozisyon açmaz, sadece olanı kapatır.
        timeInForce: 'GTC'
    };

    const response = await makePrivateRequest('POST', '/v5/order/create', params);
    if(response && response.retCode === 0) {
        console.log(`[BYBIT] İşlem başarıyla Kapatıldı! Symbol: ${symbol}`);
        return true;
    } else {
        throw new Error(response ? `Bybit Close Error: ${response.retMsg}` : "Close Error");
    }
}

// 5. Stop Loss Güncelleme (Breakeven / Trailing Stop için)
async function updateStopLoss(symbol, newStopLoss) {
    const pos = await getPosition(symbol);
    if (!pos || parseFloat(pos.size) === 0) throw new Error("Açık pozisyon yok, StopLoss güncellenemez.");
    
    // Bybit üzerinde tickSize uyumluluğunu kontrol etmeniz gerekebilir (Math.round vs).
    // Basitlik adına info üzerinden de bulunabilir ama direk parametreyi yollayalım.
    const params = {
        category: 'linear',
        symbol: symbol,
        stopLoss: newStopLoss.toString(), // Yeni SL rakamı
        positionIdx: pos.positionIdx || 0 // 0 = One-Way, 1 = Hedge Long, 2 = Hedge Short
    };

    const response = await makePrivateRequest('POST', '/v5/position/trading-stop', params);
    if(response && response.retCode === 0) {
        console.log(`[BYBIT] StopLoss Başarıyla Güncellendi! Symbol: ${symbol} Yeni SL: ${newStopLoss}`);
        return true;
    } else {
        throw new Error(response ? `Bybit SL Update Error: ${response.retMsg}` : "SL Update Error");
    }
}

module.exports = {
    placeOrder,
    getPosition,
    closePosition,
    updateStopLoss
};
