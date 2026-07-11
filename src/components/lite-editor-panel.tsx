import type {
  EditableObjectId,
  KartMovementTuning,
  KartMovementTuningKey,
  Position3,
  StartPosition,
  TransformAxis,
} from "@/game/contracts";
import {
  EDITOR_ROTATE_STEP,
  EDITOR_TRANSLATE_STEP,
} from "@/game/editor/editor-config";

const EDITABLE_OBJECT_LABELS: Record<EditableObjectId, string> = {
  "obstacle-barrel-a": "Barrel A",
  "obstacle-barrel-b": "Barrel B",
  "start-position": "Start Position",
  kart: "Kart",
};

const MOVEMENT_FIELDS = [
  ["maxForwardSpeed", "Max", 0.5, 0.5],
  ["acceleration", "Accel", 0.5, 0.5],
  ["brakeForce", "Brake", 0.5, 0.5],
  ["drag", "Drag", 0.1, 0],
  ["turnRate", "Turn", 1, 1],
  ["gravity", "Gravity", 0.5, 0],
] satisfies [KartMovementTuningKey, string, number, number][];

type LiteEditorPanelProps = {
  editorOpen: boolean;
  movementTuning: KartMovementTuning;
  onMovementTuningChange: (
    key: KartMovementTuningKey,
    nextValue: number,
  ) => void;
  onMovementTuningReset: () => void;
  onResetKart: () => void;
  onRotateSelected: (axis: TransformAxis, delta: number) => void;
  onStartPositionChange: (position: StartPosition) => void;
  onStartPositionNudge: (xDelta: number, zDelta: number) => void;
  onToggleEditor: () => void;
  onTranslateSelected: (axis: TransformAxis, delta: number) => void;
  selectedObjectId: EditableObjectId;
  selectedPosition: Position3;
  selectedRotation: Position3;
  startPosition: StartPosition;
};

export function LiteEditorPanel({
  editorOpen,
  movementTuning,
  onMovementTuningChange,
  onMovementTuningReset,
  onResetKart,
  onRotateSelected,
  onStartPositionChange,
  onStartPositionNudge,
  onToggleEditor,
  onTranslateSelected,
  selectedObjectId,
  selectedPosition,
  selectedRotation,
  startPosition,
}: LiteEditorPanelProps) {
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 top-auto z-10 max-h-[42dvh] w-[min(21rem,calc(100vw-2rem))] overflow-y-auto font-mono sm:bottom-auto sm:top-4 sm:max-h-[calc(100dvh-2rem)] sm:overflow-y-auto">
      <div className="pointer-events-auto border border-titan-ice/20 bg-titan-black/82 p-3 shadow-[0_20px_70px_rgb(0_0_0/0.45)] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-titan-hazard">
            Lite Editor
          </p>
          <button
            type="button"
            className="border border-titan-ice/25 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-titan-ice/86 transition hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
            onClick={onToggleEditor}
          >
            {editorOpen ? "Drive" : "Edit"}
          </button>
        </div>

        {editorOpen ? (
          <div className="mt-3 grid gap-3">
            <div className="border border-titan-ice/15 bg-titan-ice/[0.04] px-3 py-2">
              <p className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-titan-muted">
                Selected
              </p>
              <p
                className="mt-1 text-sm font-bold text-titan-ice"
                data-testid="selected-editor-object"
              >
                {EDITABLE_OBJECT_LABELS[selectedObjectId]}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-titan-muted">
                <span data-testid="selected-position-x">
                  X {selectedPosition.x}
                </span>
                <span data-testid="selected-position-y">
                  Y {selectedPosition.y}
                </span>
                <span data-testid="selected-position-z">
                  Z {selectedPosition.z}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-titan-muted">
                <span data-testid="selected-rotation-x">
                  RX {selectedRotation.x}
                </span>
                <span data-testid="selected-rotation-y">
                  RY {selectedRotation.y}
                </span>
                <span data-testid="selected-rotation-z">
                  RZ {selectedRotation.z}
                </span>
              </div>
            </div>

            <TransformControls
              label="Translate"
              step={EDITOR_TRANSLATE_STEP}
              verb="Move"
              onChange={onTranslateSelected}
            />
            <TransformControls
              label="Rotate"
              step={EDITOR_ROTATE_STEP}
              verb="Rotate"
              onChange={onRotateSelected}
            />

            <div className="grid gap-2 border border-titan-ice/15 bg-titan-ice/[0.04] p-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-titan-muted">
                  Movement
                </p>
                <button
                  type="button"
                  className="border border-titan-ice/20 px-2 py-1 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-titan-ice/78 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
                  onClick={onMovementTuningReset}
                >
                  Defaults
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {MOVEMENT_FIELDS.map(([key, label, step, min]) => (
                  <label
                    key={key}
                    className="grid min-w-0 gap-1 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-titan-muted"
                  >
                    {label}
                    <input
                      className="h-9 w-full min-w-0 border border-titan-ice/20 bg-titan-black px-2 text-sm text-titan-ice outline-none focus:border-titan-hazard"
                      data-testid={`movement-${key}`}
                      inputMode="decimal"
                      min={min}
                      type="number"
                      step={step}
                      value={movementTuning[key]}
                      onChange={(event) =>
                        onMovementTuningChange(key, Number(event.target.value))
                      }
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
              <label className="grid min-w-0 gap-1 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-titan-muted">
                X
                <input
                  className="h-10 w-full min-w-0 border border-titan-ice/20 bg-titan-black px-2 text-sm text-titan-ice outline-none focus:border-titan-hazard"
                  data-testid="start-position-x"
                  inputMode="decimal"
                  type="number"
                  step={EDITOR_TRANSLATE_STEP}
                  value={startPosition.x}
                  onChange={(event) =>
                    onStartPositionChange({
                      x: Number(event.target.value),
                      z: startPosition.z,
                    })
                  }
                />
              </label>
              <label className="grid min-w-0 gap-1 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-titan-muted">
                Z
                <input
                  className="h-10 w-full min-w-0 border border-titan-ice/20 bg-titan-black px-2 text-sm text-titan-ice outline-none focus:border-titan-hazard"
                  data-testid="start-position-z"
                  inputMode="decimal"
                  type="number"
                  step={EDITOR_TRANSLATE_STEP}
                  value={startPosition.z}
                  onChange={(event) =>
                    onStartPositionChange({
                      x: startPosition.x,
                      z: Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <span />
              <NudgeButton
                label="Move start position forward"
                onClick={() =>
                  onStartPositionNudge(0, -EDITOR_TRANSLATE_STEP)
                }
              >
                ↑
              </NudgeButton>
              <span />
              <NudgeButton
                label="Move start position left"
                onClick={() =>
                  onStartPositionNudge(-EDITOR_TRANSLATE_STEP, 0)
                }
              >
                ←
              </NudgeButton>
              <button
                type="button"
                className="h-10 border border-titan-orange/70 bg-titan-orange px-2 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-titan-black hover:bg-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
                onClick={onResetKart}
              >
                Reset
              </button>
              <NudgeButton
                label="Move start position right"
                onClick={() =>
                  onStartPositionNudge(EDITOR_TRANSLATE_STEP, 0)
                }
              >
                →
              </NudgeButton>
              <span />
              <NudgeButton
                label="Move start position backward"
                onClick={() =>
                  onStartPositionNudge(0, EDITOR_TRANSLATE_STEP)
                }
              >
                ↓
              </NudgeButton>
              <span />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TransformControls({
  label,
  onChange,
  step,
  verb,
}: {
  label: string;
  onChange: (axis: TransformAxis, delta: number) => void;
  step: number;
  verb: string;
}) {
  return (
    <div className="grid gap-2 border border-titan-ice/15 bg-titan-ice/[0.04] p-2">
      <p className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-titan-muted">
        {label}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {(["x", "y", "z"] satisfies TransformAxis[]).map((axis) => (
          <div key={axis} className="grid grid-cols-2 gap-1">
            <button
              type="button"
              aria-label={`${verb} selected negative ${axis.toUpperCase()}`}
              className="h-9 border border-titan-ice/20 text-xs font-bold uppercase text-titan-ice/86 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
              onClick={() => onChange(axis, -step)}
            >
              {axis}-
            </button>
            <button
              type="button"
              aria-label={`${verb} selected positive ${axis.toUpperCase()}`}
              className="h-9 border border-titan-ice/20 text-xs font-bold uppercase text-titan-ice/86 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
              onClick={() => onChange(axis, step)}
            >
              {axis}+
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function NudgeButton({
  children,
  label,
  onClick,
}: {
  children: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="h-10 border border-titan-ice/20 text-sm font-bold text-titan-ice/86 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
