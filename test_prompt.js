require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function test() {
    const promptTemplate = `
Sen bir Wall Street Hedge Fund Quants Yöneticisisin. Sana gönderilen hisse / kripto senedi hakkında (Kurumsal terminoloji kullanarak) detaylı bir "Investment Thesis" (Yatırım Tezi) oluştur.
Analiz Edilecek Varlık: NVDA

Lütfen SADECE AŞAĞIDAKİ JSON FORMATINDA BAŞKA HİÇBİR TEXT OLMADAN YANIT VER:
{
    "ceoScore": [0-100 arası sayı],
    "edgeScore": [0-100 arası sayı],
    "earningsScore": [0-100 arası sayı],
    "insiderScore": [0-100 arası sayı],
    "patentScore": [0-100 arası sayı],
    "sentimentPercent": [0-100 arası sayı],
    "summary": "Maksimum 120 karakterlik Türkçe genel durum özeti",
    "detailedReport": "Markdown formatında en az 500 kelimelik, kesintisiz, tam ve çok detaylı profesyonel yatırım raporu."
}`;
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
    const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: promptTemplate }] }],
        generationConfig: { responseMimeType: "application/json" }
    });
    console.log("Raw Output:", result.response.text());
}
test().catch(console.error);
