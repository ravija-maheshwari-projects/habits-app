# Habit Terminal

AI-assisted habit tracking web app with:

- browser frontend
- Node.js backend API
- SQLite persistence
- IndexedDB phone persistence for the installed PWA
- OpenAI-powered habit inference with heuristic fallback
- Vercel-compatible serverless API for hosted phone use

## Local run

1. Create a `.env` file:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

2. Start the app:

```bash
npm start
```

3. Open `http://localhost:3000`

4. On a phone, add it to the home screen to run it like an app. Habit data is stored locally in the browser via IndexedDB after the first load.

If port `3000` is already in use:

```bash
PORT=3010 npm start
```

## Hosted deployment on Railway

This project is prepared to deploy on Railway using the included `Dockerfile`.

### What to configure

- A web service built from this repository
- A persistent volume mounted at `/app/data`
- An environment variable:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

### Deployment steps

1. Push this folder to a GitHub repository.
2. In Railway, create a new project and choose `Deploy from GitHub repo`.
3. Select this repository.
4. Add a volume and mount it at:

```text
/app/data
```

5. Add the `OPENAI_API_KEY` environment variable.
6. Deploy.

Railway will use:

- `Dockerfile` for the runtime
- `/api/health` as the health check
- the mounted `/app/data` directory for the SQLite database file

### Notes

- The SQLite database will be created automatically at `data/habits.sqlite`.
- In Railway's container, that resolves to `/app/data/habits.sqlite`.
- If you deploy without a volume, your habit data will be lost on redeploy or restart.

## Current architecture

- Frontend: `public/`
- Backend API: `src/server.js`
- Database layer: `src/db.js`
- Inference layer: `src/inference.js`

## Phone / PWA behavior

- The app is installable as a PWA from a mobile browser.
- Habits and entries are persisted on-device in IndexedDB.
- Existing server-side SQLite data can be imported into the phone on first online launch.
- AI habit inference remains online-only through `/api/infer-habit`.

## Hosted deployment on Vercel

This project can also be deployed to Vercel for phone-first use without keeping your computer running.

### What deploys on Vercel

- Static app files from `public/`
- Serverless API routes from `api/`
- Phone persistence stays on-device in IndexedDB

### What to configure

- Import the GitHub repository into Vercel
- Add one environment variable:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

### Deployment steps

1. In Vercel, create a new project from this GitHub repository.
2. Set the Framework Preset to `Other` if Vercel asks.
3. Add the `OPENAI_API_KEY` environment variable.
4. Deploy.
5. Open the deployment URL on your phone.
6. Add it to your home screen.

### Notes

- Vercel does not use the local SQLite database in `data/` for the hosted phone workflow.
- `/api/infer-habit` stays online-only.
- `/api/state` returns an empty server state on Vercel, which is fine because the phone is the source of truth.
- Local development with `npm start` still uses `src/server.js` and SQLite.
