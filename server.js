// server.js
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app     = express();
const API_KEY = process.env.API_KEY;

// Setup lowdb
const file    = path.join(__dirname, 'data.json');
const adapter = new JSONFile(file);
const db      = new Low(adapter);

// Init DB
(async () => {
  await db.read();
  db.data ||= { bookings: [], prices: {} };
  await db.write();
})();

// Helpers
function hasOverlap(bookings, start, end) {
  const s = new Date(start), e = new Date(end);
  return bookings.some(b => {
    const bs = new Date(b.start), be = new Date(b.end);
    return !(be < s || bs > e);
  });
}

function requireKey(req, res, next) {
  if (req.header('X-API-KEY') !== API_KEY) {
    return res.status(401).json({ error:'Unauthorized' });
  }
  next();
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET bookings
app.get('/api/bookings', async (req,res) => {
  await db.read();
  res.json(db.data.bookings);
});

// GET prices
app.get('/api/prices', async (req,res) => {
  await db.read();
  res.json(db.data.prices);
});

// POST booking (now accepts name,email,payment stub)
app.post('/api/bookings', requireKey, async (req,res) => {
  const { name, email, start, end } = req.body;
  if (!name||!email||!start||!end) {
    return res.status(400).json({ error:'name,email,start,end required' });
  }
  await db.read();
  if (hasOverlap(db.data.bookings, start, end)) {
    return res.status(409).json({ error:'Already booked' });
  }
  const nextId = (db.data.bookings.reduce((m,b)=>Math.max(m,b.id),0)||0)+1;
  db.data.bookings.push({ id: nextId, name, email, start, end });
  await db.write();
  res.status(201).json({ id: nextId, name, email, start, end });
});

// POST price (unchanged)
app.post('/api/prices', requireKey, async (req,res) => {
  const { date, price } = req.body;
  if (!date||price==null) {
    return res.status(400).json({ error:'date & price required' });
  }
  await db.read();
  db.data.prices[date] = price;
  await db.write();
  res.sendStatus(204);
});

// Start
const PORT = process.env.PORT||3001;
app.listen(PORT, ()=> {
  console.log(`Listening on http://localhost:${PORT}`);
});
