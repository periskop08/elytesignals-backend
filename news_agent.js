const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./database');
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
let telegramBot = null;
const { logTokenUsage } = require('./usage_tracker');
if (process.env.TELEGRAM_BOT_TOKEN) {
    telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const extractAssetsRules = `Sen bir finansal haber filtreleme AI'sısın. Kullanıcıya sadece ABD borsalarını (S&P 500, Nasdaq vb.) doğrudan etkileyecek haberleri sun. Aşağıdaki katı kurallara %100 uy:

Yasaklanan Haber Türleri (Asla Alma/Sunma):
- Türkiye ile uzaktan/yakından alakalı her şey: Siyasi, ekonomik, doğal afet, spor veya herhangi bir haber. (Örnek: TL kuru, seçimler, deprem, futbol maçı.)
- Şiddet içeren bireysel olaylar: Okul saldırıları (school shooting), intiharlar, kavgalar, cinayetler, bireysel silahlı olaylar. (Sadece bireysel/yerel şiddet; kitlesel savaş hariç.)
- Diğer önemsizler: Yerel suçlar, trafik kazaları, ünlülerin kişisel dramları.

İzin Verilen Haber Türleri (Sadece Bunları Al/Sun):
- ABD borsalarını doğrudan etkileyecek küresel olaylar: Enflasyon verileri, Fed kararları, istihdam raporları, büyük şirket kazançları (NVIDIA, AMD gibi), ABD ve dünya faiz oranları (fakat Türkiye hariç).
- Savaş ve jeopolitik gerilimler: Aktif savaşlar (örneğin Ukrayna-Rusya, Orta Doğu çatışmaları), savunma sanayi hisselerini (Lockheed Martin, Raytheon) ve borsayı etkileyecek gelişmeler. (Bireysel şiddet değil, stratejik/kitlesel olaylar.)
- Teknoloji/finans odaklı: AI, yarı iletken (TSMC, NVIDIA), bulut bilişim (AWS), büyük piyasa hareketleri.

Uygulama Kuralları:
Her haberi filtrele: ABD borsalarına ve kriptolara etkisi yoksa reddet ("relevant": false olarak JSON döndür, laf kalabalığı yapma).

Örnek İzinli: "Fed faiz indirimi sinyali verdi"
Örnek Yasak: "Türkiye'de okul saldırısı" veya "ABD'de lise kavgası."

Bu kurallara sadık kal, istisna yapma.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÇIKTI (JSON FORMATI - ZORUNLU SİSTEM ALTYAPISI):
Tüm analizi yaptıktan sonra AŞAĞIDAKİ JSON ŞABLONU İLE yanıt ver (Başka hiçbir metin yazma!):

Haber İLGİSİZ veya YASAKLI ise SADECE bunu döndür (Laf kalabalığı yapma):
{
  "relevant": false
}

Haber İLGİLİ ise AŞAĞIDAKİ FORMATI DOLDUR:
{
  "relevant": true,
  "category": "[Yukarıdaki ilgili kategori adı]",
  "relatedSymbols": "TSMC, GOOGL, HII", 
  "sentimentScore": 72, 
  "impact_direction": "BULLISH | BEARISH | NEUTRAL",
  "urgency": "BREAKING | HIGH | MEDIUM",
  "summary": "[ETKİ ETİKETİ]\\nBuraya analize göre ✅ POZİTİF ETKİ (veya 🔴 NEGATİF ETKİ, veya ⚪ NÖTR/KARIŞIK) yaz.\\n\\n📊 ETKİ PUANI: [Üstte belirlediğin 0-100 puan] — [Etiket adı]\\n\\n📌 KISA HABER ÖZETİ:\\n(Buraya kurallara uygun yorumsuz özet)\\n\\n🔍 DETAYLI ANALİZ RAPORU:\\n✅ Olumlu Yönler:\\n- (1-2 cümlelik somut kanıtlanmış çıkarım)\\n⚠️ Riskler & Olumsuz Yönler:\\n- (Sadece gerçekçi riskler)\\n💡 Analist Yorumu:\\n(2-3 cümlelik dengeli, mantıklı Wall Street yorumu.)\\n\\n📌 HABERİN ETKİLEYEBİLECEĞİ DİĞER HİSSELER\\n[Şirket Adı - Ticker] -> [POZİTİF / NEGATİF]\\nGerekçe: (Tek cümle. Neden etkileneceğini açıkla. Eğer uyan hisse yoksa bu bölümü hiç ekleme.)"
}
`;

const KANTAN_API = 'https://kantan.news/api/news?filter=all&category=&q=&page=1&limit=24';

async function fetchAndProcessNews() {
    console.log("[News Agent] İstihbarat Ağı başlatıldı. Kantan.news taranıyor...");
    try {
        const response = await fetch(KANTAN_API);

        if (!response.ok) {
            console.error("[News Agent] Kantan.news'e bağlanılamadı. Kod:", response.status);
            return;
        }

        const data = await response.json();

        // Gelen listeyi işle (en sondan en başa gibi, kronolojik sıra için)
        if (!data || !data.data || !Array.isArray(data.data)) {
            console.error("[News Agent] Hatalı veri formatı geldi.");
            return;
        }

        let processedCount = 0;
        let addedCount = 0;

        // Son eklenenleri veritabanında daha kolay kontrol edebilmek için tersten dolaşıyoruz
        const articles = data.data.reverse();

        for (let article of articles) {
            // Check if exists
            const existing = await db.get(`SELECT id FROM stock_news WHERE kantanId = ? OR slug = ?`, [article.id, article.slug]);
            if (existing) {
                // Already processed
                continue;
            }

            processedCount++;

            // Eğer yoksa işle
            console.log(`[News Agent] Yeni haber bulundu: ${article.title}`);
            const fullContent = article.content ? article.content.replace(/<[^>]+>/g, ' ').trim() : article.title;

            // 🚨 HASH/KELİME DRENAJ KALKANI (Lokal Filtre) 🚨
            const textToTest = (article.title + " " + fullContent).toLowerCase();
            const keywords = [
                'çip', 'chip', 'yarı iletken', 'semiconductor', 'yapay zeka', 'ai ', // 'ai ' with space to avoid capturing words with 'ai' inside
                'enerji', 'jeopolitik', 'savunma sanayi', 'yazılım',
                'anthropic', 'open ai', 'openai', 'meta', 'gemini', 'chatgpt', 'claude', 'nvidia', 'amd', 'intel'
            ];

            const isRelevant = keywords.some(kw => textToTest.includes(kw));

            if (!isRelevant) {
                console.log(`[News Agent] ATLANDI (İlgisiz Konu): ${article.title}`);
                // Gemini'ı meşgul etmemek için haberi DB'ye "SKIPPED" olarak yaz, bir dahaki döngüde atlanmasını sağla.
                await db.run(
                    `INSERT INTO stock_news (kantanId, title, slug, content, summary, relatedSymbols, sentimentScore) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [article.id, article.title, article.slug, 'SKIPPED_BY_FILTER', "[SKIPPED_BY_FILTER]", "", 50]
                );
                continue;
            }

            const promptContent = fullContent.substring(0, 3000); // Sadece AI'ın okuyacağı kısmı kısalt (Maliyet/Hız için)

            const prompt = `${extractAssetsRules}
---
HABER BAŞLIĞI: ${article.title}
HABER İÇERİĞİ: ${promptContent}
---
`;

            try {
                const model = genAI.getGenerativeModel({
                    model: "gemini-2.5-flash",
                    generationConfig: { responseMimeType: "application/json" }
                });

                const result = await model.generateContent(prompt);
                await logTokenUsage('Hamdi Bey', result);
                let responseText = result.response.text().trim();
                let parsed;
                try {
                    parsed = JSON.parse(responseText);
                } catch (e) {
                    console.error("[News Agent] AI parse hatası. Ham dönüş:", responseText);
                    continue;
                }

                if (parsed.relevant && parsed.relevant === true) {
                    // Veritabanına DAHA UZUN / TAM haberi kaydet
                    await db.run(
                        `INSERT INTO stock_news (kantanId, title, slug, content, summary, relatedSymbols, sentimentScore) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [article.id, article.title, article.slug, fullContent, parsed.summary, parsed.relatedSymbols || "", parsed.sentimentScore || 50]
                    );
                    console.log(`[News Agent] KAYDEDİLDİ: ${parsed.relatedSymbols} -> ${parsed.summary}`);
                    addedCount++;
                } else {
                    // Kaydet ama gereksiz olarak (böylece bir sonraki turda tekrar işlemeyelim)
                    await db.run(
                        `INSERT INTO stock_news (kantanId, title, slug, content, summary, relatedSymbols, sentimentScore) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [article.id, article.title, article.slug, fullContent, "[REJECTED/IRRELEVANT]", "", 50]
                    );
                    console.log(`[News Agent] REDDEDİLDİ (Piyasayla İlgisiz): ${article.title}`);
                }

            } catch (aiErr) {
                console.error(`[News Agent] Gemini hatası (${article.title}):`, aiErr.message);
                // Bekleme süresi
            }

            // Limit takılmamak için 1 saniye bekle
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        console.log(`[News Agent] Tur Tamamlandı. İşlenen Hacim: ${processedCount}, İstihbarata Eklenen: ${addedCount}`);

    } catch (e) {
        console.error("[News Agent] Genel motor hatası:", e.message);
    }
}

async function sendDailyNewsReport() {
    if (!telegramBot || !process.env.ADMIN_TELEGRAM_ID) return;
    try {
        const row = await new Promise((resolve, reject) => {
            db.get(`SELECT count(id) as totalCount, 
                           sum(case when relatedSymbols != '' and relatedSymbols is not null then 1 else 0 end) as symbolsCount 
                    FROM stock_news 
                    WHERE datetime(createdAt) > datetime('now', '-24 hours')`, [], (err, res) => {
                if (err) reject(err);
                else resolve(res);
            });
        });

        const total = row ? row.totalCount : 0;
        const symbols = row ? row.symbolsCount : 0;

        const msg = `📰 *Merhaba ben Hamdi Bey; Görevimin başındayım.*\n\nBugün Kantan News altyapısından toplam *${total}* adet haber çektim ve bu haberler arasından gizli etkilenecek olan *${symbols}* adet hisse bilgisi yazdım.\n\nÇalışmaya devam ediyorum, iyi geceler.`;

        await telegramBot.sendMessage(process.env.ADMIN_TELEGRAM_ID, msg, { parse_mode: 'Markdown' });
        console.log("[News Agent] Günlük rapor Telegram'a iletildi.");
    } catch (e) {
        console.error("[News Agent] Günlük rapor hatası:", e.message);
    }
}

module.exports = {
    fetchAndProcessNews,
    sendDailyNewsReport
};
