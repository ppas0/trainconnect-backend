const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── SECURITY ─────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc:  ["'self'","'unsafe-inline'"],
    styleSrc:   ["'self'","'unsafe-inline'","https://fonts.googleapis.com"],
    fontSrc:    ["'self'","https://fonts.gstatic.com"],
    imgSrc:     ["'self'","data:","https:"],
    connectSrc: ["'self'"],
  }
}}));
app.use(compression());
// CORS: nur erlaubte Origins zulassen
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['https://trainconnect.eu', 'https://www.trainconnect.eu'];

// In der Entwicklung localhost immer erlauben
if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080');
}

app.use(cors({
  origin(origin, cb) {
    // Erlaubt Requests ohne Origin (z.B. mobile Apps, curl, Postman in dev)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: Origin nicht erlaubt – ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit:'1mb' }));

// ── RATE LIMITING ─────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15*60*1000, max: 20,
  message: { error:'Zu viele Anfragen – bitte 15 Minuten warten' }
});
const apiLimiter = rateLimit({
  windowMs: 60*1000, max: 200,
  message: { error:'API-Limit erreicht – bitte kurz warten' }
});
app.use('/api/auth', authLimiter);
app.use('/api',      apiLimiter);

// ── STATIC ───────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API ───────────────────────────────────────────────────────────────────────
app.use('/api', require('./server/routes'));

// ── SPA FALLBACK ─────────────────────────────────────────────────────────────
app.get('/{*filePath}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// ── ERROR HANDLER ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error:'Interner Serverfehler' });
});

app.listen(PORT, () => {
  console.log(`\n🚆 TrainConnect Europe v2.0`);
  console.log(`   → http://localhost:${PORT}`);
  console.log(`   → API: http://localhost:${PORT}/api/health\n`);
});

module.exports = app;
