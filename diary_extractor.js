const fs = require('fs');
const path = require('path');

const BRAIN_DIR = '/Users/periskop/.gemini/antigravity/brain/';
const DIARY_PATH = '/Users/periskop/Desktop/ElyteSignalsBackup/ELYTE_SOHBET_GUNLUGU.md';

function extractLogs() {
    try {
        if (!fs.existsSync('/Users/periskop/Desktop/ElyteSignalsBackup')) {
            fs.mkdirSync('/Users/periskop/Desktop/ElyteSignalsBackup', { recursive: true });
        }

        let totalConversations = 0;
        let allContent = "# 🧠 ELYTE ANTIGRAVITY SOHBET GÜNLÜĞÜ\n\nBu dosya Memory Agent tarafından sistem loglarından otomatik süzülmüştür.\n\n---\n\n";

        const folders = fs.readdirSync(BRAIN_DIR);
        
        for (const folder of folders) {
            const overviewPath = path.join(BRAIN_DIR, folder, '.system_generated', 'logs', 'overview.txt');
            
            if (fs.existsSync(overviewPath)) {
                totalConversations++;
                const content = fs.readFileSync(overviewPath, 'utf8');
                
                allContent += `## GÖRÜŞME ID: ${folder}\n\n`;
                allContent += "```text\n";
                allContent += content;
                allContent += "\n```\n\n---\n\n";
            }
        }
        
        fs.writeFileSync(DIARY_PATH, allContent);
        console.log(`[Diary Extractor] Başarılı! ${totalConversations} adet görüşme logu ELYTE_SOHBET_GUNLUGU.md dosyasına yazdırıldı.`);
    } catch (e) {
        console.error('[Diary Extractor] Hata:', e);
    }
}

extractLogs();
