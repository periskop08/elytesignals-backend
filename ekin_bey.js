require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');

const dbPath = path.resolve(__dirname, 'signals.db');
const db = new sqlite3.Database(dbPath);

const { GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, PERISKOP_TELEGRAM_ID } = process.env;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3.1-pro-preview" });

function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function sendTelegramMessage(text) {
    if (!TELEGRAM_BOT_TOKEN || !PERISKOP_TELEGRAM_ID) return;
    try {
        const chunks = text.match(/[\s\S]{1,4000}/g) || [];
        for (const chunk of chunks) {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: PERISKOP_TELEGRAM_ID,
                text: chunk,
                parse_mode: 'Markdown'
            });
        }
    } catch(e) {
        console.error("Telegram gönderme hatası:", e.message);
    }
}

async function generateStrategyReport() {
    console.log("=== Baş Stratejist (CRO) Ekin Bey Başlatıldı ===");

    const sqlWins = `
        SELECT ut.symbol, ut.type, ut.pnl, s.qualityScore, s.warnings 
        FROM user_trades ut 
        JOIN signals s ON ut.signalId = s.id 
        WHERE ut.status = 'CLOSED' AND ut.closeReason = 'NATIVE_TP'
        ORDER BY ut.closedAt DESC LIMIT 30`;

    const sqlLosses = `
        SELECT ut.symbol, ut.type, ut.pnl, s.qualityScore, s.warnings 
        FROM user_trades ut 
        JOIN signals s ON ut.signalId = s.id 
        WHERE ut.status = 'CLOSED' AND ut.closeReason = 'NATIVE_SL'
        ORDER BY ut.closedAt DESC LIMIT 30`;

    try {
        const wins = await runQuery(sqlWins);
        const losses = await runQuery(sqlLosses);

        if (wins.length === 0 && losses.length === 0) {
            console.log("Analiz edilecek geçmiş veri bulunamadı.");
            await sendTelegramMessage("👨‍💼 *Merhaba Ben Ekin Bey, görevimin başındayım.*\n\nBugün analiz edilecek yeni bir otopilot işlemi kapanmadığı için sunacak bir strateji raporum yok.\n\nİyi geceler.");
            return;
        }

        let contextData = "--- KAZANAN (WIN) İŞLEMLER BİLANÇOSU ---\n";
        wins.forEach((w, i) => {
            contextData += `${i+1}. ${w.symbol} (${w.type}) | Skor: ${w.qualityScore} | Uyarılar: ${w.warnings}\n`;
        });

        contextData += "\n--- KAYBEDEN (LOSS) İŞLEMLER BİLANÇOSU ---\n";
        losses.forEach((l, i) => {
            contextData += `${i+1}. ${l.symbol} (${l.type}) | Skor: ${l.qualityScore} | Uyarılar: ${l.warnings}\n`;
        });

        console.log("Veriler toplandı, Gemini (CRO) yapay zekasına Analiz Emri veriliyor...");

        const prompt = `Sen PeriskopAI nicel (quant) hedge fonunun Baş Stratejisti ve Risk Yöneticisisin (CRO).
        Aşağıda, algoritmamızın (Otopilot) son zamanlarda açıp KAZANDIĞI ve KAYBETTİĞİ (Stop olduğu) işlemlerin bir dökümünü sana veriyorum.
        Bu işlemlerin "Uyarılar (warnings)" kısmı, o işlemin teknik tetikleyicilerini (Örn: Katil Fitil, FVG, ADX Regime vs) gösterir.

        ${contextData}

        GÖREVİN: Bu verilere dayanarak detaylı bir durum değerlendirme ve strateji optimizasyonu raporu hazırlamak.
        Lütfen raporunu aşağıdaki 3 ana başlıkta oluştur:

        1. GİZLİ KAZANÇ PATERNİ: Kazanan işlemlerin ortak özellikleri nelerdir? Hangi uyarı/rejim kombinasyonlarında paramızı katlıyoruz?
        2. KRONİK ZAAFİYETLER: Kaybeden işlemlerin (Zarar) asıl kanayan yarası nedir? Hangi formasyon/tuzak ya da rejimde durmadan stop oluyoruz? Asıl sorun nerede?
        3. EYLEM PLANI (3 AKSİYON): Otopilot kodlarındaki puanlama barajlarına yönelik matematiksel 3 adet net tavsiye.

        KESİN KURALLAR:
        - Mail veya mektup taslağı (Kime, Kimden, Tarih, Konu) ASLA kullanma.
        - Sahte bir tarih veya uydurma veri ASLA yazma.
        - Raporun tamamı kısa, çok net ve tamamen teknik tespitlere odaklansın. Doğrudan başlıklara gir.`;

        const result = await model.generateContent(prompt);
        let response = result.response.text();

        console.log("\n=== GEMINI STRATEJİ RAPORU ===\n");
        console.log(response);

        // Send to Telegram
        let ekinMsg = `👨‍💼 *Merhaba Ben Ekin Bey, görevimin başındayım.*\n\nİşte dünkü analizlere göre yapay zeka tabanlı Strateji Raporum:\n\n${response}\n\nİyi geceler.`;
        await sendTelegramMessage(ekinMsg);
        console.log("\nTelegram raporu iletildi. Görev tamam.");
    } catch(e) {
        console.error("Raporlama hatası:", e);
    }
}

cron.schedule('30 3 * * *', async () => {
    await generateStrategyReport();
});

console.log("=== Baş Stratejist (CRO) Ekin Bey servisi başlatıldı (Nöbette) ===");
