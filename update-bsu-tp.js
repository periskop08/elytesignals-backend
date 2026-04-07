require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { google } = require('googleapis');
const path = require('path');

// Yeni TP ve Oran Hesapları
const entry = 0.0441;
const stop = 0.042603879618835;
const risk = entry - stop;
const newReward = risk * 3.0;
const newTarget = entry + newReward; 
const newTpPercent = (newReward / entry) * 100;

console.log(`Eski Hedef: 0.05478`);
console.log(`Yeni Hedef: ${newTarget}`);
console.log(`Yeni TP Yüzdesi: %${newTpPercent.toFixed(2)}`);

async function run() {
    // 1. Veritabanı (SQLite) Güncellemesi
    const db = new sqlite3.Database(path.join(__dirname, 'signals.db'));
    db.run(
        "UPDATE signals SET targetPrice = ? WHERE id = ?",
        [newTarget, 135],
        function (err) {
            if (err) return console.error("[DB] BSU Güncellenemedi:", err);
            console.log(`[DB] BSU (ID: 135) hedefi güncellendi. Rows affected: ${this.changes}`);
        }
    );

    // 2. Google Sheets Güncellemesi
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, 'google-credentials.json'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    // clear-and-fill scripti sayesinde BSU'nun 2. satırda (Sayfa1!A2:I2) olduğunu, 
    // TP yüzdesinin E sütununda (Sayfa1!E2) olduğunu biliyoruz.
    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.GOOGLE_SHEETS_INSTANT_ID,
            range: 'Sayfa1!E2',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[`%${newTpPercent.toFixed(2)}`]] }
        });
        console.log(`[SHEETS] BSU TP yüzdesi Sayfa1!E2 hücresinde %${newTpPercent.toFixed(2)} olarak güncellendi.`);
    } catch(err) {
        console.error("[SHEETS] Hata:", err.message);
    }
}

run();
