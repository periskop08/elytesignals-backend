require('dotenv').config();
const { appendToSheet } = require('./google-api');

async function pushManualSignal() {
    // 135|BSUUSDT|LONG|0.0441|0.05478|0.042603879618835|ACTIVE|0|60|["Counter-trend 4H","High R:R Bonus (+10)"]|2026-04-01 22:00:36
    
    // Yüzdeleri Hesaplayalım
    const entry = 0.0441;
    const target = 0.05478;
    const stop = 0.042603879618835;
    
    const tpPercent = ((target - entry) / entry) * 100;
    const slPercent = ((entry - stop) / entry) * 100;
    
    // [Tarih, Sembol, Skor, Yön, TP%, SL%, Durum, Açıklama, ID]
    const signalData = [
        "01.04.2026 22:00:36",
        "BSUUSDT",
        60,
        "LONG",
        `%${tpPercent.toFixed(2)}`,
        `%${slPercent.toFixed(2)}`,
        "ACTIVE",
        "Counter-trend 4H, High R:R Bonus (+10)",
        135
    ];

    const result = await appendToSheet(signalData);
    if (result) {
         console.log("BSUUSDT Sinyali basariyla Google Sheets'e islendi!");
    } else {
         console.log("HATA OLUSTU!");
    }
}

pushManualSignal();
