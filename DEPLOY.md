# TrainConnect Deployment Guide

## Aktuelles Hosting
- Frontend: https://ppas0.github.io/trainconnect-live/ (GitHub Pages, kostenlos, 24/7)
- Backend: https://trainconnect-backend.onrender.com (Render Free, schläft nach 15min)

## Problem: Render Free Tier schläft
GitHub Actions Keep-Alive pingt alle 14min → Backend schläft nicht mehr.
Datei: .github/workflows/keep-alive.yml

## Alternative: Koyeb (kostenlos, kein Sleep, Frankfurt)
1. Account erstellen: koyeb.com
2. Neues App → GitHub Repo ppas0/trainconnect-backend
3. Region: Frankfurt (fra)
4. Environment Variables eintragen (Stripe, JWT, DB)
5. Deploy klicken

## Stripe Live-Zahlung aktivieren
STRIPE_SECRET_KEY muss sk_live_... sein (nicht rk_live_!).
Aktuell bei Render: rk_live_... (falsch) → Zahlungen schlagen fehl.

Lösung: Stripe Dashboard → Developers → API Keys → Create restricted key (alle Permissions Write)
→ Render Environment → STRIPE_SECRET_KEY = sk_live_...

## PostgreSQL (Neon, kostenlos)
Ohne DATABASE_URL gehen alle Daten beim Neustart verloren!
1. neon.tech → Neues Projekt
2. Connection String kopieren
3. Bei Render/Koyeb als DATABASE_URL eintragen
