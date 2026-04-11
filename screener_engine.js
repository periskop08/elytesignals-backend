const YFClass = require('yahoo-finance2').default;
const yahooFinance = new YFClass();
const db = require('./database');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

let ai = null;
if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

let telegramBot = null;
if (process.env.TELEGRAM_BOT_TOKEN) {
    telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
}

async function runDailyScreener() {
    console.log("[HAMDİ BEY - OTONOM YATIRIM AJANI] Günlük borsa tarayıcısı (Screener) masaya oturdu...");

    if (!ai) {
        console.error("[HAMDİ BEY] Gemini API Key bulunamadı, tarayıcı durduruldu.");
        return;
    }

    try {
        // Find best candidates dynamically using Yahoo Screener. 
        // We look broadly at multiple screeners to find aggressive opportunities.
        const queryOptionsList = [
            { scrIds: 'day_gainers', count: 5 },
            { scrIds: 'aggressive_small_caps', count: 5 },
            { scrIds: 'undervalued_growth_stocks', count: 5 }
        ];

        let potentialSymbols = [];
        for (const q of queryOptionsList) {
            try {
                const res = await yahooFinance.screener(q);
                if (res && res.quotes) {
                    res.quotes.forEach(q => potentialSymbols.push(q.symbol));
                }
            } catch(err) {
                 console.error(`[AI SCREENER] Screener ${q.scrIds} error:`, err.message);
            }
        }
        
        // Uniquify symbols
        potentialSymbols = [...new Set(potentialSymbols)].filter(Boolean);
        if (potentialSymbols.length === 0) {
            console.log("[AI SCREENER] Tarayici hisse bulamadi.");
            return;
        }

        console.log(`[AI SCREENER] Toplam ${potentialSymbols.length} ham aday bulundu. Yapay zeka filteresine giriyor...`);

        // Check against existing portfolio assets to only discover NEW ones
        const existingRows = await db.all("SELECT symbol FROM portfolio_assets");
        const existingSet = new Set(existingRows.map(r => r.symbol));
        const newCandidates = potentialSymbols.filter(s => !existingSet.has(s)).slice(0, 5); // Limit to top 5 fresh candidates per day to respect API limits

        if (newCandidates.length === 0) {
        if (newCandidates.length === 0) {
            console.log("[HAMDİ BEY] Kantarıma giren yeni bir hisse adayı bulamadım.");
            return;
        }

        console.log(`[HAMDİ BEY] ${newCandidates.length} adayı derin analize alıyorum:`, newCandidates);

        let addedAny = false;

        for (const symbol of newCandidates) {
            try {
                // Fetch basic fundamental info for the prompt or baseline
                let currentPrice = 0;
                let metricsObj = {};
                try {
                     const qs = await yahooFinance.quoteSummary(symbol, { modules: ['price', 'defaultKeyStatistics', 'financialData'] });
                     currentPrice = qs?.price?.regularMarketPrice || 0;
                     metricsObj.pegRatio = qs?.defaultKeyStatistics?.pegRatio !== undefined ? qs.defaultKeyStatistics.pegRatio.toFixed(2) : "Bilinmiyor";
                     metricsObj.forwardPE = qs?.defaultKeyStatistics?.forwardPE !== undefined ? qs.defaultKeyStatistics.forwardPE.toFixed(2) : "Bilinmiyor";
                     metricsObj.trailingPE = qs?.defaultKeyStatistics?.trailingPE !== undefined ? qs.defaultKeyStatistics.trailingPE.toFixed(2) : "Bilinmiyor";
                     metricsObj.priceToSales = qs?.defaultKeyStatistics?.priceToSalesTrailing12Months !== undefined ? qs.defaultKeyStatistics.priceToSalesTrailing12Months.toFixed(2) : "Bilinmiyor";
                     metricsObj.fcf = qs?.financialData?.freeCashflow ? `$${(qs.financialData.freeCashflow / 1e9).toFixed(2)} Milyar` : "Bilinmiyor";
                     metricsObj.debtToEbitda = (qs?.financialData?.totalDebt && qs?.financialData?.ebitda) ? (qs.financialData.totalDebt / qs.financialData.ebitda).toFixed(2) : "Bilinmiyor";
                     metricsObj.revenueGrowth = qs?.financialData?.revenueGrowth !== undefined ? (qs.financialData.revenueGrowth * 100).toFixed(2) + "%" : "Bilinmiyor";
                } catch(e) {}
                const promptTemplate = `
Sen benim varlık yönetimi kıdemli asistanım olan "Hamdi Bey"sin (Investment Agent AI) – sofistike bir finansal karar makinesisin.
Analiz Edilecek (Screener'dan düşen yeni) Varlık: ${symbol}
Güncel Fiyat: $${currentPrice}

=== FİNANSAL VERİ SETİ ===
- PEG Oranı: ${metricsObj.pegRatio}
- İleri F/K (Forward PE): ${metricsObj.forwardPE}
- Güncel F/K (Trailing PE): ${metricsObj.trailingPE}
- Fiyat/Satış (P/S): ${metricsObj.priceToSales}
- Serbest Nakit Akışı (FCF): ${metricsObj.fcf}
- Borç / FAVÖK: ${metricsObj.debtToEbitda}
- Çeyreklik Gelir Büyümesi: ${metricsObj.revenueGrowth}
==========================

Yatırımcı Profilimiz (Sensörlerin buna göre çalışmalı!):
Antalya/Türkiye merkezli, havacılık sektöründe (kabin ekibi) çalışan aktif bir yatırımcı.
Özel Odak Alanlarımız: AI altyapısı (NVDA, AMD, TSMC), Savunma Sanayii, Nükleer/Enerji, Dronlar ve Siber Güvenlik.
Türkiye gerçekleri: Döviz riski ve vergilendirmeler göz önüne alındığında "Kâr beklentisi yüksek, katı moat değerine sahip" sağlam şirketleri kovalıyoruz.

[GÖREV VE KALICI KURALLARIN - HAMDİ BEY MANTALİTESİ]

1. Moat Analizi (Rekabet Avantajı Değerlendirmesi):
- Kantan bilgilerinle hisseyi 4 faktörde incele: Teknoloji (Patentler), Marka (Pazar payı), Ölçek (Üretim kapasitesi) ve Regülasyonlar.
- Örnek: NVDA (Güçlü Moat - CUDA ekosistemi), AMD (Zayıf/Orta Moat - MI300 gecikmesi). AVAV (Güçlü - Switchblade DoD tekel kontratları). Coca-Cola (Zayıf Moat - Emtia/Süpermarket rekabeti -> Teknik dışı bir şirkete yatırım kötüdür).

2. Sektörel Risk & Fırsat Dinamikleri:
- HBM / Emtia Bellek (SK Hynix, Micron): Çin (CXMT) rekabeti fiyat çökertir. Süreç teknolojisi zayıfsa "SAT" veya Düşük Puan ver.
- Nükleer / Enerji (CEG, TLN vb.): Regülatör tavan fiyat çekerse marj erir. Ama AI Hyperscaler (MSFT/META) kontratları varsa Alım Gücü yaratır.
- Siber Güvenlik (CRWD, Rubrik): Yüksek AI exploit zaafiyetleri olan veya skandal yaşamış projeleri derhal Reddet.

3. Sistem Çıktısı Beklentisi (Karar Motoru):
Kuralları okudun. Şimdi karşına çıkan ${symbol} hissesi için Moat Testi yap, yukarıdaki finansal oranları (PE, FCF) kontrol et ve bana AL, SAT, TUT veya BEKLE argümanlı mükemmel bir JSON teslim et. Beklenen getirisi güdükse sentimentPercent'i acımasızca düşük tut.

ÇIKTI FORMATI ZORUNLULUĞU:
Sadece ve sadece aşağıdaki alanları içeren geçerli bir JSON objesi döndür! Markdown \`\`\`json veya başka bloklar GİRME, düz dize olarak JSON gönder.
{
    "ceoScore": [0-100, şirket yönetimi kalitesi],
    "edgeScore": [0-100, Moat ve Rekabet Gücü Puanı],
    "earningsScore": [0-100, Finansal verilere dayanarak],
    "insiderScore": [0-100, Pazar beklentisi/Duyumlar],
    "patentScore": [0-100, Teknoloji/Inovasyon kapasitesi],
    "sentimentPercent": [0-100, NİHAİ KARAR PUANIN (AI Skoru)],
    "entryPriceTarget": [0.00 şeklinde RAKAMSAL Optimal Alım Noktası],
    "summary": "120 karakterlik veri odaklı özet (AL/SAT/TUT/BEKLE tezi dahil)",
    "detailedReport": "Hamdi Bey'in özel analiz şablonunu (Aşağıda gösterilen) kullanarak yazdığı kapsamlı tez."
}

*** JSON İÇİNDEKİ detailedReport ALANI İÇİN ŞABLON ***
### Hamdi Bey 360° Analizi: ${symbol}
**Tez ve Moat İncelemesi:** [Moat, Teknoloji, Pazar Payı incelemen. Neden AL veya SAT demeliyiz?]
**Sektörel Konjonktür:** [Yukarıdaki kurallara göre AI/Savunma/Nükleer sektör konumlandırması ve Rakipler]
**Finansal Röntgen:** [F/K ve Serbest Nakit analizleri]
**Karar:** AL / SAT / BEKLE / TUT
**Hedef Giriş (Re-entry) Mantığı:** [Eğer BEKLE isen hangi fiyata inerse toplanır?]
`;

                const model = ai.getGenerativeModel({ model: "gemini-3.1-pro-preview" });�ulu):** [Potansiyel alım bölgesi veya geri çekilme koşulu]
`;

                const model = ai.getGenerativeModel({ model: "gemini-3.1-pro-preview" });
                const result = await model.generateContent({
                    contents: [{ role: "user", parts: [{ text: promptTemplate }] }],
                    generationConfig: { responseMimeType: "application/json" }
                });

                const text = result.response.text().trim();
                const parsed = JSON.parse(text);

                // AI Approval Threshold check
                if (parsed.sentimentPercent > 85) {
                    console.log(`[HAMDİ BEY] ${symbol} analizini tamamladı ve skor: ${parsed.sentimentPercent}. Portföye öneriliyor.`);
                    
                    // Insert into AI Sentiments database
                    await db.run("DELETE FROM ai_sentiments WHERE symbol = ?", [symbol]);
                    await db.run(
                       "INSERT INTO ai_sentiments (symbol, ceoScore, edgeScore, earningsScore, insiderScore, patentScore, sentimentPercent, summary, detailedReport) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                       [symbol, parsed.ceoScore || 0, parsed.edgeScore || 0, parsed.earningsScore || 0, parsed.insiderScore || 0, parsed.patentScore || 0, parsed.sentimentPercent || 0, parsed.summary, parsed.detailedReport]
                    );

                    // Insert into Portfolio Asset (2% immediate, 3% pending weighting allocation!)
                    const qty = currentPrice > 0 ? Math.floor((500 * 0.02) / currentPrice) : 1;
                    const entryTarget = parsed.entryPriceTarget ? parseFloat(parsed.entryPriceTarget) : 0;
                    
                    await db.run(
                        "INSERT INTO portfolio_assets (symbol, type, allocatedPercentage, averageCost, quantity, aiScore, ceoScore, edgeScore, insiderScore, patentScore, lastStatus, pendingPercentage, pendingEntryPrice) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        [symbol, 'STOCK', 2, currentPrice || 0, qty || 1, parsed.sentimentPercent || 0, parsed.ceoScore || 0, parsed.edgeScore || 0, parsed.insiderScore || 0, parsed.patentScore || 0, 'ACTIVE', 3, entryTarget]
                    );

                    // Send Telegram Alert safely
                    if (telegramBot && process.env.TELEGRAM_VIP_GROUP_ID) {
                        const msg = `🚀 *YAPAY ZEKA FIRSAT KEŞFİ!*\n\nABD Varlık Tarayıcımız *Hamdi Bey*, piyasa taramalarında yüksek potansiyelli bir hisse tespit etti ve portföye  *%5 ağırlıkla* dahil edilmesi için masaya sundu!\n\n💎 *Hisse:* GİZLİ (Premium)\n🎯 *Yatırım Cazibe Skoru:* ${parsed.sentimentPercent}/100\n💼 *Moat (Rekabet Gücü):* ${parsed.edgeScore}/100\n\n📌 _Hamdi Bey'in bu şirket için hazırladığı özel 360 Derece Yatırım Raporu Varlık Yöneticisi sayfasına yüklendi, detaylara siteden göz atabilirsiniz._`;
                        telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, msg, { parse_mode: 'Markdown' }).catch(e => console.error("Telegram error:", e));
                    }
                    
                    addedAny = true;
                } else {
                    console.log(`[HAMDİ BEY] ${symbol} şirketi vizyonsuz/zayıf Moat'a sahip. Eledim. (Skor: ${parsed.sentimentPercent})`);
                }
            } catch (evalErr) {
                console.error(`[HAMDİ BEY] ${symbol} analiz hatası (JSON Parsing vs):`, evalErr.message);
            }
            
            // Wait 5 seconds between evaluating candidates to avoid Rate Limiting
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
    } catch(err) {
        console.error("[AI SCREENER] Engine Main Error:", err);
    }
}

module.exports = { runDailyScreener };
