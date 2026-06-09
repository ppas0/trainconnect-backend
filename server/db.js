/**
 * TrainConnect Europe v2.0 – Datenbank-Schicht
 * PostgreSQL (wenn DATABASE_URL gesetzt) oder JSON-Fallback für lokale Entwicklung
 * ALLE Funktionen sind async / geben Promises zurück.
 */
const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ── DB-Verbindung ─────────────────────────────────────────────────────────────
const USE_POSTGRES = !!process.env.DATABASE_URL;
let pool = null;

if (USE_POSTGRES) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // für Render / Supabase / Railway nötig
    max: 10,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (err) => console.error('[DB] Pool error:', err.message));
  console.log('[DB] PostgreSQL-Modus aktiv');
} else {
  console.log('[DB] JSON-Fallback-Modus (keine DATABASE_URL)');
}

// ── JSON-Hilfsfunktionen ──────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, '../data/db.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const init = { users:[], tickets:[], pricealerts:[], errors:[], meta:{ version:'2.0', created: new Date().toISOString() } };
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2));
    return init;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

let _writeLock = Promise.resolve();
function withLock(fn) { return (_writeLock = _writeLock.then(fn).catch(fn)); }

// ── USERS ─────────────────────────────────────────────────────────────────────
const users = {
  async findByEmail(email) {
    if (USE_POSTGRES) {
      const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
      return rows[0] || null;
    }
    return loadDB().users.find(u => u.email === email.toLowerCase()) || null;
  },

  async findById(id) {
    if (USE_POSTGRES) {
      const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
      return rows[0] || null;
    }
    return loadDB().users.find(u => u.id === id) || null;
  },

  async create(data) {
    if (USE_POSTGRES) {
      const id = uuidv4();
      const { rows } = await pool.query(
        `INSERT INTO users (id, email, password_hash, name, role, loyalty_points, created_at)
         VALUES ($1,$2,$3,$4,$5,0,NOW())
         RETURNING *`,
        [id, data.email.toLowerCase(), data.passwordHash, data.name, data.role || 'user']
      );
      return pgUserToObj(rows[0]);
    }
    const db = loadDB();
    const user = {
      id: uuidv4(), email: data.email.toLowerCase(), passwordHash: data.passwordHash,
      name: data.name, role: data.role || 'user', createdAt: new Date().toISOString(),
      loyaltyPoints: 0, passwordResetToken: null, passwordResetExpiry: null
    };
    db.users.push(user); saveDB(db); return user;
  },

  async update(id, patch) {
    if (USE_POSTGRES) {
      const sets = [];
      const vals = [];
      let i = 1;
      if (patch.name          !== undefined) { sets.push(`name=$${i++}`);           vals.push(patch.name); }
      if (patch.passwordHash  !== undefined) { sets.push(`password_hash=$${i++}`);  vals.push(patch.passwordHash); }
      if (patch.role          !== undefined) { sets.push(`role=$${i++}`);            vals.push(patch.role); }
      if (patch.passwordResetToken  !== undefined) { sets.push(`password_reset_token=$${i++}`);  vals.push(patch.passwordResetToken); }
      if (patch.passwordResetExpiry !== undefined) { sets.push(`password_reset_expiry=$${i++}`); vals.push(patch.passwordResetExpiry); }
      if (sets.length === 0) return users.findById(id);
      vals.push(id);
      const { rows } = await pool.query(`UPDATE users SET ${sets.join(',')} WHERE id=$${i} RETURNING *`, vals);
      return rows[0] ? pgUserToObj(rows[0]) : null;
    }
    const db = loadDB();
    const u = db.users.find(u => u.id === id);
    if (u) { Object.assign(u, patch); saveDB(db); }
    return u;
  },

  async updatePoints(id, delta) {
    if (USE_POSTGRES) {
      await pool.query(
        'UPDATE users SET loyalty_points = GREATEST(0, loyalty_points + $1) WHERE id=$2',
        [delta, id]
      );
      return;
    }
    return withLock(() => {
      const db = loadDB();
      const u = db.users.find(u => u.id === id);
      if (u) { u.loyaltyPoints = Math.max(0, (u.loyaltyPoints || 0) + delta); saveDB(db); }
    });
  },

  async count() {
    if (USE_POSTGRES) {
      const { rows } = await pool.query('SELECT COUNT(*) AS n FROM users');
      return parseInt(rows[0].n);
    }
    return loadDB().users.length;
  },

  async all() {
    if (USE_POSTGRES) {
      const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
      return rows.map(pgUserToObj);
    }
    return loadDB().users;
  }
};

// ── TICKETS ───────────────────────────────────────────────────────────────────
const tickets = {
  async create(data) {
    if (USE_POSTGRES) {
      const id         = uuidv4();
      const ticketCode = 'TC-' + Math.random().toString(36).toUpperCase().slice(2, 9);
      const { rows } = await pool.query(
        `INSERT INTO tickets
           (id, ticket_code, user_id, from_station, from_id, to_station, to_id,
            departure_time, arrival_time, train_number, operator, seat_class, passengers,
            price, currency, status, payment_method, payment_id, changes, duration,
            amenities, price_breakdown, seat_number, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'EUR','confirmed',
                 $15,$16,$17,$18,$19,$20,$21,NOW())
         RETURNING *`,
        [
          id, ticketCode, data.userId,
          data.fromStation, data.fromId, data.toStation, data.toId,
          data.departureTime, data.arrivalTime, data.trainNumber, data.operator,
          data.seatClass || '2', data.passengers || 1,
          data.price,
          data.paymentMethod, data.paymentId || null,
          data.changes || 0, data.duration || '',
          JSON.stringify(data.amenities || []),
          data.priceBreakdown ? JSON.stringify(data.priceBreakdown) : null,
          data.seatNumber || null,
        ]
      );
      return pgTicketToObj(rows[0]);
    }
    const db = loadDB();
    const ticket = {
      id: uuidv4(),
      ticketCode: 'TC-' + Math.random().toString(36).toUpperCase().slice(2, 9),
      userId: data.userId, fromStation: data.fromStation, fromId: data.fromId,
      toStation: data.toStation, toId: data.toId,
      departureTime: data.departureTime, arrivalTime: data.arrivalTime,
      trainNumber: data.trainNumber, operator: data.operator,
      seatClass: data.seatClass || '2', passengers: data.passengers || 1,
      price: data.price, currency: 'EUR', status: 'confirmed',
      paymentMethod: data.paymentMethod, paymentId: data.paymentId || null,
      changes: data.changes || 0, duration: data.duration || '',
      amenities: data.amenities || [], priceBreakdown: data.priceBreakdown || null,
      trackingEvents: [], createdAt: new Date().toISOString(),
      cancelledAt: null, refundAmount: null, seatNumber: data.seatNumber || null
    };
    db.tickets.push(ticket); saveDB(db); return ticket;
  },

  async findByUser(userId) {
    if (USE_POSTGRES) {
      const { rows } = await pool.query(
        'SELECT * FROM tickets WHERE user_id=$1 ORDER BY created_at DESC', [userId]
      );
      return rows.map(pgTicketToObj);
    }
    return loadDB().tickets
      .filter(t => t.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async findById(id) {
    if (USE_POSTGRES) {
      const { rows } = await pool.query('SELECT * FROM tickets WHERE id=$1', [id]);
      return rows[0] ? pgTicketToObj(rows[0]) : null;
    }
    return loadDB().tickets.find(t => t.id === id) || null;
  },

  async cancel(id, refundAmount) {
    if (USE_POSTGRES) {
      const { rows } = await pool.query(
        `UPDATE tickets SET status='cancelled', cancelled_at=NOW(), refund_amount=$1
         WHERE id=$2 RETURNING *`,
        [refundAmount, id]
      );
      return rows[0] ? pgTicketToObj(rows[0]) : null;
    }
    const db = loadDB();
    const t = db.tickets.find(t => t.id === id);
    if (t) { t.status = 'cancelled'; t.cancelledAt = new Date().toISOString(); t.refundAmount = refundAmount; saveDB(db); }
    return t;
  },

  async addTracking(id, event) {
    if (USE_POSTGRES) {
      await pool.query(
        `UPDATE tickets
         SET tracking_events = tracking_events || $1::jsonb
         WHERE id=$2`,
        [JSON.stringify([{ ...event, ts: new Date().toISOString() }]), id]
      );
      return;
    }
    const db = loadDB();
    const t = db.tickets.find(t => t.id === id);
    if (t) { t.trackingEvents = t.trackingEvents || []; t.trackingEvents.push({ ...event, ts: new Date().toISOString() }); saveDB(db); }
  },

  async count() {
    if (USE_POSTGRES) {
      const { rows } = await pool.query('SELECT COUNT(*) AS n FROM tickets');
      return parseInt(rows[0].n);
    }
    return loadDB().tickets.length;
  },

  async revenue() {
    if (USE_POSTGRES) {
      const { rows } = await pool.query("SELECT COALESCE(SUM(price),0) AS r FROM tickets WHERE status!='cancelled'");
      return parseFloat(rows[0].r);
    }
    return loadDB().tickets.filter(t => t.status !== 'cancelled').reduce((s, t) => s + (t.price || 0), 0);
  },

  async all() {
    if (USE_POSTGRES) {
      const { rows } = await pool.query('SELECT * FROM tickets ORDER BY created_at DESC');
      return rows.map(pgTicketToObj);
    }
    return loadDB().tickets;
  },

  async recentSales(n = 10) {
    if (USE_POSTGRES) {
      const { rows } = await pool.query('SELECT * FROM tickets ORDER BY created_at DESC LIMIT $1', [n]);
      return rows.map(pgTicketToObj);
    }
    return loadDB().tickets
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, n);
  }
};

// ── PRICE ALERTS ──────────────────────────────────────────────────────────────
const priceAlerts = {
  async create(data) {
    if (USE_POSTGRES) {
      const id = uuidv4();
      const { rows } = await pool.query(
        `INSERT INTO price_alerts (id, user_id, from_id, to_id, from_name, to_name, target_price, active, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,NOW()) RETURNING *`,
        [id, data.userId, data.fromId, data.toId, data.fromName, data.toName, data.targetPrice]
      );
      return pgAlertToObj(rows[0]);
    }
    const db = loadDB();
    const alert = {
      id: uuidv4(), userId: data.userId, fromId: data.fromId, toId: data.toId,
      fromName: data.fromName, toName: data.toName, targetPrice: data.targetPrice,
      active: true, createdAt: new Date().toISOString(), triggeredAt: null
    };
    db.pricealerts = db.pricealerts || []; db.pricealerts.push(alert); saveDB(db); return alert;
  },

  async findByUser(userId) {
    if (USE_POSTGRES) {
      const { rows } = await pool.query('SELECT * FROM price_alerts WHERE user_id=$1', [userId]);
      return rows.map(pgAlertToObj);
    }
    return (loadDB().pricealerts || []).filter(a => a.userId === userId);
  },

  async delete(id) {
    if (USE_POSTGRES) {
      await pool.query('DELETE FROM price_alerts WHERE id=$1', [id]);
      return;
    }
    const db = loadDB();
    db.pricealerts = (db.pricealerts || []).filter(a => a.id !== id);
    saveDB(db);
  }
};

// ── ERRORS ────────────────────────────────────────────────────────────────────
const errors = {
  async log(data) {
    if (USE_POSTGRES) {
      await pool.query(
        'INSERT INTO error_logs (id, type, message, context, created_at) VALUES ($1,$2,$3,$4,NOW())',
        [uuidv4(), data.type || 'unknown', data.message || '', JSON.stringify(data)]
      ).catch(() => {}); // don't crash on log failure
      return;
    }
    const db = loadDB();
    db.errors.push({ id: uuidv4(), ...data, timestamp: new Date().toISOString() });
    if (db.errors.length > 200) db.errors = db.errors.slice(-200);
    saveDB(db);
  },

  async recent(n = 30) {
    if (USE_POSTGRES) {
      const { rows } = await pool.query('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT $1', [n]);
      return rows.map(r => ({ id: r.id, type: r.type, message: r.message, timestamp: r.created_at }));
    }
    return loadDB().errors.slice(-n).reverse();
  }
};

// ── PG Row → JS Object Mapper ─────────────────────────────────────────────────
function pgUserToObj(r) {
  if (!r) return null;
  return {
    id: r.id, email: r.email, passwordHash: r.password_hash,
    name: r.name, role: r.role, loyaltyPoints: r.loyalty_points,
    createdAt: r.created_at, passwordResetToken: r.password_reset_token,
    passwordResetExpiry: r.password_reset_expiry,
  };
}

function pgTicketToObj(r) {
  if (!r) return null;
  return {
    id: r.id, ticketCode: r.ticket_code, userId: r.user_id,
    fromStation: r.from_station, fromId: r.from_id,
    toStation: r.to_station, toId: r.to_id,
    departureTime: r.departure_time, arrivalTime: r.arrival_time,
    trainNumber: r.train_number, operator: r.operator,
    seatClass: r.seat_class, passengers: r.passengers,
    price: parseFloat(r.price), currency: r.currency,
    status: r.status, paymentMethod: r.payment_method,
    paymentId: r.payment_id, changes: r.changes,
    duration: r.duration,
    amenities: r.amenities || [],
    priceBreakdown: r.price_breakdown || null,
    trackingEvents: r.tracking_events || [],
    createdAt: r.created_at, cancelledAt: r.cancelled_at,
    refundAmount: r.refund_amount ? parseFloat(r.refund_amount) : null,
    seatNumber: r.seat_number,
  };
}

function pgAlertToObj(r) {
  if (!r) return null;
  return {
    id: r.id, userId: r.user_id, fromId: r.from_id, toId: r.to_id,
    fromName: r.from_name, toName: r.to_name,
    targetPrice: parseFloat(r.target_price),
    active: r.active, createdAt: r.created_at, triggeredAt: r.triggered_at,
  };
}

// ── STATIONS (immer in-memory) ────────────────────────────────────────────────
const STATIONS = [
  // Deutschland
  { id:'BER', name:'Berlin Hbf',          city:'Berlin',       country:'DE', lat:52.5251, lon:13.3694 },
  { id:'MUC', name:'München Hbf',         city:'München',      country:'DE', lat:48.1402, lon:11.5602 },
  { id:'HAM', name:'Hamburg Hbf',         city:'Hamburg',      country:'DE', lat:53.5530, lon:10.0061 },
  { id:'FRA', name:'Frankfurt Hbf',       city:'Frankfurt',    country:'DE', lat:50.1072, lon:8.6637  },
  { id:'KOL', name:'Köln Hbf',            city:'Köln',         country:'DE', lat:50.9430, lon:6.9590  },
  { id:'STU', name:'Stuttgart Hbf',       city:'Stuttgart',    country:'DE', lat:48.7840, lon:9.1827  },
  { id:'DUS', name:'Düsseldorf Hbf',      city:'Düsseldorf',   country:'DE', lat:51.2199, lon:6.7942  },
  { id:'DOR', name:'Dortmund Hbf',        city:'Dortmund',     country:'DE', lat:51.5178, lon:7.4593  },
  { id:'NUR', name:'Nürnberg Hbf',        city:'Nürnberg',     country:'DE', lat:49.4454, lon:11.0820 },
  { id:'DRE', name:'Dresden Hbf',         city:'Dresden',      country:'DE', lat:51.0407, lon:13.7326 },
  // Schweiz
  { id:'ZRH', name:'Zürich HB',           city:'Zürich',       country:'CH', lat:47.3783, lon:8.5404  },
  { id:'BSL', name:'Basel SBB',           city:'Basel',        country:'CH', lat:47.5476, lon:7.5899  },
  { id:'GEN', name:'Genf Cornavin',       city:'Genf',         country:'CH', lat:46.2104, lon:6.1422  },
  { id:'BRN', name:'Bern Hbf',            city:'Bern',         country:'CH', lat:46.9488, lon:7.4393  },
  { id:'LUZ', name:'Luzern',              city:'Luzern',       country:'CH', lat:47.0502, lon:8.3093  },
  // Österreich
  { id:'VIE', name:'Wien Hbf',            city:'Wien',         country:'AT', lat:48.1848, lon:16.3762 },
  { id:'SZG', name:'Salzburg Hbf',        city:'Salzburg',     country:'AT', lat:47.8126, lon:13.0454 },
  { id:'IBK', name:'Innsbruck Hbf',       city:'Innsbruck',    country:'AT', lat:47.2639, lon:11.4014 },
  { id:'GRZ', name:'Graz Hbf',            city:'Graz',         country:'AT', lat:47.0707, lon:15.3913 },
  // Frankreich
  { id:'CDG', name:'Paris Gare du Nord',  city:'Paris',        country:'FR', lat:48.8809, lon:2.3553  },
  { id:'PGL', name:'Paris Gare de Lyon',  city:'Paris',        country:'FR', lat:48.8450, lon:2.3735  },
  { id:'LYO', name:'Lyon Part-Dieu',      city:'Lyon',         country:'FR', lat:45.7606, lon:4.8598  },
  { id:'MRS', name:'Marseille St-Charles',city:'Marseille',    country:'FR', lat:43.3026, lon:5.3808  },
  { id:'NCE', name:'Nice Ville',          city:'Nizza',        country:'FR', lat:43.7045, lon:7.2619  },
  { id:'BDX', name:'Bordeaux St-Jean',    city:'Bordeaux',     country:'FR', lat:44.8255, lon:-0.5561 },
  // Niederlande
  { id:'AMS', name:'Amsterdam Centraal',  city:'Amsterdam',    country:'NL', lat:52.3791, lon:4.9003  },
  { id:'RTD', name:'Rotterdam Centraal',  city:'Rotterdam',    country:'NL', lat:51.9248, lon:4.4687  },
  { id:'DHA', name:'Den Haag Centraal',   city:'Den Haag',     country:'NL', lat:52.0800, lon:4.3250  },
  // Belgien
  { id:'BRU', name:'Brüssel Midi',        city:'Brüssel',      country:'BE', lat:50.8354, lon:4.3363  },
  { id:'ANT', name:'Antwerpen Centraal',  city:'Antwerpen',    country:'BE', lat:51.2172, lon:4.4215  },
  // Italien
  { id:'ROM', name:'Roma Termini',        city:'Rom',          country:'IT', lat:41.9009, lon:12.5012 },
  { id:'MIL', name:'Milano Centrale',    city:'Mailand',      country:'IT', lat:45.4860, lon:9.2045  },
  { id:'VEN', name:'Venezia Santa Lucia', city:'Venedig',      country:'IT', lat:45.4414, lon:12.3209 },
  { id:'FLR', name:'Firenze SMN',         city:'Florenz',      country:'IT', lat:43.7746, lon:11.2480 },
  { id:'NAP', name:'Napoli Centrale',     city:'Neapel',       country:'IT', lat:40.8536, lon:14.2700 },
  // Spanien
  { id:'MAD', name:'Madrid Atocha',       city:'Madrid',       country:'ES', lat:40.4065, lon:-3.6892 },
  { id:'BCN', name:'Barcelona Sants',     city:'Barcelona',    country:'ES', lat:41.3795, lon:2.1404  },
  { id:'SVQ', name:'Sevilla Santa Justa', city:'Sevilla',      country:'ES', lat:37.3916, lon:-5.9757 },
  // UK
  { id:'LON', name:'London St Pancras',   city:'London',       country:'GB', lat:51.5308, lon:-0.1233 },
  { id:'LOV', name:'London Victoria',     city:'London',       country:'GB', lat:51.4952, lon:-0.1441 },
  { id:'EDI', name:'Edinburgh Waverley',  city:'Edinburgh',    country:'GB', lat:55.9521, lon:-3.1897 },
  { id:'MAN', name:'Manchester Piccadilly',city:'Manchester',  country:'GB', lat:53.4771, lon:-2.2309 },
  // Irland
  { id:'DUB', name:'Dublin Heuston',      city:'Dublin',       country:'IE', lat:53.3461, lon:-6.2931 },
  // Osteuropa
  { id:'PRG', name:'Praha hl. n.',        city:'Prag',         country:'CZ', lat:50.0831, lon:14.4356 },
  { id:'WAW', name:'Warszawa Centralna',  city:'Warschau',     country:'PL', lat:52.2288, lon:21.0031 },
  { id:'BUD', name:'Budapest Keleti',     city:'Budapest',     country:'HU', lat:47.5001, lon:19.0836 },
  { id:'BRQ', name:'Brno hl. n.',         city:'Brünn',        country:'CZ', lat:49.1909, lon:16.6118 },
  { id:'KRK', name:'Kraków Główny',       city:'Krakau',       country:'PL', lat:50.0670, lon:19.9450 },
  // Skandinavien
  { id:'CPH', name:'København H',              city:'Kopenhagen',    country:'DK', lat:55.6727, lon:12.5644 },
  { id:'STO', name:'Stockholm C',              city:'Stockholm',     country:'SE', lat:59.3299, lon:18.0575 },
  { id:'GOT', name:'Göteborg C',               city:'Göteborg',      country:'SE', lat:57.7072, lon:11.9737 },
  { id:'OSL', name:'Oslo S',                   city:'Oslo',          country:'NO', lat:59.9110, lon:10.7526 },
  { id:'BGO', name:'Bergen stasjon',           city:'Bergen',        country:'NO', lat:60.3912, lon:5.3326 },
  // Finnland
  { id:'HEL', name:'Helsinki Päärautatieasema',city:'Helsinki',      country:'FI', lat:60.1718, lon:24.9414 },
  { id:'TMP', name:'Tampere',                  city:'Tampere',       country:'FI', lat:61.4980, lon:23.7721 },
  { id:'OUL', name:'Oulu',                     city:'Oulu',          country:'FI', lat:65.0121, lon:25.4843 },
  // Portugal
  { id:'LIS', name:'Lisboa Santa Apolónia',    city:'Lissabon',      country:'PT', lat:38.7223, lon:-9.1303 },
  { id:'OPO', name:'Porto Campanhã',           city:'Porto',         country:'PT', lat:41.1496, lon:-8.5858 },
  { id:'FAR', name:'Faro',                     city:'Faro',          country:'PT', lat:37.0167, lon:-7.9359 },
  // Luxemburg
  { id:'LUX', name:'Luxembourg Gare',          city:'Luxemburg',     country:'LU', lat:49.6003, lon:6.1336 },
  // Slowakei
  { id:'BTS', name:'Bratislava hl. st.',       city:'Bratislava',    country:'SK', lat:48.1564, lon:17.1066 },
  { id:'KSC', name:'Košice',                   city:'Košice',        country:'SK', lat:48.7149, lon:21.2615 },
  // Slowenien
  { id:'LJU', name:'Ljubljana',                city:'Ljubljana',     country:'SI', lat:46.0569, lon:14.5058 },
  { id:'MBX', name:'Maribor',                  city:'Maribor',       country:'SI', lat:46.5547, lon:15.6459 },
  // Kroatien
  { id:'ZAG', name:'Zagreb Glavni kolodvor',   city:'Zagreb',        country:'HR', lat:45.8042, lon:15.9788 },
  { id:'SPL', name:'Split',                    city:'Split',         country:'HR', lat:43.5048, lon:16.4370 },
  { id:'RJK', name:'Rijeka',                   city:'Rijeka',        country:'HR', lat:45.3393, lon:14.4067 },
  // Rumänien
  { id:'BUC', name:'București Nord',           city:'Bukarest',      country:'RO', lat:44.4520, lon:26.0892 },
  { id:'CLJ', name:'Cluj-Napoca',              city:'Cluj',          country:'RO', lat:46.7690, lon:23.5850 },
  { id:'TMR', name:'Timișoara Nord',           city:'Timișoara',     country:'RO', lat:45.7489, lon:21.2087 },
  { id:'SIB', name:'Sibiu',                    city:'Sibiu',         country:'RO', lat:45.7983, lon:24.1542 },
  // Bulgarien
  { id:'SOF', name:'Sofia Zentralbahnhof',     city:'Sofia',         country:'BG', lat:42.7143, lon:23.3218 },
  { id:'PLV', name:'Plovdiv',                  city:'Plovdiv',       country:'BG', lat:42.1488, lon:24.7497 },
  { id:'VRN', name:'Varna',                    city:'Varna',         country:'BG', lat:43.2048, lon:27.9111 },
  // Griechenland
  { id:'ATH', name:'Athen Larissa-Bahnhof',    city:'Athen',         country:'GR', lat:37.9838, lon:23.7275 },
  { id:'SKG', name:'Thessaloniki',             city:'Thessaloniki',  country:'GR', lat:40.6390, lon:22.9373 },
  { id:'PAT', name:'Patras',                   city:'Patras',        country:'GR', lat:38.2466, lon:21.7346 },
  // Serbien
  { id:'BEG', name:'Beograd Centar',           city:'Belgrad',       country:'RS', lat:44.8046, lon:20.4685 },
  { id:'NSA', name:'Novi Sad',                 city:'Novi Sad',      country:'RS', lat:45.2671, lon:19.8335 },
  // Bosnien-Herzegowina
  { id:'SJJ', name:'Sarajevo',                 city:'Sarajevo',      country:'BA', lat:43.8607, lon:18.4094 },
  // Nordmazedonien
  { id:'SKP', name:'Skopje',                   city:'Skopje',        country:'MK', lat:41.9981, lon:21.4254 },
  // Estland
  { id:'TLL', name:'Tallinn Balti jaam',       city:'Tallinn',       country:'EE', lat:59.4437, lon:24.7365 },
  { id:'TRT', name:'Tartu',                    city:'Tartu',         country:'EE', lat:58.3776, lon:26.7286 },
  // Lettland
  { id:'RIX', name:'Riga Centrālā',            city:'Riga',          country:'LV', lat:56.9468, lon:24.1134 },
  // Litauen
  { id:'VNO', name:'Vilnius',                  city:'Vilnius',       country:'LT', lat:54.6736, lon:25.2835 },
  { id:'KNS', name:'Kaunas',                   city:'Kaunas',        country:'LT', lat:54.8985, lon:23.9211 },
  // Albanien
  { id:'TIA', name:'Tirana Stacioni',          city:'Tirana',        country:'AL', lat:41.3375, lon:19.8189 },
];

const OPERATORS = {
  DE:'DB (Deutsche Bahn)',       CH:'SBB CFF FFS',          AT:'ÖBB',
  FR:'SNCF',                     NL:'NS',                   BE:'NMBS/SNCB',
  IT:'Trenitalia',               ES:'Renfe',                GB:'Eurostar',
  IE:'Irish Rail',               CZ:'RegioJet',             PL:'PKP Intercity',
  HU:'MÁV-Start',               DK:'DSB',                  SE:'SJ',
  NO:'Vy',                       FI:'VR (Finnische Bahn)',  PT:'CP (Comboios de Portugal)',
  LU:'CFL',                      SK:'ZSSK',                 SI:'SŽ',
  HR:'HŽ Putnički prijevoz',    RO:'CFR Călători',         BG:'BDŽ',
  GR:'Hellenic Train',           RS:'Srbija Voz',           BA:'ŽFBH / ŽRS',
  MK:'MŽ Transport',            EE:'Elron',                LV:'Pasažieru vilciens',
  LT:'LTG Link',                AL:'HSH (Hekurudha Shqiptare)',
};
const OPERATOR_RIGHTS = {
  'DB (Deutsche Bahn)':         'https://www.bahn.de/hilfe/fahrgastrechte',
  'SBB CFF FFS':                'https://www.sbb.ch/de/hilfe-und-kontakt/kundenservice/entschaedigungen.html',
  'ÖBB':                        'https://www.oebb.at/de/reise-information/fahrgastrechte',
  'SNCF':                       'https://www.sncf-connect.com/aide/mes-droits-de-voyageur',
  'NS':                         'https://www.ns.nl/en/travel-information/traveling-by-train/passenger-rights.html',
  'NMBS/SNCB':                  'https://www.belgiantrain.be/en/travel-information/before-you-travel/passenger-rights',
  'Trenitalia':                 'https://www.trenitalia.com/it/informazioni/Diritti_del_Viaggiatore.html',
  'Renfe':                      'https://www.renfe.com/es/es/cercanias/cercanias-madrid/informacion-al-viajero',
  'Eurostar':                   'https://www.eurostar.com/uk-en/travel-info/travel-updates',
  'Irish Rail':                 'https://www.irishrail.ie/en-IE/travel-information/passenger-charter',
  'RegioJet':                   'https://www.regiojet.de/informationen/fahrgastrechte.html',
  'PKP Intercity':              'https://www.pkpintercity.pl/en/passenger-rights',
  'MÁV-Start':                  'https://www.mavcsoport.hu/mav-start/utasaink-figyelmébe/utas-tajékoztato',
  'DSB':                        'https://www.dsb.dk/find-produkter-og-services/rettigheder/',
  'SJ':                         'https://www.sj.se/sv/om-oss/passagerarrattigheternas.html',
  'Vy':                         'https://www.vy.no/kundeservice/reisegaranti',
  'VR (Finnische Bahn)':        'https://www.vr.fi/en/passenger-rights',
  'CP (Comboios de Portugal)':  'https://www.cp.pt/passageiros/en/passenger-rights',
  'CFL':                        'https://www.cfl.lu/en-gb/content/passenger-rights',
  'ZSSK':                       'https://www.zssk.sk/en/passenger-rights/',
  'SŽ':                         'https://www.sz.si/en/passenger-rights/',
  'HŽ Putnički prijevoz':       'https://www.hzpp.hr/en/passenger-rights',
  'CFR Călători':               'https://www.cfrcalatori.ro/en/passenger-rights/',
  'BDŽ':                        'https://www.bdz.bg/en/passenger-rights.html',
  'Hellenic Train':             'https://www.hellenictrain.gr/en/passenger-rights',
  'Srbija Voz':                 'https://www.srbvoz.rs/en/passenger-rights',
  'ŽFBH / ŽRS':                'https://www.zfbh.ba/',
  'MŽ Transport':               'https://www.mzt.mk/',
  'Elron':                      'https://elron.ee/en/passenger-rights',
  'Pasažieru vilciens':         'https://www.pv.lv/en/passenger-rights/',
  'LTG Link':                   'https://ltglink.lt/en/passenger-rights',
  'HSH (Hekurudha Shqiptare)':  'https://hsh.com.al/',
};
const TRAIN_TYPES = ['ICE','TGV','EC','IC','RJ','NJ','Railjet','EuroCity','IR','RE','Intercités','AVE','Frecciarossa','Talgo','RegioJet','Leo Express'];
const AMENITIES_BY_TYPE = {
  ICE:          { wifi:true,  dining:true,  powerOutlets:true,  quiet:true,  airConditioning:true, bikeStorage:false, wheelchair:true, sleepingCar:false, couchette:false },
  TGV:          { wifi:true,  dining:true,  powerOutlets:true,  quiet:true,  airConditioning:true, bikeStorage:true,  wheelchair:true, sleepingCar:false, couchette:false },
  EC:           { wifi:false, dining:true,  powerOutlets:true,  quiet:false, airConditioning:true, bikeStorage:true,  wheelchair:true, sleepingCar:false, couchette:false },
  IC:           { wifi:false, dining:false, powerOutlets:true,  quiet:false, airConditioning:true, bikeStorage:false, wheelchair:true, sleepingCar:false, couchette:false },
  RJ:           { wifi:true,  dining:true,  powerOutlets:true,  quiet:true,  airConditioning:true, bikeStorage:false, wheelchair:true, sleepingCar:false, couchette:false },
  NJ:           { wifi:true,  dining:false, powerOutlets:true,  quiet:false, airConditioning:true, bikeStorage:false, wheelchair:true, sleepingCar:true,  couchette:true  },
  Railjet:      { wifi:true,  dining:true,  powerOutlets:true,  quiet:true,  airConditioning:true, bikeStorage:false, wheelchair:true, sleepingCar:false, couchette:false },
  EuroCity:     { wifi:false, dining:true,  powerOutlets:false, quiet:false, airConditioning:true, bikeStorage:true,  wheelchair:true, sleepingCar:false, couchette:false },
  IR:           { wifi:false, dining:false, powerOutlets:true,  quiet:false, airConditioning:true, bikeStorage:true,  wheelchair:true, sleepingCar:false, couchette:false },
  RE:           { wifi:false, dining:false, powerOutlets:false, quiet:false, airConditioning:true, bikeStorage:true,  wheelchair:true, sleepingCar:false, couchette:false },
  Intercités:   { wifi:true,  dining:true,  powerOutlets:true,  quiet:false, airConditioning:true, bikeStorage:false, wheelchair:true, sleepingCar:false, couchette:false },
  AVE:          { wifi:true,  dining:true,  powerOutlets:true,  quiet:true,  airConditioning:true, bikeStorage:false, wheelchair:true, sleepingCar:false, couchette:false },
  Frecciarossa: { wifi:true,  dining:true,  powerOutlets:true,  quiet:true,  airConditioning:true, bikeStorage:false, wheelchair:true, sleepingCar:false, couchette:false },
  Talgo:        { wifi:true,  dining:true,  powerOutlets:true,  quiet:false, airConditioning:true, bikeStorage:false, wheelchair:true, sleepingCar:true,  couchette:true  },
  RegioJet:     { wifi:true,  dining:true,  powerOutlets:true,  quiet:false, airConditioning:true, bikeStorage:true,  wheelchair:true, sleepingCar:false, couchette:false },
  'Leo Express':{ wifi:true,  dining:false, powerOutlets:true,  quiet:false, airConditioning:true, bikeStorage:false, wheelchair:true, sleepingCar:false, couchette:false },
};
const PRICE_CALENDAR_VARIATION = [0.6,0.7,0.75,0.8,0.85,0.9,1.0,1.1,1.2,1.35,1.5,1.7,0.65,0.72,0.88,0.95,1.05,1.15,1.25,1.4,1.55,1.65,0.78,0.92,1.02,0.98,1.08,1.18,0.82,0.68];

function calcDistance(from, to) {
  const dx = from.lon - to.lon; const dy = from.lat - to.lat;
  return Math.sqrt(dx*dx + dy*dy) * 111;
}
function calcDuration(dist) {
  const mins = Math.max(30, Math.round(dist / 200 * 60));
  return `${Math.floor(mins/60)}h ${String(mins%60).padStart(2,'0')}min`;
}
function calcBasePrice(dist, seatClass, passengers) {
  const base = Math.max(19, Math.round(dist * 0.11));
  return Math.round(base * (seatClass === '1' ? 1.65 : 1) * passengers);
}

const stations = {
  search(q) {
    const l = q.toLowerCase();
    return STATIONS.filter(s =>
      s.name.toLowerCase().includes(l) || s.city.toLowerCase().includes(l) ||
      s.id.toLowerCase() === l || s.country.toLowerCase().includes(l)
    ).slice(0, 10);
  },
  findById: id => STATIONS.find(s => s.id === id) || null,
  all:   () => STATIONS,
  count: () => STATIONS.length
};

const routes = {
  search({ fromId, toId, date, passengers, seatClass }) {
    const from = STATIONS.find(s => s.id === fromId);
    const to   = STATIONS.find(s => s.id === toId);
    if (!from || !to) return [];
    const dist    = calcDistance(from, to);
    const isCross = from.country !== to.country;
    const results = [];
    const numRes  = 5 + Math.floor(Math.random() * 3);
    const dayOfYear = Math.floor((new Date(date) - new Date(new Date().getFullYear() + '-01-01')) / 86400000);
    const dayVar    = PRICE_CALENDAR_VARIATION[dayOfYear % PRICE_CALENDAR_VARIATION.length];

    for (let i = 0; i < numRes; i++) {
      const depH = 5 + i*2 + Math.floor(Math.random() * 2);
      const depM = [0, 15, 30, 45][Math.floor(Math.random() * 4)];
      const dep  = new Date(date); dep.setHours(depH, depM, 0, 0);
      const travelMins = Math.max(30, Math.round(dist / 200 * 60));
      const changes    = dist > 900 ? Math.floor(Math.random() * 2) : 0;
      const arr  = new Date(dep.getTime() + (travelMins + changes * 25) * 60000);
      const trainType  = TRAIN_TYPES[Math.floor(Math.random() * TRAIN_TYPES.length)];
      const trainNum   = trainType + ' ' + (100 + Math.floor(Math.random() * 900));
      const operator   = isCross ? 'Eurostar' : (OPERATORS[from.country] || 'DB (Deutsche Bahn)');
      const amenities  = AMENITIES_BY_TYPE[trainType] || AMENITIES_BY_TYPE.IC;
      const basePrice  = calcBasePrice(dist, seatClass, passengers);
      const variation  = (0.8 + Math.random() * 0.5) * dayVar;
      const price      = Math.round(basePrice * variation);
      const seats      = 20 + Math.floor(Math.random() * 180);
      const occupancy  = seats < 50 ? 'high' : seats < 120 ? 'medium' : 'low';

      results.push({
        id: uuidv4(),
        fromStation: from.name, fromId: from.id, fromCity: from.city,
        toStation: to.name,   toId: to.id,     toCity: to.city,
        departureTime: dep.toISOString(), arrivalTime: arr.toISOString(),
        duration: calcDuration(dist), trainNumber: trainNum, operator,
        operatorRightsUrl: OPERATOR_RIGHTS[operator] || null,
        changes, price, currency: 'EUR', seatClass, passengers,
        availableSeats: seats, occupancy,
        isNightTrain: depH >= 22 || depH <= 5,
        amenities, distance: Math.round(dist),
        priceBreakdown: {
          baseFare:        Math.round(price * 0.7),
          taxes:           Math.round(price * 0.15),
          serviceFee:      Math.round(price * 0.05),
          seatReservation: Math.round(price * 0.1)
        }
      });
    }
    return results.sort((a, b) => new Date(a.departureTime) - new Date(b.departureTime));
  },

  priceCalendar({ fromId, toId, month, year, passengers, seatClass }) {
    const from = STATIONS.find(s => s.id === fromId);
    const to   = STATIONS.find(s => s.id === toId);
    if (!from || !to) return [];
    const dist = calcDistance(from, to);
    const base = calcBasePrice(dist, seatClass, passengers);
    const days = new Date(year, month, 0).getDate();
    const cal  = [];
    for (let d = 1; d <= days; d++) {
      const v = PRICE_CALENDAR_VARIATION[(d - 1) % PRICE_CALENDAR_VARIATION.length];
      cal.push({ day: d, price: Math.round(base * v * (0.85 + Math.random() * 0.3)) });
    }
    return cal;
  }
};

// ── DB-Verbindungstest (beim Start) ───────────────────────────────────────────
async function testConnection() {
  if (!USE_POSTGRES) return;
  try {
    await pool.query('SELECT 1');
    console.log('[DB] PostgreSQL-Verbindung OK');
  } catch (err) {
    console.error('[DB] PostgreSQL-Verbindungsfehler:', err.message);
    console.error('[DB] Überprüfe DATABASE_URL in .env');
  }
}
testConnection();

module.exports = { users, tickets, priceAlerts, stations, routes, errors, STATIONS, OPERATORS, pool, USE_POSTGRES };
