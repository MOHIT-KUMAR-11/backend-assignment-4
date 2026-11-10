# Secure Connect and Communication Platform — Lab 4 (Web Dev III, Unit 4)

A secure Node.js backend where users **sign up, log in, access protected resources,
manage personal notes and chat in real time**. It's built from scratch, without any
auth boilerplate or chat framework.

**Stack (as required):** Node.js · Express · jsonwebtoken (JWT) · bcrypt · dotenv ·
Socket.IO · MongoDB (via Mongoose). `socket.io-client` is a dev dependency used only by
the tests and the chat demo script.

---

## 1. Run it

Prerequisites: Node.js 18+ and MongoDB running locally (`mongodb://127.0.0.1:27017`)
or a MongoDB Atlas URI.

```bash
cd secure-connect-communication-platform
npm install
copy .env.example .env        # then set JWT_SECRET to a long random string
npm run seed:admin            # creates the admin account from .env (for RBAC)
npm start                     # http://localhost:5000
```

* `npm run dev` — auto-restart on changes
* `npm test` — 31 automated tests (REST + Socket.IO) against a separate test database
* `npm run chat:demo` — with the server running, two users (aditi, rohan) chat in
  real time; watch the server terminal (like Fig 3 in the brief)
* Open **http://localhost:5000/** for a small browser chat client (log in and chat;
  open a second browser window as another user to see messages arrive live)

### Environment variables (`.env`)

| Variable | Purpose |
|---|---|
| `PORT` | HTTP + Socket.IO port (5000) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | secret used to sign/verify JWTs (keep it private) |
| `JWT_EXPIRES_IN` | token lifetime, e.g. `1h` |
| `BCRYPT_SALT_ROUNDS` | bcrypt cost factor (10) |
| `ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | used by `npm run seed:admin` |

`.env` is in `.gitignore`; `.env.example` documents every setting.

## 2. Project structure

```
server.js                     entry: load env, connect DB, start HTTP + Socket.IO
src/
  config/env.js, db.js        dotenv settings (validated) + Mongoose connection
  createServer.js             Express app + Socket.IO on one HTTP server
  app.js                      middleware, routes, 404 + error handler
  models/User.js, Note.js, Message.js
  controllers/                auth, notes, admin (RBAC)
  routes/                     /api/auth, /api/notes, /api/admin
  middleware/auth.js          protect (JWT) + authorize(role) (RBAC)
  middleware/validate.js      request validation
  middleware/rateLimit.js     brute-force protection on signup/login
  middleware/errorHandler.js  central JSON errors
  events/appEvents.js         EventEmitter bus + event names
  events/listeners.js         activity log, console log, live Socket.IO notifications
  sockets/chat.js             JWT-authenticated real-time chat
  utils/token.js              sign / verify / extract JWT (Bearer header or cookie)
public/index.html             browser chat client
scripts/createAdmin.js, chatDemo.js
tests/api.test.js, socket.test.js
postman/Secure-Connect.postman_collection.json
screenshots/                  expected-output screenshots
```

## 3. Features → requirements

### Signup and login (bcrypt)
* `POST /api/auth/signup` `{ username, email, password }` → **201**
  `{ "message": "User registered", "id", "username", "email" }`
* Passwords are hashed with **bcrypt** (`BCRYPT_SALT_ROUNDS`); only the hash is stored,
  and the field is `select: false`, so it's never returned.
* Validation: username 3–30 letters/digits/_; valid email; password 6–72 chars;
  `role` cannot be set at signup (prevents privilege escalation). Duplicate → **409**.
* `POST /api/auth/login` `{ email, password }` → **200**
  `{ "message": "Login successful", "token": "<JWT>" }`. The token is also set as an
  **httpOnly, SameSite=strict cookie**.
* Wrong password and unknown email give the **same 401** message and similar timing,
  so emails can't be probed. Signup/login are **rate-limited** per IP.

### JWT authentication
* Token payload `{ id, username, role }`, signed with HS256 using `JWT_SECRET`,
  expiring after `JWT_EXPIRES_IN`.
* Accepted from `Authorization: Bearer <token>` **or** the `token` cookie.
* `GET /api/auth/me` returns the current user; `POST /api/auth/logout` clears the cookie.

### Protected routes and RBAC
* `protect` middleware: no token → **403 `{"message":"No token provided"}`**;
  bad/forged/expired token → **401**; a deleted user's token → **401**.
* `authorize('admin')` middleware → **403** `Access denied: requires role admin`.
* Roles: `user` (default) and `admin` (created by `npm run seed:admin`).
* `GET /api/protected` is a sample protected resource.
* Admin-only routes: `GET /api/admin/users`, `PATCH /api/admin/users/:id/role`,
  `DELETE /api/admin/users/:id`, `GET /api/admin/notes`, `GET /api/admin/activity`.

### Secure Notes API (all routes need a JWT)
| Method | Endpoint | Result |
|---|---|---|
| GET | `/api/notes` | my notes (array), optional `?search=` |
| POST | `/api/notes` `{ title, content }` | 201 + note |
| GET | `/api/notes/:id` | one of my notes |
| PUT | `/api/notes/:id` `{ title?, content? }` | updated note |
| DELETE | `/api/notes/:id` | `{ "message": "Note deleted", "id" }` |

The `owner` is always taken from the token (the client can't set it). Other users get
**404** for notes that aren't theirs, so they can't even tell a note exists. Admins can
see all notes.

### Real-time chat (Socket.IO)
* The socket handshake requires a valid JWT (`io(url, { auth: { token } })`); otherwise
  the connection is refused (`No token provided` / `Invalid or expired token`).
* Client → server: `joinRoom(room)`, `leaveRoom(room)`, `chatMessage({room, text})`,
  `typing({room, isTyping})`, `privateMessage({to, text})`, each with an
  acknowledgement callback.
* Server → client: `message`, `system` (join/leave), `roomUsers` (who's online),
  `typing`, `privateMessage`, `notification`.
* The sender name comes from the verified token, not from the client. Messages are
  validated (1–1000 chars), flood-limited (10 per 5 s), stored in MongoDB, and the
  last 50 are replayed to anyone who joins a room.
* Server console log, as in Fig 3:
  ```
  User connected: sK92_xT31Qp (aditi)
  sK92_xT31Qp joined room general
  [general] aditi: Hey team, backend is ready
  ```

### Event-driven features (EventEmitter)
`src/events/appEvents.js` is a shared `EventEmitter`. Controllers and the chat only
**emit** events (`user:registered`, `user:loggedIn`, `user:loginFailed`,
`user:roleChanged`, `note:created|updated|deleted`, `chat:joined`, `chat:message`).
The listeners in `src/events/listeners.js` react independently:
1. log to the console (`[event] new user registered: ...`)
2. keep an activity feed for admins (`GET /api/admin/activity`)
3. push **live Socket.IO notifications**: a note change is sent instantly to the
   owner's other open tabs/devices, new signups are announced, and a role change
   notifies that user.

### Error format
Every error is `{ "message": "...", "errors"?: [{ field, message }] }`:
400 validation / malformed JSON / bad id · 401 bad credentials or token ·
403 no token or wrong role · 404 not found · 409 duplicate · 429 too many requests.

## 4. Screenshots (`screenshots/`)

| File | Shows (brief figure) |
|---|---|
| `1-signup.png` | signup → 201 User registered (Fig 1) |
| `2-login.png` | login → 200 + JWT (Fig 1) |
| `3-notes-without-token.png` | GET /api/notes without token → 403 No token provided (Fig 2) |
| `4-create-note.png` | POST note with JWT → 201 (Fig 2) |
| `5-get-notes-with-token.png` | GET notes with JWT → 200, my two notes (Fig 2) |
| `6-protected-route.png` | sample protected route |
| `7-rbac-user-denied.png` | admin route as user → 403 (RBAC) |
| `8-rbac-admin-allowed.png` | admin route as admin → 200 (RBAC) |
| `9-realtime-chat-console.png` | Socket.IO chat activity in the server console (Fig 3) |
| `10-event-activity-feed.png` | events captured by the EventEmitter listeners |

To take your own in Postman, import `postman/Secure-Connect.postman_collection.json`.
**Login** saves the token into a collection variable, so the notes requests are
authorised automatically.

## 5. Rubric mapping

| Criterion | Where |
|---|---|
| Functionality (1.5) | auth, JWT, protected routes + RBAC, notes CRUD, Socket.IO chat, EventEmitter: all covered by 31 passing tests |
| API design (0.5) | REST resources, correct status codes, consistent JSON errors, Bearer or cookie auth |
| Clean code (0.5) | config / models / controllers / routes / middleware / events / sockets folders, async error wrapper, central error handler, no secrets in code |
