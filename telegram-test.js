require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { generatePnlImage } = require('./pnl-generator');

async function testTelegram() {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_VIP_GROUP_ID) {
        return console.log("Missing Telegram env vars.");
    }
    const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
    
    console.log("Resim ciziliyor...");
    const imageBuffer = await generatePnlImage('BTC-USDT', 'LONG 10X', 240.50, 12450.50, true);
    
    if (imageBuffer) {
        console.log("Resim bitti, Telegram'a firlatiliyor...");
        const msg = `🛡️ *KORUMA DEVREDE! (TEST)* [BTC-USDT]\nİşlem İlk Kâr Hedefine (1R) ulaştı. Zarar Etme Riski Sıfırlandı!`;
        
        await bot.sendPhoto(process.env.TELEGRAM_VIP_GROUP_ID, imageBuffer, {
            caption: msg,
            parse_mode: 'Markdown'
        });
        console.log("Telegrama basariyla iletildi!");
    } else {
        console.log("Resim cizilemedi, buffer bos!");
    }
}

testTelegram();
