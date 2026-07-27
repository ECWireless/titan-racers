import type { PersistedResolvedKartSnapshot } from "@/game/kart/kart-derivation";
import type { DeepReadonly } from "@/game/kart/immutable-registry";

import { EditorSection } from "./editor/editor-section";

export function KartDerivedEvidence({
  snapshot,
}: {
  snapshot: DeepReadonly<PersistedResolvedKartSnapshot>;
}) {
  const inertia = snapshot.massProperties.inertiaTensor;

  return (
    <>
      <EditorSection title="Derived construction">
        <Readout
          label="Dimensions"
          value={`${formatMeters(snapshot.geometry.dimensions.x)} × ${formatMeters(snapshot.geometry.dimensions.y)} × ${formatMeters(snapshot.geometry.dimensions.z)}`}
        />
        <Readout
          label="Mass"
          value={`${snapshot.massProperties.totalMass.toFixed(3)} kg`}
        />
        <Readout
          label="Center of mass"
          value={`${formatMeters(snapshot.massProperties.centerOfMass.x)}, ${formatMeters(snapshot.massProperties.centerOfMass.y)}, ${formatMeters(snapshot.massProperties.centerOfMass.z)}`}
        />
        <Readout
          label="Inertia diagonal"
          value={`${inertia.xx.toFixed(4)}, ${inertia.yy.toFixed(4)}, ${inertia.zz.toFixed(4)} kg·m²`}
        />
        <Readout
          label="Wheelbase / track"
          value={`${formatMeters(snapshot.geometry.wheelbase)} / ${formatMeters(snapshot.geometry.trackWidth)}`}
        />
      </EditorSection>
      <EditorSection title="Derived runtime behavior">
        <Readout
          label="Drive force"
          value={`${snapshot.physicalProfile.drivetrain.maximumDriveForce.toFixed(2)} N`}
        />
        <Readout
          label="No-load speed"
          value={`${snapshot.physicalProfile.drivetrain.noLoadSpeed.toFixed(2)} m/s`}
        />
        <Readout
          label="Steering lock"
          value={`${snapshot.physicalProfile.steering.maximumCenterAngle.toFixed(2)}°`}
        />
        <Readout
          label="Spring / damper"
          value={`${snapshot.physicalProfile.suspension.springRate.toFixed(1)} N/m · ${snapshot.physicalProfile.suspension.damperRate.toFixed(2)} N·s/m`}
        />
      </EditorSection>
      <EditorSection title="Practical stats">
        <p className="text-xs leading-relaxed text-titan-muted">
          Normalized comparisons derived from acceleration, steering curvature,
          no-load road speed, and static stability.
        </p>
        {Object.entries(snapshot.playerStats).map(([label, value]) => (
          <div className="grid gap-1" key={label}>
            <div className="flex justify-between text-xs">
              <span className="font-bold capitalize">{label}</span>
              <span className="font-mono">{value}/100</span>
            </div>
            <div className="h-2 border border-titan-ice/15 bg-titan-black">
              <div
                className="h-full bg-titan-hazard"
                style={{ width: `${value}%` }}
              />
            </div>
          </div>
        ))}
      </EditorSection>
    </>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-titan-muted">{label}</span>
      <output className="text-right font-mono text-titan-ice">{value}</output>
    </div>
  );
}

function formatMeters(value: number) {
  return `${value.toFixed(3)} m`;
}
