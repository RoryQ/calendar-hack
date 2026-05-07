#!/usr/bin/env node
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

/**
 * structurePlan.js
 * 
 * Automatically generates a structured 'steps' array for Pfitzinger/Douglas 
 * training plans by parsing workout titles with regex.
 */

function parseDistance(dist) {
  if (Array.isArray(dist)) {
    return dist[dist.length - 1]; // Use upper bound for calculations
  }
  return dist;
}

function createStep(type, value, unit, name = null, target = null) {
  const step = { type, duration: { value, unit } };
  if (name) step.name = name;
  if (target) step.target = target;
  return step;
}

function structureWorkout(workout, units) {
  const title = workout.title.replace(/\s+/g, ' ').trim();
  const distance = parseDistance(workout.distance || 0);
  const steps = [];

  // 1. Lactate Threshold (LT)
  const ltMatch = title.match(/LT .* with (\d+)-?(\d+)? minutes at LT pace/);
  if (ltMatch) {
    const ltMin = ltMatch[2] ? parseInt(ltMatch[2]) : parseInt(ltMatch[1]);
    steps.push(createStep("warmup", 2, units));
    steps.push(createStep("active", ltMin, "min", "LT interval", { type: "heart_rate", zone: 4 }));
    const remaining = distance - 2;
    if (remaining > 1) {
      steps.push(createStep("cooldown", remaining, units));
    }
    return steps;
  }

  // 2. Marathon-pace run (MP)
  const mpMatch = title.match(/Marathon-pace run .* with \{(\d+):?(\d+)?\} at marathon pace/);
  if (mpMatch) {
    const mpDist = parseFloat(mpMatch[1]);
    const warmupDist = 2.0;
    steps.push(createStep("warmup", warmupDist, units));
    steps.push(createStep("active", mpDist, units, "Marathon pace", { type: "pace", value: "Marathon" }));
    const cooldownDist = Math.max(0, distance - mpDist - warmupDist);
    if (cooldownDist > 0) {
      steps.push(createStep("cooldown", cooldownDist, units));
    }
    return steps;
  }

  // 3. VO2max
  const vo2Match = title.match(/VO₂max .* with (\d+) x (\d+) (m|km) at 5[kK] race pace/);
  if (vo2Match) {
    const count = parseInt(vo2Match[1]);
    const val = parseInt(vo2Match[2]);
    const unit = vo2Match[3];
    steps.push(createStep("warmup", 2, units));
    const repeatSteps = [
      createStep("active", val, unit, "VO2max interval", { type: "heart_rate", zone: 5 }),
      createStep("rest", 3, "min", "Recovery")
    ];
    steps.push({ type: "repeat", count, steps: repeatSteps });
    steps.push(createStep("cooldown", 2, units));
    return steps;
  }

  // 4. General aerobic + speed / Recovery + speed
  const speedMatch = title.match(/(Gen-aerobic|Recovery) \+ speed .* with (?:(\d+) x (\d+) sec hill sprints)?(?:\s*\+\s*)?(\d+) x (\d+) m strides/);
  if (speedMatch) {
    const hCount = speedMatch[2] ? parseInt(speedMatch[2]) : 0;
    const hSec = speedMatch[3] ? parseInt(speedMatch[3]) : 0;
    const sCount = speedMatch[4] ? parseInt(speedMatch[4]) : 0;
    const sM = speedMatch[5] ? parseInt(speedMatch[5]) : 0;

    steps.push(createStep("warmup", 2, units, speedMatch[1].includes("Gen") ? "General aerobic" : "Recovery"));

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

    const remaining = distance - 2 - (hCount > 0 ? 1 : 0);
    if (remaining > 0) {
      steps.push(createStep("cooldown", remaining, units));
    }
    return steps;
  }
  
  // 5. Strides Only (Recovery/Gen-aerobic/Dress rehearsal)
  const stridesOnlyMatch = title.match(/(Recovery|Gen-aerobic|Dress rehearsal) .* with (\d+) x (\d+) m strides/);
  if (stridesOnlyMatch) {
    const sCount = parseInt(stridesOnlyMatch[2]);
    const sM = parseInt(stridesOnlyMatch[3]);
    steps.push(createStep("warmup", 2, units, stridesOnlyMatch[1]));
    steps.push({
        type: "repeat", count: sCount, steps: [
          createStep("active", sM, "m", "Strides"),
          createStep("rest", 60, "sec", "Recovery")
        ]
      });
    const remaining = distance - 2;
    if (remaining > 0) {
      steps.push(createStep("cooldown", remaining, units));
    }
    return steps;
  }

  // 6. Tune-up Race
  if (title.toLowerCase().includes("tune-up race")) {
    steps.push(createStep("warmup", 2, units));
    steps.push(createStep("active", 10, "km", "Tune-up Race", { type: "pace", value: "10K" }));
    steps.push(createStep("cooldown", 2, units));
    return steps;
  }

  // 7. Standard Continuous Run
  if (distance > 0) {
    steps.push(createStep("active", distance, units));
    return steps;
  }

  return null;
}

const inputFile = process.argv[2];
if (!inputFile) {
  console.log("Usage: node bin/structurePlan.js <input.yaml>");
  process.exit(1);
}

const outputFile = inputFile.replace(".yaml", "_structured.yaml");
const plan = yaml.load(fs.readFileSync(inputFile, 'utf8'));

const units = plan.units || "mi";
plan.id = plan.id + "_structured";
plan.name = plan.name + " (Structured)";

plan.schedule.forEach(week => {
  week.workouts.forEach(workout => {
    if (workout.title.includes("Rest")) return;

    const structuredSteps = structureWorkout(workout, units);
    if (structuredSteps) {
      workout.steps = structuredSteps;
    }
  });
});

fs.writeFileSync(outputFile, yaml.dump(plan, { lineWidth: -1, quotingType: '"', forceQuotes: false }));
console.log(`Generated structured plan: ${outputFile}`);
