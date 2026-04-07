require('dotenv').config();
const db = require('./database');
const { appendToSheet } = require('./google-api');

async function backfillSheets() {
    console.log('[BACKFILL] Veritabanındaki geçmiş veriler E-Tabloya aktarılıyor...');
    try {
        // En eskiden en yeniye tüm benzersiz tarihleri al
        const dates = await db.all("SELECT DISTINCT date(createdAt) as dateStr FROM signals WHERE dateStr IS NOT NULL ORDER BY dateStr ASC");
        
        if (!dates || dates.length === 0) {
            console.log('[BACKFILL] Aktarılacak geçmiş veri bulunamadı.');
            return;
        }

        console.log(`[BACKFILL] Toplam ${dates.length} farklı gün tespit edildi. Satır satır ekleniyor...`);

        // Sütun başlıklarını artık biz göndermiyoruz (Kullanıcı Sayfa1'de başlıklarını kendi ayarladı).
        
        for (const row of dates) {
            const dayString = row.dateStr;
            const signalsForDay = await db.all("SELECT qualityScore, status, symbol FROM signals WHERE date(createdAt) = ?", [dayString]);
            
            let detailedData = {};
            let totalWins = 0; let totalLosses = 0; let totalActive = 0;

            signalsForDay.forEach(s => {
                if(!detailedData[s.qualityScore]) detailedData[s.qualityScore] = { WIN:0, LOSS:0, ACTIVE:0 };
                detailedData[s.qualityScore][s.status]++;
                if(s.status === 'WIN') totalWins++;
                if(s.status === 'LOSS') totalLosses++;
                if(s.status === 'ACTIVE') totalActive++;
            });

            let totalClosed = totalWins + totalLosses;
            let winRateStr = totalClosed > 0 ? ((totalWins / totalClosed) * 100).toFixed(1) + '%' : '-';
            let totalSignalsOfDay = totalWins + totalLosses + totalActive;

            const ALL_SCORES = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
            const rowsToInsert = [];

            for(let i=0; i < ALL_SCORES.length; i++) {
                let score = ALL_SCORES[i];
                let data = detailedData[score] || { WIN: 0, LOSS: 0, ACTIVE: 0 };
                let scoreTotal = data.WIN + data.LOSS + data.ACTIVE;
                let closed = data.WIN + data.LOSS;
                let wr = closed > 0 ? ((data.WIN / closed) * 100).toFixed(1) + '%' : '-';
                
                if (i === 0) {
                    rowsToInsert.push([
                        score,                 // Skor Puanı
                        scoreTotal,            // Sinyal Sayısı
                        data.WIN,              // TP
                        data.LOSS,             // SL
                        wr,                    // WR
                        totalSignalsOfDay,     // Toplam Sinyal Sayısı
                        dayString,             // Tarih
                        winRateStr             // Günlük Toplam WR
                    ]);
                } else {
                    rowsToInsert.push([
                        score,                 // Skor Puanı
                        scoreTotal,            // Sinyal Sayısı
                        data.WIN,              // TP
                        data.LOSS,             // SL
                        wr,                    // WR
                        "",                    // Toplam Sinyal Sayısı (Boş)
                        "",                    // Tarih (Boş)
                        ""                     // Günlük Toplam WR (Boş)
                    ]);
                }
            }

            const success = await appendToSheet(rowsToInsert);
            if (success) {
                console.log(`[BACKFILL SUCCESS] ${dayString} tarihi için veriler başarıyla eklendi!`);
            } else {
                console.log(`[BACKFILL ERROR] ${dayString} tarihi için veri ekleme başarısız.`);
            }
            
            // API rate limitlerine takılmamak için 1 saniye bekle
            await new Promise(res => setTimeout(res, 1000));
        }

        console.log('[BACKFILL] Tüm geçmiş veriler Google E-Tabloya aktarıldı! İşlem tamam.');
        process.exit(0);
    } catch (e) {
        console.error('[BACKFILL ERROR] Beklenmeyen hata:', e);
        process.exit(1);
    }
}

backfillSheets();
