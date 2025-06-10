// server.js

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const nodemailer = require('nodemailer');
const { Low }    = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app      = express();
const API_KEY  = process.env.API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

// --- Setup LowDB ---
const dbFile  = path.join(__dirname, 'data.json');
const adapter = new JSONFile(dbFile);
const db      = new Low(adapter);
(async () => {
  await db.read();
  db.data ||= { bookings: [], prices: {} };
  await db.write();
})();

// --- Configure Mailer ---
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Helpers ---
function hasOverlap(bookings, start, end) {
  const s = new Date(start), e = new Date(end);
  return bookings.some(b => {
    const bs = new Date(b.start), be = new Date(b.end);
    return !(be < s || bs > e);
  });
}

function requireKey(req, res, next) {
  if (req.header('X-API-KEY') !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// --- Routes ---

// GET bookings
app.get('/api/bookings', async (req, res) => {
  await db.read();
  res.json(db.data.bookings);
});

// GET prices
app.get('/api/prices', async (req, res) => {
  await db.read();
  res.json(db.data.prices);
});

// POST booking
app.post('/api/bookings', requireKey, async (req, res) => {
  const { name, email, start, end } = req.body;
  if (!name || !email || !start || !end) {
    return res.status(400).json({ error: 'name, email, start & end are required' });
  }

  await db.read();
  if (hasOverlap(db.data.bookings, start, end)) {
    return res.status(409).json({ error: 'That date range is already booked.' });
  }

  const nextId = (db.data.bookings.reduce((m, b) => Math.max(m, b.id), 0) || 0) + 1;
  const newBooking = { id: nextId, name, email, start, end };
  db.data.bookings.push(newBooking);
  await db.write();

  // Send confirmation to guest
  transporter.sendMail({
    from: `"Your Condo" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Your booking is confirmed!',
    text: `Hi ${name},\n\nThanks for booking from ${start} to ${end}. We look forward to hosting you!\n\n– The Team`,
    html: `<p>Hi <strong>${name}</strong>,</p>
           <p>Thanks for booking from <strong>${start}</strong> to <strong>${end}</strong>. We look forward to hosting you!</p>
           <p>– The Team</p>`
  }).catch(console.error);

  // Notify admin
  transporter.sendMail({
    from: `"Booking Notifications" <${process.env.SMTP_USER}>`,
    to: ADMIN_EMAIL,
    subject: 'New booking received',
    text: `New booking by ${name} <${email}> from ${start} to ${end}.`,
    html: `<p>New booking by <strong>${name}</strong> &lt;${email}&gt; from <strong>${start}</strong> to <strong>${end}</strong>.</p>`
  }).catch(console.error);

  res.status(201).json(newBooking);
});

// POST price (unchanged)
app.post('/api/prices', requireKey, async (req, res) => {
  const { date, price } = req.body;
  if (!date || price == null) {
    return res.status(400).json({ error: 'date & price are required' });
  }
  await db.read();
  db.data.prices[date] = price;
  await db.write();
  res.sendStatus(204);
});

// --- Start ---
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});
