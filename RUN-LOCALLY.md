# Run TaskSphere locally and test it with several users

Local **test mode** lets you check everything without setting up Google:

- **Test users:** pick a person on the login screen; no Google sign-in needed.
- **Simulated Google Calendar:** booking, the "calendar not clear" check, free-time suggestions and Meet links all work. Busy times come from meetings booked in the app, plus a daily 10:00–10:15 stand-up. The Meet links are placeholders and don't open a real meeting.
- **Sample data:** two spaces, three lists (Agile, Scrum, SDLC), tickets, chats and a group.

| Test user | Virtualsphere Products | Sales & Marketing |
|---|---|---|
| Vikalp Paliwal | **Owner** | Member |
| Aarav Mehta | **Admin** | Owner |
| Riya Jain | Member | – |
| Karan Verma | **Viewer** (read-only) | Member |
| Neha Sharma | – | Member |

---

## Option A – Docker (easiest, one command)

1. Install **Docker Desktop**: https://www.docker.com/products/docker-desktop/ and start it.
2. Unzip the project, open a terminal in the `pm-tool` folder and run:
   ```bash
   docker compose up --build
   ```
   The first run takes a few minutes. When you see `API running on http://localhost:5000`, it's ready.
3. Open **http://localhost:5000**.

To stop, press `Ctrl + C`. To start again with fresh sample data:
```bash
docker compose down -v
docker compose up --build
```

## Option B – without Docker (Node + MySQL)

Needs **Node.js 18+** and **MySQL 8** (or MariaDB / XAMPP's MySQL).

```bash
# 1. Server
cd pm-tool/server
cp .env.example .env
```
Edit `server/.env`:
```
PORT=5000
CLIENT_ORIGIN=http://localhost:5173
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your-mysql-password
DB_NAME=pm_tool
JWT_SECRET=any-long-random-text
DEV_LOGIN=true
CALENDAR_MODE=fake
```
```bash
npm install
npm run migrate      # creates the database + tables
npm run seed         # loads the sample data (only when the database is empty)
npm run dev          # API on http://localhost:5000

# 2. Client (second terminal)
cd pm-tool/client
npm install
npm run dev          # open http://localhost:5173
```

---

## How to test as several people at once

Each browser profile can be signed in as one person. Use:
- a **normal window** → Vikalp
- an **incognito/private window** → Aarav
- a **different browser** (Edge / Firefox) → Riya or Karan

Place the windows side by side.

## Cross-functional test checklist

| # | Feature | Steps | Expected |
|---|---|---|---|
| 1 | Roles | Sign in as **Karan (Viewer)** → Virtualsphere Products | Can see everything, can't add or edit tickets, can chat |
| 2 | Live tickets | Aarav adds a ticket or drags one to "In Testing" | Appears instantly on Vikalp's board |
| 3 | Methodology lists | Vikalp → **＋** next to Lists → pick SDLC/Scrum/Kanban, edit statuses | Board columns match the chosen workflow |
| 4 | Ticket details | Open a ticket → subtasks, priority flag, dates, assignees, comment | Latest comment shows on the card for everyone |
| 5 | Members & invites | Vikalp → Members → change Riya to Viewer | Riya immediately loses edit buttons |
| 6 | Space chat | Type in Space chat as Vikalp | Aarav sees it live, with a typing indicator |
| 7 | 1:1 chat | Vikalp → Messages → Aarav → send | Aarav's **Messages** badge goes up; online dot shows |
| 8 | Group chat | Messages → **+ New → Group chat** → pick 2+ people | All members get the group and messages |
| 9 | 1:1 huddle | In the Vikalp↔Aarav chat → **Start huddle** | Aarav gets "Vikalp is calling you" → Join → you hear each other |
| 10 | Huddle controls | Mute, camera, screen share, expand | The other side sees the mute icon, video and shared screen |
| 11 | Space/group huddle | Space chat → **🎧 Huddle**, others join from the popup | 3+ people in one call; "Huddle ended" is logged in chat |
| 12 | Book a meeting | Messages → **📅 Schedule** → Aarav, tomorrow 11:00 → **Book calendar & Meet** | Confirmation with Meet link; card posted in the chat |
| 13 | Calendar not clear | As **Aarav**, schedule with Vikalp at the same time | "⚠ Calendar not clear: Vikalp and you are busy" |
| 14 | Find a clear time | Click **✨ Find a clear time** | Suggests slots within 10:00–19:30, Mon–Sat, where both are free |
| 15 | Book anyway | Try the clashing time → **Book anyway** | Books despite the conflict |
| 16 | Calendar page | **Calendar** tab for both users | The meeting shows for both; the organizer can cancel it |

> **Huddles and microphones:** browsers only allow the mic and camera on `localhost` or **https**. Testing on one computer with several windows works as-is. To test from a phone or another PC on your network, serve the app over https. The easiest way is a tunnel such as `cloudflared tunnel --url http://localhost:5000` or `ngrok http 5000`; open the https link it prints on the other device.

---

## Moving to real Google Workspace

When you're done testing, switch the server to real mode in `.env` (or `docker-compose.yml`):
```
DEV_LOGIN=false
# remove CALENDAR_MODE
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
ALLOWED_DOMAIN=virtualspheretechnologies.in
TOKEN_ENC_KEY=any-long-random-text
```
The login screen then shows **Sign in with Google Workspace**. See README.md for the Google Cloud steps.

⚠️ Never run with `DEV_LOGIN=true` on a server others can reach: anyone could sign in as anyone.
