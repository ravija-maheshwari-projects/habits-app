const DATABASE_NAME = "habit-terminal";
const DATABASE_VERSION = 1;
const HABITS_STORE = "habits";
const ENTRIES_STORE = "entries";
const META_STORE = "meta";

let databasePromise;

export async function initializeStorage() {
  if (!("indexedDB" in window)) {
    throw new Error("IndexedDB is not available in this browser.");
  }

  if (!databasePromise) {
    databasePromise = openDatabase();
  }

  return databasePromise;
}

export async function getState() {
  const database = await initializeStorage();
  const [rawHabits, entries] = await Promise.all([
    getAll(database, HABITS_STORE),
    getAll(database, ENTRIES_STORE)
  ]);
  const habits = rawHabits.map(normalizeHabitRecord);

  habits.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  entries.sort((left, right) => {
    const byDate = String(right.date).localeCompare(String(left.date));
    if (byDate !== 0) {
      return byDate;
    }
    return String(right.createdAt).localeCompare(String(left.createdAt));
  });

  return {
    habits,
    entries,
    meta: {
      storage: "indexeddb"
    }
  };
}

export async function mergeRemoteState(remoteState, options = {}) {
  const database = await initializeStorage();
  const pendingHabitDeletes = new Set(options.pendingHabitDeletes || []);
  const pendingEntryDeletes = new Set(options.pendingEntryDeletes || []);
  const currentState = await getState();
  const currentHabits = new Map(currentState.habits.map((habit) => [habit.id, habit]));
  const currentEntries = new Map(currentState.entries.map((entry) => [entry.key, entry]));
  const transaction = database.transaction([HABITS_STORE, ENTRIES_STORE], "readwrite");
  const habitStore = transaction.objectStore(HABITS_STORE);
  const entryStore = transaction.objectStore(ENTRIES_STORE);
  let importedHabits = 0;
  let importedEntries = 0;

  const remoteHabits = Array.isArray(remoteState.habits) ? remoteState.habits : [];
  remoteHabits.forEach((habit) => {
    if (!habit?.id || pendingHabitDeletes.has(habit.id)) {
      return;
    }

    const normalizedHabit = normalizeHabitRecord(habit);
    const localHabit = currentHabits.get(normalizedHabit.id);

    if (!localHabit || isRemoteNewer(normalizedHabit.updatedAt, localHabit.updatedAt)) {
      habitStore.put(normalizedHabit);
      importedHabits += 1;
    }
  });

  const remoteEntries = Array.isArray(remoteState.entries) ? remoteState.entries : [];
  remoteEntries.forEach((entry) => {
    const key = entry?.key || (entry?.habitId && entry?.date ? entryKey(entry.habitId, entry.date) : "");
    if (!key || pendingEntryDeletes.has(key)) {
      return;
    }

    const normalizedEntry = {
      ...entry,
      key
    };
    const localEntry = currentEntries.get(key);

    if (!localEntry || isRemoteNewer(normalizedEntry.updatedAt, localEntry.updatedAt)) {
      entryStore.put(normalizedEntry);
      importedEntries += 1;
    }
  });

  await waitForTransaction(transaction);

  return {
    imported: importedHabits > 0 || importedEntries > 0,
    counts: {
      habits: importedHabits,
      entries: importedEntries
    }
  };
}

export async function getPendingSyncDeletes() {
  const database = await initializeStorage();
  const record = await get(database, META_STORE, "pending-sync-deletes");
  return {
    habitIds: Array.isArray(record?.value?.habitIds) ? record.value.habitIds : [],
    entryKeys: Array.isArray(record?.value?.entryKeys) ? record.value.entryKeys : []
  };
}

export async function queuePendingSyncDeletes(input) {
  const database = await initializeStorage();
  const existing = await getPendingSyncDeletes();
  const next = {
    habitIds: [...new Set([...existing.habitIds, ...(input.habitIds || [])])],
    entryKeys: [...new Set([...existing.entryKeys, ...(input.entryKeys || [])])]
  };

  await put(database, META_STORE, {
    id: "pending-sync-deletes",
    value: next
  });

  return next;
}

export async function clearPendingSyncDeletes() {
  const database = await initializeStorage();
  await put(database, META_STORE, {
    id: "pending-sync-deletes",
    value: {
      habitIds: [],
      entryKeys: []
    }
  });
}

export async function createHabit(input) {
  const database = await initializeStorage();
  const now = new Date().toISOString();
  const habit = {
    id: input.id || buildId("habit"),
    name: input.name,
    originalPrompt: input.originalPrompt || input.name,
    category: input.category || "general",
    unit: normalizeGoalUnit(input.unit || "session"),
    goalCount: normalizePositiveInteger(input.goalCount, 1),
    targetCount: normalizePositiveInteger(input.targetCount, 1),
    periodDays: normalizePositiveInteger(input.periodDays, 7),
    weeklyDays: normalizeWeeklyDays(input.weeklyDays || []),
    createdAt: input.createdAt || now,
    updatedAt: now
  };

  await put(database, HABITS_STORE, habit);
  return habit;
}

export async function updateHabit(habitId, input) {
  const database = await initializeStorage();
  const existing = await get(database, HABITS_STORE, habitId);

  if (!existing) {
    throw new Error("Habit not found.");
  }

  const updatedHabit = {
    ...existing,
    name: input.name || existing.name,
    originalPrompt: input.originalPrompt || existing.originalPrompt,
    category: input.category || existing.category,
    unit: normalizeGoalUnit(input.unit || existing.unit),
    goalCount: normalizePositiveInteger(input.goalCount, existing.goalCount || 1),
    targetCount: normalizePositiveInteger(input.targetCount, existing.targetCount),
    periodDays: normalizePositiveInteger(input.periodDays, existing.periodDays),
    weeklyDays: normalizeWeeklyDays(input.weeklyDays || existing.weeklyDays || []),
    updatedAt: new Date().toISOString()
  };

  await put(database, HABITS_STORE, updatedHabit);
  return updatedHabit;
}

export async function upsertEntry(input) {
  const database = await initializeStorage();
  const existing = await get(database, ENTRIES_STORE, entryKey(input.habitId, input.date));
  const now = new Date().toISOString();

  if (existing) {
    const updatedEntry = {
      ...existing,
      status: input.status,
      updatedAt: now
    };

    await put(database, ENTRIES_STORE, updatedEntry);
    return updatedEntry;
  }

  const entry = {
    id: input.id || buildId("entry"),
    key: entryKey(input.habitId, input.date),
    habitId: input.habitId,
    date: input.date,
    status: input.status,
    createdAt: input.createdAt || now,
    updatedAt: now
  };

  await put(database, ENTRIES_STORE, entry);
  return entry;
}

export async function deleteEntry(habitId, date) {
  const database = await initializeStorage();
  const key = entryKey(habitId, date);
  const existing = await get(database, ENTRIES_STORE, key);

  if (!existing) {
    return false;
  }

  await remove(database, ENTRIES_STORE, key);
  return true;
}

export async function deleteHabit(habitId) {
  const database = await initializeStorage();
  const entries = await getAll(database, ENTRIES_STORE);
  const transaction = database.transaction([HABITS_STORE, ENTRIES_STORE], "readwrite");
  const habitStore = transaction.objectStore(HABITS_STORE);
  const entryStore = transaction.objectStore(ENTRIES_STORE);

  habitStore.delete(habitId);

  entries
    .filter((entry) => entry.habitId === habitId)
    .forEach((entry) => {
      entryStore.delete(entry.key);
    });

  await waitForTransaction(transaction);
}

export async function hydrateFromServer(fetchJson) {
  const database = await initializeStorage();
  const alreadyHydrated = await get(database, META_STORE, "server-hydrated-at");
  const currentState = await getState();

  if (alreadyHydrated || currentState.habits.length || currentState.entries.length) {
    return { imported: false, reason: "local-data-present" };
  }

  const remoteState = await fetchJson("/api/state");
  const habits = Array.isArray(remoteState.habits) ? remoteState.habits : [];
  const entries = Array.isArray(remoteState.entries) ? remoteState.entries : [];

  if (!habits.length && !entries.length) {
    await put(database, META_STORE, {
      id: "server-hydrated-at",
      value: new Date().toISOString()
    });
    return { imported: false, reason: "remote-empty" };
  }

  const transaction = database.transaction([HABITS_STORE, ENTRIES_STORE, META_STORE], "readwrite");
  const habitStore = transaction.objectStore(HABITS_STORE);
  const entryStore = transaction.objectStore(ENTRIES_STORE);
  const metaStore = transaction.objectStore(META_STORE);
  const hydratedAt = new Date().toISOString();

  habits.forEach((habit) => {
    habitStore.put({
      ...habit,
      updatedAt: habit.updatedAt || hydratedAt
    });
  });

  entries.forEach((entry) => {
    entryStore.put({
      ...entry,
      key: entry.key || entryKey(entry.habitId, entry.date),
      updatedAt: entry.updatedAt || entry.createdAt || hydratedAt
    });
  });

  metaStore.put({ id: "server-hydrated-at", value: hydratedAt });

  await waitForTransaction(transaction);

  return {
    imported: true,
    counts: {
      habits: habits.length,
      entries: entries.length
    }
  };
}

async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(HABITS_STORE)) {
        database.createObjectStore(HABITS_STORE, { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains(ENTRIES_STORE)) {
        database.createObjectStore(ENTRIES_STORE, { keyPath: "key" });
      }

      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "id" });
      }
    });

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error || new Error("Could not open IndexedDB.")));
  });
}

async function getAll(database, storeName) {
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error || new Error(`Could not read ${storeName}.`)));
  });
}

async function get(database, storeName, key) {
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
    request.addEventListener("success", () => resolve(request.result || null));
    request.addEventListener("error", () => reject(request.error || new Error(`Could not read ${storeName}.`)));
  });
}

async function put(database, storeName, value) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const request = transaction.objectStore(storeName).put(value);

    request.addEventListener("success", () => resolve(value));
    request.addEventListener("error", () => reject(request.error || new Error(`Could not write ${storeName}.`)));
  });
}

async function remove(database, storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const request = transaction.objectStore(storeName).delete(key);

    request.addEventListener("success", () => resolve());
    request.addEventListener("error", () => reject(request.error || new Error(`Could not delete ${storeName}.`)));
  });
}

async function waitForTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error || new Error("Transaction failed.")));
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("Transaction aborted.")));
  });
}

function entryKey(habitId, date) {
  return `${habitId}:${date}`;
}

function buildId(prefix) {
  if (crypto && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizePositiveInteger(value, fallback) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : fallback;
}

function normalizeWeeklyDays(days) {
  return [...new Set(days.map((day) => Number(day)).filter((day) => day >= 0 && day <= 6))].sort();
}

function isRemoteNewer(remoteUpdatedAt, localUpdatedAt) {
  return String(remoteUpdatedAt || "") > String(localUpdatedAt || "");
}

function normalizeHabitRecord(habit) {
  const unit = normalizeGoalUnit(habit.unit || "session");
  const goalCount = normalizePositiveInteger(habit.goalCount, deriveLegacyGoalCount(habit, unit));
  const targetCount = normalizePositiveInteger(
    habit.targetCount,
    deriveLegacyCadenceTargetCount(habit, unit)
  );

  return {
    ...habit,
    unit,
    goalCount,
    targetCount,
    periodDays: normalizePositiveInteger(habit.periodDays, 7),
    weeklyDays: normalizeWeeklyDays(habit.weeklyDays || [])
  };
}

function deriveLegacyGoalCount(habit, unit) {
  if (isGenericGoalUnit(unit)) {
    return 1;
  }

  const parsed = parseGoalCountFromText(habit.originalPrompt || "", unit);
  if (parsed > 0) {
    return parsed;
  }

  return normalizePositiveInteger(habit.targetCount, 1);
}

function deriveLegacyCadenceTargetCount(habit, unit) {
  if (Array.isArray(habit.weeklyDays) && habit.weeklyDays.length) {
    return habit.weeklyDays.length;
  }

  if (normalizePositiveInteger(habit.periodDays, 7) === 1) {
    return 1;
  }

  const parsed = parseCadenceCountFromText(habit.originalPrompt || "", habit.periodDays);
  if (parsed > 0) {
    return parsed;
  }

  if (isGenericGoalUnit(unit)) {
    return normalizePositiveInteger(habit.targetCount, 1);
  }

  return 1;
}

function parseCadenceCountFromText(text, periodDays) {
  const lower = String(text || "").toLowerCase();
  const countPattern = "(\\d[\\d,]*|one|two|three|four|five|six|seven|eight|nine|ten)";

  if (periodDays === 7) {
    const match = lower.match(new RegExp(`${countPattern}\\s+(?:times?|days?)\\s+(?:(?:a|per)\\s+week|in\\s+(?:a\\s+)?week)`));
    return match ? parseCountToken(match[1]) : 0;
  }

  if (periodDays === 30) {
    const match = lower.match(new RegExp(`${countPattern}\\s+(?:times?|days?)\\s+(?:(?:a|per)\\s+month|in\\s+(?:a\\s+)?month)`));
    return match ? parseCountToken(match[1]) : 0;
  }

  if (periodDays === 365) {
    const match = lower.match(new RegExp(`${countPattern}\\s+(?:times?|days?)\\s+(?:(?:a|per)\\s+year|in\\s+(?:a\\s+)?year)`));
    return match ? parseCountToken(match[1]) : 0;
  }

  return 0;
}

function parseGoalCountFromText(text, unit) {
  const lower = String(text || "").toLowerCase();
  const match = lower.match(new RegExp(`(\\d[\\d,]*)\\s+${escapeRegExp(unit)}\\b`));
  return match ? parseCountToken(match[1]) : 0;
}

function parseCountToken(value) {
  const raw = String(value || "").trim().toLowerCase();
  const words = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
  };

  if (words[raw]) {
    return words[raw];
  }

  const normalized = Number(raw.replace(/,/g, ""));
  return Number.isInteger(normalized) && normalized > 0 ? normalized : 0;
}

function isGenericGoalUnit(unit) {
  return unit === "session" || unit === "sessions" || unit === "time" || unit === "times";
}

function normalizeGoalUnit(unit) {
  const raw = String(unit || "").trim().toLowerCase();
  if (raw === "times" || raw === "time" || raw === "sessions") {
    return "session";
  }
  if (raw === "step") return "steps";
  if (raw === "rep") return "reps";
  return raw || "session";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
