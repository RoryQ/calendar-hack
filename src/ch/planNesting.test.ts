import * as fs from "fs";
import * as path from "path";
import { TrainingPlan, WorkoutStep } from "../@types/app";

function getStepDepth(step: WorkoutStep): number {
  if (step.type === "repeat" && step.steps && step.steps.length > 0) {
    return 1 + Math.max(0, ...step.steps.map(getStepDepth));
  }
  return 0;
}

function getWorkoutMaxDepth(steps: WorkoutStep[]): number {
  if (!steps || steps.length === 0) return 0;
  return Math.max(0, ...steps.map(getStepDepth));
}

describe("Training Plans Nesting Depth", () => {
  const plansDir = path.resolve(__dirname, "../../public/plans/json");
  
  if (!fs.existsSync(plansDir)) {
    console.warn(`Plans directory not found at ${plansDir}, skipping nesting tests.`);
    return;
  }

  const files = fs.readdirSync(plansDir).filter((f) => f.endsWith(".json"));

  files.forEach((file) => {
    test(`plan ${file} should not have nested repeats deeper than 1`, () => {
      const filePath = path.join(plansDir, file);
      const plan: TrainingPlan = JSON.parse(fs.readFileSync(filePath, "utf-8"));

      plan.schedule.forEach((week) => {
        week.workouts.forEach((workout) => {
          if (workout.steps) {
            const depth = getWorkoutMaxDepth(workout.steps);
            expect(depth).toBeLessThanOrEqual(1);
          }
        });
      });
    });
  });
});
