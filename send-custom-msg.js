require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_VIP_GROUP_ID) {
    console.error("Missing TELEGRAM variables.");
    process.exit(1);
}

const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

const reportText = `🚨 *PİYASADA SON DURUM* 🚨

🔥 *İşlemler Çılgın Atıyor!*
Anlık tüm açık işlemlerin toplam net kârı muazzam bir şekilde *+%30'a* ulaştı! 💸

👁️‍🗨️ *PERİSKOP AI MODELİ ATEŞ EDİYOR!* 🔫
Gelişmiş algoritmamız tıkır tıkır işliyor, sarmaldaki hedefler tek tek vuruluyor!

_Sıkı tutunun, kârlarımızı katlamaya devam ediyoruz..._ 🚀`;

telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, reportText, { parse_mode: 'Markdown' })
    .then(() => {
        console.log("Mesaj Telegram grubuna başarıyla gönderildi!");
        process.exit(0);
    })
    .catch(err => {
        console.error("Hata oluştu:", err);
        process.exit(1);
    });
