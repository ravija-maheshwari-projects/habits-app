const { loadEnvFile } = require("./env");

loadEnvFile();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "";

function isCloudSyncConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

async function pullDeviceState(deviceId) {
  if (!isCloudSyncConfigured()) {
    return { configured: false, habits: [], entries: [] };
  }

  const [habits, entries] = await Promise.all([
    selectRows("habits", deviceId),
    selectRows("entries", deviceId)
  ]);

  return {
    configured: true,
    habits: habits.map(mapHabitFromDb),
    entries: entries.map(mapEntryFromDb)
  };
}

async function pushDeviceState(deviceId, payload) {
  if (!isCloudSyncConfigured()) {
    return { configured: false, ok: false };
  }

  const habits = Array.isArray(payload.habits) ? payload.habits : [];
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const pendingDeletes = payload.pendingDeletes || {};

  if (habits.length) {
    await upsertRows("habits", habits.map((habit) => mapHabitToDb(habit, deviceId)), "id");
  }

  if (entries.length) {
    await upsertRows("entries", entries.map((entry) => mapEntryToDb(entry, deviceId)), "key");
  }

  if (Array.isArray(pendingDeletes.entryKeys) && pendingDeletes.entryKeys.length) {
    await deleteRows("entries", "key", pendingDeletes.entryKeys, deviceId);
  }

  if (Array.isArray(pendingDeletes.habitIds) && pendingDeletes.habitIds.length) {
    await deleteRows("habits", "id", pendingDeletes.habitIds, deviceId);
  }

  return {
    configured: true,
    ok: true,
    syncedAt: new Date().toISOString()
  };
}

async function selectRows(table, deviceId) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set("select", "*");
  url.searchParams.set("device_id", `eq.${deviceId}`);

  const response = await fetch(url, {
    headers: authHeaders()
  });

  if (!response.ok) {
    throw new Error(`Supabase select failed for ${table}: ${response.status}`);
  }

  return response.json();
}

async function upsertRows(table, rows, conflictKey) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set("on_conflict", conflictKey);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(rows)
  });

  if (!response.ok) {
    throw new Error(`Supabase upsert failed for ${table}: ${response.status}`);
  }
}

async function deleteRows(table, keyName, ids, deviceId) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set(keyName, `in.(${ids.map(quotePostgrestValue).join(",")})`);
  url.searchParams.set("device_id", `eq.${deviceId}`);

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      ...authHeaders(),
      Prefer: "return=minimal"
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase delete failed for ${table}: ${response.status}`);
  }
}

function authHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`
  };
}

function mapHabitFromDb(row) {
  return {
    id: row.id,
    name: row.name,
    originalPrompt: row.original_prompt,
    category: row.category,
    unit: row.unit,
    targetCount: row.target_count,
    periodDays: row.period_days,
    weeklyDays: normalizeWeeklyDays(row.weekly_days || []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapHabitToDb(habit, deviceId) {
  return {
    id: habit.id,
    device_id: deviceId,
    name: habit.name,
    original_prompt: habit.originalPrompt || habit.name,
    category: habit.category || "general",
    unit: habit.unit || "times",
    target_count: normalizePositiveInteger(habit.targetCount, 1),
    period_days: normalizePositiveInteger(habit.periodDays, 7),
    weekly_days: normalizeWeeklyDays(habit.weeklyDays || []),
    created_at: habit.createdAt || new Date().toISOString(),
    updated_at: habit.updatedAt || new Date().toISOString()
  };
}

function mapEntryFromDb(row) {
  return {
    id: row.id,
    key: row.key,
    habitId: row.habit_id,
    date: row.date,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEntryToDb(entry, deviceId) {
  return {
    id: entry.id,
    key: entry.key || `${entry.habitId}:${entry.date}`,
    habit_id: entry.habitId,
    device_id: deviceId,
    date: entry.date,
    status: entry.status,
    created_at: entry.createdAt || new Date().toISOString(),
    updated_at: entry.updatedAt || new Date().toISOString()
  };
}

function normalizePositiveInteger(value, fallback) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : fallback;
}

function normalizeWeeklyDays(days) {
  return [...new Set(days.map((day) => Number(day)).filter((day) => day >= 0 && day <= 6))].sort();
}

function quotePostgrestValue(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

module.exports = {
  isCloudSyncConfigured,
  pullDeviceState,
  pushDeviceState
};
