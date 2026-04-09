const Jimp = require('jimp');
const path = require('path');

/**
 * Dinamik Telegram PNL Kartı Çizici
 * Gelen sembol, PNL verisi ve kâr oranına göre fotoğraf oluşturur ve Buffer döndürür.
 * Buffer, TelegramBot API tarafından doğrudan sendPhoto ile okunabilir.
 */
async function generatePnlImage(symbol, side, pnlPercentage, netUsdProfit, isWin) {
    try {
        const basePath = path.join(__dirname, 'pnl_base.png');
        const image = await Jimp.read(basePath);
        
        const font64 = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
        const font32 = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
        
        const operator = isWin ? '+' : '';
        const roeRaw = `${operator}${parseFloat(pnlPercentage).toFixed(2)}% ROE`;
        
        let profitRaw = '';
        if (netUsdProfit && !isNaN(netUsdProfit)) {
             profitRaw = `Net PNL: ${operator}$${parseFloat(netUsdProfit).toFixed(2)} USDT`;
        } else {
             profitRaw = isWin ? `TP Hedefine Ulaşıldı` : `Zarar Durduruldu`;
        }

        const symbolStr = symbol.replace('-USDT', '');
        const sideStr = side;

        // Sembol ve Yön En Üst Alan (Y: 340)
        image.print(
            font32,
            0,
            340,
            {
                text: `${symbolStr}   |   ${sideStr}`,
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
            },
            1024
        );

        // Devasa ROE Yüzdesi (Y: 420)
        image.print(
            font64,
            0,
            420,
            {
                text: roeRaw,
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
            },
            1024
        );

        // Alt Detay Yazısı (Y: 510)
        image.print(
            font32,
            0,
            510,
            {
                text: profitRaw,
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
            },
            1024
        );
        
        // Return file buffer for Telegram
        return await image.getBufferAsync(Jimp.MIME_PNG);
    } catch (e) {
        console.error("[PNL GENERATOR] Fotoğraf çizim hatası:", e);
        return null; // Fallback yapabilmek icin null donuyoruz
    }
}

module.exports = { generatePnlImage };
