require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');
const { appendToSheet } = require('./google-api');

async function processSheets() {
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, 'google-credentials.json'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

    console.log("1. Eski veriler temizleniyor (Başlıklar hariç)...");
    try {
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: 'Sayfa1!A2:I1000'
        });
        console.log("Temizleme basarili.");
    } catch(e) {
        console.error("Temizleme hatasi:", e.message);
    }
    
    // 135|BSUUSDT|LONG|0.0441|0.05478|0.042603879618835|ACTIVE|60|["Counter-trend 4H","High R:R Bonus (+10)"]|2026-04-01 22:00:36
    const bsuEntry = 0.0441;
    const bsuTarget = 0.05478;
    const bsuStop = 0.042603879618835;
    const bsuTpPercent = ((bsuTarget - bsuEntry) / bsuEntry) * 100;
    const bsuSlPercent = ((bsuEntry - bsuStop) / bsuEntry) * 100;

    const bsuData = [
        "01.04.2026 22:00:36",
        "BSUUSDT",
        60,
        "LONG",
        `%${bsuTpPercent.toFixed(2)}`,
        `%${bsuSlPercent.toFixed(2)}`,
        "ACTIVE",
        "[BTC: BULL, ETH: BULL] - Counter-trend 4H, High R:R Bonus (+10)",
        135
    ];

    // 136|PTBUSDT|LONG|0.0007757|0.00107025|0.000730656683983988|ACTIVE|60|["Counter-trend 4H","High R:R Bonus (+10)"]|2026-04-01 23:16:54
    const ptbEntry = 0.0007757;
    const ptbTarget = 0.00107025;
    const ptbStop = 0.000730656683983988;
    const ptbTpPercent = ((ptbTarget - ptbEntry) / ptbEntry) * 100;
    const ptbSlPercent = ((ptbEntry - ptbStop) / ptbEntry) * 100;

    const ptbData = [
        "01.04.2026 23:16:54",
        "PTBUSDT",
        60,
        "LONG",
        `%${ptbTpPercent.toFixed(2)}`,
        `%${ptbSlPercent.toFixed(2)}`,
        "ACTIVE",
        "[BTC: BULL, ETH: BULL] - Counter-trend 4H, High R:R Bonus (+10)",
        136
    ];

    console.log("2. BSU Sinyali ekleniyor...");
    await appendToSheet(bsuData);
    
    // Gecikme koyalim Sheets API rate limit olmasin
    await new Promise(r => setTimeout(r, 1000));
    
    console.log("3. PTB Sinyali ekleniyor...");
    await appendToSheet(ptbData);
    
    console.log("Tum islemler tamamlandi.");
}

processSheets();
