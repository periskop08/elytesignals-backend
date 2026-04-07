const { appendToSheet, updateSheetSignalStatus } = require('./google-api');

async function runTest() {
    console.log("TEST 1: Satir ekleniyor...");
    const dateStr = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    
    // Rastgele bir ID atayalim
    const testId = 99999;
    
    // [Tarih, Sembol, Skor, Yön, TP%, SL%, Durum, Açıklama, ID]
    const testData = [
        dateStr,
        "TESTUSDT",
        99,
        "LONG",
        "%5.40",
        "%2.10",
        "ACTIVE",
        "BTC Trend: BULL, ETH Trend: BULL (Test Verisi)",
        testId
    ];
    
    const appendSuccess = await appendToSheet(testData);
    
    if (appendSuccess) {
        console.log("TEST 1 Basaılı! Şimdi 5 saniye bekleyip Durumu WIN olarak güncelleyeceğim...");
        setTimeout(async () => {
            console.log("TEST 2: Satir güncelleniyor...");
            await updateSheetSignalStatus(testId, "WIN");
            console.log("TEST TAMAMLANDI!");
        }, 5000);
    }
}

require('dotenv').config();
runTest();
