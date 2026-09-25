import React, { useState } from "react";
import { repo } from "./ch/planrepo";
import { endOfWeek, addWeeks, isAfter } from "date-fns";
import { RacePlan } from "./ch/dategrid";
import { build, swap, swapDow, offset, shiftMeeSchedule } from "./ch/planbuilder";
import { CalendarGrid } from "./components/CalendarGrid";
import { toIcal } from "./ch/icalservice";
import { toCsv } from "./ch/csvService";
import { download } from "./ch/downloadservice";
import UnitsButtons from "./components/UnitsButtons";
import PlanAndDate from "./components/PlanAndDate";
import UndoButton from "./components/UndoButton";
import history from "./defy/history";
import {
  useQueryParams,
  StringParam,
  DateParam,
  NumberParam,
} from "use-query-params";
import { PlanDetailsCard } from "./components/PlanDetailsCard";
import { WeekStartsOn, WeekStartsOnValues } from "./ch/datecalc";
import WeekStartsOnPicker from "./components/WeekStartsOnPicker";
import { useMountEffect } from "./ch/hooks";
import { Units, PlanSummary, dayOfWeek } from "types/app";
import { getLocaleUnits } from "./ch/localize";
import { toFit } from "./ch/fitservice";
import { render } from "./ch/rendering";

const App = () => {
  const [{ u, p, d, s, w, m }, setq] = useQueryParams({
    u: StringParam,
    p: StringParam,
    d: DateParam,
    s: NumberParam,
    w: NumberParam, // workout index for deep-linking
    m: NumberParam, // marathon excellence sunday long run shift
  });

  const [selectedUnits, setSelectedUnits] = useState<Units>(
    u === "mi" || u === "km" ? u : getLocaleUnits(),
  );
  var [selectedPlan, setSelectedPlan] = useState(repo.find(p || ""));
  var [racePlan, setRacePlan] = useState<RacePlan | undefined>(undefined);
  var [undoHistory, setUndoHistory] = useState([] as RacePlan[]);
  const isMeePlan = selectedPlan[0]?.startsWith("mee_");
  const [isSundayLongRun, setIsSundayLongRun] = useState(isMeePlan && m === 1);
  var [weekStartsOn, setWeekStartsOn] = useState<WeekStartsOn>(
    s === 0 || s === 1 || s === 6 ? s : WeekStartsOnValues.Monday,
  );
  var [planEndDate, setPlanEndDate] = useState(
    d && isAfter(d, new Date())
      ? d
      : addWeeks(endOfWeek(new Date(), { weekStartsOn: weekStartsOn }), 20),
  );

  useMountEffect(() => {
    initialLoad(selectedPlan, planEndDate, selectedUnits, weekStartsOn, isMeePlan && m === 1);
  });

  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    // listen for changes to the URL and force the app to re-render
    history.listen(() => {
      forceUpdate();
    });
  }, []);

  React.useEffect(() => {
    // If URL parameters change (e.g. via a deep link), update the internal state
    // and trigger a reload of the plan.
    const planFromUrl = repo.find(p || "");
    const unitsFromUrl = u === "mi" || u === "km" ? u : getLocaleUnits();
    const weekStartsOnFromUrl = s === 0 || s === 1 || s === 6 ? s : WeekStartsOnValues.Monday;
    const dateFromUrl = d && isAfter(d, new Date()) ? d : planEndDate;
    const isMee = planFromUrl[0]?.startsWith("mee_");
    const sundayLongRunFromUrl = isMee && m === 1;

    if (
      p !== selectedPlan[0] ||
      unitsFromUrl !== selectedUnits ||
      weekStartsOnFromUrl !== weekStartsOn ||
      (d && d.getTime() !== planEndDate.getTime()) ||
      sundayLongRunFromUrl !== isSundayLongRun
    ) {
      setSelectedPlan(planFromUrl);
      setSelectedUnits(unitsFromUrl);
      setWeekStartsOn(weekStartsOnFromUrl);
      setIsSundayLongRun(sundayLongRunFromUrl);
      if (d) setPlanEndDate(d);
      
      initialLoad(planFromUrl, dateFromUrl, unitsFromUrl, weekStartsOnFromUrl, sundayLongRunFromUrl);
    }
  }, [p, d, u, s, m]);

  React.useEffect(() => {
    if (racePlan && w !== undefined && w !== null) {
      const workout = getWorkoutByIndex(racePlan, w);
      if (workout?.steps) {
        const [renderedTitle] = render(
          workout,
          workout.sourceUnits,
          selectedUnits,
        );
        const uint8Array = toFit(workout, renderedTitle);
        if (uint8Array) {
          const fileName = `${renderedTitle.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;
          download(uint8Array, fileName, "fit");
          // Clear the 'w' param so it doesn't re-download on refresh
          setq({ w: undefined }, "replaceIn");
        }
      }
    }
  }, [racePlan, w]);

  function getWorkoutByIndex(plan: RacePlan, index: number) {
    let count = 0;
    for (const week of plan.dateGrid.weeks) {
      for (const day of week.days) {
        if (day.event) {
          if (count === index) {
            return day.event;
          }
          count++;
        }
      }
    }
    return undefined;
  }

  const getParams = (
    units: Units,
    plan: PlanSummary,
    date: Date,
    weekStartsOn: WeekStartsOn,
    sundayLongRun?: boolean,
  ) => {
    return {
      u: units,
      p: plan[0],
      d: date,
      s: weekStartsOn,
      m: sundayLongRun ? 1 : undefined,
    };
  };

  const initialLoad = async (
    plan: PlanSummary,
    endDate: Date,
    units: Units,
    weekStartsOn: WeekStartsOn,
    sundayLongRun?: boolean,
  ) => {
    let racePlan = build(await repo.fetch(plan), endDate, weekStartsOn);
    const shouldShift = plan[0]?.startsWith("mee_") && (sundayLongRun ?? (m === 1));
    if (shouldShift) {
      racePlan = shiftMeeSchedule(racePlan, 1);
    }
    setRacePlan(racePlan);
    setUndoHistory([...undoHistory, racePlan]);
    setq(getParams(units, plan, endDate, weekStartsOn, shouldShift), "replaceIn");
  };

  const onSelectedPlanChange = async (plan: PlanSummary) => {
    const racePlan = build(await repo.fetch(plan), planEndDate, weekStartsOn);
    setSelectedPlan(plan);
    setIsSundayLongRun(false);
    setRacePlan(racePlan);
    setUndoHistory([racePlan]);
    setq(getParams(selectedUnits, plan, planEndDate, weekStartsOn, false));
  };

  const onSelectedEndDateChange = async (date: Date) => {
    let racePlan = build(await repo.fetch(selectedPlan), date, weekStartsOn);
    if (isSundayLongRun && isMeePlan) {
      racePlan = shiftMeeSchedule(racePlan, 1);
    }
    setPlanEndDate(date);
    setRacePlan(racePlan);
    setUndoHistory([racePlan]);
    setq(getParams(selectedUnits, selectedPlan, date, weekStartsOn, isSundayLongRun));
  };

  const onSelectedUnitsChanged = (u: Units) => {
    setSelectedUnits(u);
    setq(getParams(u, selectedPlan, planEndDate, weekStartsOn, isSundayLongRun));
  };

  const onWeekStartsOnChanged = async (v: WeekStartsOn) => {
    let racePlan = build(await repo.fetch(selectedPlan), planEndDate, v);
    if (isSundayLongRun && isMeePlan) {
      racePlan = shiftMeeSchedule(racePlan, 1);
    }
    setWeekStartsOn(v);
    setRacePlan(racePlan);
    setUndoHistory([racePlan]);
    setq(getParams(selectedUnits, selectedPlan, planEndDate, v, isSundayLongRun));
  };

  const onOffsetPlan = (days: number) => {
    if (racePlan) {
      const newRacePlan = offset(racePlan, days);
      setRacePlan(newRacePlan);
      const newEndDate = newRacePlan.planDates.planEndDate;
      setPlanEndDate(newEndDate);
      setUndoHistory([...undoHistory, newRacePlan]);
      setq(getParams(selectedUnits, selectedPlan, newEndDate, weekStartsOn, isSundayLongRun));
    }
  };

  function swapDates(d1: Date, d2: Date): void {
    if (racePlan) {
      const newRacePlan = swap(racePlan, d1, d2);
      setRacePlan(newRacePlan);
      setUndoHistory([...undoHistory, newRacePlan]);
    }
  }

  function doSwapDow(dow1: dayOfWeek, dow2: dayOfWeek) {
    if (racePlan) {
      const newRacePlan = swapDow(racePlan, dow1, dow2);
      setRacePlan(newRacePlan);
      setUndoHistory([...undoHistory, newRacePlan]);
    }
  }

  function toggleMeeScheduleHandler() {
    if (racePlan) {
      const nextShift = !isSundayLongRun;
      const newRacePlan = shiftMeeSchedule(racePlan, nextShift ? 1 : -1);
      setIsSundayLongRun(nextShift);
      setRacePlan(newRacePlan);
      setUndoHistory([...undoHistory, newRacePlan]);
      setq(getParams(selectedUnits, selectedPlan, planEndDate, weekStartsOn, nextShift));
    }
  }

  function downloadIcalHandler() {
    if (racePlan) {
      // Get the base URL including the subpath but excluding the hash/query
      const baseUrl = window.location.href.split('#')[0];
      const eventsStr = toIcal(racePlan, selectedUnits, baseUrl);
      if (eventsStr) {
        download(eventsStr, "plan", "ics");
      }
    }
  }

  function downloadCsvHandler() {
    if (racePlan) {
      const eventsStr = toCsv(racePlan, selectedUnits, weekStartsOn);
      if (eventsStr) {
        download(eventsStr, "plan", "csv");
      }
    }
  }

  function undoHandler() {
    if (undoHistory?.length >= 0) {
      undoHistory.pop();
    }
    const prevPlan = undoHistory[undoHistory.length - 1];
    setRacePlan(prevPlan);
    if (prevPlan) {
      setIsSundayLongRun(!!prevPlan.isSundayLongRun);
      setq(getParams(selectedUnits, selectedPlan, prevPlan.planDates.planEndDate, weekStartsOn, prevPlan.isSundayLongRun));
    }
  }

  return (
    <>
      <PlanAndDate
        availablePlans={repo.available}
        selectedPlan={selectedPlan}
        selectedDate={planEndDate}
        dateChangeHandler={onSelectedEndDateChange}
        selectedPlanChangeHandler={onSelectedPlanChange}
        weekStartsOn={weekStartsOn}
        onOffsetPlan={onOffsetPlan}
      />
      <div className="second-toolbar">
        <div className="units">
          <UnitsButtons
            units={selectedUnits}
            unitsChangeHandler={onSelectedUnitsChanged}
          />
        </div>
      </div>
      <div className="second-toolbar">
        <button className="app-button" onClick={downloadIcalHandler}>
          Download iCal
        </button>
        <button className="app-button" onClick={downloadCsvHandler}>
          Download CSV
        </button>
        <UndoButton
          disabled={undoHistory.length <= 1}
          undoHandler={undoHandler}
        />
      </div>
      <PlanDetailsCard racePlan={racePlan} />
      <div className="second-toolbar">
        <WeekStartsOnPicker
          weekStartsOn={weekStartsOn}
          changeHandler={onWeekStartsOnChanged}
        />
        {isMeePlan && (
          <button className="app-button" onClick={toggleMeeScheduleHandler}>
            {isSundayLongRun ? "Shift Long Run to Saturday" : "Shift Long Run to Sunday"}
          </button>
        )}
      </div>
      <div className="main-ui">
        {racePlan && (
          <CalendarGrid
            racePlan={racePlan}
            units={selectedUnits}
            weekStartsOn={weekStartsOn}
            swapDates={swapDates}
            swapDow={doSwapDow}
          />
        )}
      </div>
    </>
  );
};

export default App;
