const { google } = require('googleapis');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

async function getAuthClient() {
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, 'google-credentials.json'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return await auth.getClient();
}

async function updateSpecificVolume() {
    try {
        console.log("1. BingX'ten anlık Ticker verileri çekiliyor...");
        const response = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
        const symbols = response.data.data;
        
        let idolVol = null;
        let irVol = null;

        symbols.forEach(s => {
            if (s.symbol === 'IDOL-USDT') idolVol = parseFloat(s.quoteVolume);
            if (s.symbol === 'IR-USDT') irVol = parseFloat(s.quoteVolume);
        });

        console.log(`Anlık IDOL Hacim: $${idolVol} | IR Hacim: $${irVol}`);

        const idolFormatted = idolVol ? (idolVol / 1000000).toFixed(1) + 'M' : '?';
        const irFormatted = irVol ? (irVol / 1000000).toFixed(1) + 'M' : '?';

        console.log("2. Google E-Tablodaki işlemler aranıyor...");
        const authClient = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        const spreadsheetId = process.env.GOOGLE_SHEETS_INSTANT_ID;

        // B sütununu (Sembol) ve J sütununu (Hacim) okuyalım
        const sheetRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Sayfa1!B:J'
        });

        const rows = sheetRes.data.values;
        if (!rows) return console.log("Tablo boş.");

        let idolRowIndex = -1;
        let irRowIndex = -1;
        let idolExistingRvol = '1.02x';
        let irExistingRvol = '1.04x'; // default fallbacks

        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i][0] === 'IDOLUSDT' && idolRowIndex === -1) {
                idolRowIndex = i + 1;
                if (rows[i][8]) idolExistingRvol = rows[i][8];
            }
            if (rows[i][0] === 'IRUSDT' && irRowIndex === -1) {
                irRowIndex = i + 1;
                if (rows[i][8]) irExistingRvol = rows[i][8];
            }
        }

        if (idolRowIndex !== -1) {
            const finalIdolText = `${idolFormatted} (${idolExistingRvol})`;
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Sayfa1!J${idolRowIndex}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[finalIdolText]] }
            });
            console.log(`IDOLUSDT (Satır ${idolRowIndex}) güncellendi: ${finalIdolText}`);
        }

        if (irRowIndex !== -1) {
            const finalIrText = `${irFormatted} (${irExistingRvol})`;
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Sayfa1!J${irRowIndex}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[finalIrText]] }
            });
            console.log(`IRUSDT (Satır ${irRowIndex}) güncellendi: ${finalIrText}`);
        }

        console.log("✅ Görev tamamlandı!");
    } catch (e) {
        console.error("Hata:", e.response ? e.response.data : e.message);
    }
}

updateSpecificVolume();
