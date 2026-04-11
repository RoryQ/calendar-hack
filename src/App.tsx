import React, { useState } from "react";
import { repo } from "./ch/planrepo";
import { endOfWeek, addWeeks, isAfter } from "date-fns";
import { RacePlan } from "./ch/dategrid";
import { build, swap, swapDow, offset } from "./ch/planbuilder";
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
  const [{ u, p, d, s, w }, setq] = useQueryParams({
    u: StringParam,
    p: StringParam,
    d: DateParam,
    s: NumberParam,
    w: NumberParam, // workout index for deep-linking
  });

  const [selectedUnits, setSelectedUnits] = useState<Units>(
    u === "mi" || u === "km" ? u : getLocaleUnits(),
  );
  var [selectedPlan, setSelectedPlan] = useState(repo.find(p || ""));
  var [racePlan, setRacePlan] = useState<RacePlan | undefined>(undefined);
  var [undoHistory, setUndoHistory] = useState([] as RacePlan[]);
  var [weekStartsOn, setWeekStartsOn] = useState<WeekStartsOn>(
    s === 0 || s === 1 || s === 6 ? s : WeekStartsOnValues.Monday,
  );
  var [planEndDate, setPlanEndDate] = useState(
    d && isAfter(d, new Date())
      ? d
      : addWeeks(endOfWeek(new Date(), { weekStartsOn: weekStartsOn }), 20),
  );

  useMountEffect(() => {
    initialLoad(selectedPlan, planEndDate, selectedUnits, weekStartsOn);
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

    if (
      p !== selectedPlan[0] ||
      unitsFromUrl !== selectedUnits ||
      weekStartsOnFromUrl !== weekStartsOn ||
      (d && d.getTime() !== planEndDate.getTime())
    ) {
      setSelectedPlan(planFromUrl);
      setSelectedUnits(unitsFromUrl);
      setWeekStartsOn(weekStartsOnFromUrl);
      if (d) setPlanEndDate(d);
      
      initialLoad(planFromUrl, dateFromUrl, unitsFromUrl, weekStartsOnFromUrl);
    }
  }, [p, d, u, s]);

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
  ) => {
    return {
      u: units,
      p: plan[0],
      d: date,
      s: weekStartsOn,
    };
  };

  const initialLoad = async (
    plan: PlanSummary,
    endDate: Date,
    units: Units,
    weekStartsOn: WeekStartsOn,
  ) => {
    const racePlan = build(await repo.fetch(plan), endDate, weekStartsOn);
    setRacePlan(racePlan);
    setUndoHistory([...undoHistory, racePlan]);
    setq(getParams(units, plan, endDate, weekStartsOn));
  };

  const onSelectedPlanChange = async (plan: PlanSummary) => {
    const racePlan = build(await repo.fetch(plan), planEndDate, weekStartsOn);
    setSelectedPlan(plan);
    setRacePlan(racePlan);
    setUndoHistory([racePlan]);
    setq(getParams(selectedUnits, plan, planEndDate, weekStartsOn));
  };

  const onSelectedEndDateChange = async (date: Date) => {
    const racePlan = build(await repo.fetch(selectedPlan), date, weekStartsOn);
    setPlanEndDate(date);
    setRacePlan(racePlan);
    setUndoHistory([racePlan]);
    setq(getParams(selectedUnits, selectedPlan, date, weekStartsOn));
  };

  const onSelectedUnitsChanged = (u: Units) => {
    setSelectedUnits(u);
    setq(getParams(u, selectedPlan, planEndDate, weekStartsOn));
  };

  const onWeekStartsOnChanged = async (v: WeekStartsOn) => {
    const racePlan = build(await repo.fetch(selectedPlan), planEndDate, v);
    setWeekStartsOn(v);
    setRacePlan(racePlan);
    setUndoHistory([racePlan]);
    setq(getParams(selectedUnits, selectedPlan, planEndDate, v));
  };

  const onOffsetPlan = (days: number) => {
    if (racePlan) {
      const newRacePlan = offset(racePlan, days);
      setRacePlan(newRacePlan);
      const newEndDate = newRacePlan.planDates.planEndDate;
      setPlanEndDate(newEndDate);
      setUndoHistory([...undoHistory, newRacePlan]);
      setq(getParams(selectedUnits, selectedPlan, newEndDate, weekStartsOn));
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
    setRacePlan(undoHistory[undoHistory.length - 1]);
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
