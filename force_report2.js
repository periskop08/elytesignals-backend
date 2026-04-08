require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const { all } = require('./database.js');

async function sendCustomReport() {
    console.log('[TEST] Generating Custom Report for Today (2026-04-08)...');
    try {
        const dayString = "2026-04-08"; // BUGÜNÜN TARİHİ

        const allSignals = await all("SELECT qualityScore, status, symbol FROM signals WHERE date(createdAt) = ?", [dayString]);
        
        const detailedData = {};
        let totalWins = 0; let totalLosses = 0; let totalActive = 0;

        allSignals.forEach(s => {
            if(!detailedData[s.qualityScore]) detailedData[s.qualityScore] = { WIN:0, LOSS:0, ACTIVE:0 };
            detailedData[s.qualityScore][s.status]++;
            if(s.status === 'WIN') totalWins++;
            if(s.status === 'LOSS') totalLosses++;
            if(s.status === 'ACTIVE') totalActive++;
        });

        let totalClosed = totalWins + totalLosses;
        let winRate = totalClosed > 0 ? ((totalWins / totalClosed) * 100).toFixed(1) : 0;
        let totalSignalsOfDayLog = totalWins + totalLosses + totalActive;

        let reportText = `🤖 *Periskop AI - TEST ÖZETİ (GÜNCEL)*\n`;
        reportText += `📅 *Tarih:* ${dayString}\n\n`;
        reportText += `📈 *Anlık İstatistikler:*\n`;
        reportText += `📊 Toplam İşlem: ${totalSignalsOfDayLog}\n`;
        reportText += `✅ Başarılı: ${totalWins} İşlem\n`;
        reportText += `⛔ Stop: ${totalLosses} İşlem\n`;
        reportText += `⏳ Açık: ${totalActive} İşlem\n`;
        reportText += `🎯 *Başarı Oranı: %${winRate}*\n\n`;

        reportText += `_Bu rapor senin isteğin üzerine test amaçlı 'Bugünün' kayıtlarıyla fırlatılmıştır._\n\n`;

        if (process.env.TELEGRAM_VIP_GROUP_ID) {
            await bot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, reportText, { parse_mode: 'Markdown' });
            console.log('[SCANNER] Sent!');
        }

    } catch (error) {
         console.error('[SCANNER] Error: ', error);
    }
}

sendCustomReport().then(() => setTimeout(() => process.exit(0), 3000));
