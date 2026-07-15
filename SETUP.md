# Major Match Tracker — get it on your phone (with alerts)

Everything here is done in your **web browser** — no terminal, no installs.
Two parts: **(A)** the live scoreboard on your phone, **(B)** the robot that
buzzes you when Princess Lulu's score moves — even when the app is closed.

---

## A. Put the scoreboard on your phone (~3 min)

1. Go to **github.com/new** (sign in as `thedailywalk`).
   - Repository name: `golf-match`
   - Visibility: **Public**  ·  don't add a README  ·  click **Create repository**.
2. On the new empty repo, click **"uploading an existing file"**.
   - Open the `major-match-tracker` folder on your Mac, select **everything inside it**
     (index.html, sw.js, manifest, the icons, and the `.github` and `robot` folders),
     and **drag it all** into the browser. Folders keep their structure.
   - Click **Commit changes**.
3. Turn on hosting: repo **Settings → Pages**.
   - Source: **Deploy from a branch** → Branch: **main** → **/(root)** → **Save**.
   - Wait ~1 minute, refresh. It shows your live URL:
     **https://thedailywalk.github.io/golf-match/**
4. On your **phone**, open that URL in Safari → **Share → Add to Home Screen**.
   You now have the full-screen app with its own icon. Tap **🔔 Notify me** inside it
   for buzzes *while it's open*.

## B. Turn on always-on alerts (buzz when the app is closed) (~2 min)

The robot is already in the repo (`.github/workflows/alerts.yml`). It just needs the
free **ntfy** app on your phone to receive the pushes.

5. Install **ntfy** from the App Store (free, no account).
6. Open ntfy → **+ Subscribe to topic** →
   - Topic name: **`mmt-413ab7587a6e`**
   - Service: leave as **ntfy.sh**
   - Subscribe. (Anyone who knows this topic name can see the scores, so keep it to yourself.)
7. Back on GitHub, open the **Actions** tab → if it asks, click **"I understand… enable workflows"**.
   Click **Golf alerts robot → Run workflow** once to test.
   - During a live round you'll get a test push. Between rounds it just says "not started" — that's fine.

That's it. From Thursday's tee time, the robot checks every 5 minutes and pushes
things like:

> **Princess Lulu −8 · leading by 3**
> Scheffler ▼1 birdie 🐦 · Thru 14 — now −7

---

## Changing teams / players later
- **In the app:** tap the ✎ (top right) — rename teams, add/remove players, switch which
  team is "yours", or flip to manual score entry. Saved on your phone.
- **For the alerts robot:** edit `robot/config.json` in the GitHub repo (pencil icon → commit).
  `countBest` = how many scores count toward the total (6 = all; set 4 for the weekend rule).
  Set `notifyOnOpponentMove` to `true` if you also want a buzz when Team Trev moves.

## Notes
- Scores come from ESPN's public golf feed, matched by player name. If a name ever
  stops matching, check the spelling in config / the app's edit sheet.
- GitHub's scheduled runs can lag a few minutes under load — normal, not broken.
- The robot never spams: it only pushes when a score actually changes, and it sends a
  single wrap-up when the event goes final.
