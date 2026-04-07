require('dotenv').config();
const { appendToSheet } = require('./google-api');

async function testDrive() {
    console.log('[TEST] Google Sheets entegrasyonu test ediliyor...');
    console.log('[TEST] Kullanılan Sheet ID:', process.env.GOOGLE_SHEETS_ID);
    
    const testRow = [
        new Date().toISOString().split('T')[0],
        '✅ TEST-WIN',
        '⛔ TEST-LOSS',
        '⏳ TEST-ACTIVE',
        '%100.0',
        JSON.stringify({ test_mesaj: "Antigravity/Yaratıcı Dev Test Fire! Sistem calisiyor!" })
    ];
    
    const success = await appendToSheet(testRow);
    
    if (success) {
        console.log('[TEST SUCCESS] Test verisi Google E-Tabloya mükemmel şekilde eklendi!');
    } else {
        console.error('[TEST FAILED] Tabloya veri yazılamadı. Lütfen Yetkilendirme (Sayfayı paylaşma) adımını kontrol edin.');
    }
}

testDrive();
