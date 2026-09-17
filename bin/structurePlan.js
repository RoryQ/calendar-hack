#!/usr/bin/env node
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

/**
 * structurePlan.js
 * 
 * Automatically generates a structured 'steps' array for training plans
 * (including Pfitzinger/Douglas and Marathon Excellence schedules)
 * by parsing workout titles with regex into structured steps for FIT file export.
 */

function parseDistance(dist) {
  if (Array.isArray(dist)) {
    return dist[dist.length - 1]; // Use upper bound for calculations
  }
  return dist || 0;
}

function createStep(type, value, unit, name = null, target = null) {
  const step = { type, duration: { value, unit } };
  if (name) step.name = name;
  if (target) step.target = target;
  return step;
}

function parseDistFromBrackets(str, units = "mi") {
  const m = str.match(/\{(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?(?::(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?)?\}/);
  if (!m) return null;
  if (units === "mi") {
    return m[2] ? parseFloat(m[2]) : parseFloat(m[1]);
  } else {
    if (m[4]) return parseFloat(m[4]);
    if (m[3]) return parseFloat(m[3]);
    if (m[2]) return parseFloat(m[2]);
    return parseFloat(m[1]);
  }
}

function structureSingleSession(title, totalDistance, units, prefix = "") {
  title = title.trim().replace(/\s+/g, " ");
  const pfx = prefix ? prefix + ": " : "";
  const steps = [];

  if (title === "Rest" || title === "Off") return [];

  // Rest or easy / Off or easy
  const restOrMatch = title.match(/^(?:Rest|Off) or (.*)$/i);
  if (restOrMatch) {
    const sub = restOrMatch[1];
    const d = parseDistFromBrackets(sub, units) || (Array.isArray(totalDistance) ? totalDistance[totalDistance.length - 1] : totalDistance);
    if (d > 0) {
      steps.push(createStep("active", d, units, pfx + "Easy run (optional)"));
      return steps;
    }
    return [];
  }

  // Marathon race
  if (title.toLowerCase().includes("marathon race")) {
    steps.push(createStep("active", units === "mi" ? 26.2 : 42.2, units, pfx + "Marathon race", { type: "pace", value: "Marathon" }));
    return steps;
  }

  // Tune-up Race
  if (title.toLowerCase().includes("tune-up race")) {
    steps.push(createStep("warmup", 2, units, pfx + "Warmup"));
    steps.push(createStep("active", 10, "km", pfx + "Tune-up Race", { type: "pace", value: "10K" }));
    steps.push(createStep("cooldown", 2, units, pfx + "Cooldown"));
    return steps;
  }

  // Pfitz Lactate Threshold (LT)
  const ltMatch = title.match(/LT .* with (\d+)-?(\d+)? minutes at LT pace/i);
  if (ltMatch) {
    const ltMin = ltMatch[2] ? parseInt(ltMatch[2]) : parseInt(ltMatch[1]);
    steps.push(createStep("warmup", 2, units, pfx + "Warmup"));
    steps.push(createStep("active", ltMin, "min", pfx + "LT interval", { type: "heart_rate", zone: 4 }));
    const remaining = parseDistance(totalDistance) - 2;
    if (remaining > 1) {
      steps.push(createStep("cooldown", remaining, units, pfx + "Cooldown"));
    }
    return steps;
  }

  // Pfitz Marathon-pace run (MP)
  const mpMatch = title.match(/Marathon-pace run .* with \{(\d+):?(\d+)?\} at marathon pace/i);
  if (mpMatch) {
    const mpDist = parseFloat(mpMatch[1]);
    const warmupDist = 2.0;
    steps.push(createStep("warmup", warmupDist, units, pfx + "Warmup"));
    steps.push(createStep("active", mpDist, units, pfx + "Marathon pace", { type: "pace", value: "Marathon" }));
    const cooldownDist = Math.max(0, parseDistance(totalDistance) - mpDist - warmupDist);
    if (cooldownDist > 0) {
      steps.push(createStep("cooldown", cooldownDist, units, pfx + "Cooldown"));
    }
    return steps;
  }

  // Pfitz VO2max
  const vo2Match = title.match(/VO₂max .* with (\d+) x (\d+) (m|km) at 5[kK] race pace/i);
  if (vo2Match) {
    const count = parseInt(vo2Match[1]);
    const val = parseInt(vo2Match[2]);
    const unit = vo2Match[3];
    steps.push(createStep("warmup", 2, units, pfx + "Warmup"));
    const repeatSteps = [
      createStep("active", val, unit, "VO2max interval", { type: "heart_rate", zone: 5 }),
      createStep("rest", 3, "min", "Recovery")
    ];
    steps.push({ type: "repeat", count, steps: repeatSteps });
    steps.push(createStep("cooldown", 2, units, pfx + "Cooldown"));
    return steps;
  }

  // Pfitz General aerobic + speed / Recovery + speed with hill sprints + strides
  const speedMatch = title.match(/(Gen-aerobic|Recovery) \+ speed .* with (?:(\d+) x (\d+) sec hill sprints)?(?:\s*\+\s*)?(\d+) x (\d+) m strides/i);
  if (speedMatch) {
    const hCount = speedMatch[2] ? parseInt(speedMatch[2]) : 0;
    const hSec = speedMatch[3] ? parseInt(speedMatch[3]) : 0;
    const sCount = speedMatch[4] ? parseInt(speedMatch[4]) : 0;
    const sM = speedMatch[5] ? parseInt(speedMatch[5]) : 0;

    steps.push(createStep("warmup", 2, units, pfx + (speedMatch[1].includes("Gen") ? "General aerobic" : "Recovery")));

    if (hCount > 0) {
      steps.push({
        type: "repeat", count: hCount, steps: [
          createStep("active", hSec, "sec", "Uphill"),
          createStep("rest", 60, "sec", "Recovery")
        ]
      });
      steps.push(createStep("active", 1, units, "Transition"));
    }

    if (sCount > 0) {
      steps.push({
        type: "repeat", count: sCount, steps: [
          createStep("active", sM, "m", "Strides"),
          createStep("rest", 60, "sec", "Recovery")
        ]
      });
    }

    const remaining = parseDistance(totalDistance) - 2 - (hCount > 0 ? 1 : 0);
    if (remaining > 0) {
      steps.push(createStep("cooldown", remaining, units, pfx + "Cooldown"));
    }
    return steps;
  }

  // Sets of repeats e.g. "2 sets of (6 × 500m at 95% 5k with 30 sec walk), 4 min walk between sets"
  // or "4 sets of (3 min at 98% 5k, 1 min jog, 2 min at 100% 5k, 1 min jog, 1 min at 102% 5k, 2 min jog)"
  const setsMatch = title.match(/^(\d+)\s*sets of \((.*?)\)(?:,\s*(\d+(?:\.\d+)?)\s*(min|sec)\s*(?:walk|jog|rest) between sets)?$/i);
  if (setsMatch) {
    const setCount = parseInt(setsMatch[1]);
    const inner = setsMatch[2];
    const betweenVal = setsMatch[3] ? parseFloat(setsMatch[3]) : null;
    const betweenUnit = setsMatch[4] ? setsMatch[4].toLowerCase() : "min";

    steps.push(createStep("warmup", 2, units, pfx + "Warmup"));

    const innerRepMatch = inner.match(/^(\d+(?:[–-]\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)\s*(min|sec|km|m|mi)\s*(?:at|progressing)?\s*([^w]+?)\s*with\s*(\d+(?:\.\d+)?)\s*(min|sec)\s*(jog|walk|rest)$/i);
    for (let s = 0; s < setCount; s++) {
      if (innerRepMatch) {
        const count = parseInt(innerRepMatch[1].split(/[–-]/).pop());
        const val = parseFloat(innerRepMatch[2]);
        const unit = innerRepMatch[3].toLowerCase();
        const tgt = innerRepMatch[4].trim();
        const rVal = parseFloat(innerRepMatch[5]);
        const rUnit = innerRepMatch[6].toLowerCase();
        const rType = innerRepMatch[7].toLowerCase();

        steps.push({
          type: "repeat",
          count: count,
          steps: [
            createStep("active", val, unit, `Set ${s + 1} Interval`, { type: "pace", value: tgt }),
            createStep("rest", rVal, rUnit, rType.includes("walk") ? "Walk recovery" : "Jog recovery")
          ]
        });
      } else {
        const parts = inner.split(",").map(p => p.trim());
        const subSteps = [];
        parts.forEach(part => {
          const m = part.match(/^(\d+(?:\.\d+)?)\s*(min|sec|km|m)\s*(?:at\s*(.*?)|(jog|walk|rest))$/i);
          if (m) {
            const val = parseFloat(m[1]);
            const unit = m[2].toLowerCase();
            if (m[3]) {
              subSteps.push(createStep("active", val, unit, "Interval", { type: "pace", value: m[3].trim() }));
            } else {
              subSteps.push(createStep("rest", val, unit, m[4].toLowerCase().includes("walk") ? "Walk recovery" : "Jog recovery"));
            }
          }
        });
        if (subSteps.length > 0) {
          subSteps.forEach(st => steps.push(st));
        }
      }

      if (betweenVal && s < setCount - 1) {
        steps.push(createStep("rest", betweenVal, betweenUnit, "Recovery between sets"));
      }
    }
    steps.push(createStep("cooldown", 2, units, pfx + "Cooldown"));
    return steps;
  }

  // Compound repeats e.g. "3 × (3 min at 100% 5k, 1.5 min jog, 2 min at 102% 5k, 3 min jog)"
  // or "3 × (2 km at 108% MP, 2 min walk/jog, 1 km at 110–112% MP, 4–5 min walk/jog)"
  // or "10 × (1 km at 105% MP, 1 km at 90–92% MP)"
  const compoundMatch = title.match(/^(\d+(?:[–-]\d+)?)\s*[×x]\s*\((.*?)\)(?:\s*with\s*(\d+(?:\.\d+)?)\s*(min|sec)\s*(walk|jog|rest|walk\/jog))?$/i);
  if (compoundMatch) {
    const count = parseInt(compoundMatch[1].split(/[–-]/).pop());
    const inner = compoundMatch[2];
    const withVal = compoundMatch[3] ? parseFloat(compoundMatch[3]) : null;
    const withUnit = compoundMatch[4] ? compoundMatch[4].toLowerCase() : "min";
    const withType = compoundMatch[5] ? compoundMatch[5].toLowerCase() : "jog";

    steps.push(createStep("warmup", 2, units, pfx + "Warmup"));

    const innerParts = inner.split(",").map(p => p.trim());
    const repeatSteps = [];
    innerParts.forEach(part => {
      const m = part.match(/^(\d+(?:\.\d+)?)\s*(min|sec|km|m|mi)\s*(?:at\s*(.*?)|(jog|walk|rest|walk\/jog))$/i);
      if (m) {
        const val = parseFloat(m[1]);
        const unit = m[2].toLowerCase();
        if (m[3]) {
          repeatSteps.push(createStep("active", val, unit, "Interval", { type: "pace", value: m[3].trim() }));
        } else {
          repeatSteps.push(createStep("rest", val, unit, m[4].toLowerCase().includes("walk") ? "Walk recovery" : "Jog recovery"));
        }
      }
    });

    if (withVal) {
      repeatSteps.push(createStep("rest", withVal, withUnit, withType.includes("walk") ? "Walk recovery" : "Jog recovery"));
    }

    steps.push({
      type: "repeat",
      count: count,
      steps: repeatSteps
    });

    steps.push(createStep("cooldown", 2, units, pfx + "Cooldown"));
    return steps;
  }

  // Strides in easy run: e.g. "{4-6:6-10} easy with 4 × 20 sec strides" or "{4:6} easy with 5 x 100 m strides"
  const stridesMatch = title.match(/^(.*?)\s*with\s*(\d+)\s*[×x]\s*(\d+)\s*(sec|s|m)\s*strides(.*)$/i);
  if (stridesMatch) {
    const baseRun = stridesMatch[1];
    const count = parseInt(stridesMatch[2]);
    const strideVal = parseInt(stridesMatch[3]);
    const strideUnit = stridesMatch[4].toLowerCase().startsWith("s") ? "sec" : "m";
    const runDist = parseDistFromBrackets(baseRun, units) || (Array.isArray(totalDistance) ? totalDistance[totalDistance.length - 1] : totalDistance) || 6;

    const warmupDist = Math.max(1, Math.min(2, runDist - 1));
    const cooldownDist = Math.max(0, runDist - warmupDist - 1);

    steps.push(createStep("warmup", warmupDist, units, pfx + "Easy run"));
    steps.push({
      type: "repeat",
      count: count,
      steps: [
        createStep("active", strideVal, strideUnit, "Strides", { type: "pace", value: "Fast" }),
        createStep("rest", 60, "sec", "Recovery")
      ]
    });
    if (cooldownDist > 0) {
      steps.push(createStep("cooldown", cooldownDist, units, pfx + "Cooldown"));
    }
    return steps;
  }

  // Embedded fartlek by duration: "{6-8:10-12} easy with 28 min of (1 min at ~95% 5k effort, 3 min easy) in the middle"
  const fartlekMiddleMatch = title.match(/^(.*?)\s*with\s*(\d+)\s*min of \((\d+(?:\.\d+)?)\s*(min|sec)\s*at\s*([^,]+),\s*(\d+(?:\.\d+)?)\s*(min|sec)\s*(?:easy|moderate)\)(?: in the middle)?$/i);
  if (fartlekMiddleMatch) {
    const baseRun = fartlekMiddleMatch[1];
    const totalMin = parseFloat(fartlekMiddleMatch[2]);
    const onVal = parseFloat(fartlekMiddleMatch[3]);
    const onUnit = fartlekMiddleMatch[4].toLowerCase();
    const paceTarget = fartlekMiddleMatch[5].trim();
    const offVal = parseFloat(fartlekMiddleMatch[6]);
    const offUnit = fartlekMiddleMatch[7].toLowerCase();

    const onMin = onUnit === "sec" ? onVal / 60 : onVal;
    const offMin = offUnit === "sec" ? offVal / 60 : offVal;
    const reps = Math.round(totalMin / (onMin + offMin));

    const runDist = parseDistFromBrackets(baseRun, units) || (Array.isArray(totalDistance) ? totalDistance[totalDistance.length - 1] : totalDistance) || 8;
    const warmupDist = Math.max(1, Math.min(2, Math.floor(runDist / 3)));
    const cooldownDist = Math.max(0, runDist - warmupDist - Math.round(totalMin / 8));

    steps.push(createStep("warmup", warmupDist, units, pfx + "Warmup"));
    steps.push({
      type: "repeat",
      count: reps,
      steps: [
        createStep("active", onVal, onUnit, "Fast interval", { type: "pace", value: paceTarget.replace(/~/g, "") }),
        createStep("rest", offVal, offUnit, "Float recovery")
      ]
    });
    if (cooldownDist > 0) {
      steps.push(createStep("cooldown", cooldownDist, units, pfx + "Cooldown"));
    }
    return steps;
  }

  // Embedded fartlek by reps: "{8-10:13-16} easy with 10 × (30 sec at ~5k effort, 2.5 min easy)"
  const fartlekRepsMatch = title.match(/^(.*?)\s*with\s*(\d+)\s*[×x]\s*\((.*?)\)(?: \((.*?)\))?$/i);
  if (fartlekRepsMatch) {
    const baseRun = fartlekRepsMatch[1];
    const count = parseInt(fartlekRepsMatch[2]);
    const inner = fartlekRepsMatch[3];
    const extraTarget = fartlekRepsMatch[4];

    const runDist = parseDistFromBrackets(baseRun, units) || (Array.isArray(totalDistance) ? totalDistance[totalDistance.length - 1] : totalDistance) || 8;
    const warmupDist = Math.max(1, Math.min(2, Math.floor(runDist / 3)));
    const cooldownDist = Math.max(0, runDist - warmupDist - 2);

    steps.push(createStep("warmup", warmupDist, units, pfx + "Warmup"));

    const innerParts = inner.split(",").map(s => s.trim());
    const repeatSteps = [];
    innerParts.forEach((part, pIdx) => {
      const pMatch = part.match(/(\d+(?:\.\d+)?)\s*(min|sec)\s*(?:at\s*([^,]+)|fast|easy run|easy|moderate)?/i);
      if (pMatch) {
        const val = parseFloat(pMatch[1]);
        const unit = pMatch[2].toLowerCase();
        const tgt = pMatch[3] || (pIdx === 0 ? extraTarget || "Fast" : "Recovery");
        if (pIdx === 0) {
          repeatSteps.push(createStep("active", val, unit, "Fast interval", { type: "pace", value: tgt.replace(/~/g, "") }));
        } else {
          repeatSteps.push(createStep("rest", val, unit, "Float recovery"));
        }
      }
    });

    steps.push({
      type: "repeat",
      count: count,
      steps: repeatSteps
    });

    if (cooldownDist > 0) {
      steps.push(createStep("cooldown", cooldownDist, units, pfx + "Cooldown"));
    }
    return steps;
  }

  // Standard Interval Repeats: "6–7 × 3 min at 90% 5k with 1 min jog" or "12 × 500m at 108–110% MP with 30 sec walk"
  const standardIntervalMatch = title.match(/^(\d+(?:[–-]\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?|\{\d+:\d+\.?\d*\}|\{\d+-\d+:\d+-\d+\})\s*(min|sec|km|m|mi)?\s*(?:at|progressing)?\s*([^w]+?)\s*with\s*(\d+(?:\.\d+)?)\s*(min|sec)\s*(jog|walk|rest)$/i);
  if (standardIntervalMatch) {
    const countRange = standardIntervalMatch[1];
    const count = parseInt(countRange.split(/[–-]/).pop());
    let rawVal = standardIntervalMatch[2];
    let unit = standardIntervalMatch[3] ? standardIntervalMatch[3].toLowerCase() : units;
    let val;
    if (rawVal.startsWith("{")) {
      val = parseDistFromBrackets(rawVal, units);
    } else {
      val = parseFloat(rawVal);
    }
    const paceTarget = standardIntervalMatch[4].trim();
    const restVal = parseFloat(standardIntervalMatch[5]);
    const restUnit = standardIntervalMatch[6].toLowerCase();
    const restType = standardIntervalMatch[7].toLowerCase();

    steps.push(createStep("warmup", 2, units, pfx + "Warmup"));
    steps.push({
      type: "repeat",
      count: count,
      steps: [
        createStep("active", val, unit, "Interval", { type: "pace", value: paceTarget }),
        createStep("rest", restVal, restUnit, restType.includes("walk") ? "Walk recovery" : "Jog recovery")
      ]
    });
    steps.push(createStep("cooldown", 2, units, pfx + "Cooldown"));
    return steps;
  }

  // Multi-step progressive tempo e.g. "{5:8} at 90% MP + {5:8} at 92% MP + {5:8} at 94% MP + {3-4:5-8} at 96% MP"
  if (title.includes(" + ") && (title.includes(" at ") || title.includes("prog"))) {
    const parts = title.split(" + ").map(s => s.trim());
    parts.forEach((part, idx) => {
      const pDist = parseDistFromBrackets(part, units) || (part.toLowerCase().includes("cooldown") ? 2 : null);
      const tgtMatch = part.match(/at\s*([^$]+)$/i);
      const tgt = tgtMatch ? tgtMatch[1].trim() : null;
      if (pDist) {
        if (part.toLowerCase().includes("cooldown")) {
          steps.push(createStep("cooldown", pDist, units, pfx + "Cooldown"));
        } else if (part.toLowerCase().includes("easy")) {
          steps.push(createStep("warmup", pDist, units, pfx + "Warmup"));
        } else {
          steps.push(createStep("active", pDist, units, pfx + `Tempo Step ${idx + 1}`, tgt ? { type: "pace", value: tgt } : null));
        }
      }
    });
    if (steps.length > 0) return steps;
  }

  // Descending Ladder or Canova Blocks e.g. "3-2-1-1 km at 102–106% MP with 2 min walk"
  const ladderMatch = title.match(/^((?:\d+[-,])+\d+)\s*(?:km|mi)?\s*at\s*([^w]+?)\s*with\s*(.*?)$/i);
  if (ladderMatch) {
    const segments = ladderMatch[1].split(/[-,]/).map(Number);
    const paceTarget = ladderMatch[2].trim();
    const withClause = ladderMatch[3].trim();

    const withRestMatch = withClause.match(/^(\d+(?:\.\d+)?)\s*(min|sec)\s*(walk|jog|rest)$/i);
    const withFloatMatch = withClause.match(/^(\d+(?:\.\d+)?)\s*(km|mi)\s*at\s*([^($]+)/i);

    steps.push(createStep("warmup", 2, units, pfx + "Warmup"));

    segments.forEach((seg, idx) => {
      steps.push(createStep("active", seg, "km", `Ladder ${seg}km`, { type: "pace", value: paceTarget }));
      if (idx < segments.length - 1) {
        if (withRestMatch) {
          steps.push(createStep("rest", parseFloat(withRestMatch[1]), withRestMatch[2].toLowerCase(), withRestMatch[3].toLowerCase().includes("walk") ? "Walk recovery" : "Jog recovery"));
        } else if (withFloatMatch) {
          steps.push(createStep("active", parseFloat(withFloatMatch[1]), withFloatMatch[2].toLowerCase(), "Float segment", { type: "pace", value: withFloatMatch[3].trim() }));
        }
      }
    });

    steps.push(createStep("cooldown", 2, units, pfx + "Cooldown"));
    return steps;
  }

  // Single paced run e.g. "{10-11:16-18} at 70–75% 5k" or "{16-18:27-30} at 90–92% MP"
  const singlePacedMatch = title.match(/^(.*?)\s*at\s*([^$]+)$/i);
  if (singlePacedMatch) {
    const distStr = singlePacedMatch[1];
    const targetStr = singlePacedMatch[2].trim();
    const dist = parseDistFromBrackets(distStr, units) || (Array.isArray(totalDistance) ? totalDistance[totalDistance.length - 1] : totalDistance);
    if (dist > 0) {
      steps.push(createStep("active", dist, units, pfx + (distStr.includes("rolling hills") ? "Rolling hills" : "Paced run"), { type: "pace", value: targetStr }));
      return steps;
    }
  }

  // Kenyan progression run e.g. "{5:8} Kenyan-style progression run"
  if (title.toLowerCase().includes("kenyan") || title.toLowerCase().includes("progression")) {
    const dist = parseDistFromBrackets(title, units) || (Array.isArray(totalDistance) ? totalDistance[totalDistance.length - 1] : totalDistance);
    if (dist > 0) {
      steps.push(createStep("active", dist, units, pfx + "Kenyan progression run", { type: "pace", value: "Progression" }));
      return steps;
    }
  }

  // Standard Continuous Run (Easy, Very Easy, Rolling Hills, etc.)
  const dist = parseDistFromBrackets(title, units) || (Array.isArray(totalDistance) ? totalDistance[totalDistance.length - 1] : totalDistance);
  if (dist > 0) {
    let name = "Easy run";
    if (title.toLowerCase().includes("very easy")) name = "Very easy run";
    else if (title.toLowerCase().includes("rolling hills")) name = "Rolling hills run";
    else if (title.toLowerCase().includes("moderate")) name = "Moderate run";
    steps.push(createStep("active", dist, units, pfx + name));
    return steps;
  }

  return [];
}

export function structureWorkout(workout, units) {
  let title = workout.title.trim().replace(/\s+/g, " ");
  const distance = workout.distance;

  // Doubles: AM / PM
  if (title.startsWith("AM:") || title.includes(" / PM:") || title.startsWith("Special block AM:")) {
    const cleanTitle = title.replace(/^Special block\s+/i, "");
    const parts = cleanTitle.split(/\s*\/\s*PM:\s*/i);
    const amTitle = parts[0].replace(/^AM:\s*/i, "").trim();
    const pmTitle = parts[1] ? parts[1].trim() : "";

    const amSteps = structureSingleSession(amTitle, distance, units, "AM");
    const pmSteps = pmTitle ? structureSingleSession(pmTitle, distance, units, "PM") : [];
    return [...amSteps, ...pmSteps];
  }

  return structureSingleSession(title, distance, units);
}

export function structurePlanFile(inputFile, outputFile = null) {
  if (!outputFile) {
    outputFile = inputFile.replace(".yaml", "_structured.yaml");
  }

  const plan = yaml.load(fs.readFileSync(inputFile, 'utf8'));
  const units = plan.units || "mi";

  if (!plan.id.endsWith("_structured")) {
    plan.id = plan.id + "_structured";
  }
  if (!plan.name.endsWith("(Structured)")) {
    plan.name = plan.name + " (Structured)";
  }

  plan.schedule.forEach(week => {
    week.workouts.forEach(workout => {
      const steps = structureWorkout(workout, units);
      if (steps && steps.length > 0) {
        workout.steps = steps;
      }
    });
  });

  fs.writeFileSync(outputFile, yaml.dump(plan, { lineWidth: -1, quotingType: '"', forceQuotes: false }));
  console.log(`Generated structured plan: ${outputFile}`);
}

const args = process.argv.slice(2);
if (args.length > 0) {
  args.forEach(file => {
    structurePlanFile(file);
  });
}
