# User Guide

This guide walks you through common tasks in CrosswordNodeApp.

## Getting started
1) Open the site in your browser (e.g., http://localhost:3000 in development).
2) Create an account via Register, or log in if you already have one.

## Account tasks

### Register
- Go to `/register`.
- Enter a username, email, and password (confirm password).
- Submit to create your account.

### Login
- Go to `/login`.
- Enter your username and password.
- You’ll be redirected to the dashboard on success.

### Forgot or change password
- If you forgot your password or want to change it, use `/forgot`.
- Enter both your email and username; a reset link is sent if they match your account.
- Open the link, choose a new password, and log back in.

### Logout
- Use the logout control in the header/dashboard.

## Using the dashboard
- See recent completions with the time you took to solve them.
- Read a “Tip of the moment” to improve your solving skills.
- Click "Export My History" to download a ZIP of your activity.

## Solving a puzzle
- From the dashboard, start or resume a puzzle to open the 10×10 grid.
- Type letters in the editable cells; numbers appear as small non‑editable markers.
- The timer runs while the tab is visible and pauses when you switch away.
- Buttons:
  - Save Progress: store current letters and timer so you can continue later.
  - Submit: check your solution; if correct, your score updates.
  - Reset: restore the puzzle to its initial state and reset the timer.
- If you submit wrong answers, your remaining attempts decrease. Once you reach the limit, the page reloads and you start over.

## Exporting your activity
- On the dashboard, choose "Export My History".
- A ZIP file will be downloaded containing your profile summary, completions, failed attempts, and a snapshot of any in‑progress puzzle.

## Tips
- Keep the tab visible to let the timer run; it pauses when hidden.
- Use Save Progress before leaving the page to ensure your answers and time are stored.
- Make sure your email settings are correct if you expect a reset email and don’t see it.
