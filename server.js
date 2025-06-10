// server.js
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const { Low }   = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app     = express();
const API_KEY = process.env.API_KEY;
const file    = path.join(__dirname, 'data.json');
const adapter = new JSONFile(file);
const db      = new Low(adapter);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize DB (if data.json missing or empty)
async function initDB() {
  await db.read();
  db.data ||= { bookings: [], prices: {} };
  await db.write();
}
initDB();

// Helper: check for overlapping bookings
function hasOverlap(bookings, start, end) {
  const s = new Date(start), e = new Date(end);
  return bookings.some(b => {
    const bs = new Date(b.start), be = new Date(b.end);
    return !(be < s || bs > e);
  });
}

// Protect write routes
function requireApiKey(req, res, next) {
  if (req.header('X-API-KEY') !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// — GET all bookings
app.get('/api/bookings', async (req, res) => {
  await db.read();
  res.json(db.data.bookings);
});

// — GET all prices
app.get('/api/prices', async (req, res) => {
  await db.read();
  res.json(db.data.prices);
});

// — POST a booking (with overlap check & auth)
app.post('/api/bookings', requireApiKey, async (req, res) => {
  const { start, end } = req.body;
  if (!start || !end) {
    return res.status(400).json({ error: 'start & end required' });
  }
  await db.read();
  if (hasOverlap(db.data.bookings, start, end)) {
    return res.status(409).json({ error: 'That date range is already booked.' });
  }
  const nextId = (db.data.bookings.reduce((max, b) => Math.max(max, b.id), 0) || 0) + 1;
  db.data.bookings.push({ id: nextId, start, end });
  await db.write();
  res.status(201).json({ id: nextId, start, end });
});

// — POST a price (auth)
app.post('/api/prices', requireApiKey, async (req, res) => {
  const { date, price } = req.body;
  if (!date || price == null) {
    return res.status(400).json({ error: 'date & price required' });
  }
  await db.read();
  db.data.prices[date] = price;
  await db.write();
  res.sendStatus(204);
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server listening on http://localhost:${PORT}`);
  console.log(`🔑  Using API_KEY=${API_KEY}`);
});
