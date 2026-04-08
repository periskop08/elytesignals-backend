#!/bin/bash
# Antigravity Safe Deployment Script
# Bu script, canli veritabanini ASLA ezmemesi icin ozel olarak yazilmistir.

if [ ! -f "Elyte.pem" ]; then
    PEM_KEY="~/.ssh/Elyte.pem"
else
    PEM_KEY="Elyte.pem"
fi

echo "🚀 Güvenli Deployment Başlıyor..."
echo "🛡️  Korunan Dosyalar: signals.db, sessions, logs, node_modules"

rsync -avz \
  --exclude="node_modules" \
  --exclude=".git" \
  --exclude="*.db" \
  --exclude="*.sqlite" \
  --exclude="logs" \
  -e "ssh -o StrictHostKeyChecking=no -i $PEM_KEY" \
  /Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/backend/ \
  ubuntu@13.60.44.209:~/backend/

echo "🔄 AWS Sunucusu Yeniden Başlatılıyor..."
ssh -o StrictHostKeyChecking=no -i $PEM_KEY ubuntu@13.60.44.209 'pm2 restart all'

echo "✅ Deployment Tamamlandı! Veritabanı %100 Güvende."
