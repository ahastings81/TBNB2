// server.js
const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const session      = require('express-session');
const bcrypt       = require('bcryptjs');
const multer       = require('multer');
const nodemailer   = require('nodemailer');
const { Pool }     = require('pg');

// Env vars
const {
  API_KEY,
  SESSION_SECRET,
  ADMIN_USER,
  ADMIN_PASS_HASH,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  ADMIN_EMAIL,
  DATABASE_URL
} = process.env;

// PostgreSQL pool
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Ensure tables exist (with renamed columns)
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id          SERIAL PRIMARY KEY,
      name        TEXT   NOT NULL,
      email       TEXT   NOT NULL,
      start_date  DATE   NOT NULL,
      end_date    DATE   NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prices (
      date  DATE    PRIMARY KEY,
      price INTEGER NOT NULL
    );
  `);
})().catch(err => {
  console.error('Error setting up tables:', err);
  process.exit(1);
});

// Mailer
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: parseInt(SMTP_PORT, 10),
  secure: SMTP_SECURE === 'true',
  auth: { user: SMTP_USER, pass: SMTP_PASS }
});

// File upload
const uploadDir = path.join(__dirname, 'public', 'uploads');
const storage   = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

const app = express();
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

// Overlap checker
async function hasOverlap(start, end) {
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM bookings
      WHERE NOT (end_date < $1 OR start_date > $2)
      LIMIT 1`,
    [start, end]
  );
  return rowCount > 0;
}

// 1) Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (
    username === ADMIN_USER &&
    await bcrypt.compare(password, ADMIN_PASS_HASH)
  ) {
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

// 3) Public GET bookings & prices
app.get('/api/bookings', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      id,
      name,
      email,
      start_date AS start,
      end_date   AS end
    FROM bookings
    ORDER BY id
  `);
  res.json(rows);
});

app.get('/api/prices', async (req, res) => {
  const { rows } = await pool.query('SELECT date, price FROM prices');
  const obj = {};
  rows.forEach(r => {
    obj[r.date.toISOString().slice(0,10)] = r.price;
  });
  res.json(obj);
});

// 4) Admin: set price
app.post('/api/prices', requireAdmin, async (req, res) => {
  const { date, price } = req.body;
  if (!date || price == null) return res.status(400).json({ error: 'date & price required' });
  await pool.query(
    `INSERT INTO prices(date, price)
     VALUES($1, $2)
     ON CONFLICT(date) DO UPDATE SET price = EXCLUDED.price`,
    [date, price]
  );
  res.sendStatus(204);
});

// 5) Admin: upload images
app.post('/api/upload', requireAdmin, upload.single('image'), (req, res) => {
  res.json({ url: `/uploads/${req.file.filename}` });
});

// 6) Booking (public)
app.post('/api/bookings', requireKey, async (req, res) => {
  const { name, email, start, end } = req.body;
  if (!name || !email || !start || !end) return res.status(400).json({ error: 'name, email, start, end required' });
  if (await hasOverlap(start, end)) return res.status(409).json({ error: 'Already booked' });

  const { rows } = await pool.query(
    `INSERT INTO bookings(name, email, start_date, end_date)
     VALUES($1, $2, $3, $4)
     RETURNING
       id,
       name,
       email,
       start_date AS start,
       end_date   AS end`,
    [name, email, start, end]
  );
  const booking = rows[0];

  // Email confirmations
  transporter.sendMail({
    from: SMTP_USER,
    to: email,
    subject: 'Your booking is confirmed!',
    text: `Thank You ${name} for choosing TaraBnB! Your booking from ${start} to ${end} is confirmed.` // message to user (confirmation)
  }).catch(console.error);
  transporter.sendMail({
    from: SMTP_USER,
    to: ADMIN_EMAIL,
    subject: 'New Booking',
    text: `New booking by ${name} (${email}) from ${start} to ${end}.`  // message to owner (notification)
  }).catch(console.error);

  res.status(201).json(booking);
});

// Start
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
