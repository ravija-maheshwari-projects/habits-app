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
  "cadence": {
    "targetCount": number,
    "periodDays": number,
    "weeklyDays": number[],
    "unit": string
  }
}

## UNIT
Preserve any explicit quantity and unit from the user (e.g. "10 minutes", "5 km", "20 pages").
Do NOT substitute schedule counts (like "7 days") for measurement units.
Valid units include minutes, hours, pages, km, miles, glasses, cups, times, reps, session, time, and similar concrete habit units.
If a quantity is provided (e.g. "5 km"), targetCount should be that number (5) and unit should be that unit (km).
If no quantity is provided (e.g. "go to the gym"), targetCount defaults to 1 and unit defaults to "session" or "time".

## CADENCE RULES (in priority order)

1. NAMED WEEKDAYS - user explicitly names days (e.g. "Monday Wednesday Friday", "Mon/Wed/Fri")
   -> periodDays: 7, weeklyDays: [<day indices>], targetCount: number of named days
   Day index: Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6, Sun=7

2. DAILY - "every day", "daily", "each day", "every day in a week"
   -> targetCount: 1, periodDays: 1, weeklyDays: []

3. N TIMES A WEEK - "N times a week / per week"
   -> targetCount: N, periodDays: 7, weeklyDays: []

4. N TIMES A MONTH - "N times a month / per month"
   -> targetCount: N, periodDays: 30, weeklyDays: []

5. N TIMES A YEAR - "N times a year / per year"
   -> targetCount: N, periodDays: 365, weeklyDays: []

6. EVERY OTHER DAY - "every other day", "alternate days"
   -> targetCount: 1, periodDays: 2, weeklyDays: []

7. EVERY WEEKDAY - "every weekday", "on weekdays", "Monday to Friday"
   -> targetCount: 5, periodDays: 7, weeklyDays: [1,2,3,4,5]

8. EVERY WEEKEND - "every weekend", "on weekends"
   -> targetCount: 2, periodDays: 7, weeklyDays: [6,7]

9. FORTNIGHTLY - "every two weeks", "fortnightly", "biweekly"
   -> targetCount: 1, periodDays: 14, weeklyDays: []
   Note: "biweekly" is ambiguous - always treat it as every 2 weeks, never twice a week.

10. AMBIGUOUS/MISSING - "regularly", "often", "sometimes", "a few times", or no frequency given
    -> default to: targetCount: 1, periodDays: 1, weeklyDays: []
    Set rationale to: "Frequency was unclear, defaulted to daily"

## ADDITIONAL RULES
- Treat spelled-out counts like one, two, three, four, and five the same as digits.
- Only populate weeklyDays when the user explicitly names weekdays or clearly means weekdays/weekends.
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
          required: ["name", "category", "rationale", "cadence"],
          properties: {
            name: { type: "string" },
            category: { type: "string" },
            rationale: { type: "string" },
            cadence: {
              type: "object",
              additionalProperties: false,
              required: ["targetCount", "periodDays", "weeklyDays", "unit"],
              properties: {
                targetCount: { type: "integer", minimum: 1, maximum: 1000 },
                periodDays: { type: "integer", minimum: 1, maximum: 365 },
                weeklyDays: {
                  type: "array",
                  items: { type: "integer", minimum: 1, maximum: 7 }
                },
                unit: { type: "string" }
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
  const dayMatches = Array.from(lower.matchAll(/\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/g));
  const explicitCountMatch = lower.match(/(\d+)\s*(times?|x)\b/);
  const quantityMatch = lower.match(
    /(\d+)\s*(minutes?|hours?|pages?|kilometers?|km|miles?|glasses?|cups?)\b/
  );
  const dailyMatch = /\bdaily|every day|each day\b/.test(lower);
  const weeklyMatch = /\bweekly|per week|a week|every week\b/.test(lower);
  const monthlyMatch = /\bmonthly|per month|a month|every month\b/.test(lower);

  let unit = inferUnit(lower);
  let targetCount = quantityMatch
    ? Number(quantityMatch[1])
    : explicitCountMatch
      ? Number(explicitCountMatch[1])
      : 1;
  let periodDays = 7;
  let weeklyDays = [];

  if (dayMatches.length > 0) {
    weeklyDays = [...new Set(dayMatches.map((match) => weekdayIndex(match[0])))].filter(
      (value) => value !== -1
    );
    periodDays = 7;
  } else if (dailyMatch) {
    periodDays = 7;
    weeklyDays = [0, 1, 2, 3, 4, 5, 6];
  } else if (monthlyMatch) {
    periodDays = 30;
  } else if (weeklyMatch) {
    periodDays = 7;
  } else if (!quantityMatch && !explicitCountMatch) {
    targetCount = 3;
    periodDays = 7;
    weeklyDays = [1, 3, 5];
  }

  const name = cleaned
    .replace(/\b(i want to|i need to|help me|track|habit|should)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,:-]\s*/, "") || cleaned;

  return sanitizeInference(
    {
      name: sentenceCase(name),
      category: inferCategory(lower),
      rationale: buildRationale(targetCount, periodDays, weeklyDays, unit),
      cadence: {
        targetCount,
        periodDays,
        weeklyDays,
        unit
      }
    },
    description
  );
}

function sanitizeInference(inference, originalText) {
  const cadence = inference.cadence || {};

  return {
    name: sentenceCase(String(inference.name || originalText).trim()),
    category: String(inference.category || "general").trim().toLowerCase(),
    rationale: String(inference.rationale || "Suggested from your description.").trim(),
    cadence: {
      targetCount: normalizePositiveInteger(cadence.targetCount, 1),
      periodDays: normalizePositiveInteger(cadence.periodDays, 7),
      weeklyDays: normalizeWeeklyDays(cadence.weeklyDays || []),
      unit: String(cadence.unit || "times").trim() || "times"
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
  return "times";
}

function inferCategory(text) {
  if (/\b(run|walk|gym|exercise|yoga|swim|bike|stretch|workout)\b/.test(text)) return "fitness";
  if (/\b(read|book|study|learn|practice|course)\b/.test(text)) return "learning";
  if (/\bmeditat|journal|mindful|sleep|therapy\b/.test(text)) return "wellness";
  if (/\bwater|eat|meal|protein|fruit|vegetable|cook\b/.test(text)) return "nutrition";
  if (/\bcode|project|write|ship|build|deep work\b/.test(text)) return "productivity";
  return "general";
}

function buildRationale(targetCount, periodDays, weeklyDays, unit) {
  if (weeklyDays.length) {
    const dayNames = weeklyDays.map((day) => shortDayName(day)).join(", ");
    return `Suggested cadence: ${targetCount} ${unit} on ${dayNames}.`;
  }

  return `Suggested cadence: ${targetCount} ${unit} every ${periodDays} day${periodDays === 1 ? "" : "s"}.`;
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
