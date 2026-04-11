import { DateControl } from "./DateControl";
import PlanPicker from "./PlanPicker";
import { PlanSummary } from "types/app";
import { WeekStartsOn } from "../ch/datecalc";

interface Props {
  availablePlans: PlanSummary[];
  selectedPlan: PlanSummary;
  selectedDate: Date;
  dateChangeHandler: (d: Date) => void;
  selectedPlanChangeHandler: (p: PlanSummary) => void;
  weekStartsOn: WeekStartsOn;
  onOffsetPlan: (days: number) => void;
}

const PlanAndDate = ({
  selectedPlan,
  selectedPlanChangeHandler,
  availablePlans,
  selectedDate,
  dateChangeHandler,
  weekStartsOn,
  onOffsetPlan,
}: Props) => {
  return (
    <div className="plan-and-date">
      <PlanPicker
        availablePlans={availablePlans}
        selectedPlan={selectedPlan}
        planChangeHandler={selectedPlanChangeHandler}
      />
      <h3>ending on</h3>
      <div className="offset-controls">
        <button className="app-button" onClick={() => onOffsetPlan(-1)}>
          {"<"}
        </button>
        <DateControl
          selectedDate={selectedDate}
          onDateChanged={dateChangeHandler}
          weekStartsOn={weekStartsOn}
        />
        <button className="app-button" onClick={() => onOffsetPlan(1)}>
          {">"}
        </button>
      </div>
    </div>
  );
};

export default PlanAndDate;
