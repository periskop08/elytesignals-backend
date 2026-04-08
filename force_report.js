require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const scanner = require('./scanner.js');

async function run() {
    console.log("Forcing 03:00 report...");
    scanner.setBot(bot);
    await scanner.sendNightlyReport();
    console.log("Done.");
    setTimeout(() => process.exit(0), 4000);
}
run();
