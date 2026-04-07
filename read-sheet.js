require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

async function main() {
    const credentialsPath = path.join(__dirname, 'google-credentials.json');
    if (!fs.existsSync(credentialsPath)) throw new Error('No credentials');
    
    const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Sayfa1!A1:Z1',
        });
        
        console.log(JSON.stringify(response.data.values[0] || [], null, 2));
    } catch (e) {
        console.error("Hata:", e.message);
    }
}
main();
