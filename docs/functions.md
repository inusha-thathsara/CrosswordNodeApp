# Functional Documentation

This document explains the main features and flows of the application.

## 1. Authentication

### 1.1 Register
- Navigate to `/register`.
- Provide username, email, and password (min length enforced).
- Email is required and validated.
- On success, you can log in at `/login`.

### 1.2 Login
- Navigate to `/login`.
- Enter your username and password.
- On success, you are redirected to the dashboard (`/`).

### 1.3 Forgot password (reset link)
- Navigate to `/forgot`.
- Enter BOTH your email and username.
- If they match the same account, a time‑limited reset link is emailed.
- If not, the system does not send a link and only notifies the admin (generic message shown to avoid information leaks).

### 1.4 Reset password
- Open the link you received via email.
- Enter a new password and confirm.
- Tokens are single‑use and expire in ~15 minutes.
- After success, go to `/login` and sign in with your new password.

### 1.5 Logout
- Use the logout control on the dashboard or header to end your session.

## 2. Dashboard
- Displays recent completions with solve time (elapsed time from the puzzle page).
- Shows first/last solved dates (presented as text, not animated numbers).
- Includes a randomized “Tip of the moment” from `tips.json`.
- Provides an "Export My History" action that downloads your activity as a ZIP.

## 3. Content Generation (Puzzle)
- Visit the puzzle page (e.g., click "Start"/"Continue" from the dashboard).
- The server generates or resumes a 10×10 puzzle using `crossWord.py` and word sets.
- Inputs & actions:
  - Fill cells (letters only; number hints appear as non‑editable overlays).
  - Save Progress: persists your current answers and timer state.
  - Submit: checks answers against the solution.
  - Reset: restores the puzzle to the initial state (clears inputs, resets timer).
- Timer behavior:
  - Visible in the header; starts on page load.
  - Pauses automatically when the tab is hidden; resumes when visible.
  - Saved with your progress and attached to your completion record.
- Wrong attempts:
  - Wrong submissions increment a counter.
  - If the limit is reached, you must restart (page reload enforced).
- Scoring:
  - First‑time correct completion awards +1 score.
  - Duplicate solves don’t award points again.

## 4. Past Actions (History)
- Your progress (answers + elapsed time) is saved on demand and periodically (autosave).
- On completion, an entry is added to your history (puzzleId, time, elapsed seconds).
- The dashboard lists your recent completions; the export includes a fuller dataset.

## 5. Report Generation (Export)
- From the dashboard, click "Export My History".
- The app builds a ZIP including:
  - Profile summary JSON
  - Completed history JSON (with elapsed times)
  - Failed attempts JSON (if applicable)
  - Current puzzle snapshot (if any) and basic artifacts per puzzle
- The ZIP is streamed to your browser for download.

## 6. Wordsets and clues
- Word lists live in `wordsets/` (randomly selected) or fallback to `words.json`.
- Each entry is `[word, clue]`; duplicates and malformed entries are filtered.

## 7. Health and support
- `GET /health` returns status (`ok`, `memory_fallback`, or `db_down`).
- If emails do not arrive, the app may be logging reset links in the server console (when SMTP is not configured).
