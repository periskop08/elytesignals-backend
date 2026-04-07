const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const vipGroupId = process.env.TELEGRAM_VIP_GROUP_ID;

let bot = null;

if (token && token.trim() !== '') {
    // Polling mode for the bot
    bot = new TelegramBot(token, { polling: true });
    console.log("Telegram Auth Bot is listening for deep links...");

    // Dinleyici: `/start {sessionId}`
    bot.onText(/\/start (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const sessionId = match[1]; // UUID from deep link
        const telegramId = msg.from.id.toString();
        const firstName = msg.from.first_name || '';
        const lastName = msg.from.last_name || '';
        const name = `${firstName} ${lastName}`.trim();
        const username = msg.from.username;

        try {
            // Profil resmini al (ilk resmi alıyoruz)
            let photoUrl = 'https://randomuser.me/api/portraits/lego/1.jpg'; // Varsayılan
            try {
                const profiles = await bot.getUserProfilePhotos(telegramId, { limit: 1 });
                if (profiles && profiles.total_count > 0 && profiles.photos[0].length > 0) {
                    const fileId = profiles.photos[0][0].file_id;
                    const file = await bot.getFile(fileId);
                    photoUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
                }
            } catch (pErr) {
                console.log("Profil resmi çekilemedi:", pErr.message);
            }

            // VIP grubunda mı kontrol et
            let isVip = 0;
            if (vipGroupId) {
                try {
                    const member = await bot.getChatMember(vipGroupId, telegramId);
                    if (['member', 'administrator', 'creator'].includes(member.status)) {
                        isVip = 1;
                    }
                } catch (cErr) {
                    console.log("VIP kontrolü başarısız (Bot grupta admin değil veya grup ID yanlış):", cErr.message);
                }
            }

            // Session'ı DBA'e kaydet (güncelle)
            const exists = await db.get("SELECT * FROM sessions WHERE sessionId = ?", [sessionId]);
            if (exists) {
                await db.run(
                    "UPDATE sessions SET telegramId = ?, name = ?, photo = ?, isVip = ?, isAuthenticated = 1 WHERE sessionId = ?",
                    [telegramId, name || username || 'Telegram User', photoUrl, isVip, sessionId]
                );
                bot.sendMessage(chatId, `🎉 Hoş geldin ${name}! Elyte Signals uygulamasına başarıyla bağlandın. Şimdi uygulamaya dönebilirsin.`);
            } else {
                bot.sendMessage(chatId, "❌ Oturum geçersiz veya zaman aşımına uğramış. Lütfen mobil uygulamayı yeniden başlatıp tekrar bağlanmayı dene.");
            }
        } catch (err) {
            console.error("Bot handler error:", err);
            bot.sendMessage(chatId, "Kritik bir hata oluştu.");
        }
    });

} else {
    console.log("TELEGRAM_BOT_TOKEN eksik. Auth Bot devre dışı bırakıldı. (Gerçek çalışma için .env dosyasına token girmelisiniz)");
}

// REST Endpoints
// 1. Session oluştur
router.get('/session', async (req, res) => {
    try {
        const sessionId = uuidv4();
        await db.run(
            "INSERT INTO sessions (sessionId, isAuthenticated) VALUES (?, 0)",
            [sessionId]
        );
        res.json({ sessionId });
    } catch (e) {
        res.status(500).json({ error: 'Session creation failed' });
    }
});

// 2. Session durumunu kontrol et (Mobil uygulama poll yapacak)
router.get('/session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = await db.get("SELECT * FROM sessions WHERE sessionId = ?", [sessionId]);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        session.isAdmin = process.env.ADMIN_TELEGRAM_ID && session.telegramId && session.telegramId.toString() === process.env.ADMIN_TELEGRAM_ID.toString();
        res.json({ session });
    } catch (e) {
        res.status(500).json({ error: 'Session check failed' });
    }
});

// 3. VIP durumunu bot ile yeniden zorla güncelle (ör: HomeScreen açıldığında)
router.get('/vip-status/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        let isVip = 0;
        
        if (bot && vipGroupId) {
            try {
                const member = await bot.getChatMember(vipGroupId, telegramId);
                if (['member', 'administrator', 'creator'].includes(member.status)) {
                    isVip = 1;
                }
            } catch (cErr) {
                // Ignore API error for 400 user not found, logic implies isVip = 0
            }
            
            // Veritabanını güncelle
            await db.run("UPDATE sessions SET isVip = ? WHERE telegramId = ?", [isVip, telegramId]);
        }
        
        res.json({ isVip });
    } catch (e) {
        res.status(500).json({ error: 'VIP check failed' });
    }
});

module.exports = router;
