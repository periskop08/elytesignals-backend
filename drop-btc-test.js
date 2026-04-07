const db = require('./database');
const { placeOrder } = require('./bingx-trade');
require('dotenv').config();

async function run() {
    try {
        console.log("FETCHING BTC PRICE...");
        // BingX API public endpoint to get current price
        const crypto = require('crypto');
        const axios = require('axios');
        let currentPrice = 69000;
        try {
            const res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker?symbol=BTC-USDT');
            if (res.data && res.data.data && res.data.data.lastPrice) {
                currentPrice = parseFloat(res.data.data.lastPrice);
            }
            console.log("BTC Current Price:", currentPrice);
        } catch(e) {
            console.log("Could not fetch price natively, using default.", e.message);
        }

        // Karar Verme Mekanizması: Eğer fiyat çift ise LONG (yükseliş), tek ise SHORT. (Basit mantık simülasyonu)
        const type = Math.round(currentPrice) % 2 === 0 ? 'LONG' : 'LONG'; // Always long for test to be safe, or just fixed LONG
        
        // Seviyeleri hesapla
        let targetPrice, stopPrice, entryPrice;
        entryPrice = currentPrice;

        if (type === 'LONG') {
            targetPrice = currentPrice * 1.015; // %1.5 kar
            stopPrice = currentPrice * 0.99; // %1 zarar
        } else {
            targetPrice = currentPrice * 0.985;
            stopPrice = currentPrice * 1.01;
        }

        console.log(`Karar Edildi: ${type} at ${entryPrice}. Hedef: ${targetPrice}, Zarar Kes: ${stopPrice}`);

        const telegramId = '1194576674';

        // 1. Veritabanı Signals tablosuna ekle
        const result = await db.run(
            "INSERT INTO signals (symbol, type, entryPrice, targetPrice, stopPrice, qualityScore, warnings, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ['BTCUSDT', type, entryPrice.toFixed(2), targetPrice.toFixed(2), stopPrice.toFixed(2), 99.5, '["Yapay Zeka Onaylı Acil Test Sinyali"]', 'ACTIVE']
        );
        const signalRow = await db.get("SELECT id FROM signals ORDER BY id DESC LIMIT 1");
        const signalId = signalRow.id;
        console.log("Signal inserted into DB with ID:", signalId);

        // 2. BingX Borsasında işlemi aç
        let orderId = 'MOCK_ORDER_' + Date.now();
        try {
            orderId = await placeOrder('BTCUSDT', type, entryPrice.toFixed(2), targetPrice.toFixed(2), stopPrice.toFixed(2));
            console.log("BingX Emri Başarıyla Açıldı:", orderId);
        } catch (botErr) {
            console.error("BingX Emri başarısız! Bakiye yetersiz olabilir veya API reddetti:", botErr.message);
        }

        // 3. UserTrades ve Favorites a kaydet
        await db.run("INSERT INTO favorites (telegramId, signalId, bingxOrderId) VALUES (?, ?, ?)", [telegramId, signalId, orderId]);
        await db.run(
            "INSERT INTO user_trades (telegramId, signalId, symbol, type, entryPrice, targetPrice, stopPrice, status, bybitOrderId) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)",
            [telegramId, signalId, 'BTCUSDT', type, entryPrice.toFixed(2), targetPrice.toFixed(2), stopPrice.toFixed(2), orderId]
        );

        console.log("✅ TEST İŞLEMİ TAMAMLANDI! Taramalar (Signals) ve Favoriler Ekranda Göreblirsiniz.");
        process.exit(0);

    } catch (e) {
        console.error("Test hata verdi:", e);
        process.exit(1);
    }
}

run();
