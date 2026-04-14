const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const path = require('path');

// Load environment variables since process.env is needed
require('dotenv').config({ path: path.join(__dirname, '.env') });

const db = new sqlite3.Database(path.join(__dirname, 'signals.db'));

async function sendQuickReport() {
    db.all(`
        SELECT s.symbol, s.type, s.lessonId, a.lessonText 
        FROM shadow_trades s 
        LEFT JOIN ai_lessons a ON s.lessonId = a.id 
        WHERE s.status IN ('PENDING', 'SHADOW_TEST_PENDING')
    `, async (err, rows) => {
        if (err) {
            console.error('DB Error:', err);
            return;
        }

        let msg = `🐺 *Börü Bey: Anlık Karanlık Oda (Sanal Takip) Raporu* 🐺\n\n`;

        if (rows.length === 0) {
            msg += `_Şu anda takip ettiğim aktif bir sanal işlem bulunmuyor._`;
        } else {
            msg += `📋 *Şu Anki Takip Listesi (${rows.length} işlem):*\n\n`;
            for (let s of rows) {
                let currReason = "";
                if (s.lessonId === -999) currReason = "Yetersiz ADX / Düşük Kalite Skoru (Sabit Motor Kuralı)";
                else if (s.lessonId === -998) currReason = "Demir Bey Tahta Koruması (Sığ Tahta / Yüksek Makas)";
                else if (s.lessonText) currReason = `Ders ID: ${s.lessonId} - "${s.lessonText}"`;
                else currReason = `Ders ID: ${s.lessonId}`;

                msg += `🔹 *${s.symbol}* (${s.type})\n_Sebep:_ ${currReason}\n\n`;
            }
        }

        console.log(msg);

        if (process.env.ADMIN_TELEGRAM_ID && process.env.TELEGRAM_BOT_TOKEN) {
            try {
                await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    chat_id: process.env.ADMIN_TELEGRAM_ID,
                    text: msg,
                    parse_mode: 'Markdown'
                });
                console.log('Telegram message sent successfully.');
            } catch (tgEr) {
                console.error("Telegram notification error:", tgEr.message);
            }
        } else {
            console.error("Telegram credentials missing in .env");
        }
    });
}

sendQuickReport();
