/**
 * TrainConnect Europe – PostgreSQL Migration
 * Verwendung: DATABASE_URL=postgresql://... node setup/migrate.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const fs       = require('fs');
const path     = require('path');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL nicht gesetzt. Bitte .env Datei erstellen.');
  console.error('   Vorlage: .env.example');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔗 Verbinde mit PostgreSQL...');
    await client.query('SELECT 1');
    console.log('✅ Verbindung OK\n');

    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    console.log('📋 Führe schema.sql aus...');
    await client.query(sql);
    console.log('✅ Schema erstellt / aktualisiert\n');

    // Optional: JSON-Daten migrieren
    const dbPath = path.join(__dirname, '../data/db.json');
    if (fs.existsSync(dbPath)) {
      const { users, tickets, pricealerts } = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

      if (users?.length) {
        console.log(`📦 Migriere ${users.length} User(s)...`);
        for (const u of users) {
          await client.query(
            `INSERT INTO users (id, email, password_hash, name, role, loyalty_points, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
            [u.id, u.email, u.passwordHash, u.name, u.role, u.loyaltyPoints || 0, u.createdAt]
          );
        }
        console.log('✅ User migriert');
      }

      if (tickets?.length) {
        console.log(`📦 Migriere ${tickets.length} Ticket(s)...`);
        for (const t of tickets) {
          await client.query(
            `INSERT INTO tickets
               (id, ticket_code, user_id, from_station, from_id, to_station, to_id,
                departure_time, arrival_time, train_number, operator, seat_class, passengers,
                price, currency, status, payment_method, payment_id, changes, duration,
                amenities, price_breakdown, tracking_events, seat_number,
                cancelled_at, refund_amount, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
             ON CONFLICT (id) DO NOTHING`,
            [
              t.id, t.ticketCode, t.userId,
              t.fromStation, t.fromId, t.toStation, t.toId,
              t.departureTime, t.arrivalTime, t.trainNumber, t.operator,
              t.seatClass, t.passengers, t.price, t.currency || 'EUR', t.status,
              t.paymentMethod, t.paymentId,
              t.changes, t.duration,
              JSON.stringify(t.amenities || []),
              t.priceBreakdown ? JSON.stringify(t.priceBreakdown) : null,
              JSON.stringify(t.trackingEvents || []),
              t.seatNumber,
              t.cancelledAt || null, t.refundAmount || null,
              t.createdAt
            ]
          );
        }
        console.log('✅ Tickets migriert');
      }

      if (pricealerts?.length) {
        console.log(`📦 Migriere ${pricealerts.length} Preisalert(s)...`);
        for (const a of pricealerts) {
          await client.query(
            `INSERT INTO price_alerts (id, user_id, from_id, to_id, from_name, to_name, target_price, active, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
            [a.id, a.userId, a.fromId, a.toId, a.fromName, a.toName, a.targetPrice, a.active, a.createdAt]
          );
        }
        console.log('✅ Preisalerts migriert');
      }
    }

    console.log('\n🎉 Migration abgeschlossen!');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('❌ Migration fehlgeschlagen:', err.message);
  process.exit(1);
});
