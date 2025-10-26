const express = require('express');
const { spawn } = require('child_process');
const crypto = require('crypto');
let nodemailer;
try { nodemailer = require('nodemailer'); } catch (_) { nodemailer = null; }
const fs = require('fs');
const fsp = require('fs/promises');
const session = require('express-session');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { findUser, connect, isMemoryMode } = require('./db');
const { awardPointIfFirst } = require('./db');
const archiver = require('archiver');
// Lazy-require other DB helpers where used to avoid circular surprises

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Sessions (in-memory store for demo; replace with Mongo store for production)
app.use(session({
  secret: process.env.SESSION_SECRET || 'crossword-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 } // 1 hour
}));

// Middleware to protect authenticated routes
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

// Simple admin checker based on env var ADMIN_USERS (comma-separated usernames)
const ADMIN_USERS = (process.env.ADMIN_USERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect('/login');
  const u = (req.session.user.username || '').toLowerCase();
  if (ADMIN_USERS.includes(u)) return next();
  return res.status(403).send('Forbidden: Admins only');
}

// Public (unprotected) static assets for the login page & shared styles
app.use('/assets', express.static(path.join(__dirname, 'public')));

// Favicon fallback for browsers requesting /favicon.ico
app.get('/favicon.ico', (req, res) => {
  res.type('image/svg+xml');
  res.sendFile(path.join(__dirname, 'public', 'favicon.svg'));
});

// Protected static files for the game itself
app.use('/public', requireAuth, express.static(path.join(__dirname, 'public')));
// Protected static for saved puzzle artifacts (JSON/SVG)
app.use('/puzzles', requireAuth, express.static(path.join(__dirname, 'puzzles')));

// Login page (GET)
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  const rawError = typeof req.query.error === 'string' ? req.query.error : '';
  const safeError = rawError.replace(/</g,'&lt;').replace(/>/g,'&gt;');
  res.send(`<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Crossword Login</title>
  <link rel="shortcut icon" href="/favicon.ico">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/login.css" />
  </head>
  <body class="login-body">
    <div class="login-gradient"></div>
    <main class="login-wrapper" aria-label="Login form">
      <section class="login-card" role="form">
        <header class="login-header">
          <h1 class="login-title">Crossword Portal</h1>
          <p class="login-subtitle">Sign in with your username & password</p>
        </header>
        ${safeError ? `<div class="alert alert-error" role="alert">${safeError}</div>` : ''}
        <form method="POST" action="/login" class="login-form" autocomplete="off">
          <label for="username" class="field-label">Username</label>
            <div class="field-group">
              <input id="username" name="username" class="input" required placeholder="e.g. testuser" autofocus maxlength="40" />
            </div>
          <label for="password" class="field-label" style="margin-top:1rem">Password</label>
            <div class="field-group">
              <input id="password" type="password" name="password" class="input" required placeholder="Your password" maxlength="100" />
            </div>
          <button type="submit" class="button-primary" aria-label="Login">Login</button>
        </form>
        <div style="margin-top:1rem;text-align:center;font-size:0.85rem;">
           <span>Need an account? <a href="/register" style="color:#4ea0ff;text-decoration:none;font-weight:500;">Create one</a></span>
           <span style="margin-left:12px;color:#9aa3b2;">·</span>
           <span><a href="/forgot" style="color:#4ea0ff;text-decoration:none;font-weight:500;">Forgot password?</a></span>
        </div>
        
      </section>
    </main>
  </body>
  </html>`);
});

// Forgot password page
app.get('/forgot', (req, res) => {
  if (req.session.user) return res.redirect('/');
  const rawError = typeof req.query.error === 'string' ? req.query.error : '';
  const safeError = rawError.replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const success = typeof req.query.success === 'string' ? req.query.success : '';
  const safeSuccess = success.replace(/</g,'&lt;').replace(/>/g,'&gt;');
  res.send(`<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Forgot Password - Crossword</title>
    <link rel="shortcut icon" href="/favicon.ico">
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/login.css" />
  </head>
  <body class="login-body">
    <div class="login-gradient"></div>
    <main class="login-wrapper" aria-label="Forgot password form">
      <section class="login-card" role="form">
        <header class="login-header">
          <h1 class="login-title">Forgot Password</h1>
          <p class="login-subtitle">Enter your email and username. We'll send a reset link and notify the admin.</p>
        </header>
        ${safeError ? `<div class="alert alert-error" role="alert">${safeError}</div>` : ''}
        ${safeSuccess ? `<div class="alert" role="status">${safeSuccess}</div>` : ''}
        <form method="POST" action="/forgot" class="login-form" autocomplete="off">
          <label for="fp_email" class="field-label">Email</label>
          <div class="field-group">
            <input id="fp_email" name="email" type="email" class="input" required placeholder="you@example.com" maxlength="120" />
          </div>
          <label for="fp_username" class="field-label" style="margin-top:1rem">Username</label>
          <div class="field-group">
            <input id="fp_username" name="username" class="input" required placeholder="your username" maxlength="40" />
          </div>
          <button type="submit" class="button-primary" aria-label="Submit">Request Reset</button>
        </form>
        <div style="margin-top:1rem;text-align:center;font-size:0.85rem;">
          <span><a href="/login" style="color:#4ea0ff;text-decoration:none;font-weight:500;">Back to login</a></span>
        </div>
      </section>
    </main>
  </body>
  </html>`);
});

// Forgot password submit
const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });
app.post('/forgot', forgotLimiter, async (req, res) => {
  try {
    const { email, username } = req.body || {};
    const ua = req.get('user-agent');
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    const { addPasswordResetRequest, findUser, createPasswordResetToken } = require('./db');

    const trimmedEmail = String(email || '').trim();
    const cleanedUsername = String(username || '').trim().toLowerCase();

    // If either field missing or email invalid, don't reveal details; just notify admin.
    if (!trimmedEmail || !cleanedUsername || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      await addPasswordResetRequest({ username: cleanedUsername, email: trimmedEmail, userAgent: ua, ip });
      return res.redirect('/forgot?success=' + encodeURIComponent('If the details are valid, the admin has been notified. You will receive assistance shortly.'));
    }

    // Require strict match between username and email
    const target = await findUser(cleanedUsername);
    if (!target || !target.email || String(target.email).toLowerCase() !== trimmedEmail.toLowerCase()) {
      await addPasswordResetRequest({ username: cleanedUsername, email: trimmedEmail, userAgent: ua, ip });
      return res.redirect('/forgot?success=' + encodeURIComponent('If the details are valid, the admin has been notified. You will receive assistance shortly.'));
    }
    // Create reset token and attempt to send email with link
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await createPasswordResetToken(target.username, trimmedEmail, tokenHash, expiresAt);
    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${baseUrl}/reset?token=${encodeURIComponent(token)}`;

    const sent = await (async () => {
      const host = process.env.SMTP_HOST; const port = Number(process.env.SMTP_PORT || 0);
      const user = process.env.SMTP_USER; const pass = process.env.SMTP_PASS; const from = process.env.SMTP_FROM || user;
      if (!nodemailer || !host || !port || !user || !pass || !from) {
        console.warn('[EMAIL] SMTP not configured. Reset link:', link);
        return false;
      }
      const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
      const html = `<p>Hello ${target.username},</p><p>You requested to reset your password. Click the button below:</p><p><a href="${link}" style="background:#7d2ae8;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none">Reset Password</a></p><p>This link expires in 15 minutes. If you didn't request this, ignore this email.</p>`;
      await transporter.sendMail({ from, to: trimmedEmail, subject: 'Reset your Crossword password', html });
      return true;
    })();
    // Only notify admin on mismatches; on success we just inform the user
    const msg = sent ? 'Check your email for a reset link.' : 'A reset link was generated. If you did not receive an email, please contact admin.';
    return res.redirect('/forgot?success=' + encodeURIComponent(msg));
  } catch (e) {
    console.error('[FORGOT] error', e);
    return res.redirect('/forgot?error=Server%20error');
  }
});

// Reset password form
app.get('/reset', async (req, res) => {
  const rawToken = String(req.query.token || '');
  if (!rawToken) return res.status(400).send('Invalid reset link');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const { findValidResetToken } = require('./db');
  const rec = await findValidResetToken(tokenHash);
  const valid = !!rec;
  res.send(`<!DOCTYPE html>
  <html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Reset Password</title>
  <link rel="shortcut icon" href="/favicon.ico"><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/login.css" />
  </head><body class="login-body"><div class="login-gradient"></div>
  <main class="login-wrapper" aria-label="Reset password form"><section class="login-card" role="form">
  <header class="login-header"><h1 class="login-title">Reset Password</h1><p class="login-subtitle">Enter your new password</p></header>
  ${!valid ? '<div class="alert alert-error" role="alert">This link is invalid or has expired.</div>' : ''}
  ${valid ? `<form method="POST" action="/reset" class="login-form" autocomplete="off">
    <input type="hidden" name="token" value="${rawToken}"/>
    <label for="np1" class="field-label">New Password</label>
    <div class="field-group"><input id="np1" type="password" name="password" class="input" required minlength="6" maxlength="100"/></div>
    <label for="np2" class="field-label" style="margin-top:1rem">Confirm New Password</label>
    <div class="field-group"><input id="np2" type="password" name="password2" class="input" required minlength="6" maxlength="100"/></div>
    <button type="submit" class="button-primary">Update Password</button>
  </form>` : `<div style="margin-top:1rem;text-align:center"><a href="/forgot" style="color:#4ea0ff;text-decoration:none;font-weight:500;">Request a new link</a></div>`}
  </section></main></body></html>`);
});

// Reset password submit
app.post('/reset', async (req, res) => {
  try {
    const { token, password, password2 } = req.body || {};
    if (!token || !password || !password2) return res.status(400).send('Missing fields');
    if (password !== password2) return res.status(400).send('Passwords do not match');
    if (String(password).length < 6) return res.status(400).send('Password too short');
    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const { findValidResetToken, consumeResetToken, updateUserPassword } = require('./db');
    const rec = await findValidResetToken(tokenHash);
    if (!rec) return res.status(400).send('Invalid or expired token');
    const ok = await updateUserPassword(rec.username, password);
    if (!ok.ok) return res.status(500).send('Failed to update password');
    await consumeResetToken(tokenHash);
    return res.redirect('/login?success=' + encodeURIComponent('Password updated. Please login.'));
  } catch (e) {
    console.error('[RESET] error', e);
    return res.status(500).send('Server error');
  }
});

// Registration page
app.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  const rawError = typeof req.query.error === 'string' ? req.query.error : '';
  const safeError = rawError.replace(/</g,'&lt;').replace(/>/g,'&gt;');
  res.send(`<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Create Account - Crossword</title>
  <link rel="shortcut icon" href="/favicon.ico">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/login.css" />
  </head>
  <body class="login-body">
    <div class="login-gradient"></div>
    <main class="login-wrapper" aria-label="Registration form">
      <section class="login-card" role="form">
        <header class="login-header">
          <h1 class="login-title">Create Account</h1>
          <p class="login-subtitle">Join and start solving puzzles</p>
        </header>
        ${safeError ? `<div class="alert alert-error" role="alert">${safeError}</div>` : ''}
        <form method="POST" action="/register" class="login-form" autocomplete="off" id="registerForm">
          <label for="reg_username" class="field-label">Username</label>
          <div class="field-group">
            <input id="reg_username" name="username" class="input" required placeholder="letters, numbers, _ (3-24)" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" />
          </div>
          <label for="reg_email" class="field-label" style="margin-top:1rem">Email</label>
          <div class="field-group">
            <input id="reg_email" type="email" name="email" class="input" required placeholder="you@example.com" maxlength="120" />
          </div>
          <label for="reg_password" class="field-label" style="margin-top:1rem">Password</label>
          <div class="field-group">
            <input id="reg_password" type="password" name="password" class="input" required placeholder="Min 6 characters" minlength="6" maxlength="100" />
          </div>
          <label for="reg_password2" class="field-label" style="margin-top:1rem">Confirm Password</label>
          <div class="field-group">
            <input id="reg_password2" type="password" name="password2" class="input" required placeholder="Repeat password" minlength="6" maxlength="100" />
          </div>
          <button type="submit" class="button-primary" aria-label="Create account">Create Account</button>
        </form>
        <div style="margin-top:1rem;text-align:center;font-size:0.85rem;">
          <span>Already have an account? <a href="/login" style="color:#4ea0ff;text-decoration:none;font-weight:500;">Login</a></span>
        </div>
        <footer class="login-footer">
          <small>By creating an account you agree to basic fair use of this Platform.</small>
        </footer>
      </section>
    </main>
    <script>
      const form = document.getElementById('registerForm');
      form?.addEventListener('submit', (e) => {
        const p1 = document.getElementById('reg_password').value;
        const p2 = document.getElementById('reg_password2').value;
        if (p1 !== p2) {
          e.preventDefault();
          alert('Passwords do not match');
        }
      });
    </script>
  </body>
  </html>`);
});

// Registration submit
app.post('/register', async (req, res) => {
  const { username, email, password, password2 } = req.body || {};
  if (!username || !email || !password || !password2) return res.redirect('/register?error=All%20fields%20required');
  if (password !== password2) return res.redirect('/register?error=Passwords%20do%20not%20match');
  if (!dbReady && !memoryMode) return res.redirect('/register?error=Database%20unavailable');
  const cleaned = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(cleaned)) return res.redirect('/register?error=Invalid%20username');
  if (password.length < 6) return res.redirect('/register?error=Password%20too%20short');
  const trimmedEmail = String(email).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) return res.redirect('/register?error=Invalid%20email');
  try {
    const existing = await findUser(cleaned);
    if (existing && existing.passwordHash) return res.redirect('/register?error=Username%20already%20taken');
    const { addUserWithPassword } = require('./db');
    await addUserWithPassword(cleaned, password, trimmedEmail);
    req.session.user = { username: cleaned };
    console.log('[REGISTER] created user', cleaned);
    return res.redirect('/');
  } catch (e) {
    console.error('[REGISTER] error', e);
    return res.redirect('/register?error=Server%20error');
  }
});

let dbReady = false; // track DB availability (true if real DB connected)
let memoryMode = false; // true if fallback memory store is active

// Login submit (POST) - verify username & password (no auto creation)
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.redirect('/login?error=Credentials%20required');
  if (!dbReady && !memoryMode) return res.redirect('/login?error=Database%20unavailable');
  const cleaned = username.trim().toLowerCase();
  try {
    console.log('[LOGIN] attempt for username:', cleaned);
    const user = await findUser(cleaned);
    if (!user) {
      console.log('[LOGIN] rejected (user not found):', cleaned);
      return res.redirect('/login?error=Invalid%20credentials');
    }
    const { verifyUserPassword } = require('./db');
    const ok = await verifyUserPassword(cleaned, password);
    if (!ok) {
      console.log('[LOGIN] rejected (bad password):', cleaned);
      return res.redirect('/login?error=Invalid%20credentials');
    }
    req.session.user = { username: cleaned };
    console.log('[LOGIN] success for', cleaned);
    return res.redirect('/');
  } catch (e) {
    console.error('[LOGIN] error', e);
    return res.redirect('/login?error=Server%20error');
  }
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Directory for saving puzzles/answers
const PUZZLES_DIR = process.env.PUZZLES_DIR || path.join(__dirname, 'puzzles');

// Crossword data route (protected) - resume unfinished or generate new and store as current
app.get('/data', requireAuth, async (req, res) => {
  try {
    const username = req.session.user.username;
    const { getCurrentPuzzleState } = require('./db');
    const state = await getCurrentPuzzleState(username);
    if (state && state.puzzleId) {
      // Load existing puzzle from disk and return with saved answers
      try {
        const puzzleDir = path.join(PUZZLES_DIR, state.puzzleId);
        const jsonPath = path.join(puzzleDir, 'puzzle.json');
        const raw = await fsp.readFile(jsonPath, 'utf-8');
        const rec = JSON.parse(raw);
        const legendText = rec.legend || '';
        const answerArrayFlat = rec.answerFlattened;
        const myStringUnedited = rec.displayString;
        const wrongAttempts = state.wrongAttempts || 0;
        const elapsedTime = state.elapsedTime || 0;
        return res.json({ puzzleId: rec.puzzleId, output: '', myStringUnedited, answerArrayFlat, legend: legendText, userAnswers: state.answers || null, wrongAttempts, elapsedTime });
      } catch (e) {
        console.warn('[DATA] Could not load existing puzzle, generating a new one. Reason:', e.message);
        // fall through to generate new
      }
    }

    // No current puzzle -> generate a new one
    let output = '';
    let responded = false;
    const python = spawn('python', ['crossWord.py']);
    python.stdout.on('data', (data) => { output += data.toString(); });
    python.on('error', (err) => {
      if (responded) return; responded = true;
      console.error('Error executing Python script', err);
      res.status(500).json({ error: 'Python script execution failed' });
    });
    python.on('close', async (code) => {
      if (responded) return;
      if (code !== 0) { responded = true; return res.status(500).json({ error: 'Python script exited with code ' + code }); }
      try {
        const lines = output.split(/\r?\n/);
        const nonEmpty = lines.filter(l => l.trim().length > 0);
        const solutionLines = nonEmpty.slice(0, 10);
        const displayLines = nonEmpty.slice(10, 20);
        const legendLines = nonEmpty.slice(20);
        const solution = solutionLines.join('\n') + '\n';
        const puzzle = displayLines.join('\n') + '\n';
        const legendText = legendLines.join('. ');

        const array2D = solutionLines.map(row => row.trim().split(/\s+/));
        let answerArrayFlat = array2D.flat();
        answerArrayFlat = answerArrayFlat.filter(ch => ch !== '');
        answerArrayFlat = answerArrayFlat.join('');

        let myStringUnedited = puzzle;
        myStringUnedited = myStringUnedited.replace(/[\n\r]/g, "");
        myStringUnedited = myStringUnedited.replace(/\s{2}/g, "@");
        myStringUnedited = myStringUnedited.replace(/\s+/g, "");
        myStringUnedited = myStringUnedited.replace(/@/g, " ");

        const indices = [];
        const maxReveals = 10;
        while (indices.length < maxReveals && indices.length < myStringUnedited.length) {
          const index = Math.floor(Math.random() * myStringUnedited.length);
          const char = myStringUnedited[index];
          if (char !== '-' && !/\d/.test(char) && !indices.includes(index)) indices.push(index);
        }
        for (let i = 0; i < indices.length; i++) {
          const index = indices[i];
          if (index < myStringUnedited.length && index < answerArrayFlat.length) {
            myStringUnedited = myStringUnedited.substring(0, index) + answerArrayFlat[index] + myStringUnedited.substring(index + 1);
          }
        }

        const timestamp = new Date().toISOString();
        const fileSafeTime = timestamp.replace(/[:.]/g, '-');
        const puzzleId = `${fileSafeTime}-${Math.random().toString(36).slice(2,8)}`;
        const record = {
          puzzleId,
          createdAt: timestamp,
          solutionRaw: solution.trim(),
          puzzleRaw: puzzle.trim(),
          answerFlattened: answerArrayFlat,
          displayString: myStringUnedited,
          indicesRevealed: indices,
          legend: legendText
        };
        try {
          const puzzleDir = path.join(PUZZLES_DIR, puzzleId);
          await fsp.mkdir(puzzleDir, { recursive: true });
          const jsonPath = path.join(puzzleDir, 'puzzle.json');
          await fsp.writeFile(jsonPath, JSON.stringify(record, null, 2), 'utf-8');
          console.log(`[PUZZLE] Saved puzzle ${puzzleId} -> ${jsonPath}`);

          // Build SVG from solution
          const grid = array2D;
          const CELL = 50;
          const width = grid[0].length * CELL;
          const height = grid.length * CELL;
          let svg = [];
          svg.push(`<?xml version="1.0" encoding="UTF-8"?>`);
          svg.push(`<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${width}\" height=\"${height}\" viewBox=\"0 0 ${width} ${height}\" font-family=\"Arial, sans-serif\">`);
          svg.push(`<rect width=\"100%\" height=\"100%\" fill=\"#ffffff\"/>`);
          for (let r = 0; r < grid.length; r++) {
            for (let c = 0; c < grid[r].length; c++) {
              const x = c * CELL;
              const y = r * CELL;
              const ch = grid[r][c];
              const isBlack = ch === '-' || ch === '';
              svg.push(`<rect x=\"${x}\" y=\"${y}\" width=\"${CELL}\" height=\"${CELL}\" fill=\"${isBlack ? '#000' : '#fff'}\" stroke=\"#000\" stroke-width=\"1\"/>`);
              if (!isBlack) {
                svg.push(`<text x=\"${x + CELL / 2}\" y=\"${y + CELL / 2 + 10}\" font-size=\"24\" text-anchor=\"middle\" fill=\"#000\">${ch.toUpperCase()}</text>`);
              }
            }
          }
          svg.push('</svg>');
          const svgContent = svg.join('\n');
          const svgPath = path.join(puzzleDir, 'puzzle.svg');
          await fsp.writeFile(svgPath, svgContent, 'utf-8');
          console.log(`[PUZZLE] SVG image saved -> ${svgPath}`);
        } catch (e) {
          console.warn('[PUZZLE] Failed to persist puzzle:', e.message);
        }

        // Set current puzzle for the user
        try {
          const { setCurrentPuzzle } = require('./db');
          await setCurrentPuzzle(username, puzzleId);
        } catch (e) {
          console.warn('[DATA] Failed to set current puzzle:', e.message);
        }

        responded = true;
        return res.json({ puzzleId, output, myStringUnedited, answerArrayFlat, legend: legendText, userAnswers: null, wrongAttempts: 0 });
      } catch (err) {
        responded = true;
        console.error('[PUZZLE] Processing error:', err);
        res.status(500).json({ error: 'Puzzle processing failed' });
      }
    });
  } catch (e) {
    console.error('[DATA] error', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Dashboard (protected)
app.get('/', requireAuth, async (req, res) => {
  const u = await findUser(req.session.user.username);
  const score = u?.score || 0;
  const solvedCount = Array.isArray(u?.completedPuzzles) ? u.completedPuzzles.length : score;
  const failedCount = Array.isArray(u?.failedPuzzles) ? u.failedPuzzles.length : 0;
  const attemptsTotal = solvedCount + failedCount;
  const accuracyPct = attemptsTotal > 0 ? Math.round((solvedCount / attemptsTotal) * 1000) / 10 : 0; // one decimal
  const hasCurrent = !!u?.currentPuzzleId;
  const history = Array.isArray(u?.completedHistory) ? u.completedHistory.slice().sort((a,b) => new Date(b.completedAt) - new Date(a.completedAt)) : [];
  const recent = history.slice(0, 5);
  const firstSolved = history.length ? new Date(history[history.length - 1].completedAt) : null;
  const lastSolved = history.length ? new Date(history[0].completedAt) : null;
  // Render-friendly strings (avoid any numeric count-up logic)
  const firstSolvedText = firstSolved ? firstSolved.toLocaleDateString() : '-';
  const lastSolvedText = lastSolved ? lastSolved.toLocaleDateString() : '-';

  // Load tips from tips.json and choose a random tip
  let randomTip = 'Solve puzzles regularly to boost your accuracy and speed.';
  try {
    const tipsPath = path.join(__dirname, 'tips.json');
    const tipsRaw = await fsp.readFile(tipsPath, 'utf-8');
    const tipsJson = JSON.parse(tipsRaw);
    const list = Array.isArray(tipsJson?.tips) ? tipsJson.tips.filter(t => typeof t === 'string' && t.trim().length > 0) : [];
    if (list.length) {
      randomTip = list[Math.floor(Math.random() * list.length)].trim();
    }
  } catch (_) { /* ignore, keep fallback */ }

  // Escape tip for safe HTML rendering
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  const tipText = esc(randomTip);
  const rows = recent.map(h => {
    const id = h.puzzleId;
    const time = new Date(h.completedAt).toLocaleString();
    const elapsedSec = h.elapsedTime || 0;
    const elapsedFormatted = elapsedSec > 0 ? formatElapsedTime(elapsedSec) : '-';
    return { id, time, elapsedFormatted };
  }).map((r, i) => `<tr class="row-in" style="animation-delay:${0.06 * i}s"><td><code>${r.id}</code></td><td>${r.time}</td><td>${r.elapsedFormatted}</td></tr>`).join('');
  
  function formatElapsedTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
  
  res.send(`<!doctype html>
  <html><head><meta charset="utf-8"/>
  <title>Dashboard - Crossword</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="shortcut icon" href="/favicon.ico">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root{
      --bg:#0a0e1a; --panel:#11162a; --panel-2:#0e1430; --panel-3:#0a1130; --line:#253053;
      --text:#eaf0ff; --muted:#9aa3b2; --accent:#5aa0ff; --accent-2:#7d2ae8; --success:#1dd1a1; --warn:#f6ad55;
      --danger:#ef476f; --glow:0 10px 30px -12px rgba(125,42,232,.55),0 6px 16px -10px rgba(90,160,255,.35);
    }
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:
      radial-gradient(1200px 700px at 15% -10%,rgba(125,42,232,.18),transparent 60%),
      radial-gradient(1000px 600px at 95% 0%,rgba(90,160,255,.14),transparent 60%),
      repeating-linear-gradient(0deg, rgba(255,255,255,.03) 0 1px, transparent 1px 40px),
      var(--bg);
      color:var(--text);font-family:Inter,system-ui,"Segoe UI",Arial,Helvetica,sans-serif}
  .wrap{max-width:1200px;margin:0 auto;padding:32px}
    .hello{font-weight:600;color:var(--muted);letter-spacing:.3px;display:inline-block;animation:slideIn .6s ease-out both}
    .username{background:linear-gradient(90deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:800;animation:popIn .6s .1s both}
    h1.welcome{margin:0 0 8px;font-size:30px;letter-spacing:.4px}
    .sub{color:var(--muted);font-size:14px;margin-bottom:16px}

  .cards{display:grid;grid-template-columns:1fr;gap:24px;align-items:stretch;margin-top:12px}
  @media(min-width:960px){.cards{grid-template-columns:repeat(2,1fr);gap:24px}}
  .card{background:linear-gradient(180deg,rgba(17,22,42,.85),rgba(13,18,36,.85));border:1px solid #223057;border-radius:16px;padding:22px;box-shadow:var(--glow);backdrop-filter:saturate(120%) blur(6px);height:100%;display:flex;flex-direction:column}
    .card h2{margin:0 0 10px;font-size:16px;letter-spacing:.35px;color:#dfe6ff}

    .metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
    @media(max-width:960px){.metrics{grid-template-columns:repeat(2,1fr)}}
    .metric{display:flex;gap:12px;align-items:center;background:linear-gradient(180deg,rgba(13,17,48,.9),rgba(10,16,42,.9));border:1px solid #273568;border-radius:14px;padding:14px}
    .metric .icon{width:38px;height:38px;display:grid;place-items:center;border-radius:10px;background:linear-gradient(135deg,rgba(90,160,255,.18),rgba(125,42,232,.18));border:1px solid #2a3355}
    .metric .metric-label{font-size:12px;color:var(--muted)}
    .metric .metric-value{font-size:24px;font-weight:800;margin-top:2px}
    .animate{opacity:0;transform:translateY(12px)}
    .in{animation:rise .55s ease forwards}

    .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:12px 16px;border-radius:12px;font-weight:700;text-decoration:none;border:1px solid transparent;transition:.2s ease;letter-spacing:.3px;min-height:44px;box-sizing:border-box;line-height:1.1}
  .actions .btn{min-width:160px}
  button.btn{appearance:none;-webkit-appearance:none;background:transparent;border-width:1px;cursor:pointer;font:inherit}
    .btn-primary{position:relative;background:linear-gradient(90deg,var(--accent-2),#9b6dff);color:#fff;box-shadow:var(--glow);overflow:hidden}
    .btn-primary::after{content:"";position:absolute;inset:0;background:linear-gradient(120deg,transparent,rgba(255,255,255,.18),transparent);transform:translateX(-120%);transition:transform .6s}
    .btn-primary:hover::after{transform:translateX(120%)}
    .btn-primary:hover{filter:brightness(1.05);transform:translateY(-1px)}
    .btn-outline{background:transparent;color:#d6dcff;border-color:#3a4672}
    .btn-outline:hover{border-color:#5a6bb2;transform:translateY(-1px)}

    table{width:100%;border-collapse:collapse;font-size:14px}
    thead th{color:#cfd6ff;text-align:left;font-weight:700;border-bottom:1px solid var(--line);padding:10px}
    tbody td{padding:12px 10px;border-bottom:1px solid #1f294a}
  tbody tr:hover{background:#0f1530}
  tbody tr.row-in{opacity:0;transform:translateY(6px);animation:fadeUp .45s ease forwards}
    code{background:#0c1430;border:1px solid #22305a;border-radius:6px;padding:2px 6px;color:#cfe1ff}
    .tag{display:inline-block;margin-right:8px;background:#0e1838;border:1px solid #27407a;color:#cfe1ff;padding:4px 8px;border-radius:999px;font-size:12px;text-decoration:none}
    .tag:hover{background:#14204b}

    .chip{display:inline-flex;align-items:center;gap:8px;background:rgba(15,25,60,.6);border:1px solid #2a3a6b;padding:6px 10px;border-radius:999px;font-size:12px;color:#cfe1ff}
    .chip svg{opacity:.85}

  .hero{display:grid;grid-template-columns:1fr;gap:24px;margin-bottom:24px;align-items:stretch}
  @media(min-width:960px){.hero{grid-template-columns:repeat(2,1fr);align-items:stretch;gap:24px}}
  .hero-card{background:linear-gradient(180deg,rgba(17,22,42,.85),rgba(13,18,36,.85));border:1px solid #223057;border-radius:16px;padding:18px;box-shadow:var(--glow);position:relative;overflow:hidden;height:100%;display:flex;flex-direction:column}
    .hero-card::before{content:"";position:absolute;inset:-80px -60px auto auto;width:260px;height:260px;border-radius:50%;background:radial-gradient(closest-side,rgba(125,42,232,.18),transparent);filter:blur(8px);opacity:.8}
  .gauge-wrap{flex:1;display:grid;place-items:center}
  .gauge{width:180px;height:180px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--accent) 0%, #1b2448 0);border:1px solid #2a3a6b;box-shadow:inset 0 0 0 8px #0d1638}
    .gauge .center{width:130px;height:130px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(180deg,#0f1738,#0b1232);border:1px solid #263565;box-shadow:inset 0 0 18px rgba(125,42,232,.25)}
    .gauge .center .val{font-weight:800;font-size:22px}
    .gauge .center .lbl{font-size:11px;color:var(--muted)}

    .progress{height:12px;background:#0e1531;border:1px solid #27325a;border-radius:999px;overflow:hidden}
    .progress>span{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--accent),var(--accent-2));transition:width .85s cubic-bezier(.2,.7,.2,1)}
    .acc-text{opacity:0;transform:translateY(6px);transition:.35s ease}
    .acc-text.show{opacity:1;transform:none}

    @keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
    @keyframes slideIn{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
    @keyframes popIn{0%{opacity:0;transform:scale(.96)}60%{opacity:1;transform:scale(1.04)}100%{opacity:1;transform:scale(1)}}
  </style>
  </head><body>
    <div class="wrap">
      <div class="hero">
        <div class="hero-card animate in" style="animation-delay:.0s">
          <h1 class="welcome"><span class="hello">Welcome,</span> <span class="username">${u?.username || ''}</span></h1>
          <div class="sub">Your crossword command center</div>
          <div class="actions">
            ${hasCurrent ? '<a href="/play" class="btn btn-primary">Resume Puzzle</a>' : '<a href="/play" class="btn btn-primary">Play Puzzle</a>'}
            <form method="POST" action="/logout" style="display:inline"><button class="btn btn-outline" type="submit">Logout</button></form>
          </div>
          <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
            <span class="chip"><svg width="14" height="14" viewBox="0 0 24 24" fill="#5aa0ff" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10"/></svg> Total Attempts: <strong>${attemptsTotal}</strong></span>
          </div>
        </div>
        <div class="hero-card animate in" style="animation-delay:.05s">
          <h2 style="margin:0 0 12px">Your Accuracy</h2>
          <div class="gauge-wrap">
            <div class="gauge" id="gauge" aria-label="Accuracy ${accuracyPct}%">
              <div class="center">
                <div class="val" id="gaugeVal">0%</div>
                <div class="lbl">Accuracy</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card animate in" style="animation-delay:.08s">
        <div class="metrics">
          <div class="metric card animate" style="--delay:.05s">
            <div class="icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#ffd166" xmlns="http://www.w3.org/2000/svg"><path d="M12 2l2.39 4.84 5.34.78-3.86 3.76.91 5.31L12 14.77 7.22 16.69l.91-5.31L4.27 7.62l5.34-.78L12 2z"/></svg>
            </div>
            <div class="metric-body"><div class="metric-label">Total Score</div><div class="metric-value" data-value="${score}">0</div></div>
          </div>
          <div class="metric card animate" style="--delay:.12s">
            <div class="icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#ef476f" xmlns="http://www.w3.org/2000/svg"><path d="M3 3h18v2H3V3zm2 4h14l-2 12H7L5 7zm6 2v8h2V9h-2z"/></svg>
            </div>
            <div class="metric-body"><div class="metric-label">Unsuccessful Puzzles</div><div class="metric-value" data-value="${failedCount}">0</div></div>
          </div>
          <div class="metric card animate" style="--delay:.18s">
            <div class="icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#1dd1a1" xmlns="http://www.w3.org/2000/svg"><path d="M7 11h5v5H7z"/><path d="M19 3H5a2 2 0 00-2 2v14l4-4h12a2 2 0 002-2V5a2 2 0 00-2-2z"/></svg>
            </div>
            <div class="metric-body"><div class="metric-label">First Solved</div><div class="metric-value">${firstSolvedText}</div></div>
          </div>
          <div class="metric card animate" style="--delay:.24s">
            <div class="icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#5aa0ff" xmlns="http://www.w3.org/2000/svg"><path d="M12 8v5l4 2"/><circle cx="12" cy="12" r="10" stroke="#5aa0ff" fill="none"/></svg>
            </div>
            <div class="metric-body"><div class="metric-label">Last Solved</div><div class="metric-value">${lastSolvedText}</div></div>
          </div>
        </div>
      </div>

      <div class="cards">
        <div class="card animate in" style="animation-delay:.1s">
          <h2>Recent Completions</h2>
          ${rows ? `
            <table>
              <thead><tr><th>Puzzle ID</th><th>Completed At</th><th>Time</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          ` : `
            <div style="padding:12px 4px;color:var(--muted);display:flex;align-items:center;gap:10px">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#9aa3b2" xmlns="http://www.w3.org/2000/svg"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 5v6h5v2h-7V7h2z"/></svg>
              No completions yet. Solve your first puzzle to see it here.
            </div>
          `}
        </div>

        <div class="card animate in" style="animation-delay:.16s">
          <h2>Export My History</h2>
          <p class="muted" style="margin:8px 0 14px">Download a ZIP with your completed and failed puzzles, including a summary.json and any available puzzle JSON/SVG artifacts. Great for review or sharing.</p>
          <a href="/export-history" class="btn btn-primary" aria-label="Download history ZIP" style="display:inline-flex;align-items:center;gap:8px">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke="#fff" stroke-width="2" fill="none"/></svg>
            Download ZIP
          </a>
        </div>
        <div class="card animate in" style="animation-delay:.22s">
          <h2>Tip of the moment</h2>
          <p class="muted" style="margin:8px 0 4px">${tipText}</p>
        </div>
      </div>
    </div>
    <script>
      // Stagger in
      document.querySelectorAll('.card.animate').forEach((el,i)=>{
        const d = el.style.animationDelay || (i*0.08)+'s';
        el.style.animationDelay = d;
        el.classList.add('in');
      });
      // Count-up metrics
      const nums = document.querySelectorAll('.metric-value[data-value]');
      nums.forEach((el)=>{
        const target = Number(el.getAttribute('data-value'))||0;
        // If value is not numeric (dates), skip animation
        if (!Number.isFinite(target)) return;
        const dur = 900; const start = performance.now();
        function step(t){ const p = Math.min((t - start) / dur, 1); const val = Math.floor(target * p); el.textContent = val; if(p<1) requestAnimationFrame(step);} requestAnimationFrame(step);
      });
      // Circular accuracy gauge animation
      (function(){
        const pct = ${accuracyPct};
        const gauge = document.getElementById('gauge');
        const valEl = document.getElementById('gaugeVal');
        if (!gauge || !valEl) return;
        const dur = 1000; const start = performance.now();
        function draw(t){
          const p = Math.min((t - start) / dur, 1);
          const v = Math.round(pct * p * 10) / 10;
          gauge.style.background = 'conic-gradient(var(--accent) ' + v + '%, #1b2448 0)';
          valEl.textContent = v.toFixed(1) + '%';
          if (p < 1) requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
      })();
    </script>
  </body></html>`);
});

// Puzzle play page (protected)
app.get('/play', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin: list password reset requests
app.get('/admin/resets', requireAdmin, async (req, res) => {
  try {
    const { listPasswordResetRequests } = require('./db');
    const showResolved = req.query.showResolved !== 'false';
    const items = await listPasswordResetRequests(showResolved);
    const rows = items.map(r => `
      <tr>
        <td>${r._id || ''}</td>
        <td>${(r.username||'')}</td>
        <td>${(r.email||'')}</td>
        <td>${new Date(r.createdAt).toLocaleString()}</td>
        <td>${r.resolvedAt ? new Date(r.resolvedAt).toLocaleString() : '-'}</td>
        <td>${r.resolvedBy || '-'}</td>
        <td>
          ${r.resolvedAt ? '' : `<form method="POST" action="/admin/resets/${r._id}/resolve" style="display:inline"><button>Resolve</button></form>`}
          <form method="POST" action="/admin/resets/${r._id}/delete" style="display:inline;margin-left:6px"><button>Delete</button></form>
        </td>
      </tr>`).join('');
    res.send(`<!doctype html>
    <html><head><meta charset="utf-8"/><title>Admin - Reset Requests</title>
    <link rel="shortcut icon" href="/favicon.ico">
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
    <style>table{border-collapse:collapse;font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px}td,th{border:1px solid #ccc;padding:6px 8px}th{background:#f5f7fb;text-align:left}body{padding:16px;background:#fafbff;color:#222}a,button{cursor:pointer}</style>
    </head><body>
    <h2>Password Reset Requests</h2>
    <div style="margin:8px 0 12px">
      <a href="/admin/resets?showResolved=true">Show All</a> ·
      <a href="/admin/resets?showResolved=false">Hide Resolved</a>
      <span style="margin-left:12px;color:#888">Logged in as: ${req.session.user.username}</span>
    </div>
    <table>
      <thead><tr><th>ID</th><th>Username</th><th>Email</th><th>Created</th><th>Resolved</th><th>By</th><th>Actions</th></tr></thead>

      <div class="card">
        <h2 style="margin:0 0 10px;font-size:18px">Need Your Full History?</h2>
        <p class="muted" style="margin:6px 0 12px">Only your 5 most recent completions are shown here. You can request your full puzzle history from an admin.</p>
        <form method="POST" action="/request-history" style="display:flex;gap:8px;flex-wrap:wrap">
          <input type="text" name="reason" placeholder="Optional message to admin" maxlength="200" style="flex:1;min-width:240px;padding:8px;border-radius:6px;border:1px solid #2a3150;background:#151a2b;color:#e8eaf3" />
          <button class="btn" type="submit">Request My History</button>
        </form>
      </div>

      <div class="card">
        <h2 style="margin:0 0 10px;font-size:18px">Request Previous Puzzle</h2>
        <p class="muted" style="margin:6px 0 12px">Ask an admin to retrieve your last generated puzzle (if available) or a specific prior puzzle.</p>
        <form method="POST" action="/request-previous-puzzle" style="display:flex;gap:8px;flex-wrap:wrap">
          <input type="text" name="note" placeholder="Optional note (e.g., date or puzzle ID)" maxlength="200" style="flex:1;min-width:240px;padding:8px;border-radius:6px;border:1px solid #2a3150;background:#151a2b;color:#e8eaf3" />
          <button class="btn" type="submit">Request Previous Puzzle</button>
        </form>
      </div>
      <tbody>${rows || '<tr><td colspan="7" style="color:#888">No requests</td></tr>'}</tbody>
    </table>
    </body></html>`);

// User: request their full history
app.post('/request-history', requireAuth, async (req, res) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 200) : '';
    const { addHistoryRequest } = require('./db');
    const ua = req.get('user-agent');
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    await addHistoryRequest({ username: req.session.user.username, reason, userAgent: ua, ip });
    return res.redirect('/?requestedHistory=1');
  } catch (e) {
    console.error('[HISTORY REQUEST] error', e);
    return res.redirect('/?requestedHistory=0');
  }
});

// Convenience GET endpoint for history request (for header link)
app.get('/request-history', requireAuth, async (req, res) => {
  try {
    const reason = typeof req.query?.reason === 'string' ? String(req.query.reason).slice(0, 200) : '';
    const { addHistoryRequest } = require('./db');
    const ua = req.get('user-agent');
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    await addHistoryRequest({ username: req.session.user.username, reason, userAgent: ua, ip });
    return res.redirect('/?requestedHistory=1');
  } catch (e) {
    console.error('[HISTORY REQUEST][GET] error', e);
    return res.redirect('/?requestedHistory=0');
  }
});

// User: request previous puzzle retrieval
app.post('/request-previous-puzzle', requireAuth, async (req, res) => {
  try {
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 200) : '';
    const { addPuzzleRequest } = require('./db');
    const ua = req.get('user-agent');
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    await addPuzzleRequest({ username: req.session.user.username, note, userAgent: ua, ip });
    return res.redirect('/?requestedPuzzle=1');
  } catch (e) {
    console.error('[PUZZLE REQUEST] error', e);
    return res.redirect('/?requestedPuzzle=0');
  }
});

// Convenience GET endpoint for previous puzzle request (for header link)
app.get('/request-previous-puzzle', requireAuth, async (req, res) => {
  try {
    const note = typeof req.query?.note === 'string' ? String(req.query.note).slice(0, 200) : '';
    const { addPuzzleRequest } = require('./db');
    const ua = req.get('user-agent');
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    await addPuzzleRequest({ username: req.session.user.username, note, userAgent: ua, ip });
    return res.redirect('/?requestedPuzzle=1');
  } catch (e) {
    console.error('[PUZZLE REQUEST][GET] error', e);
    return res.redirect('/?requestedPuzzle=0');
  }
});
  } catch (e) {
    console.error('[ADMIN] list resets error', e);
    res.status(500).send('Server error');
  }
});

// Admin: list user history requests
app.get('/admin/history-requests', requireAdmin, async (req, res) => {
  try {
    const { listHistoryRequests } = require('./db');
    const showResolved = req.query.showResolved !== 'false';
    const items = await listHistoryRequests(showResolved);
    const rows = items.map(r => `
      <tr>
        <td>${r._id || ''}</td>
        <td>${(r.username||'')}</td>
        <td>${(r.reason||'')}</td>
        <td>${new Date(r.createdAt).toLocaleString()}</td>
        <td>${r.resolvedAt ? new Date(r.resolvedAt).toLocaleString() : '-'}</td>
        <td>${r.resolvedBy || '-'}</td>
        <td>
          ${r.resolvedAt ? '' : `<form method="POST" action="/admin/history-requests/${r._id}/resolve" style="display:inline"><button>Resolve</button></form>`}
          <form method="POST" action="/admin/history-requests/${r._id}/delete" style="display:inline;margin-left:6px"><button>Delete</button></form>
        </td>
      </tr>`).join('');
    res.send(`<!doctype html>
    <html><head><meta charset="utf-8"/><title>Admin - History Requests</title>
    <link rel="shortcut icon" href="/favicon.ico">
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
    <style>table{border-collapse:collapse;font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px}td,th{border:1px solid #ccc;padding:6px 8px}th{background:#f5f7fb;text-align:left}body{padding:16px;background:#fafbff;color:#222}a,button{cursor:pointer}</style>
    </head><body>
    <h2>User History Requests</h2>
    <div style="margin:8px 0 12px">
      <a href="/admin/history-requests?showResolved=true">Show All</a> ·
      <a href="/admin/history-requests?showResolved=false">Hide Resolved</a>
      <span style="margin-left:12px;color:#888">Logged in as: ${req.session.user.username}</span>
    </div>
    <table>
      <thead><tr><th>ID</th><th>Username</th><th>Reason</th><th>Created</th><th>Resolved</th><th>By</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" style="color:#888">No requests</td></tr>'}</tbody>
    </table>
    </body></html>`);
  } catch (e) {
    console.error('[ADMIN] list history requests error', e);
    res.status(500).send('Server error');
  }
});

// Admin: list previous-puzzle requests
app.get('/admin/puzzle-requests', requireAdmin, async (req, res) => {
  try {
    const { listPuzzleRequests } = require('./db');
    const showResolved = req.query.showResolved !== 'false';
    const items = await listPuzzleRequests(showResolved);
    const rows = items.map(r => `
      <tr>
        <td>${r._id || ''}</td>
        <td>${(r.username||'')}</td>
        <td>${(r.note||'')}</td>
        <td>${new Date(r.createdAt).toLocaleString()}</td>
        <td>${r.resolvedAt ? new Date(r.resolvedAt).toLocaleString() : '-'}</td>
        <td>${r.resolvedBy || '-'}</td>
        <td>
          ${r.resolvedAt ? '' : `<form method="POST" action="/admin/puzzle-requests/${r._id}/resolve" style="display:inline"><button>Resolve</button></form>`}
          <form method="POST" action="/admin/puzzle-requests/${r._id}/delete" style="display:inline;margin-left:6px"><button>Delete</button></form>
        </td>
      </tr>`).join('');
    res.send(`<!doctype html>
    <html><head><meta charset="utf-8"/><title>Admin - Puzzle Requests</title>
    <link rel="shortcut icon" href="/favicon.ico">
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
    <style>table{border-collapse:collapse;font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px}td,th{border:1px solid #ccc;padding:6px 8px}th{background:#f5f7fb;text-align:left}body{padding:16px;background:#fafbff;color:#222}a,button{cursor:pointer}</style>
    </head><body>
    <h2>Previous Puzzle Requests</h2>
    <div style="margin:8px 0 12px">
      <a href="/admin/puzzle-requests?showResolved=true">Show All</a> ·
      <a href="/admin/puzzle-requests?showResolved=false">Hide Resolved</a>
      <span style="margin-left:12px;color:#888">Logged in as: ${req.session.user.username}</span>
    </div>
    <table>
      <thead><tr><th>ID</th><th>Username</th><th>Note</th><th>Created</th><th>Resolved</th><th>By</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" style="color:#888">No requests</td></tr>'}</tbody>
    </table>
    </body></html>`);
  } catch (e) {
    console.error('[ADMIN] list puzzle requests error', e);
    res.status(500).send('Server error');
  }
});

// Admin: resolve a previous-puzzle request
app.post('/admin/puzzle-requests/:id/resolve', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { resolvePuzzleRequest } = require('./db');
    await resolvePuzzleRequest(id, req.session.user.username);
    res.redirect('/admin/puzzle-requests');
  } catch (e) {
    console.error('[ADMIN] resolve puzzle request error', e);
    res.status(500).send('Server error');
  }
});

// Admin: delete a previous-puzzle request
app.post('/admin/puzzle-requests/:id/delete', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { deletePuzzleRequest } = require('./db');
    await deletePuzzleRequest(id);
    res.redirect('/admin/puzzle-requests');
  } catch (e) {
    console.error('[ADMIN] delete puzzle request error', e);
    res.status(500).send('Server error');
  }
});

// Admin: resolve a history request
app.post('/admin/history-requests/:id/resolve', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { resolveHistoryRequest } = require('./db');
    await resolveHistoryRequest(id, req.session.user.username);
    res.redirect('/admin/history-requests');
  } catch (e) {
    console.error('[ADMIN] resolve history request error', e);
    res.status(500).send('Server error');
  }
});

// Admin: delete a history request
app.post('/admin/history-requests/:id/delete', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { deleteHistoryRequest } = require('./db');
    await deleteHistoryRequest(id);
    res.redirect('/admin/history-requests');
  } catch (e) {
    console.error('[ADMIN] delete history request error', e);
    res.status(500).send('Server error');
  }
});

// Admin: resolve
app.post('/admin/resets/:id/resolve', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { resolvePasswordResetRequest } = require('./db');
    await resolvePasswordResetRequest(id, req.session.user.username);
    res.redirect('/admin/resets');
  } catch (e) {
    console.error('[ADMIN] resolve reset error', e);
    res.status(500).send('Server error');
  }
});

// Admin: delete
app.post('/admin/resets/:id/delete', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { deletePasswordResetRequest } = require('./db');
    await deletePasswordResetRequest(id);
    res.redirect('/admin/resets');
  } catch (e) {
    console.error('[ADMIN] delete reset error', e);
    res.status(500).send('Server error');
  }
});

// Submit puzzle result (expects JSON { puzzleId, correct: true/false })
app.post('/submit-score', requireAuth, async (req, res) => {
  try {
    const { puzzleId, correct, elapsedTime } = req.body || {};
    if (!puzzleId || typeof correct !== 'boolean') return res.status(400).json({ error: 'Invalid payload' });

    // Session state for this puzzle
    if (!req.session.puzzleState) req.session.puzzleState = {};
    const MAX_WRONG_ALLOWED = 4; // first wrong + 3 more attempts
    const state = req.session.puzzleState[puzzleId] || { wrongAttempts: 0, solved: false };

    // If already solved, do not process again
    if (state.solved) {
      const userDoc = await findUser(req.session.user.username);
      return res.json({ updated: false, alreadySolved: true, solved: true, score: userDoc?.score || 0 });
    }

    if (!correct) {
      // DB-backed attempt counter
      const { incrementWrongAttempt, getCurrentPuzzleState } = require('./db');
      await incrementWrongAttempt(req.session.user.username, puzzleId);
      const st = await getCurrentPuzzleState(req.session.user.username);
      const attempts = st?.wrongAttempts || 0;
      const remaining = Math.max(0, MAX_WRONG_ALLOWED - attempts);
      const mustRestart = attempts >= MAX_WRONG_ALLOWED;
      // If exhausted attempts, mark as failed and clear current so a new puzzle can be generated next time
      if (mustRestart) {
        try {
          const { addFailedPuzzle, clearCurrentPuzzle } = require('./db');
          await addFailedPuzzle(req.session.user.username, puzzleId);
          await clearCurrentPuzzle(req.session.user.username, puzzleId);
        } catch (e) {
          console.warn('[SCORE] Failed to mark failed/clear current puzzle:', e.message);
        }
      }
      const userDoc = await findUser(req.session.user.username);
      return res.json({ updated: false, solved: false, remainingAttempts: remaining, mustRestart, score: userDoc?.score || 0 });
    }

    // Correct submission and not yet solved -> award if first time (DB-level)
    state.solved = true;
    req.session.puzzleState[puzzleId] = state;
    const result = await awardPointIfFirst(req.session.user.username, puzzleId, elapsedTime);
    // Clear current puzzle state so user can get a new one next time
    try {
      const { clearCurrentPuzzle } = require('./db');
      await clearCurrentPuzzle(req.session.user.username, puzzleId);
    } catch (e) {
      console.warn('[SCORE] Failed to clear current puzzle:', e.message);
    }
    return res.json({ ...result, solved: true });
  } catch (e) {
    console.error('[SCORE] submit error', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Save progress for current puzzle
app.post('/save-progress', requireAuth, async (req, res) => {
  try {
    const { puzzleId, answers, elapsedTime } = req.body || {};
    if (!puzzleId || typeof answers !== 'string') return res.status(400).json({ ok: false, error: 'Invalid payload' });
    const { getCurrentPuzzleState, updateCurrentPuzzleAnswers, updateCurrentPuzzleElapsedTime } = require('./db');
    const state = await getCurrentPuzzleState(req.session.user.username);
    if (!state || state.puzzleId !== puzzleId) return res.status(400).json({ ok: false, error: 'Not current puzzle' });
    await updateCurrentPuzzleAnswers(req.session.user.username, puzzleId, answers);
    if (typeof elapsedTime === 'number') {
      await updateCurrentPuzzleElapsedTime(req.session.user.username, elapsedTime);
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[SAVE] error', e);
    return res.status(500).json({ ok: false });
  }
});

// Fetch current user info (score)
app.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await findUser(req.session.user.username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ username: user.username, score: user.score || 0 });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Export user's full history as a ZIP
app.get('/export-history', requireAuth, async (req, res) => {
  try {
    const username = req.session.user.username;
    const u = await findUser(username);
    if (!u) return res.status(404).send('User not found');

    const completed = Array.isArray(u.completedHistory) ? u.completedHistory : [];
    const failed = Array.isArray(u.failedHistory) ? u.failedHistory : [];

    const zip = archiver('zip', { zlib: { level: 9 } });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `crossword-history-${username}-${ts}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    zip.pipe(res);

    // Summary JSON
    const summary = {
      user: username,
      generatedAt: new Date().toISOString(),
      totals: { completed: completed.length, failed: failed.length },
      completed,
      failed
    };
    zip.append(JSON.stringify(summary, null, 2), { name: 'summary.json' });

    // Attach artifacts for each puzzle if present
    function addPuzzleArtifacts(puzzleId, kind) {
      const puzzleDir = path.join(PUZZLES_DIR, puzzleId);
      const jsonPath = path.join(puzzleDir, 'puzzle.json');
      const svgPath = path.join(puzzleDir, 'puzzle.svg');
      if (fs.existsSync(jsonPath)) {
        zip.file(jsonPath, { name: `${kind}/${puzzleId}/puzzle.json` });
      }
      if (fs.existsSync(svgPath)) {
        zip.file(svgPath, { name: `${kind}/${puzzleId}/puzzle.svg` });
      }
    }

    for (const c of completed) {
      if (c && c.puzzleId) addPuzzleArtifacts(c.puzzleId, 'completed');
    }
    for (const f of failed) {
      if (f && f.puzzleId) addPuzzleArtifacts(f.puzzleId, 'failed');
    }

    zip.finalize();
  } catch (e) {
    console.error('[EXPORT] error', e);
    res.status(500).send('Failed to build export');
  }
});

// Start the server ONLY after a successful DB connection or approved memory fallback
const BASE_PORT = parseInt(process.env.PORT, 10) || 3000;
async function listenWithFallback(port, attempts = 3) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => resolve({ server, port }));
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && attempts > 0) {
        console.warn(`[STARTUP] Port ${port} in use. Trying ${port + 1}...`);
        listenWithFallback(port + 1, attempts - 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

(async () => {
  try {
    await connect();
    if (isMemoryMode()) {
      memoryMode = true;
      console.warn('[STARTUP] Running with in-memory user store (ALLOW_MEMORY_FALLBACK=true). DO NOT use in production.');
    } else {
      dbReady = true;
      console.log('[STARTUP] Database connection established. Launching server...');
    }
  } catch (err) {
    console.error('[FATAL] Cannot start without MongoDB (and no fallback enabled). Exiting.');
    process.exit(1);
  }
  try {
    const { server, port } = await listenWithFallback(BASE_PORT, 5);
    console.log(`Server running on http://localhost:${port} (db=${dbReady ? 'up' : 'down'} memoryFallback=${memoryMode})`);
    server.on('error', (err) => console.error('[SERVER ERROR]', err));
  } catch (err) {
    console.error('[FATAL] Could not bind to a port starting at', BASE_PORT, err.message);
    process.exit(1);
  }
})();

// Health/diagnostic endpoint (no auth)
app.get('/health', (req, res) => {
  const status = dbReady ? 'ok' : (memoryMode ? 'memory_fallback' : 'db_down');
  const code = dbReady || memoryMode ? 200 : 500;
  res.status(code).json({ status, db: dbReady ? 'up' : 'down', memoryMode, time: new Date().toISOString() });
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
  process.exit(1);
});
process.on('exit', (code) => {
  if (code !== 0) console.error('[PROCESS EXIT] code=', code);
});

// Seed users (will use MongoDB if available, otherwise the in-memory fallback)
// No auto-seeding: users must already exist in MongoDB.

