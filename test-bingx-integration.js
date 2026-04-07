require('dotenv').config();
const { placeOrder } = require('./bingx-trade');
const db = require('./database');
const axios = require('axios');

async function createFakeSignal() {
    // find a user session to map it to
    const sessions = await db.all("SELECT telegramId FROM sessions LIMIT 1");
    let telegramId = process.env.PERISKOP_TELEGRAM_ID || '12345678';
    if(sessions && sessions.length > 0) telegramId = sessions[0].telegramId;

    const res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
    const btc = res.data.data.find(x => x.symbol === 'BTC-USDT');
    const price = parseFloat(btc.lastPrice);
    
    // We do LONG market order, so current price is entry
    const entry = price;
    const stop = price * 0.99; // 1% stop
    const target = price * 1.03; // 3% target
    
    console.log(`[TEST] Creating BTCUSDT LONG at ${entry}, Stop: ${stop}, Target: ${target}`);

    const sRes = await db.run("INSERT INTO signals (symbol, type, entryPrice, targetPrice, stopPrice, qualityScore) VALUES (?, ?, ?, ?, ?, ?)", ['BTCUSDT', 'LONG', entry, target, stop, 60]);
    const signalId = sRes.id;
    console.log("1. Fake signal added, ID:", signalId);
    
    try {
        const orderId = await placeOrder('BTCUSDT', 'LONG', entry, target, stop);
        console.log("2. BingX order success. ID:", orderId);
        
        await db.run("INSERT INTO user_trades (telegramId, signalId, symbol, type, entryPrice, targetPrice, stopPrice, status, bybitOrderId) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)", [telegramId, signalId, 'BTCUSDT', 'LONG', entry, target, stop, orderId]);
        console.log("3. User Trade active. Go check website tracking!");
    } catch(e) {
        console.error("Order trigger failed:", e.message);
    }
}
createFakeSignal();
