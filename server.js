const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const session    = require('express-session');
const bcrypt = require('bcrypt');
const multer     = require('multer');
const nodemailer = require('nodemailer');
const { Low }    = require('lowdb');
const { JSONFile } = require('lowdb/node');

// Environment vars
const API_KEY        = process.env.API_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_USER     = process.env.ADMIN_USER;
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH; // bcrypt hash
const SMTP_HOST      = process.env.SMTP_HOST;
const SMTP_PORT      = parseInt(process.env.SMTP_PORT, 10);
const SMTP_SECURE    = process.env.SMTP_SECURE === 'true';
const SMTP_USER      = process.env.SMTP_USER;
const SMTP_PASS      = process.env.SMTP_PASS;
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;

// Initialize LowDB
const dbFile  = path.join(__dirname, 'data.json');
const adapter = new JSONFile(dbFile);
const db      = new Low(adapter);
(async () => {
  await db.read();
  db.data ||= { bookings: [], prices: {} };
  await db.write();
})();

// Configure mailer
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: { user: SMTP_USER, pass: SMTP_PASS }
});

// Configure Multer for image uploads
const uploadDir = path.join(__dirname, 'public', 'uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, 'public')));

// Auth helpers
function requireKey(req, res, next) {
  if (req.header('X-API-KEY') !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/login.html');
}

// Overlap check
function hasOverlap(bookings, start, end) {
  const s = new Date(start), e = new Date(end);
  return bookings.some(b => {
    const bs = new Date(b.start), be = new Date(b.end);
    return !(be < s || bs > e);
  });
}

// Routes
// 1) Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && await bcrypt.compare(password, ADMIN_PASS_HASH)) {
    req.session.isAdmin = true;
    return res.redirect('/admin.html');
  }
  res.redirect('/login.html?error=1');
});
// 2) Logout
app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

// 3) Public data
app.get('/api/bookings', async (req, res) => {
  await db.read();
  res.json(db.data.bookings);
});
app.get('/api/prices', async (req, res) => {
  await db.read();
  res.json(db.data.prices);
});

// 4) Admin: update prices
app.post('/api/prices', requireAdmin, async (req, res) => {
  const { date, price } = req.body;
  if (!date || price == null) return res.status(400).json({ error: 'date & price required' });
  await db.read();
  db.data.prices[date] = price;
  await db.write();
  res.sendStatus(204);
});

// 5) Admin: upload images
app.post('/api/upload', requireAdmin, upload.single('image'), (req, res) => {
  res.json({ url: `/uploads/${req.file.filename}` });
});

// 6) Booking (public POST, requires API key)
app.post('/api/bookings', requireKey, async (req, res) => {
  const { name, email, start, end, payment } = req.body;
  if (!name || !email || !start || !end) return res.status(400).json({ error: 'name, email, start, end required' });
  await db.read();
  if (hasOverlap(db.data.bookings, start, end)) return res.status(409).json({ error: 'Already booked' });
  const nextId = (db.data.bookings.reduce((m, b) => Math.max(m, b.id), 0) || 0) + 1;
  const booking = { id: nextId, name, email, start, end };
  db.data.bookings.push(booking);
  await db.write();
  // email notifications
  transporter.sendMail({
    from: SMTP_USER,
    to: email,
    subject: 'Booking Confirmed',
    text: `Hi ${name}, your booking from ${start} to ${end} is confirmed.`
  }).catch(console.error);
  transporter.sendMail({
    from: SMTP_USER,
    to: ADMIN_EMAIL,
    subject: 'New Booking',
    text: `New booking by ${name} (${email}) from ${start} to ${end}.`
  }).catch(console.error);
  res.status(201).json(booking);
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
