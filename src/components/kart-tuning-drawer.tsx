"use client";

import { useEffect, useRef, useState } from "react";

import {
  KART_DEVELOPMENT_VALUE_METADATA,
  type KartDevelopmentValueKey,
  type KartDevelopmentValues,
} from "@/game/kart/kart-development-values";

type TuningField = {
  description?: string;
  key: KartDevelopmentValueKey;
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
      {
        description:
          "Theoretical no-load road speed derived from motor speed, gearing, and driven-wheel radius. Drag and rolling resistance make actual top speed lower.",
        key: "maxForwardSpeed",
        label: "No-load speed",
        unit: "m/s",
      },
      {
        description:
          "Maximum total force the motor can request across the driven wheels at low speed. Actual acceleration emerges from applied force, kart mass, and available tire grip.",
        key: "maximumDriveForce",
        label: "Maximum drive force",
        unit: "N",
      },
      {
        description:
          "Maximum total service-brake force before tire grip limits it. Actual deceleration emerges from applied force and kart mass.",
        key: "maximumBrakingForce",
        label: "Maximum braking force",
        unit: "N",
      },
      {
        description:
          "Derived tire-and-surface resistance coefficient. Rolling force scales with supported load, so mass-proportional force produces mass-independent deceleration.",
        key: "rollingResistanceCoefficient",
        label: "Rolling resistance",
        unit: "ratio",
      },
      {
        description:
          "Effective CdA derived from the construction's projected silhouette, overlap, gaps, and shape coefficients. Air density comes separately from the environment.",
        key: "aerodynamicDragArea",
        label: "Aerodynamic drag area",
        unit: "m²",
      },
      {
        description:
          "World acceleration due to gravity. Earth-standard 9.81 m/s² is environment data, never a kart-authored stat.",
        key: "gravity",
        label: "Gravity",
        unit: "m/s²",
      },
    ],
  },
  {
    label: "Steering",
    fields: [
      {
        description:
          "Largest center-equivalent steering request near a stop. Ackermann geometry derives the sharper inside and gentler outside front-wheel angles.",
        key: "maximumCenterSteerAngle",
        label: "Center steering lock",
        unit: "deg",
      },
    ],
  },
  {
    label: "Tires",
    fields: [
      {
        description:
          "Current tire-and-surface peak force relative to suspension load. The installed tire and contacted material jointly resolve it for each wheel.",
        key: "peakGripCoefficient",
        label: "Peak grip",
        unit: "ratio",
      },
      {
        description:
          "Current tire-and-surface force retained in a fully developed slide. Lower values create looser, longer drifts.",
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
    ],
  },
  {
    defaultOpen: true,
    label: "Drift and braking",
    fields: [
      {
        description:
          "Maximum total handbrake force distributed across the driven rear wheels before tire grip limits it.",
        key: "maximumHandbrakeForce",
        label: "Handbrake force",
        unit: "N",
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
    ],
  },
];

type KartDynamicsDrawerProps = {
  onClose: () => void;
  values: KartDevelopmentValues;
};

function TuningFieldControl({
  field,
  values,
}: {
  field: TuningField;
  values: KartDevelopmentValues;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const tuningValue = values[field.key];
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const metadata = KART_DEVELOPMENT_VALUE_METADATA[field.key];
  const descriptionId = `kart-dynamics-description-${field.key}`;
  const outputId = `kart-dynamics-output-${field.key}`;
  const tooltipId = `kart-dynamics-tooltip-${field.key}`;

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
    >
      <div className="flex min-w-0 items-end justify-between gap-2">
        <span className="min-w-0" id={`${outputId}-label`}>
          {field.label}
        </span>
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
              onKeyDown={(event) => {
                if (event.key !== "Escape") {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                setHelpOpen(false);
              }}
            >
              ?
            </button>
          ) : null}
        </span>
      </div>
      <span
        className="text-[0.52rem] normal-case tracking-normal text-titan-ice/40"
        data-testid={`kart-tuning-owner-${field.key}`}
      >
        {metadata.owner} · {metadata.classification}
      </span>
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
      <output
        aria-describedby={field.description ? descriptionId : undefined}
        aria-labelledby={`${outputId}-label`}
        className="flex h-9 w-full min-w-0 items-center border border-titan-ice/12 bg-titan-black/55 px-2 text-sm font-bold tabular-nums text-titan-ice/86"
        data-testid={`kart-tuning-${field.key}`}
        id={outputId}
      >
        {String(tuningValue)}
      </output>
    </div>
  );
}

function TuningGroupFields({
  group,
  values,
}: {
  group: TuningGroup;
  values: KartDevelopmentValues;
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
            values={values}
          />
        ))}
      </div>
    </details>
  );
}

export function KartDynamicsDrawer({
  onClose,
  values,
}: KartDynamicsDrawerProps) {
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
            Kart dynamics inspector
          </h2>
          <p className="text-[0.65rem] leading-4 text-titan-ice/55">
            Read-only resolved values · T closes
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
        <p className="border border-titan-ice/15 bg-titan-ice/[0.035] p-2 text-[0.63rem] leading-4 text-titan-ice/60">
          Values resolve from kart construction, the environment, contact
          interactions, and the active race ruleset. They cannot be overridden
          here.
        </p>
        {TUNING_GROUPS.map((group) => (
          <TuningGroupFields
            group={group}
            key={group.label}
            values={values}
          />
        ))}
      </div>
    </section>
  );
}
