require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const axios = require('axios');

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
        console.error("Telegram error:", e.message);
    }
}

async function run() {
    console.log("👨‍💼 Ekin Bey özel otopsi görevi için uyandırıldı...");
    
    // 17-18-19-20-21 Nisan'da Stop Olan İşlemler
    const sqlLosses = `
        SELECT ut.symbol, ut.type, ut.pnl, s.qualityScore, s.warnings, ut.closedAt, s.createdAt
        FROM user_trades ut 
        JOIN signals s ON ut.signalId = s.id 
        WHERE ut.status = 'CLOSED' 
          AND ut.closeReason = 'NATIVE_SL'
          AND date(ut.closedAt) >= '2026-04-17' 
          AND date(ut.closedAt) <= '2026-04-21'
        ORDER BY ut.closedAt DESC`;

    const losses = await runQuery(sqlLosses);

    if (losses.length === 0) {
        console.log("Belirtilen tarihlerde Stop olan işlem bulunamadı.");
        await sendTelegramMessage("👨‍💼 *Merhaba Brocum, Ben Ekin Bey.*\n\n17-21 Nisan tarihleri arasında sistemimizde Stop (Loss) olan hiçbir işlem bulunamadı. Görünüşe göre sistemimiz kusursuz çalışmış!");
        return;
    }

    let contextData = "--- 17-21 NİSAN STOP OLAN İŞLEMLER ---\n";
    losses.forEach((l, i) => {
        contextData += `${i+1}. ${l.symbol} (${l.type}) | Skor: ${l.qualityScore} | Tarih: ${l.closedAt} | Uyarılar: ${l.warnings}\n`;
    });

    console.log(`Veritabanında ${losses.length} adet Stop olmuş işlem tespit edildi. Gemini'ye bağlanılıyor...`);

    const prompt = `Sen PeriskopAI nicel (quant) hedge fonunun Baş Stratejisti ve Risk Yöneticisisin (CRO) Ekin Bey'sin.
    Aşağıda, algoritmamızın 17-21 Nisan 2026 tarihleri arasında açıp KAYBETTİĞİ (Stop olduğu) işlemlerin detaylı dökümünü veriyorum.
    "Uyarılar (warnings)" kısmı, o işlemin teknik tetikleyicilerini gösterir.

    ${contextData}

    GÖREVİN: Bu zararlı işlemleri inceleyerek detaylı bir otopsi ve strateji raporu hazırlamak.
    Lütfen raporunu aşağıdaki başlıklarda oluştur:

    1. 🔍 OTOPSİ: Neden stop olduk? Hangi teknik indikatörler, paternler veya uyarılar (warnings) bizi bu hatalara sürükledi?
    2. ⚠️ KRONİK HATALAR: Düzeltmemiz gereken yapısal veya matematiksel yanlışlar nelerdir?
    3. 🛠️ EYLEM PLANI: Sistemin algoritmasına eklememiz veya çıkarmamız gereken net 3 kural nedir?

    KESİN KURALLAR:
    - Selamlama olarak "👨‍💼 *Merhaba Brocum, Ben Ekin Bey.* 17-21 Nisan tarihlerine ait özel otopsi raporumu sunuyorum:" diye başla.
    - Mail veya mektup formatı kullanma.
    - Çok net, acımasız ve tamamen teknik tespitlere odaklan. Paramızı neden kaybettiğimizi çekinmeden söyle.`;

    try {
        const result = await model.generateContent(prompt);
        let response = result.response.text();
        await sendTelegramMessage(response);
        console.log("Rapor Telegram üzerinden patrona (Periskop'a) başarıyla gönderildi!");
    } catch(e) {
        console.error("Gemini Error:", e.message);
    }
}

run();
