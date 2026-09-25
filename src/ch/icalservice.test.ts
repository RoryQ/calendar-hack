import { eachDayOfInterval } from "date-fns";
import { register, unregister } from "timezone-mock";
import { toDate } from "./icalservice";

beforeAll(() => {
  register("Europe/London");
});

afterAll(() => {
  unregister();
});

it("should handle date intervals in which timezone offset changes (e.g. daylight savings)", () => {
  // Date range includes March 26 2023 when London enters daylight savings
  const dates: Date[] = eachDayOfInterval({
    start: new Date(2023, 2, 25),
    end: new Date(2023, 2, 28),
  });

  const actual = dates.map(toDate);
  const expected = [
    [2023, 3, 25],
    [2023, 3, 26],
    [2023, 3, 27],
    [2023, 3, 28],
  ];
  expect(actual).toEqual(expected);
});

it("should correctly link to workouts in mee_wind_18_structured (unshifted)", () => {
  const fs = require("fs");
  const path = require("path");
  const { build } = require("./planbuilder");
  const { toIcal } = require("./icalservice");

  const planPath = path.resolve(__dirname, "../../public/plans/json/mee_wind_18_structured.json");
  const planData = JSON.parse(fs.readFileSync(planPath, "utf-8"));

  const raceDate = new Date(2026, 9, 11);
  const racePlan = build(planData, raceDate, 1);

  const baseUrl = "https://roryq.github.io/calendar-hack/";
  const icalStr = toIcal(racePlan, "km", baseUrl);
  expect(icalStr).toBeDefined();

  // Unfold ICS lines
  const unfoldedIcal = icalStr!.replace(/\r\n[ \t]/g, "");
  const linkRegex = /Download Garmin FIT file:\\n(https:[^\r\n\\]+)/g;
  let match;
  const links: string[] = [];
  while ((match = linkRegex.exec(unfoldedIcal)) !== null) {
    links.push(match[1]);
  }

  expect(links.length).toBeGreaterThan(0);

  // Flatten workouts from racePlan
  const planWorkouts: any[] = [];
  for (const week of racePlan.dateGrid.weeks) {
    for (const day of week.days) {
      if (day.event) {
        planWorkouts.push(day.event);
      }
    }
  }

  links.forEach((link) => {
    expect(link).toContain("#/?");
    const queryPart = link.split("#/?")[1];
    const params = new URLSearchParams(queryPart);
    const w = parseInt(params.get("w")!, 10);
    expect(params.get("p")).toBe("mee_wind_18_structured");
    expect(params.get("u")).toBe("km");
    expect(params.get("m")).toBeNull();

    const workout = planWorkouts[w];
    expect(workout).toBeDefined();
    expect(workout.steps).toBeDefined();
  });
});

it("should correctly link to workouts in mee_wind_18_structured when shifted to Sunday long run", () => {
  const fs = require("fs");
  const path = require("path");
  const { build, shiftMeeSchedule } = require("./planbuilder");
  const { toIcal } = require("./icalservice");
  const { render } = require("./rendering");

  const planPath = path.resolve(__dirname, "../../public/plans/json/mee_wind_18_structured.json");
  const planData = JSON.parse(fs.readFileSync(planPath, "utf-8"));

  const raceDate = new Date(2026, 9, 11);
  let racePlan = build(planData, raceDate, 1);
  racePlan = shiftMeeSchedule(racePlan, 1);
  expect(racePlan.isSundayLongRun).toBe(true);

  const baseUrl = "https://roryq.github.io/calendar-hack/";
  const icalStr = toIcal(racePlan, "km", baseUrl);
  expect(icalStr).toBeDefined();

  const unfoldedIcal = icalStr!.replace(/\r\n[ \t]/g, "");

  // Check that the Friday event in week 15 (which is 10-13km easy in shifted schedule) has m=1
  const events: string[] = unfoldedIcal.split("BEGIN:VEVENT");
  const easy1013Event = events.find((ev: string) => ev.includes("SUMMARY:10-13 km easy") && ev.includes("DTSTART;VALUE=DATE:20260918"));
  expect(easy1013Event).toBeDefined();
  expect(easy1013Event).toContain("m=1");

  // Verify all links
  const linkRegex = /Download Garmin FIT file:\\n(https:[^\r\n\\]+)/g;
  let match;
  const links: string[] = [];
  while ((match = linkRegex.exec(unfoldedIcal)) !== null) {
    links.push(match[1]);
  }

  // Flatten workouts from shifted racePlan
  const planWorkouts: any[] = [];
  for (const week of racePlan.dateGrid.weeks) {
    for (const day of week.days) {
      if (day.event) {
        planWorkouts.push(day.event);
      }
    }
  }

  links.forEach((link) => {
    expect(link).toContain("#/?");
    const queryPart = link.split("#/?")[1];
    const params = new URLSearchParams(queryPart);
    const w = parseInt(params.get("w")!, 10);
    expect(params.get("p")).toBe("mee_wind_18_structured");
    expect(params.get("u")).toBe("km");
    expect(params.get("m")).toBe("1");

    const workout = planWorkouts[w];
    expect(workout).toBeDefined();
    expect(workout.steps).toBeDefined();
    
    // When simulating app reload with m=1
    let reloadedPlan = build(planData, raceDate, 1);
    if (params.get("m") === "1") {
      reloadedPlan = shiftMeeSchedule(reloadedPlan, 1);
    }
    const reloadedWorkouts: any[] = [];
    for (const week of reloadedPlan.dateGrid.weeks) {
      for (const day of week.days) {
        if (day.event) {
          reloadedWorkouts.push(day.event);
        }
      }
    }
    const reloadedWorkout = reloadedWorkouts[w];
    expect(reloadedWorkout).toBeDefined();
    const [title1] = render(workout, workout.sourceUnits, "km");
    const [title2] = render(reloadedWorkout, reloadedWorkout.sourceUnits, "km");
    expect(title1).toEqual(title2);
  });
});
