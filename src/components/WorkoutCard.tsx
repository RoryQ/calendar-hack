import React from "react";
import { render } from "../ch/rendering";
import { Dateline } from "./Dateline";
import { useDrag, DragSourceMonitor } from "react-dnd";
import { ItemTypes } from "../ch/ItemTypes";
import { DragHandle } from "./DragHandle";
import { DayDetails, Units, WorkoutStep } from "types/app";
import { toFit } from "../ch/fitservice";
import { download } from "../ch/downloadservice";

interface Props {
  dayDetails: DayDetails;
  date: Date;
  units: Units;
  swap: (d1: Date, d2: Date) => void;
}

function renderSteps(steps: WorkoutStep[]): React.ReactElement {
  return (
    <ul className="workout-steps">
      {steps.map((step, i) => {
        if (step.type === "repeat") {
          return (
            <li key={i} className="workout-step-repeat">
              <strong>Repeat {step.count}x:</strong>
              {step.steps && renderSteps(step.steps)}
            </li>
          );
        }
        const durationStr = step.duration 
          ? `${step.duration.value} ${step.duration.unit}`
          : "";
        const targetStr = step.target
          ? ` (${step.target.type === 'heart_rate' ? 'HR Zone ' + step.target.zone : step.target.value || step.target.type})`
          : "";
        return (
          <li key={i} className="workout-step">
            <span className="step-type">{step.type}:</span> {step.name || ""} {durationStr} {targetStr}
          </li>
        );
      })}
    </ul>
  );
}

function renderDesc(
  dayDetails: DayDetails,
  from: Units,
  to: Units,
): React.ReactElement {
  let [title, desc] = render(dayDetails, from, to);
  // Only render the description if it differs from the title
  // In the ical file we always render both and we automatically render the description using the same text as title if description is empty
  desc = title.replace(/\s/g, "") === desc.replace(/\s/g, "") ? "" : desc;
  return (
    <>
      <p>
        <span className="workout-title">{title}</span>
      </p>
      {desc && 
        <p>
          <span className="workout-description">{desc}</span>
        </p>
      }
      {dayDetails.steps && renderSteps(dayDetails.steps)}
    </>
  );
}

export const WorkoutCard = ({ dayDetails, date, units }: Props) => {
  const [{ isDragging }, drag, preview] = useDrag({
    type: ItemTypes.DAY,
    item: { date: date, dayDetails: dayDetails, units: units },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
      canDrag: dayDetails !== undefined,
    }),
    end: (item: { date: Date } | undefined, monitor: DragSourceMonitor) => {
      const dropResult = monitor.getDropResult();
      if (item && dropResult) {
      }
    },
  });

  function downloadFitHandler() {
    const [renderedTitle] = render(dayDetails, dayDetails.sourceUnits, units);
    const uint8Array = toFit(dayDetails, renderedTitle);
    if (uint8Array) {
      const fileName = `${renderedTitle.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;
      download(uint8Array, fileName, "fit");
    }
  }

  return (
    <div ref={preview} className={`workout-card ${isDragging ? "dragging" : ""}`}>
      <Dateline $date={date} />
      <div className="workout-content">
        <div ref={drag}>
          <DragHandle viewBox="0 0 32 36" />
        </div>
        {renderDesc(dayDetails, dayDetails.sourceUnits, units)}
        {dayDetails.steps && (
          <button
            className="app-button fit-download-btn"
            onClick={downloadFitHandler}
            title="Download Garmin FIT Workout"
          >
            FIT
          </button>
        )}
      </div>
    </div>
  );
};
