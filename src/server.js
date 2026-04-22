const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { loadEnvFile } = require("./env");

loadEnvFile();

const { initializeDatabase, getState, createHabit, findHabitById, upsertEntry } = require("./db");
const { inferHabit } = require("./inference");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(process.cwd(), "public");

initializeDatabase();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Internal server error." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Habit tracker running at http://localhost:${PORT}`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, getState());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, storage: "sqlite" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/infer-habit") {
    const body = await readJson(req);
    const description = String(body.description || "").trim();

    if (!description) {
      sendJson(res, 400, { error: "Habit description is required." });
      return;
    }

    sendJson(res, 200, await inferHabit(description));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/habits") {
    const body = await readJson(req);
    const name = String(body.name || "").trim();
    const cadence = body.cadence || {};

    if (!name) {
      sendJson(res, 400, { error: "Habit name is required." });
      return;
    }

    const habit = createHabit({
      name,
      originalPrompt: String(body.originalPrompt || name),
      category: String(body.category || "general"),
      unit: String(cadence.unit || "times"),
      targetCount: normalizePositiveInteger(cadence.targetCount, 1),
      periodDays: normalizePositiveInteger(cadence.periodDays, 7),
      weeklyDays: normalizeWeeklyDays(cadence.weeklyDays || [])
    });

    sendJson(res, 201, habit);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/entries") {
    const body = await readJson(req);
    const habitId = String(body.habitId || "").trim();
    const date = normalizeDate(body.date);
    const status = body.status === "done" ? "done" : "skipped";

    if (!habitId || !date) {
      sendJson(res, 400, { error: "Habit and date are required." });
      return;
    }

    if (!findHabitById(habitId)) {
      sendJson(res, 404, { error: "Habit not found." });
      return;
    }

    sendJson(res, 201, upsertEntry({ habitId, date, status }));
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

function serveStatic(res, url) {
  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }

    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(content);
  });
}

function contentType(filePath) {
  const extension = path.extname(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8"
  };
  return types[extension] || "application/octet-stream";
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large."));
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function normalizePositiveInteger(value, fallback) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return fallback;
  }
  return normalized;
}

function normalizeWeeklyDays(days) {
  return [...new Set(days.map((day) => Number(day)).filter((day) => day >= 0 && day <= 6))].sort();
}

function normalizeDate(input) {
  const value = String(input || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "";
  }
  return value;
}
