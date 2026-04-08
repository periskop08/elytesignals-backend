const { google } = require('googleapis');
const path = require('path');
require('dotenv').config();
async function main() {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: path.join(__dirname, 'google-credentials.json'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const c = await auth.getClient();
    const s = google.sheets({version: 'v4', auth: c});
    const r = await s.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEETS_INSTANT_ID, range: 'Sayfa1!A1:Z1' });
    console.log("Headers:", JSON.stringify(r.data.values));
  } catch(e) { console.error("Error:", e); }
}
main();
