import { createEvents, EventAttributes } from "ics";
import { addDays } from "date-fns";
import { RacePlan } from "./dategrid";
import { getWeekDistance, render, renderDist } from "./rendering";
import { Units } from "types/app";

// public for testing
export function toDate(d: Date): [number, number, number] {
  return [d.getFullYear(), 1 + d.getMonth(), d.getDate()];
}

function renderStepsToText(steps: any[], indent: string = ""): string {
  let result = "";
  steps.forEach((step) => {
    if (step.type === "repeat") {
      result += `${indent}Repeat ${step.count}x:\n`;
      if (step.steps) {
        result += renderStepsToText(step.steps, indent + "  ");
      }
    } else {
      const durationStr = step.duration 
        ? `${step.duration.value} ${step.duration.unit}`
        : "";
      const targetStr = step.target
        ? ` (${step.target.type === 'heart_rate' ? 'HR Zone ' + step.target.zone : step.target.value || step.target.type})`
        : "";
      result += `${indent}- ${step.type.toUpperCase()}: ${step.name || ""} ${durationStr} ${targetStr}\n`;
    }
  });
  return result;
}

export function toIcal(plan: RacePlan, units: Units, baseUrl?: string): string | undefined {
  const events = new Array<EventAttributes>();
  let weekDesc = null;
  let weeks = plan.dateGrid.weeks;
  let workoutCounter = 0;
  for (let i = 0; i < weeks.length; i++) {
    const currWeek = weeks[i];
    const distance = getWeekDistance(currWeek, units);
    if (i === weeks.length - 1) {
      weekDesc = "Final Training Week!";
    } else {
      weekDesc = `Training Week ${1 + i}`;
    }
    if (distance[0] > 0) {
      weekDesc += " Distance: " + renderDist(distance, units, units);
    }
    events.push({
      title: weekDesc,
      description: weekDesc,
      start: toDate(currWeek.days[0].date),
      end: toDate(addDays(currWeek.days[6].date, 1)), // end dates are non-inclusive in iCal
    });

    for (var j = 0; j < currWeek.days.length; j++) {
      const currWorkout = currWeek.days[j];
      if (currWorkout.event) {
        let [title, desc] = render(currWorkout.event, plan.sourceUnits, units);
        desc = desc.replace(/(\r\n|\n|\r)/gm, "\n");
        // if desc is not set, use title
        if (desc.replace(/\s/g, "") === "") {
          desc = title;
        }

        // Add structured steps if present
        if (currWorkout.event.steps) {
           desc += "\n\nStructured Workout Steps:\n" + renderStepsToText(currWorkout.event.steps);
           
           if (baseUrl) {
             // For HashRouter, query params must come after the hash
             const url = new URL(baseUrl);
             const searchParams = new URLSearchParams();
             searchParams.set("p", plan.planId);
             searchParams.set("u", units);
             // Format date as YYYY-MM-DD local to avoid timezone shift
             const d = plan.planDates.planEndDate;
             const dateStr = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
             searchParams.set("d", dateStr);
             searchParams.set("s", plan.dateGrid.weekStartsOn.toString());
             searchParams.set("w", workoutCounter.toString());
             
             const finalUrl = `${url.origin}${url.pathname}#?${searchParams.toString()}`;
             desc += "\n\nDownload Garmin FIT file:\n" + finalUrl;
           }
        }

        events.push({
          title: title,
          description: desc,
          start: toDate(currWorkout.date),
          end: toDate(addDays(currWorkout.date, 1)), // end dates are non-inclusive in iCal
        });
        workoutCounter++;
      }
    }
  }
  let res = createEvents(events);
  if (res.error) {
    console.log("Error creating iCal events: " + res.error);
    return undefined;
  }
  return res.value;
}