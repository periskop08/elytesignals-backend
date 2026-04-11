require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const axios = require('axios');

const dbPath = path.resolve(__dirname, 'signals.db');
const db = new sqlite3.Database(dbPath);

const { GEMINI_API_KEY } = process.env;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3.1-pro" });

function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function runExec(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

async function fetchBingxCandles(symbol, intervalMinutes, limit) {
    try {
        const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${symbol}&interval=1h&limit=${limit}`);
        let list = res.data.data;
        list.sort((a, b) => a.time - b.time);
        return list.map(k => ({
            open: parseFloat(k.open),
            high: parseFloat(k.high),
            low: parseFloat(k.low),
            close: parseFloat(k.close),
            volume: parseFloat(k.volume),
            date: new Date(parseInt(k.time)).toLocaleString()
        }));
    } catch (e) { return null; }
}

async function analyzeLoss(trade) {
    try {
        console.log(`[POST_MORTEM] Analiz başlıyor: ${trade.symbol} (${trade.type}) ID: ${trade.id}`);
        // Son 15 mumu (15 saati) çekiyoruz (İşlem yeni patladığı için tarihsel yakınsayacak)
        const candles = await fetchBingxCandles(trade.symbol, 60, 24);
        let candleContext = "Son 24 Saatlik Fiyat Hareketi Yok";
        
        if (candles && candles.length > 0) {
            candleContext = candles.map((c, i) => `H${i+1}: Açılış=${c.open.toFixed(4)}, Kapanış=${c.close.toFixed(4)}, Hacim=${c.volume.toFixed(0)}`).join('\n');
        }

        const prompt = `Sen profesyonel bir Kurumsal Hedge Fon Analisti ve Risk Yöneticisisin. PeriskopAI algoritması tarafından açılmış ancak STOP LOSS (Zarar Kes) olmuş bir işlemi "Post-Mortem (Otopsi)" analizine tabi tutacaksın.
        
İşlem Bilgileri:
- Varlık: ${trade.symbol}
- Yön: ${trade.type}
- Giriş Maliyetimiz: ${trade.entryPrice}
- Çıkış (Stop) Zorunluluğumuz: ${trade.stopPrice}
- Hedef: ${trade.targetPrice}
- Kapanış Durumu: Kötü (LOSS)

Son 24 Saatlik Mum Verileri (Giriş Sonrası Kontekst - Saatlik):
${candleContext}

Görev: Yukarıdaki verilere bakarak, teknik açıdan neden stop olduğumuzu çıkar. 
DERS ÇIKARIMI: Veritabanına kaydedilecek, gelecekteki işlemlerde yapay zekayı koruyacak KISA, NET ve KUSURSUZ TEK BİR DERS/KURAL cümlesi yaz.
Ders cümlen mutlaka "Ders: " kelimesiyle başlasın. Maksimum 2 cümle olsun. Şiirsel olma, teknik konuş.`;

        const result = await model.generateContent(prompt);
        let response = result.response.text();
        
        // "Ders: " kısmını ayıklama
        let lessonText = "Ders: Kural çıkarılamadı.";
        if (response.includes('Ders:')) {
            lessonText = "Ders: " + response.split('Ders:')[1].trim();
        } else {
            console.log("Ders tagı bulunamadı, tümünü alıyorum.");
            lessonText = response.substring(0, 200) + "...";
        }

        console.log(`[POST_MORTEM] Ders çıkarıldı: ${lessonText}`);

        // Veritabanına kaydet
        await runExec("INSERT INTO ai_lessons (symbol, tradeId, lessonText) VALUES (?, ?, ?)", [trade.symbol, trade.id, lessonText]);
        console.log(`[POST_MORTEM] Kayıt başarılı.`);
    } catch(e) {
        console.error(`[POST_MORTEM] Analiz hatası (${trade.symbol}):`, e.message);
    }
}

async function runPostMortem() {
    console.log("=== Post-Mortem (Otopsi) Ajanı Başlatıldı ===");
    
    // Status = CLOSED_LOSS olan ve henüz ai_lessons tablosunda tradeId'si OLMAYAN işlemleri bul.
    const sql = `
        SELECT u.* 
        FROM user_trades u 
        LEFT JOIN ai_lessons a ON u.id = a.tradeId 
        WHERE u.status = 'CLOSED_LOSS' 
        AND a.id IS NULL 
        ORDER BY u.id DESC 
        LIMIT 5;
    `;
    
    try {
        const pendingLosses = await runQuery(sql);
        if (pendingLosses.length === 0) {
            console.log("İncelenecek yeni bir Zarar (LOSS) işlemi bulunamadı. Görev tamam.");
            process.exit(0);
        }
        
        console.log(`${pendingLosses.length} adet işlem inceleniyor...`);
        
        for (const trade of pendingLosses) {
            await analyzeLoss(trade);
            // API Rate limit'e takılmamak için bekleme
            await new Promise(r => setTimeout(r, 2000));
        }

        console.log("=== Post-Mortem Ajanı Görevini Tamamladı ===");
        process.exit(0);
    } catch(e) {
        console.error("Critical Error", e);
        process.exit(1);
    }
}

runPostMortem();
