const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function inferHabit(description) {
  if (OPENAI_API_KEY) {
    try {
      const aiResult = await inferHabitWithOpenAI(description);
      if (aiResult) {
        return { ...aiResult, source: "openai" };
      }
    } catch (error) {
      console.error("OpenAI inference failed, using heuristic fallback.", error.message);
    }
  }

  return { ...inferHabitHeuristically(description), source: "heuristic" };
}

async function inferHabitWithOpenAI(description) {
  const payload = {
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: `You are a habit tracking parser. Extract structured habit data from natural language input.

Return ONLY a valid JSON object with this exact shape:
{
  "name": string,
  "category": string,
  "rationale": string,
  "goal": {
    "targetCount": number,
    "unit": string
  },
  "cadence": {
    "targetCount": number,
    "periodDays": number,
    "weeklyDays": number[]
  }
}

## GOAL
Preserve any explicit quantity and unit from the user (e.g. "10 minutes", "5 km", "20 pages").
Do NOT substitute schedule counts (like "7 days") for measurement units.
Valid units include minutes, hours, pages, km, miles, glasses, cups, steps, reps, session, and similar concrete habit units.
If a quantity is provided (e.g. "5 km"), goal.targetCount should be that number (5) and goal.unit should be that unit (km).
If no quantity is provided (e.g. "go to the gym"), goal.targetCount defaults to 1 and goal.unit defaults to "session".

## CADENCE RULES (in priority order)

1. NAMED WEEKDAYS - user explicitly names days (e.g. "Monday Wednesday Friday", "Mon/Wed/Fri")
   -> cadence.periodDays: 7, cadence.weeklyDays: [<day indices>], cadence.targetCount: number of named days
   Day index: Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6, Sun=7

2. DAILY - "every day", "daily", "each day", "every day in a week"
   -> cadence.targetCount: 1, cadence.periodDays: 1, cadence.weeklyDays: []

3. N TIMES OR DAYS A WEEK - "N times a week / per week", "N days a week", "N days in a week"
   -> cadence.targetCount: N, cadence.periodDays: 7, cadence.weeklyDays: []

4. N TIMES A MONTH - "N times a month / per month"
   -> cadence.targetCount: N, cadence.periodDays: 30, cadence.weeklyDays: []

5. N TIMES A YEAR - "N times a year / per year"
   -> cadence.targetCount: N, cadence.periodDays: 365, cadence.weeklyDays: []

6. EVERY OTHER DAY - "every other day", "alternate days"
   -> cadence.targetCount: 1, cadence.periodDays: 2, cadence.weeklyDays: []

7. EVERY WEEKDAY - "every weekday", "on weekdays", "Monday to Friday"
   -> cadence.targetCount: 5, cadence.periodDays: 7, cadence.weeklyDays: [1,2,3,4,5]

8. EVERY WEEKEND - "every weekend", "on weekends"
   -> cadence.targetCount: 2, cadence.periodDays: 7, cadence.weeklyDays: [6,7]

9. FORTNIGHTLY - "every two weeks", "fortnightly", "biweekly"
   -> cadence.targetCount: 1, cadence.periodDays: 14, cadence.weeklyDays: []
   Note: "biweekly" is ambiguous - always treat it as every 2 weeks, never twice a week.

10. AMBIGUOUS/MISSING - "regularly", "often", "sometimes", "a few times", or no frequency given
    -> default to: cadence.targetCount: 1, cadence.periodDays: 1, cadence.weeklyDays: []
    Set rationale to: "Frequency was unclear, defaulted to daily"

## ADDITIONAL RULES
- Treat spelled-out counts like one, two, three, four, and five the same as digits.
- Only populate weeklyDays when the user explicitly names weekdays or clearly means weekdays/weekends.
- Keep the habit name focused on the action and explicit quantity, not the cadence wording.
- Example: "walk 10,000 steps six days in a week" should become a name like "Walk 10,000 steps", a goal of 10000 steps, and a cadence of 6 in 7 days.
- For rationale, briefly explain how the cadence was interpreted.
- Return only JSON with no markdown or extra explanation.`
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Infer a habit from this text: ${description}`
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "habit_inference",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["name", "category", "rationale", "goal", "cadence"],
          properties: {
            name: { type: "string" },
            category: { type: "string" },
            rationale: { type: "string" },
            goal: {
              type: "object",
              additionalProperties: false,
              required: ["targetCount", "unit"],
              properties: {
                targetCount: { type: "integer", minimum: 1, maximum: 1000000 },
                unit: { type: "string" }
              }
            },
            cadence: {
              type: "object",
              additionalProperties: false,
              required: ["targetCount", "periodDays", "weeklyDays"],
              properties: {
                targetCount: { type: "integer", minimum: 1, maximum: 365 },
                periodDays: { type: "integer", minimum: 1, maximum: 365 },
                weeklyDays: {
                  type: "array",
                  items: { type: "integer", minimum: 1, maximum: 7 }
                }
              }
            }
          }
        }
      }
    }
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`OpenAI API returned ${response.status}`);
  }

  const result = await response.json();
  const outputText = extractResponseText(result);
  const parsed = JSON.parse(outputText);

  return sanitizeInference(parsed, description);
}

function extractResponseText(result) {
  if (typeof result.output_text === "string" && result.output_text.trim()) {
    return result.output_text;
  }

  const texts = [];
  const output = Array.isArray(result.output) ? result.output : [];

  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const block of content) {
      if (block.type === "output_text" && block.text) {
        texts.push(block.text);
      }
    }
  }

  return texts.join("").trim();
}

function inferHabitHeuristically(description) {
  const cleaned = description.replace(/\s+/g, " ").trim();
  const lower = cleaned.toLowerCase();
  const goal = inferGoal(lower);
  const cadence = inferCadence(lower);

  const name = cleaned
    .replace(/\b(i want to|i need to|help me|track|habit|should)\b/gi, "")
    .replace(/\b(?:every day|daily|each day|every other day|alternate days|every weekday|on weekdays|monday to friday|every weekend|on weekends|fortnightly|biweekly|every two weeks)\b/gi, "")
    .replace(/\b(?:\d[\d,]*|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:times?|days?|sessions?)\s+(?:(?:a|per)\s+(?:week|month|year)|in\s+(?:a\s+)?(?:week|month|year))\b/gi, "")
    .replace(/\b(?:\d[\d,]*|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:times?|sessions?)\s+every\s+(?:\d[\d,]*|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,:-]\s*/, "") || cleaned;

  const titleWithGoal = goal.targetCount > 1 && goal.unit !== "session" && !new RegExp(`\\b${escapeRegExp(goal.unit)}\\b`, "i").test(name)
    ? `${name} ${goal.targetCount.toLocaleString()} ${goal.unit}`
    : name;

  return sanitizeInference(
    {
      name: sentenceCase(titleWithGoal),
      category: inferCategory(lower),
      rationale: buildRationale(goal, cadence),
      goal,
      cadence
    },
    description
  );
}

function sanitizeInference(inference, originalText) {
  const goal = inference.goal || {};
  const cadence = inference.cadence || {};

  return {
    name: sentenceCase(String(inference.name || originalText).trim()),
    category: String(inference.category || "general").trim().toLowerCase(),
    rationale: String(inference.rationale || "Suggested from your description.").trim(),
    goal: {
      targetCount: normalizePositiveInteger(goal.targetCount, 1),
      unit: String(goal.unit || "session").trim() || "session"
    },
    cadence: {
      targetCount: normalizePositiveInteger(cadence.targetCount, 1),
      periodDays: normalizePositiveInteger(cadence.periodDays, 7),
      weeklyDays: normalizeWeeklyDays(cadence.weeklyDays || [])
    }
  };
}

function inferUnit(text) {
  if (/\bminutes?\b/.test(text)) return "minutes";
  if (/\bhours?\b/.test(text)) return "hours";
  if (/\bpages?\b/.test(text)) return "pages";
  if (/\bkilometers?\b|\bkm\b/.test(text)) return "km";
  if (/\bmiles?\b/.test(text)) return "miles";
  if (/\bglasses?\b|\bcups?\b/.test(text)) return "glasses";
  if (/\bsteps?\b/.test(text)) return "steps";
  if (/\breps?\b/.test(text)) return "reps";
  return "session";
}

function inferCategory(text) {
  if (/\b(run|walk|gym|exercise|yoga|swim|bike|stretch|workout)\b/.test(text)) return "fitness";
  if (/\b(read|book|study|learn|practice|course)\b/.test(text)) return "learning";
  if (/\bmeditat|journal|mindful|sleep|therapy\b/.test(text)) return "wellness";
  if (/\bwater|eat|meal|protein|fruit|vegetable|cook\b/.test(text)) return "nutrition";
  if (/\bcode|project|write|ship|build|deep work\b/.test(text)) return "productivity";
  return "general";
}

function buildRationale(goal, cadence) {
  if (cadence.weeklyDays.length) {
    const dayNames = cadence.weeklyDays.map((day) => shortDayName(day)).join(", ");
    return `Detected a goal of ${goal.targetCount.toLocaleString()} ${goal.unit} with fixed weekly days on ${dayNames}.`;
  }

  if (cadence.periodDays === 1) {
    return `Detected a goal of ${goal.targetCount.toLocaleString()} ${goal.unit} with a daily cadence.`;
  }

  return `Detected a goal of ${goal.targetCount.toLocaleString()} ${goal.unit} with a cadence of ${cadence.targetCount} in ${cadence.periodDays} days.`;
}

function weekdayIndex(dayText) {
  const value = dayText.slice(0, 3).toLowerCase();
  const map = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6
  };
  return map[value] ?? -1;
}

function inferGoal(text) {
  const quantityMatch = text.match(/(\d[\d,]*)\s*(minutes?|hours?|pages?|kilometers?|km|miles?|glasses?|cups?|steps?|reps?)\b/);
  const unit = inferUnit(text);

  if (quantityMatch) {
    return {
      targetCount: parseNumericToken(quantityMatch[1], 1),
      unit: normalizeUnit(quantityMatch[2])
    };
  }

  return {
    targetCount: 1,
    unit
  };
}

function inferCadence(text) {
  const namedDays = extractNamedWeekdays(text);
  if (namedDays.length) {
    return {
      targetCount: namedDays.length,
      periodDays: 7,
      weeklyDays: namedDays
    };
  }

  if (/\bevery weekday\b|\bon weekdays\b|\bmonday to friday\b/.test(text)) {
    return { targetCount: 5, periodDays: 7, weeklyDays: [1, 2, 3, 4, 5] };
  }

  if (/\bevery weekend\b|\bon weekends\b/.test(text)) {
    return { targetCount: 2, periodDays: 7, weeklyDays: [6, 0] };
  }

  if (/\bevery other day\b|\balternate days\b/.test(text)) {
    return { targetCount: 1, periodDays: 2, weeklyDays: [] };
  }

  if (/\bevery day\b|\bdaily\b|\beach day\b|\bevery day in a week\b/.test(text)) {
    return { targetCount: 1, periodDays: 1, weeklyDays: [] };
  }

  if (/\bevery two weeks\b|\bfortnightly\b|\bbiweekly\b/.test(text)) {
    return { targetCount: 1, periodDays: 14, weeklyDays: [] };
  }

  const fixedPeriodCount = text.match(/\b(\d[\d,]*|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:times?|sessions?)\s+every\s+(\d[\d,]*|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?\b/);
  if (fixedPeriodCount) {
    return {
      targetCount: parseNumericToken(fixedPeriodCount[1], 1),
      periodDays: parseNumericToken(fixedPeriodCount[2], 7),
      weeklyDays: []
    };
  }

  const weeklyCount = matchCadenceCount(text, /\b(times?|days?|sessions?)\s+(?:(?:a|per)\s+week|in\s+(?:a\s+)?week)\b/);
  if (weeklyCount) {
    return { targetCount: weeklyCount, periodDays: 7, weeklyDays: [] };
  }

  const monthlyCount = matchCadenceCount(text, /\b(times?|days?|sessions?)\s+(?:(?:a|per)\s+month|in\s+(?:a\s+)?month)\b/);
  if (monthlyCount) {
    return { targetCount: monthlyCount, periodDays: 30, weeklyDays: [] };
  }

  const yearlyCount = matchCadenceCount(text, /\b(times?|days?|sessions?)\s+(?:(?:a|per)\s+year|in\s+(?:a\s+)?year)\b/);
  if (yearlyCount) {
    return { targetCount: yearlyCount, periodDays: 365, weeklyDays: [] };
  }

  return { targetCount: 1, periodDays: 1, weeklyDays: [] };
}

function extractNamedWeekdays(text) {
  const matches = Array.from(
    text.matchAll(/\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/g)
  );
  return [...new Set(matches.map((match) => weekdayIndex(match[0])))]
    .filter((value) => value !== -1)
    .sort((left, right) => left - right);
}

function matchCadenceCount(text, trailingPattern) {
  const match = text.match(new RegExp(`(\\d[\\d,]*|one|two|three|four|five|six|seven|eight|nine|ten)\\s+${trailingPattern.source}`, "i"));
  if (!match) {
    return 0;
  }

  return parseNumericToken(match[1], 1);
}

function parseNumericToken(value, fallback) {
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
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
}

function normalizeUnit(unit) {
  const raw = String(unit || "").trim().toLowerCase();
  if (raw === "kilometer" || raw === "kilometers") return "km";
  if (raw === "glass") return "glasses";
  if (raw === "cup") return "cups";
  if (raw === "step") return "steps";
  if (raw === "rep") return "reps";
  return raw;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shortDayName(day) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day] || "Day";
}

function sentenceCase(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizePositiveInteger(value, fallback) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return fallback;
  }
  return normalized;
}

function normalizeWeeklyDays(days) {
  return [
    ...new Set(
      days
        .map((day) => Number(day))
        .map((day) => {
          if (day >= 1 && day <= 6) return day;
          if (day === 7) return 0;
          if (day >= 0 && day <= 6) return day;
          return null;
        })
        .filter((day) => day !== null)
    )
  ].sort();
}

module.exports = {
  inferHabit
};
