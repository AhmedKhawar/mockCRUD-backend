# MockCRUD Backend

**Instant mock REST APIs — no setup, always live.**

This is the backend for [MockCRUD](https://mockcrud.xyz): the API that validates resources, generates schemas with AI, links related resources together, and serves the live CRUD endpoints that power the frontend.

🌐 **Live app:** [mockcrud.xyz](https://mockcrud.xyz)
🎨 **Frontend repo:** [AhmedKhawar/mockCRUD](https://github.com/AhmedKhawar/mockCRUD)
⚙️ **API host:** [mock-crud-backend.vercel.app](https://mock-crud-backend.vercel.app)

---

## Table of Contents

- [How It Works](#how-it-works)
- [Building a Resource](#building-a-resource)
- [Link & Auth](#link--auth)
- [Live Endpoints](#live-endpoints)
- [Project Limits](#project-limits)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Deployment](#deployment)

---

## How It Works

```
Create a project (unique slug)
        │
        ▼
Add resources: Manual fields  or  Infer Fields (AI)
        │
        ▼
Optional: Link (AI relational linking)  +  Auth (JWT per resource)
        │
        ▼
Schemas stored ──► Dynamic CRUD engine ──► Live REST endpoints (MongoDB)
```

1. **Create a project.** Each project gets a unique **slug**, used in every one of its API URLs.
2. **Add resources**, one batch at a time, manually or with AI-inferred fields.
3. **Turn on Link and/or Auth** per resource, as needed.
4. **Get live endpoints** the moment a resource is created. No deploy step, no waiting.

---

## Building a Resource

A resource can be built in one of two modes:

### ✏️ Manual

The name, fields, types and required flags come straight from the request. The backend validates the resource name and stores exactly the fields it was given.

- Field types: String, Number, Boolean, Date, Array, Object, and more
- No explicit `id` field is stored. MongoDB generates `_id` for every document, and the API returns it as `id`.

### ⚡ Infer Fields (AI)

The request specifies a resource name and a field count (1–8). AI infers realistic, contextually appropriate fields for that resource name and returns a schema, which the backend then stores and serves like any other resource.

---

## Link & Auth

Two optional behaviors apply per resource, per creation batch:

| Feature  | What the backend does                                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Link** | When enabled on any resource in a batch, the backend sends all the resources in that batch to AI together. AI looks for logical relationships and injects foreign keys accordingly (for example, adding `hospitalId` to a `doctors` resource). Resources with no logical relationship are left untouched. |
| **Auth** | Requires a valid JWT on every endpoint for that resource. Enabling Auth on any resource in a project also activates the project's **Auth API**: signup, login and logout endpoints for managing user sessions. |

Field inference, resource-name validation, and relational linking are all handled by AI in a single unified pass per batch, rather than as separate calls.

---

## Live Endpoints

Every resource gets the same five endpoints, namespaced by project slug:

```
GET     https://mock-crud-backend.vercel.app/m/{slug}/{resource}
GET     https://mock-crud-backend.vercel.app/m/{slug}/{resource}/:id
POST    https://mock-crud-backend.vercel.app/m/{slug}/{resource}
PUT     https://mock-crud-backend.vercel.app/m/{slug}/{resource}/:id
DELETE  https://mock-crud-backend.vercel.app/m/{slug}/{resource}/:id
```

### About `id`

MongoDB generates an `_id` for every document. The API returns it as **`id`**, and that same `id` is what you pass to get by id, update (`PUT`) and delete.

### Example

```bash
curl -X POST https://mock-crud-backend.vercel.app/m/my-project/products \
  -H "Content-Type: application/json" \
  -d '{"name": "Desk Lamp", "price": 24.99}'
```

```json
{
  "id": "665f1c2e8b3a4d0012ab34cd",
  "name": "Desk Lamp",
  "price": 24.99
}
```

```bash
curl https://mock-crud-backend.vercel.app/m/my-project/products/665f1c2e8b3a4d0012ab34cd

curl -X PUT https://mock-crud-backend.vercel.app/m/my-project/products/665f1c2e8b3a4d0012ab34cd \
  -H "Content-Type: application/json" \
  -d '{"price": 19.99}'

curl -X DELETE https://mock-crud-backend.vercel.app/m/my-project/products/665f1c2e8b3a4d0012ab34cd
```

### Auth-protected resources

When Auth is enabled on a resource, requests to its endpoints must include a valid JWT, obtained from the project's Auth API (signup / login), in the `Authorization` header.

---

## Project Limits

- Up to **5 resources** per creation batch
- Up to **8 fields** per resource

---

## Tech Stack

| Area              | Technology                                                                 |
| ----------------- | --------------------------------------------------------------------------- |
| Runtime           | Node.js (ES modules)                                                       |
| Framework         | Express                                                                    |
| Database          | MongoDB with Mongoose                                                      |
| AI                | Google Gemini Flash — field inference, entity validation and relational linking in a single unified pass |
| Auth              | JWT-based, enabled per resource, with signup/login/logout endpoints        |
| Hosting           | Vercel                                                                     |

---

## Project Structure

```
mockCRUD-backend/
├── controller/     # Request handlers
├── middleware/     # Express middleware
├── models/         # Mongoose models
├── routes/         # Route definitions
├── utils/          # Shared helpers
├── index.js        # App entry point
├── vercel.json     # Vercel deployment config
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 18 or later
- A MongoDB database (local or Atlas)
- A Google Gemini API key
- A JWT secret for signing tokens

### Installation

```bash
git clone https://github.com/AhmedKhawar/mockCRUD-backend.git
cd mockCRUD-backend
npm install
```

### Environment variables

Create a `.env` file in the project root. The names below are examples, so match them to the ones your code reads:

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
GEMINI_API_KEY=your_gemini_api_key
JWT_SECRET=your_jwt_secret
```

### Run

```bash
npm run dev    # development, with auto-reload
npm start      # production
```

---

## Deployment

The backend is configured for [Vercel](https://vercel.com) through `vercel.json`. Add the same environment variables in your Vercel project settings and deploy.

---

## Related

- **Frontend:** [mockCRUD](https://github.com/AhmedKhawar/mockCRUD) (React + Vite)

---

## Author

Built by [@AhmedKhawar](https://github.com/AhmedKhawar).
