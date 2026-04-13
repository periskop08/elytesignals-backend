require('dotenv').config();
const { generateStrategyReport } = require('./ekin_bey');
const { sendDailyNewsReport } = require('./news_agent');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const dbPath = path.resolve(__dirname, 'signals.db');
const db = new sqlite3.Database(dbPath);

const { TELEGRAM_BOT_TOKEN_ADMIN, TELEGRAM_ADMIN_CHAT_ID } = process.env;
const bot = TELEGRAM_BOT_TOKEN_ADMIN ? new TelegramBot(TELEGRAM_BOT_TOKEN_ADMIN, { polling: false }) : null;

function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Börü Bey manuel tetikleme
async function triggerBoruBey() {
    try {
        const row = await runQuery(`SELECT count(id) as cnt FROM user_trades WHERE status = 'CLOSED' AND pnl < 0 AND datetime(closedAt) > datetime('now', '-24 hours')`);
        let lostCount = (row && row.length > 0) ? row[0].cnt : 0;
        let totalAutopsy = lostCount;
        let msg = `🐺 *Merhaba ben Börü Bey; Görevimin başındayım.*\n\nBugün portföyümüzdeki işlemleri saniye saniye takip ederek, stop olan *${totalAutopsy}* adet işlemi incelenmesi için Arif Bey'e (Otopsi) sevk ettim.\n\nElden anlık rapor istendiği için bildiriyorum: Nöbete devam ediyorum, iyi akşamlar.`;
        if (bot && TELEGRAM_ADMIN_CHAT_ID) {
            await bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID, msg, { parse_mode: 'Markdown' });
            console.log("Börü Bey mesajı iletildi.");
        }
    } catch(e) { console.error(e); }
}

async function triggerArifBey() {
    try {
        const sql = `SELECT u.* FROM user_trades u LEFT JOIN ai_lessons a ON u.id = a.tradeId WHERE u.status = 'CLOSED' AND u.pnl < 0 AND a.id IS NULL ORDER BY u.id DESC LIMIT 5;`;
        const pendingLosses = await runQuery(sql);
        if (pendingLosses.length === 0) {
            if (bot && process.env.ADMIN_TELEGRAM_ID) {
                await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, "👨🏻‍💼 *Merhaba ben Arif, görevimin başındayım;*\n\nŞu an elden rapor istediğiniz için tarama yaptım. Bugün stop olmamışız, kalkanlarımız sağlam! Vardiyaya devam ediyorum...", { parse_mode: 'Markdown' });
            }
        } else {
             if (bot && process.env.ADMIN_TELEGRAM_ID) {
                 await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, `👨🏻‍💼 *Merhaba ben Arif, görevimin başındayım;*\n\nŞu an elden rapor istediğiniz için bekleyen ${pendingLosses.length} adet zararlı işlemi otopsiye alıyorum. Asıl rapor gece gelecektir.`, { parse_mode: 'Markdown' });
             }
        }
    } catch(e) { console.error(e); }
}

async function startAll() {
    console.log("Hamdi Bey Tetikleniyor...");
    try { await sendDailyNewsReport(); } catch(e) {}
    
    console.log("Ekin Bey Tetikleniyor...");
    try { await generateStrategyReport(); } catch(e) {}
    
    console.log("Börü Bey Tetikleniyor...");
    await triggerBoruBey();
    
    console.log("Arif Bey Tetikleniyor...");
    await triggerArifBey();
    
    setTimeout(() => {
        process.exit(0);
    }, 15000); // 15 saniye bekle ve çık
}

startAll();
