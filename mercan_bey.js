require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const TelegramBot = require('node-telegram-bot-api');
const { logTokenUsage } = require('./usage_tracker');
const axios = require('axios');

// Gemini 1.5 Pro Search Grounding yeteneği için tanımlama
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const searchModel = genAI.getGenerativeModel({ 
    model: "gemini-2.5-pro",
    tools: [
        {
            googleSearch: {}
        }
    ]
});

let bot = null;
if (process.env.TELEGRAM_BOT_TOKEN) {
    bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
}

// Global hafıza: Aynı coini tekrar tekrar araştırmayı engeller (12 saat cache), eski raporu verir
const memoryCache = {};

async function fireMercanBey(symbol, type, diffPercentage) {
    const cacheKey = `${symbol}_${type}`;
    
    const diffFmt = (diffPercentage * 100).toFixed(2);
    const moveDesc = type === 'PUMP' ? `Aşırı Alış (Pump) +%${diffFmt}` : `Aşırı Satış (Dump) -%${Math.abs(diffFmt)}`;

    // Eğer bu coin son 12 saat içerisinde araştırılmışsa yapay zekaya sormadan ARŞİV'den ver
    if (memoryCache[cacheKey] && (Date.now() - memoryCache[cacheKey].time < 12 * 60 * 60 * 1000)) {
        console.log(`[MERCAN_BEY] Hafıza devreye girdi. ${symbol} için önbellekten rapor gönderiliyor...`);
        const cachedData = memoryCache[cacheKey];
        
        if (cachedData.isShort) {
            const shortMsg = `🚨 *ANOMALİ TESPİT EDİLDİ:* #${symbol}\n📉 *Hareket:* ${moveDesc}\n\n📌 _[Arşiv Hafızası]: Hareket %30'u veya hacim 100M$'ı aşmadığı için yapay zeka araştırması devredışı bırakıldı._`;
            if (bot && process.env.TELEGRAM_VIP_GROUP_ID) {
                await bot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, shortMsg, { parse_mode: 'Markdown' });
            }
        } else {
            const msg = `🕵️‍♂️ *Mercan Bey (ARŞİV RAPORU)*\n\n🚨 *TEKRARLAYAN ANOMALİ:* #${symbol}\n📉 *Hareket:* ${moveDesc}\n\n📝 *Önceki Araştırma Raporu:*\n${cachedData.aiReport}`;
            if (bot && process.env.TELEGRAM_VIP_GROUP_ID) {
                await bot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, msg, { parse_mode: 'Markdown' });
            }
        }
        return; 
    }
    
    console.log(`[MERCAN_BEY] Anomali fırlatıldı! ${symbol} (${moveDesc}). Hacim kontrol ediliyor...`);

    let volumeUsd = 0;
    try {
        const bingxSymbol = symbol.endsWith('USDT') ? symbol.replace('USDT', '-USDT') : symbol;
        const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v2/quote/ticker?symbol=${bingxSymbol}`);
        if (res.data && res.data.data && res.data.data.quoteVolume) {
            volumeUsd = parseFloat(res.data.data.quoteVolume);
        }
    } catch (e) {
        console.warn("[MERCAN_BEY] Hacim alınamadı:", e.message);
    }

    const requiresAI = Math.abs(diffPercentage) >= 0.30 || volumeUsd >= 100000000;

    if (!requiresAI) {
        let volText = volumeUsd > 0 ? `$${(volumeUsd/1000000).toFixed(1)}M` : 'Bilinmiyor';
        const shortMsg = `🚨 *ANOMALİ TESPİT EDİLDİ:* #${symbol}\n📉 *Hareket:* ${moveDesc}\n💰 *Hacim:* ${volText}\n\n📌 _Hareket %30'u veya hacim 100M$'ı aşmadığı için yapay zeka araştırması devredışı bırakıldı._`;
        
        // Kısa durumu hafızaya al
        memoryCache[cacheKey] = { time: Date.now(), isShort: true };

        if (bot && process.env.TELEGRAM_VIP_GROUP_ID) {
            await bot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, shortMsg, { parse_mode: 'Markdown' });
            console.log(`[MERCAN_BEY] Hızlı rapor başarıyla iletildi (${symbol}).`);
        }
        return;
    }

    console.log(`[MERCAN_BEY] Şartlar sağlandı (Hacim > 100M veya Fark > %30). Gemini uçuşa geçiyor...`);

    try {
        const prompt = `Şu anda kripto para piyasasında ${symbol} varlığında ani bir ${moveDesc} gerçekleşti.
Google Arama motorunu kullanarak şu anki son 24 veya 48 saatlik gelişmeleri, kripto haberlerini, borsa duyurularını, hack/delist/listeleme veya büyük balina olaylarını tara.

KURAL 1: Eğer ${symbol} ile ilgili bu düşüşe veya yükselişe sebep olacak somut bir haber, makale veya spekülasyon BULAMAZSAN sadece şu cümleyi yazarak bitir ve hiçbir şey uydurma: "Aşırı ${type === 'PUMP' ? 'alış' : 'satış'} var ancak internette veya resmi kanallarda herhangi bir somut haber bulamadım, bilginiz olsun."

KURAL 2: Eğer somut bir veri veya haber bulursan, 3 veya 4 cümlelik çok net, finansal ve profesyonel bir özet raporu yaz. Zırva ve gereksiz laf kalabalığı yapma.`;

        const result = await searchModel.generateContent(prompt);
        await logTokenUsage('Mercan Bey', result);
        let responseText = result.response.text().trim();

        // Fazladan referans/dipnot linkleri eklenmişse temizleyebiliriz ama genelde faydalıdır.
        // Uzun raporu hafızaya al
        memoryCache[cacheKey] = { time: Date.now(), isShort: false, aiReport: responseText };

        const msg = `🕵️‍♂️ *Mercan Bey (İstihbarat Hafiyesi)*\n\n🚨 *ANOMALİ TESPİT EDİLDİ:* #${symbol}\n📉 *Hareket:* ${moveDesc}\n\n📝 *Araştırma Raporu:*\n${responseText}`;
        
        if (bot && process.env.TELEGRAM_VIP_GROUP_ID) {
            await bot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, msg, { parse_mode: 'Markdown' });
            console.log(`[MERCAN_BEY] Rapor başarıyla iletildi (${symbol}).`);
        }
    } catch (e) {
        console.error("[MERCAN_BEY] Hata oluştu:", e.message);
        // Eğer API hatası olursa 12 saatlik bloku kaldıralım ki daha sonra tekrar deneyebilsin.
        delete memoryCache[cacheKey]; 
    }
}

module.exports = { fireMercanBey };
