#!/bin/bash
# ELYTE Memory & Backup Agent
# Bu script her saat başı çalışarak Antigravity sohbet geçmişini masaüstüne yedekler
# ve ELYTE_MANIFESTO.md gibi Backend dosyalarında değişiklik varsa GitHub'a mühürler.

LOG_FILE="/tmp/memory_agent.log"
echo "[$(date)] Memory Agent uyanıyor..." >> $LOG_FILE

# 1. Hafıza Senkronizasyonu (Brain loglarını masaüstüne taşıma)
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

echo "[$(date)] Memory Agent uykuya geçti." >> $LOG_FILE
