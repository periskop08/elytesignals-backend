require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_VIP_GROUP_ID) {
    console.error("Missing TELEGRAM variables.");
    process.exit(1);
}

const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

const dayString = new Date().toISOString().split('T')[0];
const totalSignalsOfDayLog = 35;
const totalWins = 7;
const totalLosses = 11;
const totalActive = 17;
const winRate = '38.9';

let reportText = `🤖 *Periskop AI - Gün Sonu Özeti*\n`;
reportText += `📅 *Tarih:* ${dayString}\n\n`;
reportText += `📈 *Günlük İstatistikler:*\n`;
reportText += `📊 Toplam İşlem: ${totalSignalsOfDayLog}\n`;
reportText += `✅ Başarılı: ${totalWins} İşlem\n`;
reportText += `⛔ Stop: ${totalLosses} İşlem\n`;
reportText += `⏳ Açık: ${totalActive} İşlem\n`;
reportText += `🎯 *Başarı Oranı: %${winRate}*\n\n`;

reportText += `_Elyte Signals Otomasyonu ile test için üretilmiştir._`;

telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, reportText, { parse_mode: 'Markdown' })
    .then(() => {
        console.log("Test message sent successfully.");
        process.exit(0);
    })
    .catch(console.error);
