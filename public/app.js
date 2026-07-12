import {
  createHabit,
  deleteEntry,
  deleteHabit,
  getState as getLocalState,
  hydrateFromServer,
  initializeStorage,
  updateHabit,
  upsertEntry
} from "./storage.js";

const state = {
  habits: [],
  entries: [],
  tasks: loadTasks(),
  events: loadEvents(),
  selectedHabitId: null,
  activeView: "calendar",
  lastMainView: "calendar",
  isComposerOpen: false,
  composerMode: "create",
  composerKind: "habit",
  editingHabitId: null,
  editingTaskId: null,
  isLogSheetOpen: false,
  isAddChooserOpen: false,
  selectedLogDate: "",
  selectedLogHabitId: null,
  detailMonthOffset: 0,
  isOnline: navigator.onLine,
  storageReady: false
};

function loadTasks() {
  try {
    const raw = localStorage.getItem("hp.tasks.v1");
    if (!raw) return seedTasks();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : seedTasks();
  } catch { return seedTasks(); }
}

function saveTasks() {
  try { localStorage.setItem("hp.tasks.v1", JSON.stringify(state.tasks)); } catch {}
}

function loadEvents() {
  // Events are read-only mirrors of an upstream calendar (e.g. Google Calendar).
  // The wrapper seeds them; in the real app this is replaced with a pull sync.
  try {
    const raw = localStorage.getItem("hp.events.v1");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function seedTasks() {
  // Seed a few sample tasks on first run so the screen isn't empty.
  return [
    { id: "t1", title: "File expense report",      meta: "Q2 travel\u00a0\u00b7 4 receipts", color: "coral", due: "today",     done: false },
    { id: "t2", title: "Call dentist",             meta: "reschedule cleaning",         color: "ochre", due: "today",     done: false },
    { id: "t3", title: "Buy birthday gift for Theo", meta: "",                          color: "plum",  due: "this-week", done: false },
    { id: "t4", title: "Renew car registration",   meta: "expires May 14",              color: "coral", due: "this-week", done: false },
    { id: "t5", title: "Read CRDT paper",          meta: "saved 2 weeks ago",           color: "sage",  due: "someday",   done: false },
    { id: "t6", title: "Reply to Mira about retreat", meta: "",                         color: "sky",   due: "someday",   done: false }
  ];
}

const SWIPE_TRIGGER = 76;
const SWIPE_MAX = 132;

/* ── Poster palette + illustration mapping ──────────────────── */
const COLOR_KEYS = ["coral", "ochre", "sage", "plum", "sky"];

const ILLO_BY_KEYWORD = [
  // [regex, illustration]
  [/walk|run|step|jog|hike|stroll|move/i, "walker"],
  [/read|book|study|learn|journal|write/i, "book"],
  [/sleep|bed|night|phone|screen|meditat/i, "moon"],
  [/lift|gym|strength|train|workout|push|pull/i, "lift"],
  [/water|drink|hydrate|tea|coffee|cup/i, "cup"],
  [/garden|plant|grow|nature|outdoor/i, "sprout"],
  [/sun|morning|wake|dawn/i, "sun"]
];

const CATEGORY_COLOR = {
  movement: "coral",
  fitness: "coral",
  exercise: "coral",
  strength: "sage",
  mind: "ochre",
  learning: "ochre",
  reading: "ochre",
  focus: "plum",
  sleep: "plum",
  health: "sage",
  wellness: "sage",
  creativity: "plum",
  social: "sky",
  finance: "sky",
  productivity: "sky"
};

function illoForHabit(habit) {
  const text = `${habit.name || ""} ${habit.originalPrompt || ""} ${habit.category || ""}`;
  for (const [regex, illo] of ILLO_BY_KEYWORD) {
    if (regex.test(text)) return illo;
  }
  return "sun";
}

function colorForHabit(habit) {
  const cat = (habit.category || "").toLowerCase();
  for (const key of Object.keys(CATEGORY_COLOR)) {
    if (cat.includes(key)) return CATEGORY_COLOR[key];
  }
  // Stable fallback based on habit id so colors stay put across renders
  const id = habit.id || habit.name || "";
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLOR_KEYS[h % COLOR_KEYS.length];
}

function applyAccent(el, colorKey) {
  el.style.setProperty("--accent", `var(--${colorKey})`);
  el.style.setProperty("--accent-deep", `var(--${colorKey}-deep)`);
  el.style.setProperty("--accent-tint", `var(--${colorKey}-tint)`);
}

const elements = {
  appHeader: document.querySelector("#app-header"),
  headerKicker: document.querySelector("#header-kicker"),
  headerTitle: document.querySelector("#header-title"),
  headerSubtitle: document.querySelector("#header-subtitle"),
  todayView: document.querySelector("#today-view"),
  calendarView: document.querySelector("#calendar-view"),
  tasksView: document.querySelector("#tasks-view"),
  insightsView: document.querySelector("#insights-view"),
  habitDetailView: document.querySelector("#habit-detail-view"),
  navItems: [...document.querySelectorAll("[data-nav-view]")],
  floatingAddButton: document.querySelector("#floating-add-button"),
  addChooserModal: document.querySelector("#add-chooser-modal"),
  addChooserBackdrop: document.querySelector("#add-chooser-backdrop"),
  addChooserRows: [...document.querySelectorAll("[data-add-kind]")],
  composerModal: document.querySelector("#composer-modal"),
  composerBackdrop: document.querySelector("#composer-backdrop"),
  composerSheet: document.querySelector(".composer-sheet"),
  composerTitle: document.querySelector("#composer-title"),
  habitForm: document.querySelector("#habit-form"),
  habitTitleField: document.querySelector("#habit-title-field"),
  habitTitleInput: document.querySelector("#habit-title-input"),
  habitInput: document.querySelector("#habit-input"),
  habitSubmitButton: document.querySelector("#habit-submit-button"),
  composerFeedback: document.querySelector("#composer-feedback"),
  logSheetModal: document.querySelector("#log-sheet-modal"),
  logSheetBackdrop: document.querySelector("#log-sheet-backdrop"),
  logSheet: document.querySelector(".log-sheet"),
  logSheetTitle: document.querySelector("#log-sheet-title"),
  logSheetSubtitle: document.querySelector("#log-sheet-subtitle"),
  logSheetDone: document.querySelector("#log-sheet-done"),
  logSheetSkip: document.querySelector("#log-sheet-skip"),
  logSheetClear: document.querySelector("#log-sheet-clear"),
  logSheetCancel: document.querySelector("#log-sheet-cancel"),
  rescheduleModal: document.querySelector("#reschedule-sheet-modal"),
  rescheduleBackdrop: document.querySelector("#reschedule-backdrop"),
  rescheduleStepPick: document.querySelector('.reschedule-step[data-step="pick"]'),
  rescheduleStepScope: document.querySelector('.reschedule-step[data-step="scope"]'),
  rescheduleKicker: document.querySelector("#reschedule-kicker"),
  rescheduleTitle: document.querySelector("#reschedule-title"),
  rescheduleCurrent: document.querySelector("#reschedule-current"),
  rescheduleScopeSummary: document.querySelector("#reschedule-scope-summary"),
  rescheduleDayRow: document.querySelector("#reschedule-day-row"),
  rescheduleTimeChips: document.querySelector("#reschedule-time-chips"),
  rescheduleTimeInput: document.querySelector("#reschedule-time-input"),
  rescheduleSkipToday: document.querySelector("#reschedule-skip-today"),
  rescheduleContinue: document.querySelector("#reschedule-continue"),
  rescheduleCancel: document.querySelector("#reschedule-cancel"),
  rescheduleScopeToday: document.querySelector("#reschedule-scope-today"),
  rescheduleScopeEvery: document.querySelector("#reschedule-scope-every"),
  rescheduleScopeBack: document.querySelector("#reschedule-scope-back"),
  todayCardTemplate: document.querySelector("#today-card-template"),
  habitRowTemplate: document.querySelector("#habit-row-template"),
  taskRowTemplate: document.querySelector("#task-row-template"),
  calendarBlockTemplate: document.querySelector("#calendar-block-template")
};

const today = currentDateString();

boot();

async function boot() {
  bindEvents();
  updateNetworkStatus();

  try {
    await initializeStorage();
    state.storageReady = true;
    await requestPersistentStorage();
    await refreshState();

    if (state.isOnline) {
      await hydrateLocalStore();
    }

    await registerServiceWorker();
  } catch (error) {
    console.error(error);
    setComposerFeedback("This browser could not initialize on-device storage.");
  }
}

function bindEvents() {
  elements.floatingAddButton.addEventListener("click", openAddChooser);
  elements.addChooserBackdrop.addEventListener("click", closeAddChooser);
  elements.addChooserRows.forEach((row) => {
    row.addEventListener("click", () => {
      const kind = row.dataset.addKind;
      closeAddChooser();
      if (kind === "habit") {
        openComposer();
      } else if (kind === "task") {
        openTaskComposer();
      }
    });
  });
  elements.composerBackdrop.addEventListener("click", closeComposer);
  elements.logSheetBackdrop.addEventListener("click", closeLogSheet);
  initializeComposerSheetDismiss();
  initializeLogSheetDismiss();

  elements.navItems.forEach((item) => {
    item.addEventListener("click", () => setActiveView(item.dataset.navView));
  });

  elements.habitForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const isEditing = state.composerMode === "edit";
    const description = elements.habitInput.value.trim();
    if (!description) {
      setComposerFeedback(isEditing ? "Retell the habit so AI can update its target and cadence." : "Add a habit description first.");
      return;
    }

    const customTitle = elements.habitTitleInput.value.trim();
    if (isEditing && !customTitle) {
      setComposerFeedback("Add a title for the habit.");
      return;
    }

    if (!state.isOnline) {
      setComposerFeedback(
        isEditing
          ? "Editing target and cadence needs a connection. Existing habits still work offline."
          : "Habit inference needs a connection. Existing habits still work offline."
      );
      return;
    }

    setComposerFeedback(isEditing ? "Updating cadence and saving your changes…" : "Inferring cadence and saving to this device…");

    try {
      const inference = await postJson("/api/infer-habit", { description });

      if (isEditing) {
        const updatedHabit = await updateHabit(state.editingHabitId, {
          name: customTitle,
          category: inference.category,
          originalPrompt: description,
          unit: inference.cadence?.unit,
          targetCount: inference.cadence?.targetCount,
          periodDays: inference.cadence?.periodDays,
          weeklyDays: inference.cadence?.weeklyDays
        });

        state.selectedHabitId = updatedHabit.id;
        setComposerFeedback(`${updatedHabit.name} updated. ${inference.rationale}`);
      } else {
        const createdHabit = await createHabit({
          name: inference.name,
          category: inference.category,
          originalPrompt: description,
          unit: inference.cadence?.unit,
          targetCount: inference.cadence?.targetCount,
          periodDays: inference.cadence?.periodDays,
          weeklyDays: inference.cadence?.weeklyDays
        });

        state.selectedHabitId = createdHabit.id;
        setComposerFeedback(`${inference.name} saved. ${inference.rationale}`);
      }

      closeComposer();
      setActiveView("habitDetail");
      await refreshState();
    } catch (error) {
      console.error(error);
      setComposerFeedback(
        isEditing
          ? "Could not update the habit. Please try again while online."
          : "Could not create the habit. Please try again while online."
      );
    }
  });

  elements.todayView.addEventListener("click", handleViewActions);
  elements.calendarView.addEventListener("click", handleCalendarActions);
  elements.tasksView.addEventListener("click", handleTasksActions);
  elements.habitDetailView.addEventListener("click", handleViewActions);
  elements.insightsView.addEventListener("click", handleViewActions);
  elements.logSheetDone.addEventListener("click", () => void saveSelectedLogDate("done"));
  elements.logSheetSkip.addEventListener("click", () => void saveSelectedLogDate("skipped"));
  elements.logSheetClear.addEventListener("click", () => void clearSelectedLogDate());
  elements.logSheetCancel.addEventListener("click", closeLogSheet);

  window.addEventListener("online", async () => {
    state.isOnline = true;
    updateNetworkStatus();

    if (state.storageReady) {
      await hydrateLocalStore();
      await refreshState();
    }
  });

  window.addEventListener("offline", () => {
    state.isOnline = false;
    updateNetworkStatus();
    render();
  });
}

function handleViewActions(event) {
  const button = event.target.closest("button");
  const card = event.target.closest("[data-open-habit-id]");

  if (button?.dataset.openHabitId) {
    state.selectedHabitId = button.dataset.openHabitId;
    setActiveView("habitDetail");
    return;
  }

  if (button?.dataset.backToView) {
    setActiveView(button.dataset.backToView);
    return;
  }

  if (button?.dataset.monthStep) {
    const step = Number(button.dataset.monthStep);
    setDetailMonthOffset(state.detailMonthOffset + step);
    return;
  }

  if (button?.dataset.monthOffset !== undefined && button?.dataset.monthOffset !== "") {
    setDetailMonthOffset(Number(button.dataset.monthOffset));
    return;
  }

  if (button?.dataset.deleteHabitId) {
    void confirmAndDeleteHabit(button.dataset.deleteHabitId);
    return;
  }

  if (button?.dataset.editHabitId) {
    openEditComposer(button.dataset.editHabitId);
    return;
  }

  if (button?.dataset.calendarDate && button?.dataset.calendarHabitId) {
    openLogSheet(button.dataset.calendarHabitId, button.dataset.calendarDate);
    return;
  }

  if (!button && card?.dataset.openHabitId) {
    if (card.dataset.suppressOpen === "true") {
      return;
    }
    state.selectedHabitId = card.dataset.openHabitId;
    setActiveView("habitDetail");
    return;
  }

  if (!button) {
    return;
  }

  const habitId = button.dataset.habitId;
  const action = button.dataset.action;
  if (!habitId || !action) {
    return;
  }

  if (action === "detail") {
    state.selectedHabitId = habitId;
    setActiveView("habitDetail");
    return;
  }

  void saveEntry(habitId, action === "done" ? "done" : "skipped");
}

async function saveEntry(habitId, status, options = {}) {
  const entryDate = options.date || today;

  try {
    await upsertEntry({ habitId, date: entryDate, status });
    if (!options.skipRefresh) {
      await refreshState();
    }
  } catch (error) {
    console.error(error);
    setComposerFeedback("Could not save that status.");
  }
}

async function confirmAndDeleteHabit(habitId) {
  const habit = state.habits.find((item) => item.id === habitId);
  if (!habit) {
    return;
  }

  const confirmed = window.confirm(`Delete "${habit.name}"? This will remove the habit and all of its logs.`);
  if (!confirmed) {
    return;
  }

  try {
    await deleteHabit(habitId);
    state.selectedHabitId = state.habits.find((item) => item.id !== habitId)?.id || null;
    setActiveView("today");
    await refreshState();
  } catch (error) {
    console.error(error);
    setComposerFeedback("Could not delete the habit. Please try again.");
  }
}

async function refreshState() {
  const data = await getLocalState();
  state.habits = data.habits || [];
  state.entries = data.entries || [];

  if (!state.selectedHabitId && state.habits.length) {
    state.selectedHabitId = state.habits[0].id;
  }

  if (state.selectedHabitId && !state.habits.some((habit) => habit.id === state.selectedHabitId)) {
    state.selectedHabitId = state.habits[0]?.id || null;
  }

  render();
}

function render() {
  renderChrome();
  renderCalendarView();
  renderTodayView();
  renderTasksView();
  renderInsightsView();
  renderHabitDetailView();
  renderComposer();
  renderLogSheet();
  renderAddChooser();
}

function renderChrome() {
  const headerMap = {
    calendar: {
      kicker: formatFriendlyDate(parseLocalDate(today)).toUpperCase(),
      title: posterTitleForCalendar(),
      subtitle: "",
      variant: "poster",
      accent: "coral"
    },
    today: {
      kicker: formatFriendlyDate(parseLocalDate(today)).toUpperCase(),
      title: "habits",
      subtitle: "",
      variant: "poster",
      accent: "coral"
    },
    tasks: {
      kicker: posterKickerForTasks(),
      title: 'Tasks <em>&amp; loose ends.</em>',
      subtitle: "",
      variant: "poster",
      accent: "ochre"
    },
    insights: {
      kicker: "Insights · last 30 days",
      title: 'Your <em>rhythm.</em>',
      subtitle: "",
      variant: "plain",
      accent: "coral"
    },
    habitDetail: {
      kicker: getCurrentMonthLabel().toUpperCase(),
      title: posterTitleForHabit(selectedHabit()),
      subtitle: "",
      variant: "plain",
      accent: selectedHabit() ? colorForHabit(selectedHabit()) : "coral"
    }
  };

  const chrome = headerMap[state.activeView] || headerMap.calendar;
  elements.headerKicker.textContent = chrome.kicker;
  elements.headerTitle.innerHTML = chrome.title;
  elements.headerSubtitle.textContent = chrome.subtitle;
  elements.headerSubtitle.hidden = !chrome.subtitle;

  elements.appHeader.dataset.variant = chrome.variant;
  elements.appHeader.dataset.view = state.activeView;
  applyAccent(elements.appHeader, chrome.accent);

  const visibleView = state.activeView === "habitDetail" ? "habitDetail" : state.activeView;
  const activeNavView = state.activeView === "habitDetail" ? state.lastMainView : state.activeView;
  elements.calendarView.hidden = visibleView !== "calendar";
  elements.todayView.hidden = visibleView !== "today";
  elements.tasksView.hidden = visibleView !== "tasks";
  elements.insightsView.hidden = visibleView !== "insights";
  elements.habitDetailView.hidden = visibleView !== "habitDetail";

  elements.navItems.forEach((item) => {
    item.classList.toggle("is-active", item.dataset.navView === activeNavView);
  });
}

function posterTitleForCalendar() {
  const dueToday = state.habits.filter((h) => isHabitScheduledOnDate(h, parseLocalDate(today))).length;
  const eventsToday = (state.events || []).filter((e) => e.date === today).length;
  const total = dueToday + eventsToday;
  if (!total) return 'A blank <em>day.</em>';
  const word = numberWord(total);
  // Phrase: "Two things." vs "One thing."
  return `${capitalize(word)}<br/><em>${total === 1 ? "thing." : "things."}</em>`;
}

function posterKickerForTasks() {
  const open = state.tasks.filter((t) => !t.done).length;
  const done = state.tasks.length - open;
  return `${open} OPEN · ${done} DONE`;
}

function posterTitleFromCounts() {
  const total = state.habits.length;
  if (!total) return 'A clean <em>slate.</em>';
  const dueToday = state.habits.filter((h) => isHabitScheduledOnDate(h, parseLocalDate(today))).length;
  const doneToday = state.habits.filter((h) => entryForHabitAndDate(h.id, today)?.status === "done").length;
  const denom = Math.max(dueToday, 1);
  const word = numberWord(doneToday);
  const ofWord = numberWord(denom);
  return `${capitalize(word)}<br/><em>of ${ofWord}.</em>`;
}

function posterTitleForHabit(habit) {
  if (!habit) return "Habit";
  const name = habit.name || "Habit";
  // Two-line: first word bold, rest italic. Keep simple.
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return `${escapeHtml(parts[0])}<br/><em>habit.</em>`;
  }
  const first = parts[0];
  const rest = parts.slice(1).join(" ");
  return `${escapeHtml(first)}<br/><em>${escapeHtml(rest)}.</em>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function numberWord(n) {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  return words[n] || String(n);
}

/* ── Today ───────────────────────────────────────────────── */
function renderTodayView() {
  elements.todayView.innerHTML = "";

  if (!state.habits.length) {
    elements.todayView.appendChild(buildEmptyCard("No habits yet", "Tap + to write your first one — describe it the way you'd say it to a friend."));
    return;
  }

  // (today's progress bar removed)
  const dueToday = state.habits.filter((h) => isHabitScheduledOnDate(h, parseLocalDate(today)));
  const doneToday = dueToday.filter((h) => entryForHabitAndDate(h.id, today)?.status === "done").length;
  const denom = Math.max(dueToday.length, 1);
  const pct = Math.round((doneToday / denom) * 100);

  const list = document.createElement("section");
  list.className = "today-stack";
  state.habits.forEach((habit) => {
    const entry = entryForHabitAndDate(habit.id, today);
    list.appendChild(buildTodayCard(habit, entry));
  });
  elements.todayView.appendChild(list);
  initializeSwipeCards();
}

/* ── Calendar ────────────────────────────────────────────── */
function renderCalendarView() {
  elements.calendarView.innerHTML = "";
  if (state.activeView !== "calendar") return;

  const dueToday = state.habits.filter((h) => isHabitScheduledOnDate(h, parseLocalDate(today)));

  // Header — week strip
  const weekStrip = buildWeekStrip();
  elements.calendarView.appendChild(weekStrip);

  // Pull events for today
  const todayEvents = (state.events || []).filter((e) => e.date === today);

  if (!dueToday.length && !todayEvents.length) {
    const empty = document.createElement("div");
    empty.className = "cal-empty";
    empty.innerHTML = `
      <h2>Nothing on the books.</h2>
      <p>Tap + to add a habit or task — they'll show up here when they're due.</p>
    `;
    elements.calendarView.appendChild(empty);
    return;
  }

  // Build unified item list (habit blocks + event blocks)
  const items = [
    ...dueToday.map((h) => ({
      kind: "habit",
      habit: h,
      entry: entryForHabitAndDate(h.id, today),
      hour: defaultHourForHabit(h),
      minute: 0
    })),
    ...todayEvents.map((e) => {
      const [hh, mm] = (e.start || "09:00").split(":").map(Number);
      const [eh, em] = (e.end || "10:00").split(":").map(Number);
      return {
        kind: "event",
        event: e,
        hour: hh,
        minute: mm || 0,
        endHour: eh,
        endMinute: em || 0
      };
    })
  ].sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));

  // Bucket into morning / afternoon / evening
  const buckets = [
    { id: "morning",   label: "Morning",   meta: "until noon",        range: [0, 12]  },
    { id: "afternoon", label: "Afternoon", meta: "noon → 5pm",        range: [12, 17] },
    { id: "evening",   label: "Evening",   meta: "after 5pm",         range: [17, 30] }
  ];

  const stack = document.createElement("section");
  stack.className = "cal-buckets";

  // Determine current bucket so we can highlight it
  const nowH = new Date().getHours();
  const currentBucket = buckets.find((b) => nowH >= b.range[0] && nowH < b.range[1])?.id;

  buckets.forEach((bucket) => {
    const inBucket = items.filter((it) => it.hour >= bucket.range[0] && it.hour < bucket.range[1]);
    if (!inBucket.length) return;

    const section = document.createElement("section");
    section.className = "cal-bucket";
    if (bucket.id === currentBucket) section.dataset.current = "true";

    const head = document.createElement("header");
    head.className = "cal-bucket-head";

    const lbl = document.createElement("h3");
    lbl.className = "cal-bucket-label";
    lbl.textContent = bucket.label;

    const meta = document.createElement("span");
    meta.className = "cal-bucket-meta";
    meta.textContent = bucket.meta;

    head.appendChild(lbl);
    head.appendChild(meta);
    section.appendChild(head);

    const list = document.createElement("div");
    list.className = "cal-bucket-list";
    inBucket.forEach((it) => {
      const block = it.kind === "event"
        ? buildCalendarEventBlock(it.event, it.hour, it.minute, (it.endHour - it.hour) * 60 + (it.endMinute - it.minute))
        : buildCalendarBlock(it.habit, it.entry, it.hour, 60);
      list.appendChild(block);
    });
    section.appendChild(list);
    stack.appendChild(section);
  });

  elements.calendarView.appendChild(stack);
}

function buildWeekStrip() {
  const wrap = document.createElement("div");
  wrap.className = "cal-week-strip";
  const todayDate = parseLocalDate(today);
  const dow = todayDate.getDay(); // 0=Sun
  // Build last 3 + today + next 3
  for (let i = -3; i <= 3; i += 1) {
    const d = new Date(todayDate);
    d.setDate(todayDate.getDate() + i);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cal-week-cell";
    if (i === 0) cell.dataset.active = "true";
    const day = document.createElement("span");
    day.className = "cal-week-day";
    day.textContent = ["S", "M", "T", "W", "T", "F", "S"][d.getDay()];
    const num = document.createElement("span");
    num.className = "cal-week-num";
    num.textContent = String(d.getDate());
    cell.appendChild(day);
    cell.appendChild(num);
    wrap.appendChild(cell);
  }
  return wrap;
}

function defaultHourForHabit(habit) {
  const cat = (habit.category || "").toLowerCase();
  if (cat.includes("movement") || cat.includes("strength")) {
    // morning movement, evening lift
    if (cat.includes("strength")) return 18;
    return 7;
  }
  if (cat.includes("focus")) return 21;
  if (cat.includes("mind")) return 20;
  if (cat.includes("sleep")) return 22;
  if (cat.includes("wellness")) return 14;
  // fallback by id hash to spread across the day
  const hours = [9, 12, 15, 18];
  return hours[hashStringToIndex(habit.id, hours.length)];
}

function formatHour12(h) {
  const mer = h >= 12 ? "pm" : "am";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12} ${mer}`;
}

function formatTime12(h, m) {
  const mer = h >= 12 ? "pm" : "am";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${mer}`;
}

function buildCalendarBlock(habit, entry, hour, duration) {
  const fragment = elements.calendarBlockTemplate.content.cloneNode(true);
  const block = fragment.querySelector(".cal-block");
  const status = entry?.status || "pending";
  const colorKey = colorForHabit(habit);
  block.dataset.kind = "habit";
  block.dataset.state = status;
  block.dataset.habitId = habit.id;
  applyAccent(block, colorKey);

  const illoKey = illoForHabit(habit);
  const illo = block.querySelector(".cal-tile-illo");
  if (illo) illo.src = `/illustrations/${illoKey}.svg`;

  block.querySelector(".cal-block-time").textContent = formatTime12(hour, 0);
  block.querySelector(".cal-block-title").textContent = habit.name || "Habit";
  const meta = block.querySelector(".cal-block-meta");
  if (status === "done") meta.textContent = "Done — nice.";
  else if (status === "skipped") meta.textContent = "Skipped today";
  else meta.textContent = scheduleLabel(habit);

  block.querySelector(".cal-block-check").dataset.calBlockToggle = habit.id;
  return block;
}

function buildCalendarEventBlock(event, hour, minute, duration) {
  const block = document.createElement("article");
  block.className = "cal-event";
  block.dataset.kind = "event";
  block.dataset.eventId = event.id || "";
  block.dataset.source = event.source || "google";

  // Color hint by calendar
  const cal = (event.calendar || "").toLowerCase();
  const colorKey =
    cal.includes("work")     ? "ochre"  :
    cal.includes("personal") ? "sage"   :
    cal.includes("family")   ? "coral"  :
                               "ink";
  applyAccent(block, colorKey);

  const endMinutes = hour * 60 + minute + duration;
  const eh = Math.floor(endMinutes / 60);
  const em = endMinutes % 60;

  const time = document.createElement("div");
  time.className = "cal-event-time";
  const start = document.createElement("strong");
  start.textContent = formatTime12(hour, minute);
  const end = document.createElement("span");
  end.textContent = formatTime12(eh, em);
  time.appendChild(start);
  time.appendChild(end);

  const body = document.createElement("div");
  body.className = "cal-event-body";

  const title = document.createElement("h3");
  title.className = "cal-event-title";
  title.textContent = event.title || "Event";
  body.appendChild(title);

  const metaParts = [];
  if (event.location) metaParts.push(event.location);
  if (event.calendar) metaParts.push(event.calendar);
  if (metaParts.length) {
    const meta = document.createElement("p");
    meta.className = "cal-event-meta";
    meta.textContent = metaParts.join(" · ");
    body.appendChild(meta);
  }

  // Tiny source glyph (G for Google)
  const source = document.createElement("span");
  source.className = "cal-event-source";
  source.textContent = event.source === "google" ? "G" : "·";
  source.title = event.source === "google" ? "Google Calendar" : "Calendar";

  block.appendChild(time);
  block.appendChild(body);
  block.appendChild(source);
  return block;
}

function handleCalendarActions(event) {
  const button = event.target.closest("button");
  if (button?.dataset.calBlockToggle) {
    const habitId = button.dataset.calBlockToggle;
    const entry = entryForHabitAndDate(habitId, today);
    const next = entry?.status === "done" ? "skipped" : "done";
    void saveEntry(habitId, next);
    return;
  }
  const block = event.target.closest(".cal-block[data-habit-id]");
  if (block) {
    state.selectedHabitId = block.dataset.habitId;
    setActiveView("habitDetail");
  }
}

function scheduleLabel(habit) {
  if (habit.weeklyDays?.length === 7) return "Daily";
  if (habit.weeklyDays?.length) {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return habit.weeklyDays.map((d) => names[d]).join(" · ");
  }
  return "Scheduled today";
}

function hashStringToIndex(s, mod) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}

/* ── Tasks ───────────────────────────────────────────────── */
function renderTasksView() {
  elements.tasksView.innerHTML = "";
  if (state.activeView !== "tasks") return;

  const wrap = document.createElement("section");
  wrap.className = "tasks-stack";

  if (!state.tasks.length) {
    const empty = document.createElement("div");
    empty.className = "cal-empty";
    empty.innerHTML = `
      <h2>Nothing on your plate.</h2>
      <p>Tap + to capture a one-off — errands, follow-ups, anything that doesn't repeat.</p>
    `;
    wrap.appendChild(empty);
    elements.tasksView.appendChild(wrap);
    return;
  }

  const groups = [
    { id: "today",     title: "TODAY",     hint: "do today" },
    { id: "this-week", title: "THIS WEEK", hint: "by friday" },
    { id: "someday",   title: "SOMEDAY",   hint: "no rush" }
  ];

  groups.forEach((group) => {
    const items = state.tasks.filter((t) => (t.due || "someday") === group.id);
    if (!items.length) return;
    const open = items.filter((t) => !t.done).length;

    const groupEl = document.createElement("div");
    groupEl.className = "task-group";
    groupEl.innerHTML = `
      <div class="task-group-head">
        <div class="task-group-title">${group.title} <em>${open} open</em></div>
        <div class="task-group-hint">${escapeHtml(group.hint)}</div>
      </div>
      <div class="task-group-list" data-task-group="${group.id}"></div>
    `;
    const list = groupEl.querySelector(".task-group-list");
    items.forEach((task) => list.appendChild(buildTaskRow(task)));
    wrap.appendChild(groupEl);
  });

  elements.tasksView.appendChild(wrap);
}

function buildTaskRow(task) {
  const fragment = elements.taskRowTemplate.content.cloneNode(true);
  const row = fragment.querySelector(".task-row");
  row.dataset.taskId = task.id;
  row.dataset.done = String(!!task.done);
  applyAccent(row, task.color || "coral");

  row.querySelector(".task-checkbox").dataset.taskToggle = task.id;
  const tag = row.querySelector(".task-tag");
  if (tag) tag.style.background = `var(--${task.color || "coral"})`;

  row.querySelector(".task-title").textContent = task.title || "Untitled";
  const metaEl = row.querySelector(".task-meta");
  if (task.meta) metaEl.textContent = task.meta;
  else metaEl.remove();
  return row;
}

function handleTasksActions(event) {
  const button = event.target.closest("button");
  if (button?.dataset.taskToggle) {
    const id = button.dataset.taskToggle;
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    task.done = !task.done;
    saveTasks();
    render();
    return;
  }

  const row = event.target.closest(".task-row[data-task-id]");
  if (row) {
    openTaskComposer(row.dataset.taskId);
  }
}

/* ── Add chooser ─────────────────────────────────────────── */
function openAddChooser() {
  state.isAddChooserOpen = true;
  elements.floatingAddButton.classList.add("is-open");
  elements.floatingAddButton.setAttribute("aria-expanded", "true");
  renderAddChooser();
}

function closeAddChooser() {
  state.isAddChooserOpen = false;
  elements.floatingAddButton.classList.remove("is-open");
  elements.floatingAddButton.setAttribute("aria-expanded", "false");
  renderAddChooser();
}

function renderAddChooser() {
  elements.addChooserModal.hidden = !state.isAddChooserOpen;
}

/* ── Task composer (lightweight prompt; reuses pattern) ───── */
function openTaskComposer(taskId) {
  const existing = taskId ? state.tasks.find((t) => t.id === taskId) : null;
  const titleStr = window.prompt(existing ? "Edit task" : "New task — what is it?", existing?.title || "");
  if (titleStr === null) return;
  const title = titleStr.trim();
  if (!title) {
    if (existing) {
      // Empty title on edit = delete
      if (window.confirm(`Delete "${existing.title}"?`)) {
        state.tasks = state.tasks.filter((t) => t.id !== existing.id);
        saveTasks();
        render();
      }
    }
    return;
  }

  if (existing) {
    existing.title = title;
  } else {
    state.tasks.unshift({
      id: `t${Date.now().toString(36)}`,
      title,
      meta: "",
      color: COLOR_KEYS[state.tasks.length % COLOR_KEYS.length],
      due: "today",
      done: false
    });
  }
  saveTasks();
  if (state.activeView !== "tasks") setActiveView("tasks");
  else render();
}

/* ── Insights ────────────────────────────────────────────── */
function renderInsightsView() {
  elements.insightsView.innerHTML = "";
  if (state.activeView !== "insights") return;

  if (!state.habits.length) {
    elements.insightsView.appendChild(
      buildEmptyCard("Nothing to chart yet", "Add a habit and start logging — your patterns will show up here.")
    );
    return;
  }

  const stack = document.createElement("div");
  stack.className = "insights-stack";

  // ── KPI row
  const last30 = buildLastNDates(30);
  const last30Set = new Set(last30);
  const totalScheduled = state.habits.reduce((acc, h) => {
    return acc + last30.filter((d) => isHabitScheduledOnDate(h, parseLocalDate(d))).length;
  }, 0);
  const totalDone = state.entries.filter((e) => e.status === "done" && last30Set.has(e.date)).length;
  const rate = totalScheduled ? Math.round((totalDone / totalScheduled) * 100) : 0;

  // best streak across all habits (consecutive days "done" on scheduled days)
  let bestStreak = 0;
  let bestStreakHabit = "";
  let bestStreakUnit = "days";
  state.habits.forEach((habit) => {
    const streak = longestStreakForHabit(habit);
    if (streak > bestStreak) {
      bestStreak = streak;
      bestStreakHabit = habit.name;
      bestStreakUnit = isWeeklyHabit(habit) ? "weeks" : "days";
    }
  });

  const kpiRow = document.createElement("div");
  kpiRow.className = "kpi-row";
  kpiRow.innerHTML = `
    <div class="kpi kpi-hero">
      <div class="kpi-label">Best streak</div>
      <div class="kpi-num">${bestStreak} <em>${bestStreak === 1 ? bestStreakUnit.slice(0, -1) : bestStreakUnit}</em></div>
      <div class="kpi-sub">${bestStreakHabit ? `on ${escapeHtml(bestStreakHabit)}` : "log a habit to begin"}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Done</div>
      <div class="kpi-num">${totalDone}<span class="of">/${totalScheduled || 0}</span></div>
      <div class="kpi-sub">${rate}% rate</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Habits</div>
      <div class="kpi-num">${state.habits.length}</div>
      <div class="kpi-sub">tracked</div>
    </div>
  `;
  stack.appendChild(kpiRow);

  // ── weekday cadence chart
  const weekdayStats = computeWeekdayStats();
  const bestIdx = weekdayStats.reduce((best, w, i) => (w.pct > weekdayStats[best].pct ? i : best), 0);
  const weekdayChart = document.createElement("div");
  weekdayChart.className = "chart-card";
  weekdayChart.innerHTML = `
    <div class="chart-head">
      <div class="chart-title">Best days of the week</div>
      <div class="chart-meta">all habits</div>
    </div>
    <div class="weekday-bars">
      ${weekdayStats.map((w, i) => `
        <div class="weekday-col">
          <div class="weekday-bar ${i === bestIdx ? "is-best" : ""}" style="height:${Math.max(8, (w.pct / 100) * 80)}px">
            ${i === bestIdx ? `<span class="bar-pct">${w.pct}%</span>` : ""}
          </div>
          <div class="weekday-label ${i === bestIdx ? "is-best" : ""}">${w.short}</div>
        </div>
      `).join("")}
    </div>
  `;
  stack.appendChild(weekdayChart);

  // ── per-habit lines
  const byHabit = document.createElement("div");
  byHabit.className = "chart-card";
  const last12Weeks = buildLastNWeeks(12);
  const habitLines = state.habits.map((habit) => {
    const colorKey = colorForHabit(habit);
    const vals = last12Weeks.map((week) =>
      week.filter((d) => state.entries.some((e) => e.habitId === habit.id && e.date === d && e.status === "done")).length
    );
    const total = vals.reduce((a, b) => a + b, 0);
    const cells = vals.map((v) => {
      const opacity = 0.25 + (Math.min(v, 7) / 7) * 0.75;
      return `<div class="byhabit-cell" style="opacity:${opacity.toFixed(2)}"></div>`;
    }).join("");
    return `
      <div class="byhabit-row" style="--accent: var(--${colorKey}); --accent-deep: var(--${colorKey}-deep); --accent-tint: var(--${colorKey}-tint);">
        <div class="byhabit-name">${escapeHtml(habit.name)}</div>
        <div class="byhabit-cells" style="grid-template-columns: repeat(${vals.length}, 1fr)">${cells}</div>
        <div class="byhabit-total">${total}</div>
      </div>
    `;
  }).join("");
  byHabit.innerHTML = `
    <div class="chart-head">
      <div class="chart-title">By habit</div>
      <div class="chart-meta">last 12 weeks</div>
    </div>
    <div class="byhabit">${habitLines}</div>
  `;
  stack.appendChild(byHabit);

  // ── AI-style insight (generated locally, no API)
  const insight = buildInsightLine(weekdayStats, bestIdx);
  if (insight) {
    const ai = document.createElement("div");
    ai.className = "ai-insight";
    ai.innerHTML = `
      <div class="ai-insight-badge">AI</div>
      <p>${insight}</p>
    `;
    stack.appendChild(ai);
  }

  elements.insightsView.appendChild(stack);
}

function buildInsightLine(weekdayStats, bestIdx) {
  const filled = weekdayStats.filter((w) => w.scheduled > 0);
  if (filled.length < 2) return null;
  const best = weekdayStats[bestIdx];
  const worst = filled.reduce((acc, w) => (w.pct < acc.pct ? w : acc), filled[0]);
  if (best.short === worst.short) return null;
  return `${best.long}s are your best day — <strong>${best.pct}%</strong>. ${worst.long}s are your worst.`;
}

function computeWeekdayStats() {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const long = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const stats = days.map((d, i) => ({ short: d[0], long: long[i], scheduled: 0, done: 0, pct: 0 }));
  const last90 = buildLastNDates(90);
  state.habits.forEach((habit) => {
    last90.forEach((dateStr) => {
      const d = parseLocalDate(dateStr);
      if (!isHabitScheduledOnDate(habit, d)) return;
      const wd = d.getDay();
      stats[wd].scheduled += 1;
      const e = state.entries.find((row) => row.habitId === habit.id && row.date === dateStr);
      if (e?.status === "done") stats[wd].done += 1;
    });
  });
  stats.forEach((s) => {
    s.pct = s.scheduled ? Math.round((s.done / s.scheduled) * 100) : 0;
  });
  // reorder to Mon-first
  return [stats[1], stats[2], stats[3], stats[4], stats[5], stats[6], stats[0]];
}

function longestStreakForHabit(habit) {
  if (isWeeklyHabit(habit)) {
    return longestWeeklyStreakForHabit(habit, buildLastNDates(180));
  }

  if (isDailyHabit(habit)) {
    return longestDailyStreakForHabit(habit, buildLastNDates(180));
  }

  const dates = buildLastNDates(180).slice().reverse();
  let best = 0;
  let cur = 0;
  for (const d of dates) {
    const date = parseLocalDate(d);
    if (!isHabitScheduledOnDate(habit, date)) continue;
    const e = state.entries.find((row) => row.habitId === habit.id && row.date === d);
    if (e?.status === "done") {
      cur += 1;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

function longestStreakForHabitInMonth(habit, year, month) {
  const dates = buildMonthDates(year, month);

  if (isWeeklyHabit(habit)) {
    return longestWeeklyStreakForHabit(habit, dates);
  }

  if (isDailyHabit(habit)) {
    return longestDailyStreakForHabit(habit, dates);
  }

  let best = 0;
  let cur = 0;
  for (const d of dates) {
    const date = parseLocalDate(d);
    if (!isHabitScheduledOnDate(habit, date)) continue;
    const e = state.entries.find((row) => row.habitId === habit.id && row.date === d);
    if (e?.status === "done") {
      cur += 1;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

function longestDailyStreakForHabit(habit, dates) {
  let best = 0;
  let cur = 0;

  for (const d of dates.slice().reverse()) {
    const entry = state.entries.find((row) => row.habitId === habit.id && row.date === d);
    if (entry?.status === "done") {
      cur += 1;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }

  return best;
}

function longestWeeklyStreakForHabit(habit, dates) {
  const weekKeys = [...new Set(dates.map((date) => weekKeyForDate(date)))].sort();
  let best = 0;
  let cur = 0;

  for (const weekKey of weekKeys) {
    const weekDates = dates.filter((date) => weekKeyForDate(date) === weekKey);
    const completed = countWeeklyCompletions(habit, weekDates);
    const target = Math.max(habit.targetCount || 1, 1);

    if (completed >= target) {
      cur += 1;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }

  return best;
}

function countWeeklyCompletions(habit, weekDates) {
  return weekDates.filter((date) => {
    const parsed = parseLocalDate(date);
    if (habit.weeklyDays?.length && !habit.weeklyDays.includes(parsed.getDay())) {
      return false;
    }

    const entry = state.entries.find((row) => row.habitId === habit.id && row.date === date);
    return entry?.status === "done";
  }).length;
}

function weekKeyForDate(dateString) {
  const date = parseLocalDate(dateString);
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  return formatLocalDate(start);
}

function isDailyHabit(habit) {
  return !habit.weeklyDays?.length && habit.periodDays === 1;
}

function isWeeklyHabit(habit) {
  return Boolean(habit.weeklyDays?.length) || habit.periodDays === 7;
}

function setDetailMonthOffset(next) {
  const clamped = Math.max(-11, Math.min(0, next));
  if (clamped === state.detailMonthOffset) return;
  state.detailMonthOffset = clamped;
  renderHabitDetailView();
  // Center active month chip in the strip
  requestAnimationFrame(() => {
    const strip = elements.habitDetailView.querySelector(".month-strip");
    const active = strip?.querySelector(".month-chip.is-active");
    if (strip && active) {
      const target = active.offsetLeft - (strip.clientWidth / 2) + (active.clientWidth / 2);
      strip.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
    }
  });
}

function buildLastNDates(n) {
  const dates = [];
  const base = parseLocalDate(today);
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    dates.push(formatLocalDate(d));
  }
  return dates;
}

function buildLastNWeeks(n) {
  const all = buildLastNDates(n * 7);
  const weeks = [];
  for (let i = 0; i < n; i += 1) {
    weeks.push(all.slice(i * 7, (i + 1) * 7));
  }
  return weeks;
}

/* ── Habit Detail ────────────────────────────────────────── */
function renderHabitDetailView() {
  if (state.activeView !== "habitDetail") {
    elements.habitDetailView.innerHTML = "";
    return;
  }

  elements.habitDetailView.innerHTML = "";

  const habit = selectedHabit();
  if (!habit) {
    elements.habitDetailView.appendChild(
      buildEmptyCard("No habit selected", "Open a habit from Today to see its detail.")
    );
    return;
  }

  const colorKey = colorForHabit(habit);
  const illoKey = illoForHabit(habit);
  const habitEntries = entriesForHabit(habit.id);

  // Clamp offset so it doesn't go below -11 or above 0
  if (state.detailMonthOffset > 0) state.detailMonthOffset = 0;
  if (state.detailMonthOffset < -11) state.detailMonthOffset = -11;

  const months = buildLast12MonthsList();
  const activeInfo = getMonthInfo(state.detailMonthOffset);
  const monthDates = buildMonthDates(activeInfo.year, activeInfo.month);
  const monthEntries = habitEntries.filter((row) => monthDates.includes(row.date));
  const calendarDays = buildMonthCalendarDays(habit, activeInfo.year, activeInfo.month);
  const scheduledThisMonth = calendarDays.filter((d) => d.isScheduled).length;
  const doneThisMonth = monthEntries.filter((r) => r.status === "done").length;
  const skippedThisMonth = monthEntries.filter((r) => r.status === "skipped").length;
  const monthPct = scheduledThisMonth ? Math.round((doneThisMonth / scheduledThisMonth) * 100) : 0;
  const streak = activeInfo.isCurrent ? longestStreakForHabit(habit) : longestStreakForHabitInMonth(habit, activeInfo.year, activeInfo.month);

  const shell = document.createElement("section");
  shell.className = "detail-shell";
  applyAccent(shell, colorKey);
  shell.style.setProperty("color-scheme", "light");
  shell.innerHTML = `
    <div class="detail-topbar">
      <button class="back-button" data-back-to-view="${state.lastMainView}" type="button">‹ Back</button>
      <span class="detail-topbar-label">${activeInfo.longLabel}</span>
    </div>

    <div class="detail-hero">
      <div class="detail-hero-sun" aria-hidden="true"></div>
      <svg class="detail-hero-hills" viewBox="0 0 390 180" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 130 Q 80 80 180 110 T 390 90 L 390 180 L 0 180 Z" fill="var(--sage)"/>
        <path d="M0 150 Q 60 120 160 140 T 320 130 L 390 150 L 390 180 L 0 180 Z" fill="var(--sage-deep)"/>
        <path d="M0 168 L 390 168 L 390 180 L 0 180 Z" fill="var(--ink)" opacity="0.5"/>
      </svg>
      <div class="detail-hero-illo" data-illo-key="${illoKey}"></div>
      <div class="detail-hero-copy">
        <div class="detail-hero-cat">${escapeHtml(habit.category || "Habit")}</div>
        <div class="detail-hero-title">${posterTitleForHabit(habit)}</div>
      </div>
    </div>

    <p class="detail-rationale">${escapeHtml(cadenceExplanation(habit))}</p>

    <div class="detail-stat-row">
      <div>
        <div class="detail-stat-big-num">${monthPct}<span class="pct">%</span></div>
        <div class="detail-stat-big-label">${escapeHtml(activeInfo.monthOnly)} completion</div>
      </div>
      <div class="detail-stat-mini-row">
        <div class="detail-stat-mini">
          <div class="detail-stat-mini-label">Streak</div>
          <div class="detail-stat-mini-num">${streak}</div>
        </div>
        <div class="detail-stat-mini">
          <div class="detail-stat-mini-label">Done</div>
          <div class="detail-stat-mini-num">${doneThisMonth}<span class="of">/${scheduledThisMonth || 0}</span></div>
        </div>
      </div>
    </div>

    <div class="month-strip" role="tablist" aria-label="Browse months">
      ${months.map((m, i) => {
        const off = i - 11;
        const isActive = off === state.detailMonthOffset;
        return `<button class="month-chip ${isActive ? "is-active" : ""}" data-month-offset="${off}" type="button" role="tab" aria-selected="${isActive}">${escapeHtml(m.shortLabel)}</button>`;
      }).join("")}
    </div>

    <div class="calendar-wrap" data-swipe-month="true">
      <div class="calendar-head">
        <button class="month-nav-button" data-month-step="-1" type="button" aria-label="Previous month" ${state.detailMonthOffset <= -11 ? "disabled" : ""}>‹</button>
        <div class="calendar-title">${escapeHtml(activeInfo.longLabel)}</div>
        <button class="month-nav-button" data-month-step="1" type="button" aria-label="Next month" ${state.detailMonthOffset >= 0 ? "disabled" : ""}>›</button>
      </div>
      <div class="calendar-grid"></div>
      <div class="calendar-legend">
        <span><i class="legend-box legend-done"></i>Done</span>
        <span><i class="legend-box legend-skipped"></i>Skipped</span>
        <span><i class="legend-box legend-scheduled"></i>Scheduled</span>
      </div>
    </div>

    <div class="detail-actions">
      ${activeInfo.isCurrent ? `<button class="action-button done-button" data-action="done" data-habit-id="${habit.id}" type="button">Mark today done</button>
      <button class="action-button skip-button" data-action="skip" data-habit-id="${habit.id}" type="button">Skip</button>` : ""}
      <button class="action-button" data-edit-habit-id="${habit.id}" type="button">Edit</button>
      <button class="action-button delete-button" data-delete-habit-id="${habit.id}" type="button">Delete</button>
    </div>
  `;

  // padding for first-of-month
  const grid = shell.querySelector(".calendar-grid");
  if (calendarDays.length) {
    const firstWeekday = parseLocalDate(calendarDays[0].date).getDay();
    for (let i = 0; i < firstWeekday; i += 1) {
      const pad = document.createElement("div");
      pad.style.visibility = "hidden";
      grid.appendChild(pad);
    }
  }
  calendarDays.forEach((day) => {
    const cell = document.createElement(day.isLoggable ? "button" : "div");
    cell.className = `day-cell ${day.statusClass} ${day.isLoggable ? "is-loggable" : "is-future"} ${
      state.selectedLogDate === day.date && state.selectedLogHabitId === habit.id ? "is-selected" : ""
    }`;
    cell.title = `${day.date}: ${day.label}`;
    if (day.isLoggable) {
      cell.type = "button";
      cell.dataset.calendarDate = day.date;
      cell.dataset.calendarHabitId = habit.id;
      cell.setAttribute("aria-label", `Log ${habit.name} on ${formatFriendlyDate(parseLocalDate(day.date))}`);
    }
    cell.innerHTML = `<span class="day-number">${day.dayOfMonth.replace(/^0/, "")}</span>`;
    grid.appendChild(cell);
  });

  elements.habitDetailView.appendChild(shell);

  // Inject hero illustration via createElement so the path-rewrite shim runs.
  const heroIllo = shell.querySelector(".detail-hero-illo");
  if (heroIllo) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = `/illustrations/${heroIllo.dataset.illoKey}.svg`;
    heroIllo.appendChild(img);
  }

  // Center active month chip in strip
  const strip = shell.querySelector(".month-strip");
  const active = strip?.querySelector(".month-chip.is-active");
  if (strip && active) {
    requestAnimationFrame(() => {
      const target = active.offsetLeft - (strip.clientWidth / 2) + (active.clientWidth / 2);
      strip.scrollLeft = Math.max(0, target);
    });
  }

  // Swipe the calendar to change month
  const swipeArea = shell.querySelector('[data-swipe-month="true"]');
  if (swipeArea) attachMonthSwipe(swipeArea);
}

function attachMonthSwipe(node) {
  let startX = 0;
  let startY = 0;
  let tracking = false;
  node.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    tracking = true;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  node.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    if (dx < 0) setDetailMonthOffset(state.detailMonthOffset + 1);
    else setDetailMonthOffset(state.detailMonthOffset - 1);
  }, { passive: true });
}

function renderComposer() {
  elements.composerModal.hidden = !state.isComposerOpen;
  document.body.classList.toggle("is-sheet-open", state.isComposerOpen || state.isLogSheetOpen);
  const isEditing = state.composerMode === "edit";
  elements.composerTitle.innerHTML = isEditing ? 'Edit <em>habit.</em>' : 'A new <em>habit.</em>';
  elements.habitTitleField.hidden = !isEditing;
  elements.habitInput.disabled = !state.isOnline;
  elements.habitTitleInput.disabled = !isEditing;
  elements.habitSubmitButton.disabled = !state.isOnline;
  elements.habitSubmitButton.textContent = isEditing ? "Save changes" : "Save habit ✦";

  if (state.isComposerOpen && !state.isOnline) {
    setComposerFeedback(
      isEditing
        ? "Offline mode: editing target and cadence needs a connection."
        : "Offline mode: AI habit creation needs a connection."
    );
  } else if (state.isComposerOpen && !elements.habitInput.value.trim()) {
    setComposerFeedback("");
  }
}

function buildTodayCard(habit, entry) {
  const fragment = elements.todayCardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".today-card");
  const colorKey = colorForHabit(habit);
  const illoKey = illoForHabit(habit);
  const isDueToday = isHabitScheduledOnDate(habit, parseLocalDate(today));
  const progress = calculateHabitProgress(habit);

  applyAccent(card, colorKey);
  card.dataset.state = entry ? entry.status : isDueToday ? "scheduled" : "idle";
  card.dataset.openHabitId = habit.id;

  fragment.querySelector(".tile-illo").src = `/illustrations/${illoKey}.svg`;
  fragment.querySelector(".today-card-cat").textContent = habit.category || "Habit";
  fragment.querySelector(".today-card-title").textContent = habit.name;
  fragment.querySelector(".today-card-meta").textContent = compactCadence(habit);

  const pip = fragment.querySelector(".today-card-pip");
  if (entry?.status === "done") {
    pip.textContent = "✓";
  } else if (entry?.status === "skipped") {
    pip.textContent = "✕";
  } else {
    pip.innerHTML = `<span class="frac">${progress.completed}/${progress.target}</span>`;
  }

  return fragment;
}

function compactCadence(habit) {
  const days = habit.weeklyDays?.length
    ? habit.weeklyDays.map(shortDayName).join(" · ")
    : `every ${habit.periodDays} day${habit.periodDays === 1 ? "" : "s"}`;
  const target = `${habit.targetCount} ${habit.unit}`;
  return `${target} · ${days}`;
}

function initializeSwipeCards() {
  elements.todayView.querySelectorAll(".today-card").forEach((card) => {
    if (card.dataset.swipeBound === "true") {
      return;
    }

    card.dataset.swipeBound = "true";
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let lastX = 0;
    let lastTime = 0;
    let dragging = false;
    let gestureLocked = "";
    let thresholdHit = "";

    card.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      currentX = 0;
      lastX = event.clientX;
      lastTime = event.timeStamp;
      dragging = false;
      gestureLocked = "";
      thresholdHit = "";
    });

    card.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointerId) {
        return;
      }

      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (!gestureLocked) {
        if (absX > 10 && absX > absY * 1.15) {
          gestureLocked = "horizontal";
          dragging = true;
          card.setPointerCapture(pointerId);
          card.classList.add("is-swipe-active");
        } else if (absY > 10 && absY > absX) {
          gestureLocked = "vertical";
          return;
        } else {
          return;
        }
      }

      if (gestureLocked !== "horizontal" || !dragging) {
        return;
      }

      currentX = applySwipeResistance(deltaX);
      lastX = event.clientX;
      lastTime = event.timeStamp;
      const progress = Math.min(1, Math.abs(currentX) / SWIPE_TRIGGER);
      const nextThreshold = currentX >= SWIPE_TRIGGER ? "done" : currentX <= -SWIPE_TRIGGER ? "skip" : "";

      card.style.setProperty("--swipe-x", `${currentX}px`);
      card.style.setProperty("--swipe-progress", String(progress));
      card.dataset.swipePreview = nextThreshold || (currentX > 0 ? "done-soft" : currentX < 0 ? "skip-soft" : "");

      if (nextThreshold && nextThreshold !== thresholdHit) {
        thresholdHit = nextThreshold;
        triggerHapticClick();
      }

      if (!nextThreshold) {
        thresholdHit = "";
      }
    });

    card.addEventListener("pointerup", async (event) => {
      if (event.pointerId !== pointerId) {
        return;
      }

      if (gestureLocked === "horizontal" && card.hasPointerCapture(pointerId)) {
        card.releasePointerCapture(pointerId);
      }
      pointerId = null;

      const finalX = currentX;
      const action = finalX >= SWIPE_TRIGGER ? "done" : finalX <= -SWIPE_TRIGGER ? "skip" : "";
      const habitId = card.dataset.openHabitId;
      const elapsed = Math.max(1, event.timeStamp - lastTime);
      const velocityX = (event.clientX - lastX) / elapsed;
      const shouldPeek =
        !action &&
        dragging &&
        Math.abs(finalX) >= 18 &&
        Math.abs(finalX) < SWIPE_TRIGGER &&
        Math.abs(velocityX) > 0.45;

      if (dragging) {
        card.dataset.suppressOpen = "true";
        window.setTimeout(() => {
          delete card.dataset.suppressOpen;
        }, 260);
      }

      if (action && habitId) {
        card.classList.add("is-committing");
        card.style.setProperty("--swipe-x", `${finalX >= 0 ? SWIPE_MAX : -SWIPE_MAX}px`);
        await animateCommittedCard(card, action);
        await saveEntry(habitId, action === "done" ? "done" : "skipped", { skipRefresh: true });
        await refreshState();
      } else if (shouldPeek) {
        await animatePeekHint(card, finalX > 0 ? "done" : "skip");
        resetSwipeCard(card);
      } else {
        resetSwipeCard(card);
      }

      dragging = false;
      currentX = 0;
      gestureLocked = "";
      thresholdHit = "";
    });

    card.addEventListener("pointercancel", () => {
      pointerId = null;
      dragging = false;
      currentX = 0;
      gestureLocked = "";
      thresholdHit = "";
      resetSwipeCard(card);
    });
  });
}

function applySwipeResistance(delta) {
  const limited = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, delta));
  if (Math.abs(limited) <= SWIPE_TRIGGER) {
    return limited * 0.92;
  }

  const extra = Math.abs(limited) - SWIPE_TRIGGER;
  const resisted = SWIPE_TRIGGER + extra * 0.35;
  return limited < 0 ? -resisted : resisted;
}

function resetSwipeCard(card) {
  card.classList.remove("is-swipe-active", "is-committing");
  card.dataset.swipePreview = "";
  card.style.removeProperty("--swipe-x");
  card.style.removeProperty("--swipe-progress");
}

function triggerHapticClick() {
  if (navigator.vibrate) {
    navigator.vibrate(12);
  }
}

async function animateCommittedCard(card, action) {
  const content = card.querySelector(".today-card-content");
  if (content && typeof content.animate === "function") {
    content.animate(
      [
        { transform: `translate3d(${getComputedStyle(card).getPropertyValue("--swipe-x") || "0px"}, 0, 0) scale(1)`, opacity: 1 },
        { transform: `translate3d(${action === "done" ? "160px" : "-160px"}, 0, 0) scale(0.96)`, opacity: 0 }
      ],
      { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" }
    );
  }
  await new Promise((resolve) => window.setTimeout(resolve, 230));
}

async function animatePeekHint(card, direction) {
  const peekX = direction === "done" ? 42 : -42;
  card.dataset.swipePreview = direction;
  card.style.setProperty("--swipe-progress", "0.72");
  card.classList.remove("is-swipe-active");

  const content = card.querySelector(".today-card-content");
  if (content && typeof content.animate === "function") {
    content.animate(
      [
        { transform: `translate3d(${card.style.getPropertyValue("--swipe-x") || "0px"}, 0, 0)` },
        { transform: `translate3d(${peekX}px, 0, 0)` },
        { transform: "translate3d(0, 0, 0)" }
      ],
      { duration: 320, easing: "cubic-bezier(0.2, 0.9, 0.25, 1.15)" }
    );
  }

  card.style.setProperty("--swipe-x", `${peekX}px`);
  await new Promise((resolve) => window.setTimeout(resolve, 110));
  card.style.setProperty("--swipe-x", "0px");
  await new Promise((resolve) => window.setTimeout(resolve, 220));
}

function calculateHabitProgress(habit) {
  const window = progressWindowForHabit(habit);
  const habitEntries = entriesForHabit(habit.id);
  const completed = habitEntries.filter(
    (entry) => entry.status === "done" && window.dates.includes(entry.date)
  ).length;
  const target = targetOccurrencesForWindow(habit, window);
  const normalizedTarget = Math.max(target, 1);
  const percent = Math.min(100, Math.round((completed / normalizedTarget) * 100));

  return {
    summaryLabel: window.summaryLabel,
    trackLabel: window.trackLabel,
    completed,
    target: normalizedTarget,
    percent
  };
}

function progressWindowForHabit(habit) {
  if (habit.weeklyDays?.length) {
    return { kind: "weekly", dates: buildCurrentWeekDates(), summaryLabel: "This week", trackLabel: "Weekly" };
  }

  if (habit.periodDays === 1) {
    return { kind: "daily", dates: [today], summaryLabel: "Today", trackLabel: "Daily" };
  }

  if (habit.periodDays <= 7) {
    return { kind: "weekly", dates: buildCurrentWeekDates(), summaryLabel: "This week", trackLabel: "Weekly" };
  }

  return { kind: "monthly", dates: buildCurrentMonthDates(), summaryLabel: "This month", trackLabel: "Monthly" };
}

function targetOccurrencesForWindow(habit, window) {
  if (habit.unit === "times") {
    return habit.targetCount;
  }

  if (habit.weeklyDays?.length) {
    return window.dates.filter((date) => isHabitScheduledOnDate(habit, parseLocalDate(date))).length;
  }

  if (window.kind === "daily") {
    return 1;
  }

  return 1;
}

function buildEmptyCard(title, copy) {
  const card = document.createElement("section");
  card.className = "empty-card";
  card.innerHTML = `
    <div class="panel-title">Nothing here yet</div>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(copy)}</p>
  `;
  return card;
}

function openComposer() {
  state.composerMode = "create";
  state.editingHabitId = null;
  state.isComposerOpen = true;
  elements.habitTitleInput.value = "";
  elements.habitInput.value = "";
  elements.composerSheet.style.removeProperty("--sheet-drag-y");
  renderComposer();
  elements.habitInput.focus();
}

function closeComposer() {
  state.isComposerOpen = false;
  state.composerMode = "create";
  state.editingHabitId = null;
  elements.habitTitleInput.value = "";
  elements.habitInput.value = "";
  elements.composerSheet.style.removeProperty("--sheet-drag-y");
  renderComposer();
}

function openLogSheet(habitId, date) {
  state.selectedLogHabitId = habitId;
  state.selectedLogDate = date;
  state.isLogSheetOpen = true;
  elements.logSheet.style.removeProperty("--sheet-drag-y");
  render();
}

function closeLogSheet() {
  state.isLogSheetOpen = false;
  state.selectedLogDate = "";
  state.selectedLogHabitId = null;
  elements.logSheet.style.removeProperty("--sheet-drag-y");
  render();
}

function openEditComposer(habitId) {
  const habit = state.habits.find((item) => item.id === habitId);
  if (!habit) {
    return;
  }

  state.composerMode = "edit";
  state.editingHabitId = habitId;
  state.isComposerOpen = true;
  elements.habitTitleInput.value = habit.name || "";
  elements.habitInput.value = habit.originalPrompt || habit.name || "";
  elements.composerSheet.style.removeProperty("--sheet-drag-y");
  renderComposer();
  elements.habitTitleInput.focus();
}

function initializeLogSheetDismiss() {
  initializeSheetDismiss(elements.logSheet, closeLogSheet);
}

function initializeComposerSheetDismiss() {
  initializeSheetDismiss(elements.composerSheet, closeComposer, "textarea, input, button");
}

function initializeSheetDismiss(sheet, onDismiss, interactiveSelector = "button") {
  let pointerId = null;
  let startY = 0;
  let dragY = 0;
  let dragging = false;

  sheet.addEventListener("pointerdown", (event) => {
    const onInteractive = event.target.closest(interactiveSelector);
    if (onInteractive) {
      return;
    }

    pointerId = event.pointerId;
    startY = event.clientY;
    dragY = 0;
    dragging = false;
  });

  sheet.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }

    const deltaY = event.clientY - startY;
    if (deltaY <= 0) {
      return;
    }

    dragging = true;
    dragY = deltaY * 0.95;
    sheet.style.setProperty("--sheet-drag-y", `${dragY}px`);
  });

  sheet.addEventListener("pointerup", (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }

    pointerId = null;
    if (dragging && dragY > 96) {
      onDismiss();
    } else {
      sheet.style.removeProperty("--sheet-drag-y");
    }

    dragging = false;
    dragY = 0;
  });

  sheet.addEventListener("pointercancel", () => {
    pointerId = null;
    dragging = false;
    dragY = 0;
    sheet.style.removeProperty("--sheet-drag-y");
  });
}

function setActiveView(nextView) {
  const previousView = state.activeView;
  if (previousView === nextView) {
    render();
    return;
  }

  const outgoing = getViewElement(previousView);
  if (nextView !== "habitDetail") {
    state.lastMainView = nextView;
  } else if (previousView !== "habitDetail") {
    state.detailMonthOffset = 0;
  }

  if (outgoing && typeof outgoing.animate === "function") {
    outgoing.getAnimations().forEach((animation) => animation.cancel());
    outgoing.animate(
      [
        { opacity: 1, transform: "translate3d(0, 0, 0)" },
        { opacity: 0, transform: "translate3d(-22px, 0, 0)" }
      ],
      { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    );
  }

  window.setTimeout(() => {
    state.activeView = nextView;
    render();
    animateViewTransition(previousView, nextView);
  }, 120);
}

function animateViewTransition(previousView, nextView) {
  const target = getViewElement(nextView);

  if (!target || typeof target.animate !== "function") {
    return;
  }

  target.getAnimations().forEach((animation) => animation.cancel());
  target.style.opacity = "1";
  target.style.transform = "translate3d(0, 0, 0)";

  const openingDetail = nextView === "habitDetail" && previousView !== "habitDetail";
  const closingDetail = previousView === "habitDetail" && nextView !== "habitDetail";
  const offset = openingDetail ? 28 : closingDetail ? 18 : 14;

  target.animate(
    [
      { opacity: 0, transform: `translate3d(${offset}px, 0, 0)` },
      { opacity: 1, transform: "translate3d(0, 0, 0)" }
    ],
    {
      duration: openingDetail || closingDetail ? 300 : 220,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)"
    }
  );
}

function getViewElement(viewName) {
  if (viewName === "habitDetail") return elements.habitDetailView;
  if (viewName === "insights")    return elements.insightsView;
  if (viewName === "calendar")    return elements.calendarView;
  if (viewName === "tasks")       return elements.tasksView;
  return elements.todayView;
}

function selectedHabit() {
  return state.habits.find((habit) => habit.id === state.selectedHabitId) || null;
}

function entryForHabitAndDate(habitId, date) {
  return state.entries.find((entry) => entry.habitId === habitId && entry.date === date) || null;
}

function cadenceExplanation(habit) {
  if (habit.weeklyDays?.length) {
    return `Tracking on ${habit.weeklyDays.map(shortDayName).join(", ")} · target ${habit.targetCount} ${habit.unit}.`;
  }

  return `Tracking ${habit.targetCount} ${habit.unit} every ${habit.periodDays} day${habit.periodDays === 1 ? "" : "s"}.`;
}

function renderLogSheet() {
  elements.logSheetModal.hidden = !state.isLogSheetOpen;
  document.body.classList.toggle("is-sheet-open", state.isComposerOpen || state.isLogSheetOpen);

  if (!state.isLogSheetOpen || !state.selectedLogHabitId || !state.selectedLogDate) {
    return;
  }

  const habit = state.habits.find((item) => item.id === state.selectedLogHabitId);
  const entry = entryForHabitAndDate(state.selectedLogHabitId, state.selectedLogDate);
  const friendlyDate = formatFriendlyDate(parseLocalDate(state.selectedLogDate));

  elements.logSheetTitle.textContent = habit ? habit.name : "Log day";
  elements.logSheetSubtitle.textContent = `${friendlyDate} · ${entry ? capitalize(entry.status) : "Not logged"}`;
  elements.logSheetClear.hidden = !entry;
}

function entriesForHabit(habitId) {
  return state.entries.filter((entry) => entry.habitId === habitId);
}

function buildCurrentMonthCalendarDays(habit) {
  const base = parseLocalDate(today);
  return buildMonthCalendarDays(habit, base.getFullYear(), base.getMonth());
}

function buildMonthCalendarDays(habit, year, month) {
  const entryMap = new Map(entriesForHabit(habit.id).map((entry) => [entry.date, entry.status]));

  return buildMonthDates(year, month).map((date) => {
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
      isScheduled,
      isLoggable: date <= today
    };
  });
}

function buildCurrentMonthDates() {
  const base = parseLocalDate(today);
  return buildMonthDates(base.getFullYear(), base.getMonth());
}

function buildMonthDates(year, month) {
  const days = [];
  const lastDay = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= lastDay; day += 1) {
    const next = new Date(year, month, day);
    days.push(formatLocalDate(next));
  }
  return days;
}

function buildCurrentWeekDates() {
  const dates = [];
  const base = parseLocalDate(today);
  const dayOfWeek = base.getDay();
  const start = new Date(base);
  start.setDate(base.getDate() - dayOfWeek);

  for (let index = 0; index < 7; index += 1) {
    const next = new Date(start);
    next.setDate(start.getDate() + index);
    dates.push(formatLocalDate(next));
  }

  return dates;
}

function getCurrentMonthLabel() {
  return parseLocalDate(today).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function getMonthInfo(offset) {
  const base = parseLocalDate(today);
  const date = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    longLabel: date.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    shortLabel: date.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
    monthOnly: date.toLocaleDateString(undefined, { month: "long" }),
    isCurrent: offset === 0
  };
}

function buildLast12MonthsList() {
  const list = [];
  for (let i = 11; i >= 0; i -= 1) list.push(getMonthInfo(-i));
  return list;
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

function formatFriendlyDate(date) {
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function capitalize(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

function isHabitScheduledOnDate(habit, date) {
  if (habit.weeklyDays?.length) {
    return habit.weeklyDays.includes(date.getDay());
  }

  const createdDate = parseLocalDate(habit.createdAt.slice(0, 10));
  const diffDays = Math.floor((date - createdDate) / 86400000);
  return diffDays >= 0 && diffDays % habit.periodDays === 0;
}

function setComposerFeedback(message) {
  elements.composerFeedback.textContent = message;
  elements.composerFeedback.hidden = !message;
}

async function saveSelectedLogDate(status) {
  if (!state.selectedLogHabitId || !state.selectedLogDate) {
    return;
  }

  const selectedDate = state.selectedLogDate;
  await saveEntry(state.selectedLogHabitId, status, { date: selectedDate, skipRefresh: false });
  closeLogSheet();
}

async function clearSelectedLogDate() {
  if (!state.selectedLogHabitId || !state.selectedLogDate) {
    return;
  }

  const selectedDate = state.selectedLogDate;

  try {
    await deleteEntry(state.selectedLogHabitId, selectedDate);
    await refreshState();
  } catch (error) {
    console.error(error);
  }

  closeLogSheet();
}

function updateNetworkStatus() {
  document.body.classList.toggle("is-offline", !state.isOnline);
}

async function requestPersistentStorage() {
  if (!navigator.storage || typeof navigator.storage.persist !== "function") {
    return;
  }

  try {
    await navigator.storage.persist();
  } catch (error) {
    console.error(error);
  }
}

async function hydrateLocalStore() {
  try {
    const result = await hydrateFromServer(fetchJson);

    if (result.imported) {
      setComposerFeedback(
        `Imported ${result.counts.habits} habits and ${result.counts.entries} entries.`
      );
      await refreshState();
    }
  } catch (error) {
    console.error(error);
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch (error) {
    console.error(error);
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
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
