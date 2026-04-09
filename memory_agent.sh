#!/bin/bash
# ELYTE Memory & Backup Agent
# Bu script her saat başı çalışarak Antigravity sohbet geçmişini masaüstüne yedekler
# ve ELYTE_MANIFESTO.md gibi Backend dosyalarında değişiklik varsa GitHub'a mühürler.

LOG_FILE="/tmp/memory_agent.log"
echo "[$(date)] Memory Agent uyanıyor..." >> $LOG_FILE

# 1. Antigravity Loglarını Sohbet Günlüğüne Süz
echo "Sistem loglarından (overview.txt) konuşmalar günlüğe çıkartılıyor..." >> $LOG_FILE
/Users/periskop/.nvm/versions/node/v20.18.0/bin/node /Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/backend/diary_extractor.js >> $LOG_FILE 2>&1

# 2. Hafıza Senkronizasyonu (Brain klasörü ham kopyası)
echo "Conversational memory senkronize ediliyor..." >> $LOG_FILE
DEST_DIR="/Users/periskop/Desktop/ElyteSignalsBackup/Conversation_Memories"
mkdir -p "$DEST_DIR"
# Antigravity brain klasörünün tam bir yedeği alınır (klasör yapısı korunarak)
cp -r /Users/periskop/.gemini/antigravity/brain/* "$DEST_DIR" 2>>$LOG_FILE

# 2. Github Oto-Hafiza Push Islemi (Manifesto & Core değişiklikleri için)
cd /Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/backend

# Değişiklik var mı diye kontrol et (untracked ve modified dosyalar dahil)
if [[ `git status --porcelain` ]]; then
  echo "Değişiklik tespit edildi. GitHub'a kalıcı hafıza olarak yazılıyor..." >> $LOG_FILE
  git add .
  git commit -m "Auto-Memory Sync & Manifesto Update: $(date)" >> $LOG_FILE
  git push origin main >> $LOG_FILE 2>&1
else
  echo "Değişiklik yok. GitHub push atlandı." >> $LOG_FILE
fi

# 3. Telegram Bildirimi (Yalnızca Saat Başı Atılır)
CURRENT_MINUTE=$(date +%M)
if [ "$CURRENT_MINUTE" == "00" ]; then
    TOKEN="8753605831:AAG2YMLriwZUrNq23O4-9NcbVXHAfuByKKA"
    CHAT_ID="1194576674"
    MESSAGE="🧠 *ELYTE Memory Agent* %0A%0A✅ Tüm sohbet anıları ve sistem kodları Masaüstüne ve Github'a senkronize edildi. Agent aktif!"
    curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
         -F chat_id="${CHAT_ID}" \
         -F text="$(echo -e ${MESSAGE})" \
         -F parse_mode="Markdown" >> $LOG_FILE
fi

echo "[$(date)] Memory Agent uykuya geçti." >> $LOG_FILE
