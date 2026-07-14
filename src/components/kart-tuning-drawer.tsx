"use client";

import { useEffect, useRef, useState } from "react";

import type { KartTuning, KartTuningKey } from "@/game/contracts";
import { KART_TUNING_BOUNDS } from "@/game/kart/kart-tuning";

type TuningField = {
  description?: string;
  key: KartTuningKey;
  label: string;
  unit: string;
};

type TuningGroup = {
  defaultOpen?: boolean;
  fields: TuningField[];
  label: string;
};

const TUNING_GROUPS: TuningGroup[] = [
  {
    defaultOpen: true,
    label: "Movement",
    fields: [
      { key: "maxForwardSpeed", label: "Forward speed", unit: "m/s" },
      { key: "maxReverseSpeed", label: "Reverse speed", unit: "m/s" },
      { key: "acceleration", label: "Acceleration", unit: "m/s²" },
      { key: "brakeForce", label: "Brake force", unit: "m/s²" },
      {
        description:
          "Speed below which brake input stops slowing forward motion and can begin applying reverse drive.",
        key: "brakeReverseStopSpeed",
        label: "Brake/reverse stop",
        unit: "m/s",
      },
      {
        description:
          "Passive slowdown while neither throttle nor brakes are applied. Higher values make the kart coast for less time.",
        key: "drag",
        label: "Rolling drag",
        unit: "rate",
      },
      { key: "gravity", label: "Gravity", unit: "m/s²" },
      {
        description:
          "Scales the drive force used in reverse. A value of 1 gives reverse the same acceleration force as forward drive.",
        key: "reverseForceMultiplier",
        label: "Reverse force",
        unit: "ratio",
      },
    ],
  },
  {
    label: "Steering",
    fields: [
      {
        description:
          "How quickly the front wheels move toward the requested steering angle. Higher values feel more immediate.",
        key: "turnRate",
        label: "Steering response",
        unit: "deg/s",
      },
      {
        description:
          "Largest front-wheel steering angle available near a stop. Higher values produce tighter low-speed turns.",
        key: "maximumSteerAngle",
        label: "Low-speed angle",
        unit: "deg",
      },
      {
        description:
          "Steering angle retained at the configured top speed. Lower values make high-speed turns gentler.",
        key: "minimumHighSpeedSteerAngle",
        label: "High-speed angle",
        unit: "deg",
      },
    ],
  },
  {
    label: "Tires",
    fields: [
      {
        description:
          "Maximum tire force relative to suspension load before the tire begins sliding. Higher values provide more cornering grip.",
        key: "peakGripCoefficient",
        label: "Peak grip",
        unit: "ratio",
      },
      {
        description:
          "Tire force retained in a fully developed slide. Lower values create looser, longer drifts.",
        key: "slidingGripCoefficient",
        label: "Sliding grip",
        unit: "ratio",
      },
      {
        description:
          "Slip angle where tire grip begins falling away from its peak value.",
        key: "peakSlipAngleDegrees",
        label: "Peak slip",
        unit: "deg",
      },
      {
        description:
          "Slip angle where the tire reaches its fully sliding grip value. A wider gap from peak slip makes breakaway more gradual.",
        key: "slidingSlipAngleDegrees",
        label: "Sliding slip",
        unit: "deg",
      },
      {
        description:
          "How strongly lateral wheel velocity generates a correcting tire force. Higher values resist sideways motion more aggressively.",
        key: "lateralStiffness",
        label: "Lateral stiffness",
        unit: "N·s/m",
      },
      {
        description:
          "Extra lateral correction used near a stop to keep the kart stable when slip-angle measurements are least reliable.",
        key: "lowSpeedLateralStiffness",
        label: "Low-speed stiffness",
        unit: "N·s/m",
      },
      {
        description:
          "Lateral speed below which the low-speed stiffness value is used instead of normal lateral stiffness.",
        key: "lowSpeedLateralStiffnessThreshold",
        label: "Low-speed crossover",
        unit: "m/s",
      },
      {
        description:
          "Minimum forward-speed reference used when calculating slip angle. Higher values suppress abrupt slip readings near a stop.",
        key: "lowSpeedReference",
        label: "Low-speed reference",
        unit: "m/s",
      },
    ],
  },
  {
    defaultOpen: true,
    label: "Drift and braking",
    fields: [
      {
        description:
          "Scales service-brake force on the driven rear wheels when the handbrake is held.",
        key: "handbrakeForceMultiplier",
        label: "Handbrake force",
        unit: "ratio",
      },
      {
        description:
          "Slip angle where sufficiently hard braking begins reducing available tire grip to encourage a slide.",
        key: "brakingSlideStartAngleDegrees",
        label: "Slide onset",
        unit: "deg",
      },
      {
        description:
          "Brake or handbrake input level where combined-slip reductions begin. A lower value makes partial braking influence drift sooner.",
        key: "brakingSlideStartDemand",
        label: "Brake demand onset",
        unit: "ratio",
      },
      {
        description:
          "Maximum fraction of sliding grip removed by hard braking at high slip. A value of 0.16 removes up to 16 percent.",
        key: "maximumBrakingSlideGripReduction",
        label: "Sliding grip reduction",
        unit: "ratio",
      },
      {
        description:
          "Maximum fraction of lateral correction removed during hard braking. Higher values let sideways velocity persist longer.",
        key: "maximumBrakingLateralStiffnessReduction",
        label: "Lateral reduction",
        unit: "ratio",
      },
      {
        description:
          "Slip angle where hard-braking force begins tapering so the kart can continue sliding instead of stopping abruptly.",
        key: "brakingAssistStartAngleDegrees",
        label: "Brake assist onset",
        unit: "deg",
      },
      {
        description:
          "Slip angle where the configured hard-braking force reduction becomes fully active.",
        key: "brakingAssistFullAngleDegrees",
        label: "Full brake assist",
        unit: "deg",
      },
      {
        description:
          "Maximum fraction of braking force removed at high slip. Higher values preserve more speed through a hard drift.",
        key: "maximumBrakingForceReduction",
        label: "Brake force reduction",
        unit: "ratio",
      },
      {
        description:
          "Moves lateral tire force closer to the chassis center during hard braking. Higher values reduce how strongly a slide rotates the kart.",
        key: "maximumBrakingYawLeverReduction",
        label: "Yaw lever reduction",
        unit: "ratio",
      },
    ],
  },
  {
    label: "Suspension",
    fields: [
      {
        description:
          "Force added per metre of suspension compression. Higher values support the chassis more firmly.",
        key: "suspensionSpringRate",
        label: "Spring rate",
        unit: "N/m",
      },
      {
        description:
          "Force that resists suspension movement. Higher values reduce bouncing but can make impacts feel harsher.",
        key: "suspensionDamperRate",
        label: "Damper rate",
        unit: "N·s/m",
      },
      {
        description:
          "Compression depth where the progressive bump response begins adding extra spring force.",
        key: "suspensionBumpStart",
        label: "Bump onset",
        unit: "m",
      },
      {
        description:
          "Strength of the progressive force near maximum compression. Higher values resist bottoming out more strongly.",
        key: "suspensionBumpRate",
        label: "Bump rate",
        unit: "N/m²",
      },
      {
        description:
          "Upper limit on the force a single wheel suspension can apply to the chassis.",
        key: "maximumSuspensionLoad",
        label: "Maximum load",
        unit: "N",
      },
    ],
  },
  {
    label: "Chassis body",
    fields: [
      {
        description:
          "Physics-engine resistance applied to all chassis translation. Higher values bleed speed continuously.",
        key: "linearDamping",
        label: "Linear damping",
        unit: "ratio",
      },
      {
        description:
          "Physics-engine resistance applied to chassis rotation. Higher values settle spins and rolls faster.",
        key: "angularDamping",
        label: "Angular damping",
        unit: "ratio",
      },
      {
        description:
          "Contact friction used when the chassis body itself touches the course or an obstacle; this is separate from tire grip.",
        key: "chassisFriction",
        label: "Body friction",
        unit: "ratio",
      },
      {
        description:
          "How bouncy direct chassis collisions are. Zero absorbs the normal bounce; higher values return more impact speed.",
        key: "chassisRestitution",
        label: "Body restitution",
        unit: "ratio",
      },
    ],
  },
  {
    label: "Airborne and settling",
    fields: [
      {
        description:
          "Desired nose-up angle while every wheel is airborne. Negative values target a nose-down attitude.",
        key: "airbornePitchTargetDegrees",
        label: "Pitch target",
        unit: "deg",
      },
      {
        description:
          "Strength of the airborne torque pulling the kart toward its pitch target.",
        key: "airbornePitchSpringRate",
        label: "Pitch spring",
        unit: "rate",
      },
      {
        description:
          "Resistance to airborne pitch rotation. Higher values reduce overshoot around the target angle.",
        key: "airbornePitchDampingRate",
        label: "Pitch damping",
        unit: "rate",
      },
      {
        description:
          "Safety clamp on the angular acceleration produced by airborne pitch assistance.",
        key: "airborneMaximumPitchAcceleration",
        label: "Maximum pitch accel",
        unit: "rad/s²",
      },
      {
        description:
          "How quickly small remaining chassis rotation is damped while all wheels are grounded and there is no input.",
        key: "restingAngularSettleRate",
        label: "Rest settling",
        unit: "rate",
      },
      {
        description:
          "Maximum total chassis speed at which the grounded rest-settling assist may activate.",
        key: "restingSettleMaximumLinearSpeed",
        label: "Settle linear limit",
        unit: "m/s",
      },
      {
        description:
          "Maximum vertical speed allowed before rest-settling disengages so impacts and suspension movement remain physical.",
        key: "restingSettleMaximumVerticalSpeed",
        label: "Settle vertical limit",
        unit: "m/s",
      },
      {
        description:
          "Maximum rotational speed at which rest-settling may activate. Faster impacts and spins bypass the assist.",
        key: "restingSettleMaximumAngularSpeed",
        label: "Settle angular limit",
        unit: "rad/s",
      },
    ],
  },
  {
    label: "Drift smoke",
    fields: [
      {
        description:
          "Minimum rear-wheel speed required to begin emitting drift smoke.",
        key: "driftSmokeStartSpeed",
        label: "Start speed",
        unit: "m/s",
      },
      {
        description:
          "Lower speed threshold used to stop existing smoke. Keeping it below start speed prevents rapid flicker.",
        key: "driftSmokeStopSpeed",
        label: "Stop speed",
        unit: "m/s",
      },
      {
        description:
          "Rear-wheel slip angle required to begin emitting light drift smoke.",
        key: "driftSmokeStartSlipAngleDegrees",
        label: "Start slip",
        unit: "deg",
      },
      {
        description:
          "Lower slip threshold used to stop existing smoke, providing hysteresis so the effect does not flicker.",
        key: "driftSmokeStopSlipAngleDegrees",
        label: "Stop slip",
        unit: "deg",
      },
      {
        description:
          "Rear-wheel slip angle where smoke increases to its heavier emission level.",
        key: "heavyDriftSmokeStartSlipAngleDegrees",
        label: "Heavy start",
        unit: "deg",
      },
      {
        description:
          "Lower slip threshold where heavy smoke returns to the light level instead of switching rapidly between them.",
        key: "heavyDriftSmokeStopSlipAngleDegrees",
        label: "Heavy stop",
        unit: "deg",
      },
    ],
  },
];

type KartTuningDrawerProps = {
  onChange: (key: KartTuningKey, value: number) => void;
  onClose: () => void;
  onReset: () => void;
  tuning: KartTuning;
};

function TuningFieldControl({
  field,
  onChange,
  tuning,
}: {
  field: TuningField;
  onChange: KartTuningDrawerProps["onChange"];
  tuning: KartTuning;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const bounds = KART_TUNING_BOUNDS[field.key];
  const descriptionId = `kart-tuning-description-${field.key}`;
  const inputId = `kart-tuning-input-${field.key}`;
  const tooltipId = `kart-tuning-tooltip-${field.key}`;

  useEffect(() => {
    if (!helpOpen) {
      return;
    }
    const dismissHelp = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      setHelpOpen(false);
    };
    const frame = requestAnimationFrame(() =>
      fieldRef.current?.scrollIntoView({ block: "nearest" }),
    );
    window.addEventListener("keydown", dismissHelp, { capture: true });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", dismissHelp, { capture: true });
    };
  }, [helpOpen]);

  return (
    <div
      className="grid min-w-0 content-start gap-1 text-[0.61rem] font-bold uppercase tracking-[0.08em] text-titan-muted"
      ref={fieldRef}
      onPointerLeave={() => {
        if (document.activeElement !== helpButtonRef.current) {
          setHelpOpen(false);
        }
      }}
    >
      <div className="flex min-w-0 items-end justify-between gap-2">
        <label className="min-w-0" htmlFor={inputId}>
          {field.label}
        </label>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-[0.55rem] normal-case tracking-normal text-titan-ice/40">
            {field.unit}
          </span>
          {field.description ? (
            <button
              aria-describedby={helpOpen ? tooltipId : undefined}
              aria-label={`Explain ${field.label}`}
              className="grid size-6 place-items-center rounded-full border border-titan-ice/25 text-[0.58rem] font-black normal-case tracking-normal text-titan-ice/65 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-titan-hazard"
              ref={helpButtonRef}
              type="button"
              onBlur={() => setHelpOpen(false)}
              onClick={() => setHelpOpen(true)}
              onFocus={() => setHelpOpen(true)}
              onPointerEnter={() => setHelpOpen(true)}
            >
              ?
            </button>
          ) : null}
        </span>
      </div>
      {field.description ? (
        <>
          <span className="sr-only" id={descriptionId}>
            {field.description}
          </span>
          {helpOpen ? (
            <p
              className="border border-titan-hazard/35 bg-titan-black/96 p-2 text-[0.63rem] font-medium normal-case leading-4 tracking-normal text-titan-ice/78 shadow-[0_10px_28px_rgb(0_0_0/0.42)]"
              id={tooltipId}
              role="tooltip"
            >
              {field.description}
            </p>
          ) : null}
        </>
      ) : null}
      <input
        aria-describedby={field.description ? descriptionId : undefined}
        className="h-9 w-full min-w-0 border border-titan-ice/20 bg-titan-black px-2 text-sm font-bold tabular-nums text-titan-ice outline-none focus:border-titan-hazard focus:ring-1 focus:ring-titan-hazard"
        data-testid={`kart-tuning-${field.key}`}
        id={inputId}
        inputMode="decimal"
        max={bounds.maximum}
        min={bounds.minimum}
        step={bounds.step}
        type="number"
        value={tuning[field.key]}
        onChange={(event) => {
          if (Number.isFinite(event.currentTarget.valueAsNumber)) {
            onChange(field.key, event.currentTarget.valueAsNumber);
          }
        }}
      />
    </div>
  );
}

function TuningGroupFields({
  group,
  onChange,
  tuning,
}: {
  group: TuningGroup;
  onChange: KartTuningDrawerProps["onChange"];
  tuning: KartTuning;
}) {
  const [open, setOpen] = useState(group.defaultOpen ?? false);

  return (
    <details
      className="border border-titan-ice/15 bg-titan-ice/[0.035]"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.13em] text-titan-ice/78 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-titan-hazard">
        {group.label}
      </summary>
      <div className="grid grid-cols-2 gap-2 border-t border-titan-ice/10 p-2">
        {group.fields.map((field) => (
          <TuningFieldControl
            field={field}
            key={field.key}
            onChange={onChange}
            tuning={tuning}
          />
        ))}
      </div>
    </details>
  );
}

export function KartTuningDrawer({
  onChange,
  onClose,
  onReset,
  tuning,
}: KartTuningDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  return (
    <section
      aria-labelledby="kart-tuning-title"
      className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-[max(0.75rem,env(safe-area-inset-right))] top-[4.25rem] z-[25] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden border border-titan-ice/25 bg-titan-black/94 font-mono text-titan-ice shadow-[0_24px_90px_rgb(0_0_0/0.62)] backdrop-blur"
      id="kart-tuning-drawer"
    >
      <div className="flex items-start justify-between gap-4 border-b border-titan-ice/15 p-3">
        <div className="grid gap-1">
          <h2
            className="text-xs font-black uppercase tracking-[0.16em] text-titan-hazard"
            id="kart-tuning-title"
          >
            Kart tuning
          </h2>
          <p className="text-[0.65rem] leading-4 text-titan-ice/55">
            Live for this race session · T closes
          </p>
        </div>
        <button
          aria-keyshortcuts="T"
          className="border border-titan-ice/20 px-2 py-1 text-[0.65rem] font-bold uppercase tracking-[0.1em] text-titan-ice/80 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-3">
        {TUNING_GROUPS.map((group) => (
          <TuningGroupFields
            group={group}
            key={group.label}
            onChange={onChange}
            tuning={tuning}
          />
        ))}
      </div>

      <div className="border-t border-titan-ice/15 p-3">
        <button
          className="w-full border border-titan-orange bg-titan-orange px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.12em] text-titan-black hover:bg-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
          type="button"
          onClick={onReset}
        >
          Reset all defaults
        </button>
      </div>
    </section>
  );
}
