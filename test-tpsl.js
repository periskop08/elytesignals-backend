require('dotenv').config();
const { placeOrder } = require('./bingx-trade');
const db = require('./database');
const axios = require('axios');

async function testWithTPSL() {
    // 1. Get exact price
    const res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
    const btc = res.data.data.find(x => x.symbol === 'BTC-USDT');
    const price = parseFloat(btc.lastPrice);
    
    const entry = price;
    const stop = price * 0.99; // 1% stop
    const target = price * 1.03; // 3% target
    
    // TEMPORARY MOCK OF placeOrder locally to test TP and SL stringification
    const crypto = require('crypto');
    const API_KEY = process.env.BINGX_API_KEY;
    const API_SECRET = process.env.BINGX_API_SECRET;
    
    // same logic as bingx-trade.js but injecting TP/SL back!
    const params = {
        symbol: 'BTC-USDT', side: 'BUY', positionSide: 'LONG', type: 'MARKET',
        quantity: '0.0150', timestamp: Date.now(),
        takeProfit: JSON.stringify({ type: "TAKE_PROFIT_MARKET", stopPrice: parseFloat(target.toFixed(1)), workingType: "MARK_PRICE" }),
        stopLoss: JSON.stringify({ type: "STOP_MARKET", stopPrice: parseFloat(stop.toFixed(1)), workingType: "MARK_PRICE" })
    };
    
    const sortedKeys = Object.keys(params).sort();
    let qs1 = '';
    for(const k of sortedKeys) qs1 += k + '=' + params[k] + '&';
    qs1 = qs1.slice(0, -1);
    
    const sign = crypto.createHmac('sha256', API_SECRET).update(qs1).digest('hex'); 
    
    let qs2 = '';
    for(const k of sortedKeys) qs2 += k + '=' + encodeURIComponent(params[k]) + '&';
    qs2 = qs2.slice(0, -1);
    
    const url = 'https://open-api.bingx.com/openApi/swap/v2/trade/order?' + qs2 + '&signature=' + sign;
    
    try {
        const oRes = await axios.post(url, null, { headers: { 'X-BX-APIKEY': API_KEY }});
        console.log("SUCCESS WITH TP/SL:", oRes.data);
    } catch(e) {
        console.error("FAIL TP/SL:", e.response?.data || e.message);
    }
}
testWithTPSL();
