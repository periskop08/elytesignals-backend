require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

async function main() {
    const credentialsPath = path.join(__dirname, 'google-credentials.json');
    if (!fs.existsSync(credentialsPath)) throw new Error('No credentials');
    
    const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    
    try {
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: 'Sayfa1!A2:Z8000',
        });
        console.log("Tablo Başarıyla Sıfırlandı (A2:Z8000 aralığı).");
    } catch (e) {
        console.error("Hata:", e.message);
    }
}
main();
