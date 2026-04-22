const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = process.env.DB_PATH || path.join(DATA_DIR, "habits.sqlite");

let database;

function initializeDatabase() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  database = new DatabaseSync(DB_FILE);
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      original_prompt TEXT NOT NULL,
      category TEXT NOT NULL,
      unit TEXT NOT NULL,
      target_count INTEGER NOT NULL,
      period_days INTEGER NOT NULL,
      weekly_days TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS habit_entries (
      id TEXT PRIMARY KEY,
      habit_id TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('done', 'skipped')),
      created_at TEXT NOT NULL,
      updated_at TEXT,
      UNIQUE (habit_id, date),
      FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
    );
  `);
}

function getState() {
  return {
    habits: listHabits(),
    entries: listEntries(),
    meta: {
      storage: "sqlite",
      dbPath: DB_FILE
    }
  };
}

function listHabits() {
  return database
    .prepare(
      `SELECT id, name, original_prompt, category, unit, target_count, period_days, weekly_days, created_at
       FROM habits
       ORDER BY created_at DESC`
    )
    .all()
    .map(mapHabitRow);
}

function listEntries() {
  return database
    .prepare(
      `SELECT id, habit_id, date, status, created_at, updated_at
       FROM habit_entries
       ORDER BY date DESC, created_at DESC`
    )
    .all()
    .map(mapEntryRow);
}

function createHabit(input) {
  const habit = {
    id: `habit_${randomUUID()}`,
    name: input.name,
    originalPrompt: input.originalPrompt,
    category: input.category,
    unit: input.unit,
    targetCount: input.targetCount,
    periodDays: input.periodDays,
    weeklyDays: input.weeklyDays,
    createdAt: new Date().toISOString()
  };

  database
    .prepare(
      `INSERT INTO habits (
        id, name, original_prompt, category, unit, target_count, period_days, weekly_days, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      habit.id,
      habit.name,
      habit.originalPrompt,
      habit.category,
      habit.unit,
      habit.targetCount,
      habit.periodDays,
      JSON.stringify(habit.weeklyDays),
      habit.createdAt
    );

  return habit;
}

function findHabitById(habitId) {
  const row = database
    .prepare(
      `SELECT id, name, original_prompt, category, unit, target_count, period_days, weekly_days, created_at
       FROM habits
       WHERE id = ?`
    )
    .get(habitId);

  return row ? mapHabitRow(row) : null;
}

function upsertEntry(input) {
  const existing = database
    .prepare(
      `SELECT id, habit_id, date, status, created_at, updated_at
       FROM habit_entries
       WHERE habit_id = ? AND date = ?`
    )
    .get(input.habitId, input.date);

  if (existing) {
    const updatedAt = new Date().toISOString();
    database
      .prepare(
        `UPDATE habit_entries
         SET status = ?, updated_at = ?
         WHERE habit_id = ? AND date = ?`
      )
      .run(input.status, updatedAt, input.habitId, input.date);

    return {
      ...mapEntryRow(existing),
      status: input.status,
      updatedAt
    };
  }

  const entry = {
    id: `entry_${randomUUID()}`,
    habitId: input.habitId,
    date: input.date,
    status: input.status,
    createdAt: new Date().toISOString(),
    updatedAt: null
  };

  database
    .prepare(
      `INSERT INTO habit_entries (id, habit_id, date, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(entry.id, entry.habitId, entry.date, entry.status, entry.createdAt, entry.updatedAt);

  return entry;
}

function mapHabitRow(row) {
  return {
    id: row.id,
    name: row.name,
    originalPrompt: row.original_prompt,
    category: row.category,
    unit: row.unit,
    targetCount: row.target_count,
    periodDays: row.period_days,
    weeklyDays: parseWeeklyDays(row.weekly_days),
    createdAt: row.created_at
  };
}

function mapEntryRow(row) {
  return {
    id: row.id,
    habitId: row.habit_id,
    date: row.date,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null
  };
}

function parseWeeklyDays(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

module.exports = {
  createHabit,
  findHabitById,
  getState,
  initializeDatabase,
  upsertEntry
};
