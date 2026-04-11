import { Encoder } from "@garmin/fitsdk";
import { DayDetails, WorkoutStep, DurationUnit, TargetType } from "types/app";

// The @garmin/fitsdk version installed seems to have a different Profile structure than expected.
// We will use the numeric values directly derived from the SDK's internal types mapping.

const FIT_CONSTANTS = {
  MesgNum: {
    FILE_ID: 0,
    WORKOUT: 26,
    WORKOUT_STEP: 27,
  },
  File: {
    WORKOUT: 5,
  },
  Intensity: {
    ACTIVE: 0,
    REST: 1,
    WARMUP: 2,
    COOLDOWN: 3,
  },
  WktStepDuration: {
    TIME: 0,
    DISTANCE: 1,
    OPEN: 5,
    REPEAT_UNTIL_STEPS_CMPLT: 6,
  },
  WktStepTarget: {
    SPEED: 0,
    HEART_RATE: 1,
    OPEN: 2,
    CADENCE: 3,
    POWER: 4,
  },
  Sport: {
    RUNNING: 1,
  },
  Manufacturer: {
    DEVELOPMENT: 255,
  }
};

function mapIntensity(type: string): number {
  switch (type) {
    case "warmup":
      return FIT_CONSTANTS.Intensity.WARMUP;
    case "rest":
      return FIT_CONSTANTS.Intensity.REST;
    case "cooldown":
      return FIT_CONSTANTS.Intensity.COOLDOWN;
    default:
      return FIT_CONSTANTS.Intensity.ACTIVE;
  }
}

function mapDurationType(unit: DurationUnit): number {
  switch (unit) {
    case "mi":
    case "km":
    case "m":
      return FIT_CONSTANTS.WktStepDuration.DISTANCE;
    case "min":
    case "sec":
      return FIT_CONSTANTS.WktStepDuration.TIME;
    default:
      return FIT_CONSTANTS.WktStepDuration.OPEN;
  }
}

function getDurationValue(value: number, unit: DurationUnit): number {
  switch (unit) {
    case "mi":
      return Math.round(value * 160934.4); // miles to cm
    case "km":
      return Math.round(value * 100000); // km to cm
    case "m":
      return Math.round(value * 100); // m to cm
    case "min":
      return Math.round(value * 60 * 1000); // min to ms
    case "sec":
      return Math.round(value * 1000); // sec to ms
    default:
      return 0;
  }
}

function mapTargetType(type?: TargetType): number {
  switch (type) {
    case "pace":
      return FIT_CONSTANTS.WktStepTarget.SPEED;
    case "heart_rate":
      return FIT_CONSTANTS.WktStepTarget.HEART_RATE;
    case "power":
      return FIT_CONSTANTS.WktStepTarget.POWER;
    case "cadence":
      return FIT_CONSTANTS.WktStepTarget.CADENCE;
    default:
      return FIT_CONSTANTS.WktStepTarget.OPEN;
  }
}

let globalStepIndex = 0;

function addStepsToEncoder(encoder: Encoder, steps: WorkoutStep[]) {
  steps.forEach((step) => {
    const currentIndex = globalStepIndex++;
    if (step.type === "repeat") {
      const firstStepInLoop = globalStepIndex;
      if (step.steps) {
        addStepsToEncoder(encoder, step.steps);
      }
      encoder.onMesg(FIT_CONSTANTS.MesgNum.WORKOUT_STEP, {
        messageIndex: globalStepIndex++,
        durationType: FIT_CONSTANTS.WktStepDuration.REPEAT_UNTIL_STEPS_CMPLT,
        durationValue: firstStepInLoop,
        targetValue: step.count, // number of repetitions
        intensity: FIT_CONSTANTS.Intensity.ACTIVE,
      });
    } else {
      encoder.onMesg(FIT_CONSTANTS.MesgNum.WORKOUT_STEP, {
        messageIndex: currentIndex,
        wktStepName: step.name || "",
        intensity: mapIntensity(step.type),
        durationType: step.duration ? mapDurationType(step.duration.unit) : FIT_CONSTANTS.WktStepDuration.OPEN,
        durationValue: step.duration ? getDurationValue(step.duration.value, step.duration.unit) : 0,
        targetType: mapTargetType(step.target?.type),
        targetValue: step.target?.zone || 0,
      });
    }
  });
}

export function toFit(dayDetails: DayDetails, renderedTitle?: string): Uint8Array | undefined {
  if (!dayDetails.steps) return undefined;

  const encoder = new Encoder();
  globalStepIndex = 0;

  // 1. File ID
  encoder.onMesg(FIT_CONSTANTS.MesgNum.FILE_ID, {
    type: FIT_CONSTANTS.File.WORKOUT,
    manufacturer: FIT_CONSTANTS.Manufacturer.DEVELOPMENT,
    product: 0,
    timeCreated: new Date(),
    serialNumber: Math.floor(Math.random() * 1000000),
  });

  // 2. Workout Message
  encoder.onMesg(FIT_CONSTANTS.MesgNum.WORKOUT, {
    wktName: (renderedTitle || dayDetails.title).substring(0, 32),
    numValidSteps: 100, // Safe upper bound or calculate total
    sport: FIT_CONSTANTS.Sport.RUNNING,
  });

  // 3. Workout Steps
  addStepsToEncoder(encoder, dayDetails.steps);

  return encoder.close();
}
