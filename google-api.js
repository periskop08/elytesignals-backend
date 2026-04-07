const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

/**
 * Google Sheets Servis Kimlik Doğrulaması (Service Account)
 */
async function getAuthClient() {
    const credentialsPath = path.join(__dirname, 'google-credentials.json');
    if (!fs.existsSync(credentialsPath)) {
        throw new Error('google-credentials.json dosyası bulunamadı. Lütfen GCP üzerinden indirip backend klasörüne ekleyin.');
    }
    
    // Yalnızca Sheets API kapsamını (scope) talep ediyoruz
    const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    return await auth.getClient();
}

/**
 * Google Sheet'e yeni bir veya birden fazla satır ekler
 * @param {Array<string|number> | Array<Array<string|number>>} data - Örn: ['2026-04-01', 5, 2] veya [['2026-04-01'], ['2026-04-02']]
 * @param {string} tableType - 'INSTANT' (Sinyal İstatistik) veya 'REPORT' (Gece Raporu)
 */
async function appendToSheet(data, tableType = 'INSTANT') {
    try {
        const authClient = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        const spreadsheetId = tableType === 'REPORT' ? process.env.GOOGLE_SHEETS_REPORT_ID : process.env.GOOGLE_SHEETS_INSTANT_ID;
        if (!spreadsheetId) {
            console.log(`[GOOGLE SHEETS] GOOGLE_SHEETS_${tableType}_ID bulunamadı.`);
            return;
        }

        // Genellikle varsayılan sekmenin adı "Sayfa1" veya İngilizce oluşturulduysa "Sheet1" olur.
        // A sütunundan E sütununa kadar (Tarih, WIN, LOSS, ACTIVE, Win Rate vb.) ekleme yapıyoruz
        const range = 'Sayfa1!A1:E1'; // Append için range "Sayfa1" diyebiliriz, API onu ilk boş satıra koyar

        // Veri 2 boyutlu array ise (bulk insert), değilse (tek satır) [data] yapıyoruz
        const isBulk = Array.isArray(data) && Array.isArray(data[0]);

        const request = {
            spreadsheetId,
            range: 'Sayfa1', // Yalnızca sayfa ismini vermek otomatik appending için uygundur
            valueInputOption: 'USER_ENTERED', // Formülleri vs. düzgün parse etmesi için
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: isBulk ? data : [data],
            },
        };

        const response = await sheets.spreadsheets.values.append(request);
        console.log(`[GOOGLE SHEETS] 1 Satır eklendi. (Range: ${response.data.updates.updatedRange})`);
        return true;
    } catch (error) {
        console.error('[GOOGLE SHEETS ERROR] Veri eklenemedı:', error.message);
        return false;
    }
}

/**
 * Google Sheet'te belirli bir ID'ye sahip satırın "Durum" sütununu (G sütunu) günceller.
 * Sinyal ID'lerinin I sütununda olduğu varsayılır.
 */
async function updateSheetSignalStatus(targetSignalId, newStatus) {
    try {
        const authClient = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        const spreadsheetId = process.env.GOOGLE_SHEETS_INSTANT_ID;
        if (!spreadsheetId) return false;

        // 1. Önce I sütununu (ID'leri) oku
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Sayfa1!I:I' // I Sütunu
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) return false;

        let targetRowIndex = -1;
        for (let i = 0; i < rows.length; i++) {
            if (rows[i][0] && rows[i][0].toString() === targetSignalId.toString()) {
                targetRowIndex = i + 1; // 1-index based
                break;
            }
        }

        if (targetRowIndex !== -1) {
            // 2. Satırı bulduk, o satırın G sütununu (Durum) güncelle
            const updateRange = `Sayfa1!G${targetRowIndex}`;
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: updateRange,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[newStatus]]
                }
            });
            console.log(`[GOOGLE SHEETS] Sinyal ID: ${targetSignalId} durumu '${newStatus}' yapıldı. (Satır: ${targetRowIndex})`);
            return true;
        } else {
            console.log(`[GOOGLE SHEETS] Sinyal ID: ${targetSignalId} tablodan bulunamadı.`);
            return false;
        }

    } catch (error) {
        console.error('[GOOGLE SHEETS ERROR] Durum güncellenemedi:', error.message);
        return false;
    }
}

module.exports = {
    appendToSheet,
    updateSheetSignalStatus
};
