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
  selectedHabitId: null,
  activeView: "today",
  lastMainView: "today",
  isComposerOpen: false,
  composerMode: "create",
  editingHabitId: null,
  isLogSheetOpen: false,
  selectedLogDate: "",
  selectedLogHabitId: null,
  isOnline: navigator.onLine,
  storageReady: false
};

const SWIPE_TRIGGER = 76;
const SWIPE_MAX = 132;

const elements = {
  headerKicker: document.querySelector("#header-kicker"),
  headerTitle: document.querySelector("#header-title"),
  headerSubtitle: document.querySelector("#header-subtitle"),
  todayView: document.querySelector("#today-view"),
  insightsView: document.querySelector("#insights-view"),
  habitDetailView: document.querySelector("#habit-detail-view"),
  navItems: [...document.querySelectorAll("[data-nav-view]")],
  floatingAddButton: document.querySelector("#floating-add-button"),
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
  todayCardTemplate: document.querySelector("#today-card-template"),
  habitRowTemplate: document.querySelector("#habit-row-template")
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
  elements.floatingAddButton.addEventListener("click", () => openComposer());
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

    setComposerFeedback(isEditing ? "Updating cadence and saving your changes..." : "Inferring cadence and saving to this device...");

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
        setComposerFeedback(`${updatedHabit.name} updated on this device. ${inference.rationale}`);
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
        setComposerFeedback(`${inference.name} saved to this phone. ${inference.rationale}`);
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
  elements.habitDetailView.addEventListener("click", handleViewActions);
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
    const dateCopy = entryDate === today ? "for today" : `for ${formatFriendlyDate(parseLocalDate(entryDate))}`;
    setComposerFeedback(`Saved ${status} ${dateCopy} on this device.`);
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
    setComposerFeedback(`Deleted ${habit.name}.`);
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
  renderTodayView();
  renderInsightsView();
  renderHabitDetailView();
  renderComposer();
  renderLogSheet();
}

function renderChrome() {
  const headerMap = {
    today: {
      kicker: formatFriendlyDate(parseLocalDate(today)),
      title: greetingForHour(new Date().getHours()),
      subtitle: ""
    },
    insights: {
      kicker: "Insights",
      title: "Your rhythm",
      subtitle: "A quick read on momentum, consistency, and what still needs attention."
    },
    habitDetail: {
      kicker: "Habit Detail",
      title: selectedHabit()?.name || "Habit detail",
      subtitle: ""
    }
  };

  const chrome = headerMap[state.activeView] || headerMap.today;
  elements.headerKicker.textContent = chrome.kicker;
  elements.headerTitle.textContent = chrome.title;
  elements.headerSubtitle.textContent = chrome.subtitle;
  elements.headerSubtitle.hidden = !chrome.subtitle;

  const visibleView = state.activeView === "habitDetail" ? "habitDetail" : state.activeView;
  const activeNavView = state.activeView === "habitDetail" ? state.lastMainView : state.activeView;
  elements.todayView.hidden = visibleView !== "today";
  elements.insightsView.hidden = visibleView !== "insights";
  elements.habitDetailView.hidden = visibleView !== "habitDetail";

  elements.navItems.forEach((item) => {
    item.classList.toggle("is-active", item.dataset.navView === activeNavView);
  });
}

function renderTodayView() {
  elements.todayView.innerHTML = "";

  if (!state.habits.length) {
    elements.todayView.appendChild(buildEmptyCard("No habits yet", "Add your first habit to get a calm daily dashboard."));
    return;
  }

  const list = document.createElement("section");
  list.className = "today-stack";
  state.habits.forEach((habit) => {
    const entry = entryForHabitAndDate(habit.id, today);
    list.appendChild(buildTodayCard(habit, entry));
  });
  elements.todayView.appendChild(list);
  initializeSwipeCards();
}

function renderInsightsView() {
  elements.insightsView.innerHTML = "";
}

function renderHabitDetailView() {
  if (state.activeView !== "habitDetail") {
    elements.habitDetailView.innerHTML = "";
    return;
  }

  elements.habitDetailView.innerHTML = "";

  const habit = selectedHabit();
  if (!habit) {
    elements.habitDetailView.appendChild(
      buildEmptyCard("No habit selected", "Open a habit from the library or Today view to see its detail.")
    );
    return;
  }

  const entry = entryForHabitAndDate(habit.id, today);
  const habitEntries = entriesForHabit(habit.id);
  const monthDates = buildCurrentMonthDates();
  const monthEntries = habitEntries.filter((row) => monthDates.includes(row.date));
  const calendarDays = buildCurrentMonthCalendarDays(habit);

  const shell = document.createElement("section");
  shell.className = "detail-shell";
  shell.innerHTML = `
    <div class="detail-topbar">
      <button class="back-button" data-back-to-view="${state.lastMainView}" type="button" aria-label="Go back">← Back</button>
      <span class="detail-topbar-label">${getCurrentMonthLabel()}</span>
    </div>
    <article class="detail-card">
      <p class="detail-rationale">${cadenceExplanation(habit)}</p>
      <div class="detail-stats">
        <article class="detail-stat">
          <span>Scheduled this month</span>
          <strong>${calendarDays.filter((day) => day.isScheduled).length}</strong>
        </article>
        <article class="detail-stat">
          <span>Done this month</span>
          <strong>${monthEntries.filter((row) => row.status === "done").length}</strong>
        </article>
        <article class="detail-stat">
          <span>Skipped this month</span>
          <strong>${monthEntries.filter((row) => row.status === "skipped").length}</strong>
        </article>
      </div>
      <div class="today-card-actions detail-actions">
        <button class="action-button done-button" data-action="done" data-habit-id="${habit.id}" type="button">Done</button>
        <button class="action-button skip-button" data-action="skip" data-habit-id="${habit.id}" type="button">Skip</button>
        <button class="action-button edit-button" data-edit-habit-id="${habit.id}" type="button">Edit habit</button>
        <button class="action-button delete-button" data-delete-habit-id="${habit.id}" type="button">Delete habit</button>
      </div>
      <div class="calendar-wrap">
        <div class="calendar-legend">
          <span><i class="legend-box legend-none"></i> Not logged</span>
          <span><i class="legend-box legend-done"></i> Done</span>
          <span><i class="legend-box legend-skipped"></i> Skipped</span>
          <span><i class="legend-box legend-scheduled"></i> Scheduled</span>
        </div>
        <div class="calendar-grid"></div>
      </div>
    </article>
  `;

  const calendarGrid = shell.querySelector(".calendar-grid");
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
    cell.innerHTML = `
      <span>${day.weekday}</span>
      <span class="day-number">${day.dayOfMonth}</span>
      <span class="day-state">${day.shortLabel}</span>
    `;
    calendarGrid.appendChild(cell);
  });

  elements.habitDetailView.appendChild(shell);
}

function renderComposer() {
  elements.composerModal.hidden = !state.isComposerOpen;
  document.body.classList.toggle("is-sheet-open", state.isComposerOpen || state.isLogSheetOpen);
  const isEditing = state.composerMode === "edit";
  elements.composerTitle.textContent = isEditing ? "Edit Habit" : "Create Habit";
  elements.habitTitleField.hidden = !isEditing;
  elements.habitInput.disabled = !state.isOnline;
  elements.habitTitleInput.disabled = !isEditing;
  elements.habitSubmitButton.disabled = !state.isOnline;
  elements.habitSubmitButton.textContent = isEditing ? "Save habit changes" : "Infer and create habit";

  if (state.isComposerOpen && !state.isOnline) {
    setComposerFeedback(
      isEditing
        ? "Offline mode: you can still track habits, but editing target and cadence needs a connection."
        : "Offline mode: you can check off saved habits, but AI habit creation needs a connection."
    );
  } else if (state.isComposerOpen && !elements.habitInput.value.trim()) {
    setComposerFeedback("");
  }
}

function buildTodayCard(habit, entry) {
  const fragment = elements.todayCardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".today-card");
  const progress = calculateHabitProgress(habit);
  const isDueToday = isHabitScheduledOnDate(habit, parseLocalDate(today));

  card.dataset.state = entry ? entry.status : isDueToday ? "scheduled" : "idle";
  card.dataset.openHabitId = habit.id;
  card.querySelector(".today-card-title").textContent = habit.name;
  card.querySelector(".today-card-meta").textContent = formatHabitMeta(habit);
  card.querySelector(".progress-window-label").textContent = progress.summaryLabel;
  card.querySelector(".progress-window-value").textContent = `${progress.completed}/${progress.target}`;
  card.querySelector(".progress-track-window-label").textContent = progress.trackLabel;
  card.querySelector(".progress-track-window-meta").textContent = `${progress.percent}% complete`;
  card.querySelector(".progress-window-fill").style.width = `${progress.percent}%`;

  fragment.querySelectorAll("[data-action]").forEach((button) => {
    button.dataset.habitId = habit.id;
  });

  return fragment;
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
        {
          transform: `translate3d(${getComputedStyle(card).getPropertyValue("--swipe-x") || "0px"}, 0, 0) scale(1)`,
          opacity: 1
        },
        {
          transform: `translate3d(${action === "done" ? "160px" : "-160px"}, 0, 0) scale(0.96)`,
          opacity: 0
        }
      ],
      {
        duration: 220,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards"
      }
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
      {
        duration: 320,
        easing: "cubic-bezier(0.2, 0.9, 0.25, 1.15)"
      }
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
  if (habit.weeklyDays.length) {
    return {
      kind: "weekly",
      dates: buildCurrentWeekDates(),
      summaryLabel: "This week",
      trackLabel: "Weekly progress"
    };
  }

  if (habit.periodDays === 1) {
    return {
      kind: "daily",
      dates: [today],
      summaryLabel: "Today",
      trackLabel: "Daily progress"
    };
  }

  if (habit.periodDays <= 7) {
    return {
      kind: "weekly",
      dates: buildCurrentWeekDates(),
      summaryLabel: "This week",
      trackLabel: "Weekly progress"
    };
  }

  return {
    kind: "monthly",
    dates: buildCurrentMonthDates(),
    summaryLabel: "This month",
    trackLabel: "Monthly progress"
  };
}

function targetOccurrencesForWindow(habit, window) {
  if (habit.unit === "times") {
    return habit.targetCount;
  }

  if (habit.weeklyDays.length) {
    return window.dates.filter((date) => isHabitScheduledOnDate(habit, parseLocalDate(date))).length;
  }

  if (window.kind === "daily") {
    return 1;
  }

  return 1;
}

function buildHabitRow(habit) {
  const fragment = elements.habitRowTemplate.content.cloneNode(true);
  const button = fragment.querySelector(".habit-row-button");
  const todayEntry = entryForHabitAndDate(habit.id, today);

  button.dataset.openHabitId = habit.id;
  fragment.querySelector(".habit-row-title").textContent = habit.name;
  fragment.querySelector(".habit-row-meta").textContent = formatHabitMeta(habit);
  fragment.querySelector(".habit-row-status").textContent = todayEntry
    ? capitalize(todayEntry.status)
    : isHabitScheduledOnDate(habit, parseLocalDate(today))
      ? "Scheduled"
      : "Not due";

  return fragment;
}

function buildEmptyCard(title, copy) {
  const card = document.createElement("section");
  card.className = "empty-card";
  card.innerHTML = `
    <div class="panel-title">Nothing here yet</div>
    <h2>${title}</h2>
    <p>${copy}</p>
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
  let pointerId = null;
  let startY = 0;
  let dragY = 0;
  let dragging = false;

  elements.logSheet.addEventListener("pointerdown", (event) => {
    const onInteractive = event.target.closest("button");
    if (onInteractive) {
      return;
    }

    pointerId = event.pointerId;
    startY = event.clientY;
    dragY = 0;
    dragging = false;
  });

  elements.logSheet.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }

    const deltaY = event.clientY - startY;
    if (deltaY <= 0) {
      return;
    }

    dragging = true;
    dragY = deltaY * 0.95;
    elements.logSheet.style.setProperty("--sheet-drag-y", `${dragY}px`);
  });

  elements.logSheet.addEventListener("pointerup", (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }

    pointerId = null;
    if (dragging && dragY > 96) {
      closeLogSheet();
    } else {
      elements.logSheet.style.removeProperty("--sheet-drag-y");
    }

    dragging = false;
    dragY = 0;
  });

  elements.logSheet.addEventListener("pointercancel", () => {
    pointerId = null;
    dragging = false;
    dragY = 0;
    elements.logSheet.style.removeProperty("--sheet-drag-y");
  });
}

function initializeComposerSheetDismiss() {
  let pointerId = null;
  let startY = 0;
  let dragY = 0;
  let dragging = false;

  elements.composerSheet.addEventListener("pointerdown", (event) => {
    const onInteractive = event.target.closest("textarea, button");
    if (onInteractive) {
      return;
    }

    pointerId = event.pointerId;
    startY = event.clientY;
    dragY = 0;
    dragging = false;
  });

  elements.composerSheet.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }

    const deltaY = event.clientY - startY;
    if (deltaY <= 0) {
      return;
    }

    dragging = true;
    dragY = deltaY * 0.95;
    elements.composerSheet.style.setProperty("--sheet-drag-y", `${dragY}px`);
  });

  elements.composerSheet.addEventListener("pointerup", (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }

    pointerId = null;
    if (dragging && dragY > 96) {
      closeComposer();
    } else {
      elements.composerSheet.style.removeProperty("--sheet-drag-y");
    }

    dragging = false;
    dragY = 0;
  });

  elements.composerSheet.addEventListener("pointercancel", () => {
    pointerId = null;
    dragging = false;
    dragY = 0;
    elements.composerSheet.style.removeProperty("--sheet-drag-y");
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
  }

  if (outgoing && typeof outgoing.animate === "function") {
    outgoing.getAnimations().forEach((animation) => animation.cancel());
    outgoing.animate(
      [
        { opacity: 1, transform: "translate3d(0, 0, 0)" },
        { opacity: 0, transform: "translate3d(-22px, 0, 0)" }
      ],
      {
        duration: 220,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)"
      }
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
  if (viewName === "habitDetail") {
    return elements.habitDetailView;
  }

  if (viewName === "insights") {
    return elements.insightsView;
  }

  return elements.todayView;
}

function selectedHabit() {
  return state.habits.find((habit) => habit.id === state.selectedHabitId) || null;
}

function habitsScheduledForDate(date) {
  return state.habits.filter((habit) => isHabitScheduledOnDate(habit, date));
}

function entryForHabitAndDate(habitId, date) {
  return state.entries.find((entry) => entry.habitId === habitId && entry.date === date) || null;
}

function formatHabitMeta(habit) {
  const daysText = habit.weeklyDays.length
    ? habit.weeklyDays.map(shortDayName).join(", ")
    : `every ${habit.periodDays} day${habit.periodDays === 1 ? "" : "s"}`;

  return `${habit.category} • target ${habit.targetCount} ${habit.unit} • ${daysText}`;
}

function shortCadence(habit) {
  if (habit.weeklyDays.length) {
    return habit.weeklyDays.map(shortDayName).join(", ");
  }

  return `Every ${habit.periodDays} day${habit.periodDays === 1 ? "" : "s"}`;
}

function cadenceExplanation(habit) {
  if (habit.weeklyDays.length) {
    return `Tracking on ${habit.weeklyDays.map(shortDayName).join(", ")} with a target of ${habit.targetCount} ${habit.unit}.`;
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
  elements.logSheetSubtitle.textContent = `${friendlyDate} • ${entry ? capitalize(entry.status) : "Not logged"}`;
  elements.logSheetClear.hidden = !entry;
}

function entriesForHabit(habitId) {
  return state.entries.filter((entry) => entry.habitId === habitId);
}

function buildCurrentMonthCalendarDays(habit) {
  const entryMap = new Map(entriesForHabit(habit.id).map((entry) => [entry.date, entry.status]));

  return buildCurrentMonthDates().map((date) => {
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
  const days = [];
  const base = parseLocalDate(today);
  const year = base.getFullYear();
  const month = base.getMonth();
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
  return parseLocalDate(today).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric"
  });
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
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function greetingForHour(hour) {
  if (hour < 12) {
    return "Good morning";
  }
  if (hour < 18) {
    return "Good afternoon";
  }
  return "Good evening";
}

function capitalize(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
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
  elements.composerFeedback.hidden = !message;
}

async function saveSelectedLogDate(status) {
  if (!state.selectedLogHabitId || !state.selectedLogDate) {
    return;
  }

  const selectedDate = state.selectedLogDate;
  await saveEntry(state.selectedLogHabitId, status, {
    date: selectedDate,
    skipRefresh: false
  });
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
    setComposerFeedback(`Cleared the log for ${formatFriendlyDate(parseLocalDate(selectedDate))}.`);
  } catch (error) {
    console.error(error);
    setComposerFeedback("Could not clear that log.");
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
        `Imported ${result.counts.habits} habits and ${result.counts.entries} entries from the server to this device.`
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
