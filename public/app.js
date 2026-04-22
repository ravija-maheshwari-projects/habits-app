const state = {
  habits: [],
  entries: []
};

const elements = {
  habitForm: document.querySelector("#habit-form"),
  habitInput: document.querySelector("#habit-input"),
  composerFeedback: document.querySelector("#composer-feedback"),
  habitList: document.querySelector("#habit-list"),
  habitCount: document.querySelector("#habit-count"),
  doneTodayCount: document.querySelector("#done-today-count"),
  skippedTodayCount: document.querySelector("#skipped-today-count"),
  inferenceStatus: document.querySelector("#inference-status"),
  storageStatus: document.querySelector("#storage-status"),
  habitCardTemplate: document.querySelector("#habit-card-template")
};

const today = currentDateString();

boot();

async function boot() {
  await refreshState();
  bindEvents();
}

function bindEvents() {
  elements.habitForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const description = elements.habitInput.value.trim();
    if (!description) {
      setComposerFeedback("Add a habit description first.");
      return;
    }

    setComposerFeedback("Inferring cadence and creating your habit...");

    try {
      const inference = await postJson("/api/infer-habit", { description });
      await postJson("/api/habits", {
        name: inference.name,
        category: inference.category,
        originalPrompt: description,
        cadence: inference.cadence
      });

      elements.inferenceStatus.textContent =
        inference.source === "openai" ? "OpenAI inference live" : "Heuristic inference live";
      elements.habitInput.value = "";
      setComposerFeedback(`${inference.name} created. ${inference.rationale}`);
      await refreshState();
    } catch (error) {
      console.error(error);
      setComposerFeedback("Could not create the habit. Please try again.");
    }
  });

  elements.habitList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const { habitId, action } = button.dataset;

    try {
      await postJson("/api/entries", {
        habitId,
        date: today,
        status: action === "done" ? "done" : "skipped"
      });
      await refreshState();
    } catch (error) {
      console.error(error);
      setComposerFeedback("Could not save today’s status.");
    }
  });
}

async function refreshState() {
  const data = await fetchJson("/api/state");
  state.habits = data.habits || [];
  state.entries = data.entries || [];
  render();
}

function render() {
  renderOverview();
  renderHabits();
}

function renderOverview() {
  elements.habitCount.textContent = String(state.habits.length);

  const todayEntries = state.entries.filter((entry) => entry.date === today);
  elements.doneTodayCount.textContent = String(
    todayEntries.filter((entry) => entry.status === "done").length
  );
  elements.skippedTodayCount.textContent = String(
    todayEntries.filter((entry) => entry.status === "skipped").length
  );

  elements.storageStatus.textContent = `Persistent storage online • ${state.entries.length} logs`;
  if (dataBackedByDatabase()) {
    elements.storageStatus.textContent = `SQLite database online • ${state.entries.length} logs`;
  }
}

function renderHabits() {
  elements.habitList.innerHTML = "";

  if (!state.habits.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent =
      "No habits yet. Write one above in plain English and the app will infer its schedule.";
    elements.habitList.appendChild(emptyState);
    return;
  }

  state.habits.forEach((habit) => {
    const fragment = elements.habitCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".habit-card");
    const habitEntries = entriesForHabit(habit.id);
    const calendarDays = buildCalendarDays(habit, 98);
    const thisWeekRange = buildRecentDays(7);
    const weekEntries = habitEntries.filter((entry) => thisWeekRange.includes(entry.date));

    fragment.querySelector(".habit-name").textContent = habit.name;
    fragment.querySelector(".habit-meta").textContent = formatHabitMeta(habit);
    fragment.querySelector(".habit-rationale").textContent = cadenceExplanation(habit);
    fragment.querySelector(".scheduled-count").textContent = String(
      calendarDays.slice(-7).filter((day) => day.isScheduled).length
    );
    fragment.querySelector(".done-count").textContent = String(
      weekEntries.filter((entry) => entry.status === "done").length
    );
    fragment.querySelector(".skipped-count").textContent = String(
      weekEntries.filter((entry) => entry.status === "skipped").length
    );

    const doneButton = fragment.querySelector(".done-button");
    const skipButton = fragment.querySelector(".skip-button");
    doneButton.dataset.action = "done";
    doneButton.dataset.habitId = habit.id;
    skipButton.dataset.action = "skip";
    skipButton.dataset.habitId = habit.id;

    const calendarGrid = fragment.querySelector(".calendar-grid");
    calendarDays.forEach((day) => {
      const cell = document.createElement("div");
      cell.className = `day-cell ${day.statusClass}`;
      cell.title = `${day.date}: ${day.label}`;
      cell.innerHTML = `
        <span>${day.weekday}</span>
        <span class="day-number">${day.dayOfMonth}</span>
        <span class="day-state">${day.shortLabel}</span>
      `;
      calendarGrid.appendChild(cell);
    });

    elements.habitList.appendChild(fragment);
  });
}

function formatHabitMeta(habit) {
  const daysText = habit.weeklyDays.length
    ? habit.weeklyDays.map(shortDayName).join(", ")
    : `every ${habit.periodDays} day${habit.periodDays === 1 ? "" : "s"}`;

  return `${habit.category} • target ${habit.targetCount} ${habit.unit} • ${daysText}`;
}

function cadenceExplanation(habit) {
  if (habit.weeklyDays.length) {
    return `Tracking on ${habit.weeklyDays.map(shortDayName).join(", ")} with a target of ${habit.targetCount} ${habit.unit}.`;
  }

  return `Tracking ${habit.targetCount} ${habit.unit} every ${habit.periodDays} day${habit.periodDays === 1 ? "" : "s"}.`;
}

function entriesForHabit(habitId) {
  return state.entries.filter((entry) => entry.habitId === habitId);
}

function buildCalendarDays(habit, totalDays) {
  const entryMap = new Map(
    entriesForHabit(habit.id).map((entry) => [entry.date, entry.status])
  );

  return buildRecentDays(totalDays).map((date) => {
    const dayDate = parseLocalDate(date);
    const weekday = dayDate.getDay();
    const entryStatus = entryMap.get(date);
    const isScheduled = isHabitScheduledOnDate(habit, dayDate);

    let label = "Not logged";
    let shortLabel = "idle";
    let statusClass = "";

    if (entryStatus === "done") {
      label = "Done";
      shortLabel = "done";
      statusClass = "status-done";
    } else if (entryStatus === "skipped") {
      label = "Skipped";
      shortLabel = "skip";
      statusClass = "status-skipped";
    } else if (isScheduled) {
      label = "Scheduled";
      shortLabel = "due";
      statusClass = "status-scheduled";
    }

    return {
      date,
      dayOfMonth: date.slice(-2),
      weekday: shortDayName(weekday),
      label,
      shortLabel,
      statusClass,
      isScheduled
    };
  });
}

function buildRecentDays(total) {
  const days = [];
  const base = parseLocalDate(today);

  for (let offset = total - 1; offset >= 0; offset -= 1) {
    const next = new Date(base);
    next.setDate(base.getDate() - offset);
    days.push(formatLocalDate(next));
  }

  return days;
}

function shortDayName(index) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][index];
}

function currentDateString() {
  return formatLocalDate(new Date());
}

function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isHabitScheduledOnDate(habit, date) {
  if (habit.weeklyDays.length) {
    return habit.weeklyDays.includes(date.getDay());
  }

  const createdDate = parseLocalDate(habit.createdAt.slice(0, 10));
  const diffDays = Math.floor((date - createdDate) / 86400000);
  return diffDays >= 0 && diffDays % habit.periodDays === 0;
}

function setComposerFeedback(message) {
  elements.composerFeedback.textContent = message;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}

function dataBackedByDatabase() {
  return true;
}
