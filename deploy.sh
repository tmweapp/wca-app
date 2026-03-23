#!/bin/bash
cd "$(dirname "$0")"
echo "=== WCA App - Deploy su Vercel ==="
echo ""

# Check if vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "Installazione Vercel CLI..."
    npm install -g vercel
fi

# Set environment variables
echo "Configurazione environment variables..."
vercel env rm SUPABASE_URL production -y 2>/dev/null
vercel env rm SUPABASE_SERVICE_KEY production -y 2>/dev/null
echo "https://dlldkrzoxvjxpgkkttxu.supabase.co" | vercel env add SUPABASE_URL production
echo "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsbGRrcnpveHZqeHBna2t0dHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODcyMDU4NCwiZXhwIjoyMDc0Mjk2NTg0fQ.py_d96kA6Mqvi0ugBm4gmIlJSoOC_KbwUM7cgDR-O_E" | vercel env add SUPABASE_SERVICE_KEY production

# Deploy
echo ""
echo "Deploy in corso..."
vercel --prod --yes

echo ""
echo "=== Deploy completato! ==="
echo "Premi un tasto per chiudere..."
read -n 1
