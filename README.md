# CrosswordNodeApp

Modern crossword generator and solver built with Node.js + Express, MongoDB, and a Python generator. Includes authentication, a secure password reset flow, a modern dashboard, a persistent in‑puzzle timer, and in‑app notifications.

## Highlights
- 10×10 interactive grid with keyboard navigation and black squares
- Timer that pauses when the tab is hidden; persisted and shown on the dashboard
- Save progress and resume; submit to score with duplicate‑solve detection
- Dashboard with recent completions (including solve times) and a random “Tip of the moment” from `tips.json`
- Accounts: registration (email required), login, logout
- Secure password reset via time‑limited email link
  - Reset link is sent only if BOTH username and email match the same account
  - Tokens are single‑use and expire (default: 15 minutes)

## Quick start (local)

Windows PowerShell (with in‑memory fallback, no MongoDB):
```powershell
$env:ALLOW_MEMORY_FALLBACK="true"
npm install
npm start
```
Then open http://localhost:3000

With MongoDB (local or Atlas):
```powershell
$env:ALLOW_MEMORY_FALLBACK=""            # disable fallback in prod
$env:MONGO_URI="mongodb://localhost:27017"  # or your Atlas URI
$env:MONGO_DB="crossworddb"
$env:SESSION_SECRET="<random-long-string>"
npm install
npm run seed   # creates initial users
npm start
```

The server binds to PORT or 3000 and will try the next few ports if busy.

## Email (SMTP) for reset links

Set these environment variables for email sending (if omitted, reset links are logged to the console):

```powershell
$env:SMTP_HOST="<smtp-host>"
$env:SMTP_PORT="587"            # 465 for SMTPS
$env:SMTP_USER="<smtp-username>"
$env:SMTP_PASS="<smtp-password>"
$env:SMTP_FROM="Crossword App <no-reply@yourdomain.com>"
$env:APP_BASE_URL="http://localhost:3000"   # public URL for links
```

Examples: Mailtrap, Gmail (App Password), Microsoft 365, SendGrid (SMTP). See the repository issues/notes for provider specifics.

## Environment variables

Minimum for production:
- `MONGO_URI` – e.g. mongodb+srv://… (Atlas) or mongodb://localhost:27017
- `MONGO_DB` – database name (e.g. crossworddb)
- `SESSION_SECRET` – long random string for sessions
- `PORT` – optional, default 3000
- `APP_BASE_URL` – public base URL used in reset emails
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` – to send emails
- `ADMIN_USERS` – optional, comma‑separated admins
- `ALLOW_MEMORY_FALLBACK` – set to `true` for dev without MongoDB (don’t use in prod)

## Features in depth

### Authentication and reset flow
- Registration requires a valid email and password (stored with bcrypt hashing)
- Forgot password requires email + username; if they match an account, a reset link is emailed
- Reset links expire in ~15 minutes and are single‑use

### Puzzle play
- Saves progress (answers + elapsed time) manually and via periodic autosave
- Timer pauses on tab blur and resumes on focus
- Wrong‑answer attempts are tracked; on too many wrong tries, a reload is forced
- When solved, your score updates and the timer stops; duplicate solves don’t re‑award

### Dashboard
- Recent completions include puzzle ID, completion date, and time taken
- “Tip of the moment” is randomized from `tips.json`

### Wordsets
You can add themed word lists as JSON files in the `wordsets/` folder. On each run, the generator randomly picks one JSON file from that folder. If the folder is empty or missing, it falls back to `words.json` in the project root.

Format (array of [word, clue] pairs):
```
[
  ["apple", "A fruit"],
  ["python", "A programming language"]
]
```

Notes:
- Words are normalized to lowercase and spaces removed
- Duplicate clues are filtered so only the first is kept

### Health and diagnostics
- `GET /health` returns `{ status: ok|memory_fallback|db_down, … }`
- On startup, the app logs whether MongoDB is connected or the memory fallback is active

## Project structure

```
├── app.js               # Express app and routes (auth, dashboard, puzzle API)
├── db.js                # MongoDB access + in‑memory fallback + reset token helpers
├── crossWord.py         # Python crossword generator
├── public/
│   ├── index.html       # Puzzle UI (timer, save/submit, toasts)
│   └── style.css        # Styles
├── tips.json            # Tips for the dashboard card
├── wordsets/            # Optional themed word lists
├── seedUsers.js         # Seeding script for initial users
├── package.json
└── README.md
```

## Deploying (MongoDB Atlas + a Node host)
1) Create an Atlas cluster and user; allow your host’s IP; copy the SRV connection string
2) Set environment variables on your host (see above), especially `MONGO_URI`, `MONGO_DB`, `SESSION_SECRET`, `APP_BASE_URL`, and SMTP vars
3) Install and start: `npm install` then `npm start` (or your platform’s start command)
4) Seed users once with `npm run seed`

Tip: platforms like Render, Railway, Fly.io, and Heroku‑like environments work well. Ensure `PORT` is honored and `APP_BASE_URL` matches your public URL so reset links are correct.

## Troubleshooting
- “db_down” in /health: set `MONGO_URI`/`MONGO_DB` or enable `ALLOW_MEMORY_FALLBACK` for development
- No reset email: verify SMTP vars; when not configured, links are logged to the server console
- Port in use: the app auto‑increments the port a few times on startup

## License
MIT

## Author
- [inusha-thathsara](https://github.com/inusha-thathsara)
