/**
 * TrainConnect Europe – E-Mail-Versand via SendGrid
 * Voraussetzungen:
 *   SENDGRID_API_KEY=SG.xxxx
 *   SENDGRID_FROM_EMAIL=noreply@trainconnect.eu
 *   SENDGRID_FROM_NAME=TrainConnect Europe
 */
const sgMail = require('@sendgrid/mail');

const ENABLED = !!process.env.SENDGRID_API_KEY;
if (ENABLED) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  console.log('[Email] SendGrid aktiv –', process.env.SENDGRID_FROM_EMAIL);
} else {
  console.log('[Email] SendGrid nicht konfiguriert (SENDGRID_API_KEY fehlt) – E-Mails werden simuliert');
}

const FROM = {
  email: process.env.SENDGRID_FROM_EMAIL || 'noreply@trainconnect.eu',
  name:  process.env.SENDGRID_FROM_NAME  || 'TrainConnect Europe',
};

async function send(msg) {
  if (!ENABLED) {
    console.log('[Email] [SIMULATED] To:', msg.to, '| Subject:', msg.subject);
    return;
  }
  try {
    await sgMail.send({ ...msg, from: FROM });
  } catch (err) {
    console.error('[Email] Fehler:', err.response?.body?.errors || err.message);
  }
}

// ── Templates ─────────────────────────────────────────────────────────────────

function formatDate(iso) {
  return new Date(iso).toLocaleString('de-DE', {
    weekday:'long', day:'2-digit', month:'long', year:'numeric',
    hour:'2-digit', minute:'2-digit', timeZone:'Europe/Berlin'
  });
}

function headerStyle() {
  return 'background:#1a1a2e;color:#fff;padding:24px 32px;font-family:sans-serif;';
}
function bodyStyle() {
  return 'font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;';
}

// ── Buchungsbestätigung ───────────────────────────────────────────────────────
async function sendBookingConfirmation(user, ticket) {
  const html = `
<div style="${bodyStyle()}">
  <div style="${headerStyle()}">
    <h1 style="margin:0;font-size:24px;">🚆 TrainConnect Europe</h1>
    <p style="margin:4px 0 0;opacity:.7;">Deine Buchungsbestätigung</p>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#1a1a2e;">Buchung bestätigt ✅</h2>
    <p>Hallo ${user.name},<br>
    deine Reise wurde erfolgreich gebucht. Hier sind deine Reisedetails:</p>

    <table style="width:100%;border-collapse:collapse;margin:24px 0;">
      <tr style="background:#f5f5f5;">
        <td style="padding:10px 14px;font-weight:bold;">Ticket-Code</td>
        <td style="padding:10px 14px;font-family:monospace;font-size:18px;color:#1a1a2e;">${ticket.ticketCode}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;">Strecke</td>
        <td style="padding:10px 14px;">${ticket.fromStation} → ${ticket.toStation}</td>
      </tr>
      <tr style="background:#f5f5f5;">
        <td style="padding:10px 14px;font-weight:bold;">Abfahrt</td>
        <td style="padding:10px 14px;">${formatDate(ticket.departureTime)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;">Ankunft</td>
        <td style="padding:10px 14px;">${formatDate(ticket.arrivalTime)}</td>
      </tr>
      <tr style="background:#f5f5f5;">
        <td style="padding:10px 14px;font-weight:bold;">Zug</td>
        <td style="padding:10px 14px;">${ticket.trainNumber} | ${ticket.operator}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;">Klasse & Sitz</td>
        <td style="padding:10px 14px;">${ticket.seatClass === '1' ? '1. Klasse' : '2. Klasse'} | Platz ${ticket.seatNumber || '–'}</td>
      </tr>
      <tr style="background:#f5f5f5;">
        <td style="padding:10px 14px;font-weight:bold;">Reisende</td>
        <td style="padding:10px 14px;">${ticket.passengers} Person(en)</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;">Preis</td>
        <td style="padding:10px 14px;font-size:18px;color:#1a1a2e;font-weight:bold;">€${ticket.price.toFixed(2)}</td>
      </tr>
    </table>

    <p style="background:#e8f5e9;border-left:4px solid #4caf50;padding:12px 16px;border-radius:4px;">
      💡 <strong>Tipp:</strong> Du kannst dein Ticket bis 24h vor Abfahrt kostenlos stornieren.
    </p>

    <p style="margin-top:32px;color:#666;font-size:13px;">
      TrainConnect Europe | <a href="https://trainconnect.eu" style="color:#1a1a2e;">trainconnect.eu</a><br>
      Bei Fragen: <a href="mailto:support@trainconnect.eu" style="color:#1a1a2e;">support@trainconnect.eu</a>
    </p>
  </div>
</div>`;

  await send({
    to:      { email: user.email, name: user.name },
    subject: `✅ Buchung bestätigt – ${ticket.ticketCode} | ${ticket.fromStation} → ${ticket.toStation}`,
    html,
    text: `Buchung bestätigt!\n\nTicket: ${ticket.ticketCode}\nStrecke: ${ticket.fromStation} → ${ticket.toStation}\nAbfahrt: ${formatDate(ticket.departureTime)}\nPreis: €${ticket.price.toFixed(2)}\n\nGute Reise!`,
  });
}

// ── Willkommens-E-Mail ────────────────────────────────────────────────────────
async function sendWelcome(user) {
  const html = `
<div style="${bodyStyle()}">
  <div style="${headerStyle()}">
    <h1 style="margin:0;font-size:24px;">🚆 TrainConnect Europe</h1>
    <p style="margin:4px 0 0;opacity:.7;">Willkommen an Bord!</p>
  </div>
  <div style="padding:32px;">
    <h2>Hallo ${user.name}! 👋</h2>
    <p>Dein Konto bei TrainConnect Europe wurde erfolgreich erstellt.</p>
    <p>Mit TrainConnect buchst du Zugverbindungen in ganz Europa – von Norwegen bis Griechenland, mit einem einzigen Ticket.</p>
    <div style="text-align:center;margin:32px 0;">
      <a href="https://trainconnect.eu" 
         style="background:#1a1a2e;color:#fff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:bold;">
        Jetzt Verbindung suchen →
      </a>
    </div>
    <p style="color:#666;font-size:13px;">
      <a href="https://trainconnect.eu" style="color:#1a1a2e;">trainconnect.eu</a> | 
      <a href="mailto:support@trainconnect.eu" style="color:#1a1a2e;">support@trainconnect.eu</a>
    </p>
  </div>
</div>`;

  await send({
    to:      { email: user.email, name: user.name },
    subject: `🚆 Willkommen bei TrainConnect Europe, ${user.name}!`,
    html,
    text: `Hallo ${user.name}!\n\nWillkommen bei TrainConnect Europe – Zugverbindungen für ganz Europa.\n\nJetzt loslegen: https://trainconnect.eu`,
  });
}

// ── Passwort-Reset ────────────────────────────────────────────────────────────
async function sendPasswordReset(user, resetToken) {
  const resetUrl = `https://trainconnect.eu/reset-password?token=${resetToken}`;
  const html = `
<div style="${bodyStyle()}">
  <div style="${headerStyle()}">
    <h1 style="margin:0;font-size:24px;">🚆 TrainConnect Europe</h1>
    <p style="margin:4px 0 0;opacity:.7;">Passwort zurücksetzen</p>
  </div>
  <div style="padding:32px;">
    <h2>Passwort zurücksetzen</h2>
    <p>Hallo ${user.name},<br>
    du hast einen Passwort-Reset angefordert. Klicke auf den Button, um ein neues Passwort festzulegen:</p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${resetUrl}"
         style="background:#1a1a2e;color:#fff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:bold;">
        Passwort zurücksetzen
      </a>
    </div>
    <p style="color:#999;font-size:13px;">
      Dieser Link ist 1 Stunde gültig.<br>
      Falls du keinen Reset angefordert hast, ignoriere diese E-Mail.
    </p>
    <p style="color:#666;font-size:13px;">
      <a href="https://trainconnect.eu" style="color:#1a1a2e;">trainconnect.eu</a>
    </p>
  </div>
</div>`;

  await send({
    to:      { email: user.email, name: user.name },
    subject: `🔑 Passwort zurücksetzen – TrainConnect Europe`,
    html,
    text: `Passwort zurücksetzen:\n${resetUrl}\n\nDieser Link ist 1 Stunde gültig.`,
  });
}

module.exports = { sendBookingConfirmation, sendWelcome, sendPasswordReset, send };
