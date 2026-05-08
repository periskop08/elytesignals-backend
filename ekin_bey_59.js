require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, 'signals.db');
const db = new sqlite3.Database(dbPath);

const { GEMINI_API_KEY } = process.env;
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

async function run() {
    console.log("👨‍💼 Ekin Bey 59 sinyallik özel otopsi görevi için uyandırıldı...");
    
    // We get the 59 signals
    const sqlSignals = `
        SELECT symbol, type, status, qualityScore, warnings, createdAt, updatedAt
        FROM signals 
        ORDER BY createdAt DESC LIMIT 59`;

    const signals = await runQuery(sqlSignals);

    if (signals.length === 0) {
        console.log("Sinyal bulunamadı.");
        return;
    }

    let contextData = "--- SON 59 SİNYALİN DÖKÜMÜ ---\n";
    let winCount = 0;
    let lossCount = 0;
    let activeCount = 0;

    signals.forEach((s, i) => {
        if (s.status === 'WIN') winCount++;
        else if (s.status === 'LOSS') lossCount++;
        else activeCount++;

        contextData += `${i+1}. ${s.symbol} (${s.type}) | Durum: ${s.status} | Skor: ${s.qualityScore} | Uyarılar: ${s.warnings}\n`;
    });

    console.log(`Toplam: ${signals.length} Sinyal (Win: ${winCount}, Loss: ${lossCount}, Active: ${activeCount})`);
    
    const prompt = `Sen PeriskopAI nicel (quant) hedge fonunun Baş Stratejisti ve Risk Yöneticisisin (CRO) Ekin Bey'sin.
    Aşağıda, sistemde şu an açık olan veya yeni kapanan 59 adet sinyalin dökümünü veriyorum. Patron (Kullanıcı) Win Rate'in (Kazanma Oranı) %15'lere düştüğünü, backtestlerde böyle bir sonuç görmediklerini ve çok fazla Stop olduklarını söylüyor.

    "Uyarılar (warnings)" kısmı, o işlemin teknik tetikleyicilerini gösterir.

    ${contextData}

    GÖREVİN: Bu 59 işlemi inceleyerek detaylı bir otopsi ve acil eylem raporu hazırlamak. 
    Lütfen raporunu aşağıdaki başlıklarda oluştur:

    1. 🔍 Neden Stop Oluyoruz?: Hangi teknik indikatörler, paternler veya uyarılar (warnings) bizi bu hatalara sürükledi? Piyasada bir rejim değişikliği mi var?
    2. ⚠️ Hatalı Backtest mi, Canlı Piyasa Farkı mı?: Backtestlerde görmediğimiz ama canlıda tosladığımız problem sence nedir? (Hacim eksikliği, çok fazla altcoin taraması vb.)
    3. 🛠️ ACİL EYLEM PLANI: Kanamayı durdurmak için algoritmada derhal yapmamız gereken 3 acil kısıtlama veya kural nedir?

    KESİN KURALLAR:
    - Selamlama olarak "👨‍💼 *Merhaba Brocum, Ben Ekin Bey.*" diye başla ve durumu sert, net bir dille açıkla.
    - Uzun uzadıya edebi laflar etme, tamamen teknik konuş.`;

    try {
        const result = await model.generateContent(prompt);
        let response = result.response.text();
        fs.writeFileSync('report_59.txt', response);
        console.log("Rapor 'report_59.txt' dosyasına yazıldı!");
        console.log("\n=====================\n");
        console.log(response);
    } catch(e) {
        console.error("Gemini Error:", e.message);
    }
}

run();
