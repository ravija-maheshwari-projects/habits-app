# Habit Terminal

AI-assisted habit tracking web app with:

- browser frontend
- Node.js backend API
- SQLite persistence
- OpenAI-powered habit inference with heuristic fallback

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
