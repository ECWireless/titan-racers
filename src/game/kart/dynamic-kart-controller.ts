import * as pc from "playcanvas";

import type {
  DrivingInput,
  KartController,
  KartControllerState,
} from "../contracts";
import type { WorldEnvironment } from "../physics/world-environment";
import { isDrivableSurfaceTopContact } from "../physics/drivable-surface-support";
import {
  KART_SUSPENSION_MAX_COMPRESSION_Y,
  KART_SUSPENSION_REST_TRAVEL,
  KART_SUSPENSION_TRAVEL,
  KART_WHEEL_RADIUS,
  KART_WHEEL_WIDTH,
} from "./kart-dimensions";
import {
  allocateDriveForce,
  getRequestedDriveForce,
} from "./kart-drive-model";
import {
  getAerodynamicDragForce,
  getRollingResistanceForce,
} from "./kart-coasting-model";
import {
  allocateServiceBrakeForce,
  BRAKE_REVERSE_TRANSITION_SPEED,
  getRequestedBrakingForce,
} from "./kart-brake-model";
import { getSuspensionLoad } from "./kart-suspension-model";
import {
  getFlatGroundedHeaveDampingImpulse,
  getGroundedRollDampingLocalTorqueImpulse,
} from "./kart-grounded-roll-damping";
import {
  getRestSettlingLocalTorqueImpulse,
  isRestSettlingEligible,
  type RestSettlingVector,
} from "./kart-rest-settling";
import {
  getAckermannWheelSteerAngle,
  getActualTurnRadius,
  getGeometricTurnRadius,
  getMaximumSteerAngle,
  getSteeringResponseRate,
  type KartSteeringGeometry,
} from "./kart-steering";
import {
  getLoadDerivedCorneringStiffness,
  getLoadSensitiveGripCoefficient,
  getRequestedLateralTireForce,
  getTireGripCoefficient,
  getTireSlipAngle,
  TRAILING_AXLE_GRIP_SAFETY_RATIO,
} from "./kart-tire-model";
import type { KartPhysicalProfile } from "./kart-physical-profile";
import type { TireSurfaceInteractionProfile } from "./tire-surface-interaction";
import {
  AmmoWheelSweep,
  requireAmmoDynamicsWorld,
} from "../runtime/ammo-wheel-sweep";

export type DynamicWheel = {
  driven: boolean;
  localPosition: pc.Vec3;
  name: string;
  pivot: pc.Entity;
  steered: boolean;
};

type DynamicKartControllerOptions = {
  app: pc.Application;
  environment: WorldEnvironment;
  fallResetY: number;
  kart: pc.Entity;
  localInertia: RestSettlingVector;
  mass: number;
  onFallReset: () => void;
  physicalProfile: KartPhysicalProfile;
  steeringGeometry: KartSteeringGeometry;
  tireSurfaceInteraction: TireSurfaceInteractionProfile;
  wheels: readonly DynamicWheel[];
};

type SupportedWheelForceState = {
  lateralForce: number;
  longitudinalForce: number;
  maximumTireForce: number;
  relativePoint: pc.Vec3;
  telemetry: DynamicWheelTelemetry;
  wheel: DynamicWheel;
  wheelForward: pc.Vec3;
  wheelRight: pc.Vec3;
};

const MINIMUM_WHEEL_SUPPORT_ALIGNMENT = 0.25;

export type DynamicKartControllerState = KartControllerState & {
  actualTurnRadius: number | null;
  geometricTurnRadius: number | null;
  maximumSteerAngle: number;
  supportCount: number;
  supportEntityNames: string[];
  supportedWheelNames: string[];
  wheelTelemetry: DynamicWheelTelemetry[];
  yawRate: number;
};

export type DynamicWheelTelemetry = {
  appliedLateralTireForce: number;
  appliedTireForce: number;
  driven: boolean;
  gripCoefficient: number;
  hubLocalY: number;
  contactNormal: pc.Vec3 | null;
  lateralSpeed: number;
  longitudinalSpeed: number;
  name: string;
  surfaceName: string | null;
  suspensionCompression: number;
  suspensionLoad: number;
  suspensionTravel: number;
  sweepFraction: number | null;
  slipAngle: number;
  steerAngle: number;
  supported: boolean;
  tireForceUtilization: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function approachValue(current: number, target: number, maxDelta: number) {
  if (current < target) {
    return Math.min(current + maxDelta, target);
  }

  return Math.max(current - maxDelta, target);
}

function requireRigidBody(entity: pc.Entity) {
  const rigidBody = entity.rigidbody;

  if (!rigidBody) {
    throw new Error(`Entity ${entity.name} requires a rigid-body component`);
  }

  return rigidBody;
}

export class DynamicKartController implements KartController {
  readonly state: DynamicKartControllerState = {
    actualTurnRadius: null,
    geometricTurnRadius: null,
    maximumSteerAngle: 0,
    speed: 0,
    steerAngle: 0,
    supportCount: 0,
    supportEntityNames: [],
    supportedWheelNames: [],
    verticalVelocity: 0,
    wheelTelemetry: [],
    yawRate: 0,
  };

  private physicalProfile: KartPhysicalProfile;
  private environment: WorldEnvironment;
  private tireSurfaceInteraction: TireSurfaceInteractionProfile;
  private readonly drivenWheelCount: number;
  private readonly steeringCenterX: number;
  private readonly wheelSweep: AmmoWheelSweep;
  private destroyed = false;

  constructor(private readonly options: DynamicKartControllerOptions) {
    this.physicalProfile = options.physicalProfile;
    this.environment = options.environment;
    this.tireSurfaceInteraction = options.tireSurfaceInteraction;
    this.drivenWheelCount = options.wheels.filter(
      (wheel) => wheel.driven,
    ).length;
    const steeredWheels = options.wheels.filter((wheel) => wheel.steered);
    this.steeringCenterX =
      steeredWheels.reduce(
        (total, wheel) => total + wheel.localPosition.x,
        0,
      ) / steeredWheels.length;

    if (this.drivenWheelCount === 0) {
      throw new Error("Dynamic kart requires at least one driven wheel");
    }
    if (steeredWheels.length === 0) {
      throw new Error("Dynamic kart requires at least one steered wheel");
    }

    this.wheelSweep = new AmmoWheelSweep(
      requireAmmoDynamicsWorld(options.app),
      KART_WHEEL_RADIUS,
      KART_WHEEL_WIDTH * 0.5,
    );
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.wheelSweep.destroy();
  }

  reset() {
    const rigidBody = requireRigidBody(this.options.kart);

    rigidBody.linearVelocity = pc.Vec3.ZERO;
    rigidBody.angularVelocity = pc.Vec3.ZERO;
    rigidBody.activate();
    this.state.actualTurnRadius = null;
    this.state.speed = 0;
    this.state.supportCount = 0;
    this.state.geometricTurnRadius = null;
    this.state.supportEntityNames = [];
    this.state.supportedWheelNames = [];
    this.state.verticalVelocity = 0;
    this.state.wheelTelemetry = [];
    this.state.yawRate = 0;
    this.state.maximumSteerAngle = getMaximumSteerAngle(
      0,
      this.physicalProfile.steering,
      this.tireSurfaceInteraction,
      this.environment,
      this.options.steeringGeometry,
    );
    this.setSteerAngle(0);
  }

  setPhysicalProfile(profile: KartPhysicalProfile) {
    this.physicalProfile = profile;
  }

  setEnvironment(environment: WorldEnvironment) {
    this.environment = environment;
  }

  setTireSurfaceInteraction(interaction: TireSurfaceInteractionProfile) {
    this.tireSurfaceInteraction = interaction;
  }

  update(input: DrivingInput, deltaSeconds: number) {
    if (this.destroyed) {
      throw new Error("Cannot update a destroyed dynamic kart controller");
    }

    const { kart } = this.options;
    const rigidBody = requireRigidBody(kart);
    const bodyPosition = kart.getPosition();

    if (bodyPosition.y <= this.options.fallResetY) {
      this.options.onFallReset();
      return;
    }

    const bodyForward = kart.forward.clone().normalize();
    const bodyUp = kart.up.clone().normalize();
    const suspensionDirection = bodyUp.clone().mulScalar(-1);
    const linearVelocity = rigidBody.linearVelocity.clone();
    const angularVelocity = rigidBody.angularVelocity.clone();
    const chassisForwardSpeed = linearVelocity.dot(bodyForward);
    const planarVelocity = new pc.Vec3(
      linearVelocity.x,
      0,
      linearVelocity.z,
    );
    const planarSpeed = planarVelocity.length();
    if (planarSpeed > 0) {
      const aerodynamicDragForce = getAerodynamicDragForce(
        planarSpeed,
        this.physicalProfile.aerodynamics.dragArea,
        this.environment.airDensity,
      );
      rigidBody.applyForce(
        planarVelocity.mulScalar(-aerodynamicDragForce / planarSpeed),
      );
    }
    const maximumSteerAngle = getMaximumSteerAngle(
      chassisForwardSpeed,
      this.physicalProfile.steering,
      this.tireSurfaceInteraction,
      this.environment,
      this.options.steeringGeometry,
    );
    this.state.maximumSteerAngle = maximumSteerAngle;

    this.setSteerAngle(
      approachValue(
        this.state.steerAngle,
        input.steer * maximumSteerAngle,
        getSteeringResponseRate(maximumSteerAngle) * deltaSeconds,
      ),
    );

    let supportCount = 0;
    const supportEntityNames: string[] = [];
    const supportedWheelNames: string[] = [];
    const supportedWheelForceStates: SupportedWheelForceState[] = [];
    const wheelTelemetry: DynamicWheelTelemetry[] = [];
    const worldTransform = kart.getWorldTransform();
    const brakingForwardMotion =
      input.brake > 0 &&
      chassisForwardSpeed > BRAKE_REVERSE_TRANSITION_SPEED;
    const handbrakingMotion =
      input.handbrake > 0 &&
      Math.abs(chassisForwardSpeed) > BRAKE_REVERSE_TRANSITION_SPEED;
    for (const wheel of this.options.wheels) {
      const telemetry: DynamicWheelTelemetry = {
        appliedLateralTireForce: 0,
        appliedTireForce: 0,
        driven: wheel.driven,
        gripCoefficient: 0,
        hubLocalY: KART_SUSPENSION_MAX_COMPRESSION_Y - KART_SUSPENSION_TRAVEL,
        contactNormal: null,
        lateralSpeed: 0,
        longitudinalSpeed: 0,
        name: wheel.name,
        surfaceName: null,
        suspensionCompression: 0,
        suspensionLoad: 0,
        suspensionTravel: KART_SUSPENSION_TRAVEL,
        slipAngle: 0,
        steerAngle: 0,
        supported: false,
        sweepFraction: null,
        tireForceUtilization: 0,
      };

      wheelTelemetry.push(telemetry);
      const maximumCompressionPosition = wheel.localPosition.clone();
      maximumCompressionPosition.y =
        wheel.localPosition.y + KART_SUSPENSION_REST_TRAVEL;
      const queryStart = worldTransform.transformPoint(
        maximumCompressionPosition,
      );
      const queryTravel = KART_SUSPENSION_TRAVEL;
      const queryEnd = queryStart
        .clone()
        .add(suspensionDirection.clone().mulScalar(queryTravel));
      const steerAngle = this.getWheelSteerAngle(wheel);
      telemetry.steerAngle = steerAngle;
      const sweepRotation = new pc.Quat().mul2(
        kart.getRotation(),
        new pc.Quat().setFromEulerAngles(0, steerAngle, 0),
      );
      const hit = this.wheelSweep.sweep(queryStart, queryEnd, sweepRotation);

      if (!hit) {
        continue;
      }

      const suspensionTravel = clamp(
        hit.fraction * queryTravel,
        0,
        KART_SUSPENSION_TRAVEL,
      );
      const compression = Math.max(
        KART_SUSPENSION_REST_TRAVEL - suspensionTravel,
        0,
      );
      telemetry.surfaceName = hit.entity.name;
      telemetry.hubLocalY =
        KART_SUSPENSION_MAX_COMPRESSION_Y - suspensionTravel;
      telemetry.suspensionCompression = compression;
      telemetry.suspensionTravel = suspensionTravel;
      telemetry.sweepFraction = hit.fraction;

      if (compression <= 0) {
        continue;
      }

      if (!isDrivableSurfaceTopContact(hit.entity, hit.point)) {
        // Stable authored support axes prevent finite-wheel edge normals from
        // manufacturing suspension spikes, but only an actual top/cap hit may
        // opt into that replacement. Primitive sides and undersides remain
        // non-drivable.
        continue;
      }

      // Demo drivable primitives expose their intended top face through the
      // entity transform. Ammo's finite-cylinder sweep normal can come from a
      // wheel edge even on a flat box, so use the authored support axis for
      // boxes, ramps, and cylinder caps; their side faces are non-supporting.
      const contactNormal = hit.entity.up.clone().normalize();
      if (contactNormal.dot(suspensionDirection) > 0) {
        // Drivable support is one-sided. Ammo can alternate the normal of a
        // thin box when a finite sweep begins close to its top face, so orient
        // that normal against the downward suspension sweep before using it.
        contactNormal.mulScalar(-1);
      }
      telemetry.contactNormal = contactNormal.clone();
      if (contactNormal.dot(bodyUp) <= MINIMUM_WHEEL_SUPPORT_ALIGNMENT) {
        // Convex sweeps can report the back face of a thin surface when the
        // wheel starts close to it. A surface facing with/away from suspension
        // travel cannot physically carry the kart and must not apply force.
        continue;
      }
      const wheelCenter = new pc.Vec3().lerp(
        queryStart,
        queryEnd,
        hit.fraction,
      );
      const stableContactPoint = wheelCenter
        .clone()
        .sub(contactNormal.clone().mulScalar(KART_WHEEL_RADIUS));
      const relativePoint = stableContactPoint.sub(bodyPosition);
      const angularPointVelocity = new pc.Vec3().cross(
        angularVelocity,
        relativePoint,
      );
      const pointVelocity = linearVelocity.clone().add(angularPointVelocity);
      // A damper reacts to motion along its strut. Using the contact normal
      // here lets a tilted/edge normal turn forward travel into false damper
      // compression and manufacture a destabilizing suspension-load spike.
      const suspensionSpeed = pointVelocity.dot(bodyUp);
      const suspensionLoad = getSuspensionLoad(
        compression,
        suspensionSpeed,
        this.physicalProfile.suspension,
      );

      if (suspensionLoad <= 0) {
        continue;
      }

      telemetry.supported = true;
      telemetry.suspensionLoad = suspensionLoad;
      supportCount += 1;
      supportEntityNames.push(hit.entity.name);
      supportedWheelNames.push(wheel.name);
      rigidBody.applyForce(
        contactNormal.clone().mulScalar(suspensionLoad),
        relativePoint,
      );

      const wheelForward = this.getWheelForward(
        bodyForward,
        contactNormal,
        steerAngle,
      );
      const wheelRight = new pc.Vec3()
        .cross(wheelForward, contactNormal)
        .normalize();
      const longitudinalSpeed = pointVelocity.dot(wheelForward);
      const lateralSpeed = pointVelocity.dot(wheelRight);

      telemetry.longitudinalSpeed = longitudinalSpeed;
      telemetry.lateralSpeed = lateralSpeed;
      const slipAngle = getTireSlipAngle(longitudinalSpeed, lateralSpeed);
      const gripCoefficient = getTireGripCoefficient(
        slipAngle,
        this.tireSurfaceInteraction,
      );
      const movingInReverse =
        chassisForwardSpeed < -BRAKE_REVERSE_TRANSITION_SPEED;
      const wheelIsOnTrailingAxle = movingInReverse
        ? wheel.steered
        : !wheel.steered;
      const gripSafetyRatio = wheelIsOnTrailingAxle
        ? TRAILING_AXLE_GRIP_SAFETY_RATIO
        : 1;
      const referenceWheelLoad =
        (this.options.mass * this.environment.gravity) /
        this.options.wheels.length;
      const effectiveGripCoefficient = getLoadSensitiveGripCoefficient(
        gripCoefficient * gripSafetyRatio,
        suspensionLoad,
        referenceWheelLoad,
      );
      const effectivePeakGripCoefficient = getLoadSensitiveGripCoefficient(
        this.tireSurfaceInteraction.peakGripCoefficient * gripSafetyRatio,
        suspensionLoad,
        referenceWheelLoad,
      );
      const maximumTireForce = suspensionLoad * effectiveGripCoefficient;
      telemetry.slipAngle = slipAngle;
      telemetry.gripCoefficient = effectiveGripCoefficient;
      let longitudinalForce = getRollingResistanceForce(
        longitudinalSpeed,
        suspensionLoad,
        this.tireSurfaceInteraction.rollingResistanceCoefficient,
      );

      if (
        handbrakingMotion &&
        wheel.driven &&
        Math.abs(longitudinalSpeed) > BRAKE_REVERSE_TRANSITION_SPEED
      ) {
        longitudinalForce +=
          -Math.sign(longitudinalSpeed) *
          (getRequestedBrakingForce(
            input.handbrake,
            this.physicalProfile.brakes.maximumHandbrakeForce,
          ) /
            this.drivenWheelCount);
      }

      const lateralForce = getRequestedLateralTireForce(
        slipAngle,
        longitudinalSpeed,
        lateralSpeed,
        getLoadDerivedCorneringStiffness(
          effectivePeakGripCoefficient,
          suspensionLoad,
          this.tireSurfaceInteraction.peakSlipAngleDegrees,
        ),
        this.options.mass / this.options.wheels.length,
      );

      supportedWheelForceStates.push({
        lateralForce,
        longitudinalForce,
        maximumTireForce,
        relativePoint,
        telemetry,
        wheel,
        wheelForward,
        wheelRight,
      });
    }

    const requestedDriveForce =
      input.throttle !== 0 &&
      // Input sources may deliberately overlap positive drive and braking.
      // Reverse still waits for forward motion to stop.
      (!brakingForwardMotion || input.throttle > 0)
        ? getRequestedDriveForce(
            input.throttle,
            chassisForwardSpeed,
            this.physicalProfile.drivetrain,
          )
        : 0;
    const allocatedDriveForces = allocateDriveForce(
      requestedDriveForce,
      supportedWheelForceStates.map(({ maximumTireForce, wheel }) =>
        wheel.driven ? maximumTireForce : 0,
      ),
      this.drivenWheelCount,
    );
    const allocatedServiceBrakeForces = allocateServiceBrakeForce(
      brakingForwardMotion
        ? getRequestedBrakingForce(
            input.brake,
            this.physicalProfile.brakes.maximumServiceBrakeForce,
          )
        : 0,
      supportedWheelForceStates.map(
        ({ telemetry }) => telemetry.suspensionLoad,
      ),
    );

    supportedWheelForceStates.forEach((wheelState, index) => {
      const {
        lateralForce,
        maximumTireForce,
        relativePoint,
        telemetry,
        wheelForward,
        wheelRight,
      } = wheelState;
      const longitudinalForce =
        wheelState.longitudinalForce +
        allocatedDriveForces[index] -
        Math.sign(telemetry.longitudinalSpeed) *
          allocatedServiceBrakeForces[index];
      const longitudinalTireForce = wheelForward
        .clone()
        .mulScalar(longitudinalForce);
      const lateralTireForce = wheelRight.clone().mulScalar(lateralForce);
      const tireForce = longitudinalTireForce.clone().add(lateralTireForce);
      const requestedTireForce = tireForce.length();

      if (requestedTireForce > maximumTireForce) {
        const forceScale = maximumTireForce / requestedTireForce;
        longitudinalTireForce.mulScalar(forceScale);
        lateralTireForce.mulScalar(forceScale);
        tireForce.mulScalar(forceScale);
      }

      telemetry.appliedLateralTireForce = lateralTireForce.dot(wheelRight);
      telemetry.appliedTireForce = tireForce.length();
      telemetry.tireForceUtilization =
        maximumTireForce > 0
          ? Math.min(requestedTireForce / maximumTireForce, 1)
          : 0;
      rigidBody.applyForce(longitudinalTireForce, relativePoint);
      rigidBody.applyForce(lateralTireForce, relativePoint);
    });

    this.state.speed = chassisForwardSpeed;
    this.state.yawRate = angularVelocity.dot(bodyUp);
    this.state.geometricTurnRadius = getGeometricTurnRadius(
      this.state.steerAngle,
      this.options.steeringGeometry.wheelbase,
    );
    this.state.actualTurnRadius = getActualTurnRadius(
      chassisForwardSpeed,
      this.state.yawRate,
    );
    this.state.supportCount = supportCount;
    this.state.supportEntityNames = supportEntityNames;
    this.state.supportedWheelNames = supportedWheelNames;
    this.state.verticalVelocity = linearVelocity.y;
    this.state.wheelTelemetry = wheelTelemetry;
  }

  postUpdate(input: DrivingInput, deltaSeconds: number) {
    const rigidBody = requireRigidBody(this.options.kart);
    const linearVelocity = rigidBody.linearVelocity.clone();
    const angularVelocity = rigidBody.angularVelocity.clone();

    const hasDrivingInput =
      input.brake !== 0 ||
      input.handbrake !== 0 ||
      input.steer !== 0 ||
      input.throttle !== 0;
    const isRestingWithoutInput = isRestSettlingEligible(
      linearVelocity,
      angularVelocity,
      this.state.supportCount === this.options.wheels.length,
      hasDrivingInput,
    );
    const rotation = this.options.kart.getRotation();
    const localAngularVelocity = rotation
      .clone()
      .invert()
      .transformVector(angularVelocity);
    const localRollDampingImpulse =
      getGroundedRollDampingLocalTorqueImpulse(
        localAngularVelocity,
        this.options.localInertia,
        this.state.supportCount,
        deltaSeconds,
      );
    const worldRollDampingImpulse = rotation.transformVector(
      new pc.Vec3(
        localRollDampingImpulse.x,
        localRollDampingImpulse.y,
        localRollDampingImpulse.z,
      ),
    );
    rigidBody.applyTorqueImpulse(
      worldRollDampingImpulse.x,
      worldRollDampingImpulse.y,
      worldRollDampingImpulse.z,
    );
    const minimumSupportNormalY = this.state.wheelTelemetry.reduce(
      (minimum, wheel) =>
        wheel.supported && wheel.contactNormal
          ? Math.min(minimum, wheel.contactNormal.y)
          : minimum,
      1,
    );
    const heaveDampingImpulse = getFlatGroundedHeaveDampingImpulse(
      linearVelocity.y,
      this.options.mass,
      this.state.supportCount,
      minimumSupportNormalY,
      this.options.kart.up.y,
      deltaSeconds,
    );
    rigidBody.applyImpulse(0, heaveDampingImpulse, 0);

    if (isRestingWithoutInput) {
      // Finite wheel sweeps can alternate between coplanar course primitives at
      // rest. Settle only that low-energy grounded regime; any input, impact,
      // vertical motion, or larger rotation releases this policy immediately.
      const localTorqueImpulse = getRestSettlingLocalTorqueImpulse(
        localAngularVelocity,
        this.options.localInertia,
        deltaSeconds,
      );
      const worldTorqueImpulse = rotation.transformVector(
        new pc.Vec3(
          localTorqueImpulse.x,
          localTorqueImpulse.y,
          localTorqueImpulse.z,
        ),
      );
      rigidBody.applyTorqueImpulse(
        worldTorqueImpulse.x,
        worldTorqueImpulse.y,
        worldTorqueImpulse.z,
      );
    }

    const observedLinearVelocity = rigidBody.linearVelocity.clone();
    const observedAngularVelocity = rigidBody.angularVelocity.clone();
    const bodyForward = this.options.kart.forward.clone().normalize();
    const bodyUp = this.options.kart.up.clone().normalize();
    this.state.speed = observedLinearVelocity.dot(bodyForward);
    this.state.verticalVelocity = observedLinearVelocity.y;
    this.state.yawRate = observedAngularVelocity.dot(bodyUp);
    this.state.geometricTurnRadius = getGeometricTurnRadius(
      this.state.steerAngle,
      this.options.steeringGeometry.wheelbase,
    );
    this.state.actualTurnRadius = getActualTurnRadius(
      this.state.speed,
      this.state.yawRate,
    );
  }

  private getWheelForward(
    bodyForward: pc.Vec3,
    contactNormal: pc.Vec3,
    steerAngle: number,
  ) {
    const steeringRotation = new pc.Quat().setFromAxisAngle(
      contactNormal,
      steerAngle,
    );
    const steeredForward = steeringRotation.transformVector(bodyForward);
    const normalComponent = contactNormal
      .clone()
      .mulScalar(steeredForward.dot(contactNormal));

    return steeredForward.sub(normalComponent).normalize();
  }

  private setSteerAngle(steerAngle: number) {
    this.state.steerAngle = steerAngle;

    this.options.wheels.forEach((wheel) => {
      if (wheel.steered) {
        wheel.pivot.setLocalEulerAngles(
          0,
          this.getWheelSteerAngle(wheel),
          0,
        );
      }
    });
  }

  private getWheelSteerAngle(wheel: DynamicWheel) {
    if (!wheel.steered) {
      return 0;
    }

    return getAckermannWheelSteerAngle(
      this.state.steerAngle,
      wheel.localPosition.x - this.steeringCenterX,
      this.options.steeringGeometry,
    );
  }
}
