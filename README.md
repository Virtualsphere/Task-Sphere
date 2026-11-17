# TaskSphere – Project Management Tool

React + Node.js (Express) + MySQL, with Google login, role-based spaces and real-time chat.

## Features

- **Google Workspace sign-in.** People sign in with their official company Google account. Set `ALLOWED_DOMAIN` (e.g. `virtualspheretechnologies.in`) and only that Workspace domain can get in: Google's account chooser shows only those accounts, and the server rejects anything else. When `GOOGLE_CLIENT_SECRET` is set, the same sign-in also grants calendar access, so there is no separate "connect calendar" step. Someone who unticks calendar access can still use the app and connect later.
- **Spaces** with roles:

  | Role | Can do |
  |---|---|
  | Owner | Everything, including deleting the space and managing admins |
  | Admin | Add/remove members, create/edit/delete lists and their statuses |
  | Member | Create/edit tickets, subtasks and comments; chat |
  | Viewer | Read-only; can use chat |

  Add people by email. If they have never signed in, an invite waits and turns into a membership on their first Google login.
- **Lists** inside a space. Each list follows a methodology, and its workflow statuses are created from that methodology. You can rename, recolor, reorder, add or remove statuses, and mark which ones count as "done":
  - **SDLC:** Requirement Analysis → Design → Development → In Testing → In Update → Deployment → Delivered
  - **Agile:** Backlog → To Do → In Progress → In Testing → In Update → Approved → Delivered
  - **Scrum:** Product Backlog → Sprint Backlog → In Progress → Code Review → In Testing → Approved → Done
  - **Kanban:** Backlog → To Do → In Progress → In Testing → Approved → Delivered
  - **Custom:** build your own
- **Tickets** have a title, description, status, priority flag (Urgent/High/Normal/Low), start date, due date (overdue shown in red), multiple assignees, **subtasks** (each with done/priority/assignee/due date) and **comments**. The latest comment shows on the card.
- **Board view** (drag and drop between status columns) and **table view**. You can search, filter by priority, and show only tickets assigned to you.
- **Space chat.** Real-time over Socket.IO, visible only to that space's members. It shows a typing indicator and an unread badge. Removed members lose access immediately.
- **Live updates.** When a teammate changes a ticket, everyone viewing the space sees it.
- **Personal chats.** 1:1 direct messages and group chats with anyone who shares a space with you. They show online status, typing indicators, unread badges and older-message loading.
- **Huddles.** Audio/video calls with screen sharing, available in 1:1 chats, group chats and spaces:
  - Everyone who can join gets an incoming-call notification ("Aarav is calling you – Join / Dismiss").
  - The call window floats over the app, so you can keep working. It can expand to a full grid and shows who is speaking.
  - "Huddle started" and "Huddle ended (duration, people)" are logged in the chat.
  - Calls are peer-to-peer WebRTC, with up to 8 people by default (`HUDDLE_MAX`).
- **Google Calendar meetings.** Each user connects their Workspace calendar once. Then:
  - Upcoming events show with **Join Meet** buttons.
  - **Schedule meeting** creates the event in Google Calendar with a **Google Meet link** and emails invites to teammates and outside guests.
  - **Clear-calendar check:** as you pick a date and time, everyone's calendar is checked automatically ("✓ Everyone's calendar is clear" or "⚠ Aarav busy"), with a day timeline of busy blocks.
  - **✨ Find a clear time** suggests the next slots in the coming week when every attendee is free, inside office hours (`WORK_START`, `WORK_END` and `WORK_DAYS`; default 10:00–19:30, Monday–Saturday).
  - **No double-booking:** the server checks calendars again just before booking. If anyone is busy it refuses, shows who, and offers "Find a clear time" or "Book anyway".
  - **Book calendar & Meet** creates the Google Calendar event, attaches a Google Meet room (waiting if Google creates it a moment later), and emails invites so the meeting appears on everyone's calendar. A confirmation shows the Meet link with Copy and Open buttons.
  - Meetings scheduled from a space or chat post a meeting card there and appear in that space's or chat's "Upcoming" list.
  - Organizers can cancel, and Google sends the cancellation emails.

## Project structure

```
pm-tool/
├── server/                 Express API + Socket.IO
│   ├── src/index.js        app entry
│   ├── src/schema.sql      MySQL tables
│   ├── src/migrate.js      creates DB + tables
│   ├── src/access.js       JWT auth + role checks
│   ├── src/methodologies.js  SDLC/Agile/Scrum/Kanban status templates
│   ├── src/socket.js       chat + live updates
│   └── src/routes/         auth, spaces, lists, tickets
└── client/                 React (Vite)
    └── src/
        ├── pages/          Login, Dashboard, SpacePage
        └── components/     ListView (board/table), TicketModal, ChatPanel,
                            CreateListModal, MembersModal, StatusEditor
```

## Quick local test (no Google needed)
See **RUN-LOCALLY.md**: run `docker compose up --build`, open http://localhost:5000, and pick test users in different browser windows to test roles, chat, huddles and meeting booking together.

## Setup

### 1. Create a Google OAuth Client ID
1. Go to https://console.cloud.google.com/ → **APIs & Services → Credentials**.
2. **Create credentials → OAuth client ID → Web application**.
3. Under **Authorized JavaScript origins**, add `http://localhost:5173` and `http://localhost:5000`, plus your production domain later.
4. Copy the Client ID.
5. On the OAuth consent screen, choose **Internal** if you only want your Google Workspace users.

### 1b. Enable Google Calendar (for meeting scheduling)
1. In the same Google Cloud project, open **APIs & Services → Library** and enable the **Google Calendar API**.
2. On the OAuth consent screen, add these scopes: `calendar.events` and `calendar.freebusy`.
3. Copy the OAuth client's **Client secret** into `GOOGLE_CLIENT_SECRET` in `server/.env`, and set `TOKEN_ENC_KEY` to a long random string. Refresh tokens are stored AES-256-GCM encrypted.
4. Free/busy shows teammates' availability when your Workspace calendar sharing allows it (by default, people in the same domain can see each other's free/busy).

**Recommended for a company rollout:** in Google Cloud, set the OAuth consent screen to **Internal**, so only your Workspace users can use it and Google doesn't require app verification. Optionally, a Workspace admin can mark the app as **Trusted** (Admin console → Security → API controls → App access control) so staff aren't asked to approve calendar access.

### 1c. Huddles on office networks
Huddles use STUN by default, which works on most networks. If people behind strict firewalls can't hear each other, run a TURN server (e.g. **coturn**) and set `TURN_URL`, `TURN_USERNAME` and `TURN_CREDENTIAL`. Browsers only allow mic and camera on **HTTPS** (or localhost), so serve the app over HTTPS in production. Huddles are peer-to-peer, which suits small groups. For calls with more than 8 people, use an SFU such as LiveKit or mediasoup.

### 2. Backend
```bash
cd server
cp .env.example .env        # fill in DB credentials, GOOGLE_CLIENT_ID, JWT_SECRET, ALLOWED_DOMAIN
npm install
npm run migrate             # creates the database and tables
npm run dev                 # API on http://localhost:5000
```

### 3. Frontend
```bash
cd client
npm install
npm run dev                 # http://localhost:5173 (proxies /api and sockets to :5000)
```
The client reads the Google Client ID from the server (`/api/config`). You can also set `VITE_GOOGLE_CLIENT_ID` in `client/.env`.

### Production
```bash
cd client && npm run build      # outputs client/dist
cd ../server && npm start       # serves the API and the built app on one port
```
Put it behind Nginx with HTTPS and WebSocket upgrade enabled for `/socket.io`. Then add your domain to the Google OAuth origins and set `CLIENT_ORIGIN` in `.env`.

## API summary

| Method | Endpoint | Min role |
|---|---|---|
| POST | `/api/auth/google` | – |
| GET | `/api/auth/me` | signed in |
| GET/POST | `/api/spaces` | signed in |
| GET | `/api/spaces/:id` | viewer |
| PATCH | `/api/spaces/:id` | admin |
| DELETE | `/api/spaces/:id` | owner |
| POST/PATCH/DELETE | `/api/spaces/:id/members[/:userId]` | admin (members can leave) |
| GET | `/api/spaces/:id/messages` | viewer |
| GET | `/api/methodologies` | signed in |
| POST | `/api/spaces/:id/lists` | admin |
| GET | `/api/lists/:id` | viewer |
| PATCH/DELETE | `/api/lists/:id`, PUT `/api/lists/:id/statuses` | admin |
| POST | `/api/lists/:id/tickets` | member |
| GET | `/api/tickets/:id` | viewer |
| PATCH | `/api/tickets/:id` | member |
| DELETE | `/api/tickets/:id` | admin or creator |
| POST | `/api/tickets/:id/subtasks`, `/api/tickets/:id/comments` | member |
| PATCH/DELETE | `/api/subtasks/:id` | member |
| DELETE | `/api/comments/:id` | author or admin |

| GET | `/api/people` | teammates |
| GET/POST | `/api/conversations`, `/api/conversations/direct`, `/api/conversations/group` | signed in |
| GET/POST | `/api/conversations/:id/messages`, POST `/api/conversations/:id/read` | conversation member |
| POST/DELETE | `/api/conversations/:id/members`, `/api/conversations/:id/members/me` | group member |
| GET/POST/DELETE | `/api/calendar/status`, `/api/calendar/connect`, `/api/calendar` | signed in |
| GET | `/api/calendar/events`, POST `/api/calendar/freebusy` | calendar connected |
| GET/POST | `/api/meetings` | member of the space/chat |
| DELETE | `/api/meetings/:id` | organizer |

Socket events: `space:join`, `chat:send`, `chat:message`, `chat:typing`, `space:changed`, `dm:send`, `dm:message`, `dm:typing`, `presence`, `conversation:new`, `conversation:updated`, `meeting:new`, `meeting:cancelled`, `huddle:status`, `huddle:join`, `huddle:leave`, `huddle:signal`, `huddle:media`, `huddle:state`, `huddle:ring`, `huddle:peer-joined`, `huddle:peer-left`.

**Upgrading an existing database:** run `npm run migrate` again. It adds the new tables and the `kind` column on space chat messages.

## Demo build
`cd client && npm run build:demo` creates `dist-demo/index-demo.html`. It's a single file that runs the whole UI on sample data, with no server needed. Huddles in the demo show simulated teammates.
