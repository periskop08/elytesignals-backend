require('dotenv').config({ path: __dirname + '/.env' });
const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const vipGroupId = process.env.TELEGRAM_VIP_GROUP_ID;

async function sendSol() {
    const symbol = 'SOLUSDT';
    const type = 'SHORT';
    const qualityScore = 57;
    const categoryTag = '[KRİPTO]';
    const tierTag = '⚠️ Standart PA Sinyali';
    const flagPart = '\n';
    const blockReason = "Düşük Risk (Küçük Pürüz): İşlem risk barajımızı az farkla geçemedi (Otonom Red).";
    
    const extraNote = `⚠️ *Uyarı:* Bu işlem borsa hesabında AÇILMADI!\nSebep: Arif Bey'in geçmiş öğrenim defteri (Dersler) kontrolü sonucu _${blockReason}_ olarak etiketlendi.\n\n`;

    const msg = `🚨 *Elyte Sinyal Uygulaması Üzerinde '${categoryTag}' Kategorisinde Yeni Bir Sinyal Düştü!*\n\n` +
        `⭐ Kalite Derecesi: *${tierTag}* (Skor: ${qualityScore})\n` +
        `🎯 Yön: *${type}*\n\n` + flagPart + extraNote +
        `_Detaylar ve seviyeler için Elyte aplikasyonuna girebilirsiniz..._ 🔭\n\n` +
        `🔗 Web Platformu:\nhttps://www.elytesignals.com/dashboard`;

    try {
        await bot.sendMessage(vipGroupId, msg, { parse_mode: 'Markdown' });
        console.log("Success");
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
}

sendSol();
