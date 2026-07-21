import type { KartAssemblyDocument } from "./kart-assembly-document";
import type { ApprovedComponentDefinition } from "./kart-component-registry";
import { getApprovedConstructionMaterial } from "./kart-material-registry";

export type KartVector = { x: number; y: number; z: number };
export type KartMatrix3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type KartBounds = {
  maximum: KartVector;
  minimum: KartVector;
};

export type KartMassElement = {
  bounds: KartBounds;
  center: KartVector;
  inertiaAtCenter: KartMatrix3;
  instanceId: string;
  mass: number;
};

type Shape =
  | {
      axis: "x" | "y" | "z";
      height: number;
      radius: number;
      shape: "cylinder";
    }
  | { shape: "box"; size: KartVector };

type ShapeMassProperties = {
  inertia: KartMatrix3;
  mass: number;
};

const identityMatrix: KartMatrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function addVector(left: KartVector, right: KartVector): KartVector {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

export function subtractVector(
  left: KartVector,
  right: KartVector,
): KartVector {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

export function scaleVector(vector: KartVector, scale: number): KartVector {
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

export function multiplyMatrix(
  left: KartMatrix3,
  right: KartMatrix3,
): KartMatrix3 {
  const result = Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let offset = 0; offset < 3; offset += 1) {
        result[row * 3 + column] +=
          left[row * 3 + offset] * right[offset * 3 + column];
      }
    }
  }
  return result as KartMatrix3;
}

export function transposeMatrix(matrix: KartMatrix3): KartMatrix3 {
  return [
    matrix[0],
    matrix[3],
    matrix[6],
    matrix[1],
    matrix[4],
    matrix[7],
    matrix[2],
    matrix[5],
    matrix[8],
  ];
}

export function transformVector(
  matrix: KartMatrix3,
  vector: KartVector,
): KartVector {
  return {
    x: matrix[0] * vector.x + matrix[1] * vector.y + matrix[2] * vector.z,
    y: matrix[3] * vector.x + matrix[4] * vector.y + matrix[5] * vector.z,
    z: matrix[6] * vector.x + matrix[7] * vector.y + matrix[8] * vector.z,
  };
}

export function rotationMatrix(rotationDegrees: KartVector): KartMatrix3 {
  const halfToRadians = Math.PI / 360;
  const x = rotationDegrees.x * halfToRadians;
  const y = rotationDegrees.y * halfToRadians;
  const z = rotationDegrees.z * halfToRadians;
  const sx = Math.sin(x);
  const cx = Math.cos(x);
  const sy = Math.sin(y);
  const cy = Math.cos(y);
  const sz = Math.sin(z);
  const cz = Math.cos(z);
  const quaternion = {
    w: cx * cy * cz + sx * sy * sz,
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
  };
  const { w, x: qx, y: qy, z: qz } = quaternion;
  return [
    1 - 2 * (qy * qy + qz * qz),
    2 * (qx * qy - qz * w),
    2 * (qx * qz + qy * w),
    2 * (qx * qy + qz * w),
    1 - 2 * (qx * qx + qz * qz),
    2 * (qy * qz - qx * w),
    2 * (qx * qz - qy * w),
    2 * (qy * qz + qx * w),
    1 - 2 * (qx * qx + qy * qy),
  ];
}

function diagonalMatrix(x: number, y: number, z: number): KartMatrix3 {
  return [x, 0, 0, 0, y, 0, 0, 0, z];
}

function subtractMatrix(
  left: KartMatrix3,
  right: KartMatrix3,
): KartMatrix3 {
  return left.map((value, index) => value - right[index]) as KartMatrix3;
}

function scaleMatrix(matrix: KartMatrix3, scale: number): KartMatrix3 {
  return matrix.map((value) => value * scale) as KartMatrix3;
}

function addMatrix(left: KartMatrix3, right: KartMatrix3): KartMatrix3 {
  return left.map((value, index) => value + right[index]) as KartMatrix3;
}

function solidMassProperties(
  shape: Shape,
  density: number,
): ShapeMassProperties {
  if (shape.shape === "box") {
    const mass = shape.size.x * shape.size.y * shape.size.z * density;
    return {
      inertia: diagonalMatrix(
        (mass * (shape.size.y ** 2 + shape.size.z ** 2)) / 12,
        (mass * (shape.size.x ** 2 + shape.size.z ** 2)) / 12,
        (mass * (shape.size.x ** 2 + shape.size.y ** 2)) / 12,
      ),
      mass,
    };
  }

  const mass = Math.PI * shape.radius ** 2 * shape.height * density;
  const axial = 0.5 * mass * shape.radius ** 2;
  const radial =
    (mass * (3 * shape.radius ** 2 + shape.height ** 2)) / 12;
  const values =
    shape.axis === "x"
      ? [axial, radial, radial]
      : shape.axis === "y"
        ? [radial, axial, radial]
        : [radial, radial, axial];
  return { inertia: diagonalMatrix(values[0], values[1], values[2]), mass };
}

function shellMassProperties(
  shape: Shape,
  density: number,
  thickness: number,
): ShapeMassProperties {
  const outer = solidMassProperties(shape, density);
  const innerShape: Shape =
    shape.shape === "box"
      ? {
          shape: "box",
          size: {
            x: shape.size.x - thickness * 2,
            y: shape.size.y - thickness * 2,
            z: shape.size.z - thickness * 2,
          },
        }
      : {
          axis: shape.axis,
          height: shape.height - thickness * 2,
          radius: shape.radius - thickness,
          shape: "cylinder",
        };
  const inner = solidMassProperties(innerShape, density);
  return {
    inertia: subtractMatrix(outer.inertia, inner.inertia),
    mass: outer.mass - inner.mass,
  };
}

function shapeHalfExtents(shape: Shape): KartVector {
  if (shape.shape === "box") return scaleVector(shape.size, 0.5);
  const axialHalf = shape.height * 0.5;
  return {
    x: shape.axis === "x" ? axialHalf : shape.radius,
    y: shape.axis === "y" ? axialHalf : shape.radius,
    z: shape.axis === "z" ? axialHalf : shape.radius,
  };
}

function rotatedBounds(
  center: KartVector,
  rotation: KartMatrix3,
  shape: Shape,
): KartBounds {
  const half = shapeHalfExtents(shape);
  const rotatedHalf = {
    x:
      Math.abs(rotation[0]) * half.x +
      Math.abs(rotation[1]) * half.y +
      Math.abs(rotation[2]) * half.z,
    y:
      Math.abs(rotation[3]) * half.x +
      Math.abs(rotation[4]) * half.y +
      Math.abs(rotation[5]) * half.z,
    z:
      Math.abs(rotation[6]) * half.x +
      Math.abs(rotation[7]) * half.y +
      Math.abs(rotation[8]) * half.z,
  };
  return {
    maximum: addVector(center, rotatedHalf),
    minimum: subtractVector(center, rotatedHalf),
  };
}

function rotateInertia(
  inertia: KartMatrix3,
  rotation: KartMatrix3,
): KartMatrix3 {
  return multiplyMatrix(
    multiplyMatrix(rotation, inertia),
    transposeMatrix(rotation),
  );
}

export function combineBounds(bounds: readonly KartBounds[]): KartBounds {
  return bounds.reduce<KartBounds>(
    (combined, current) => ({
      maximum: {
        x: Math.max(combined.maximum.x, current.maximum.x),
        y: Math.max(combined.maximum.y, current.maximum.y),
        z: Math.max(combined.maximum.z, current.maximum.z),
      },
      minimum: {
        x: Math.min(combined.minimum.x, current.minimum.x),
        y: Math.min(combined.minimum.y, current.minimum.y),
        z: Math.min(combined.minimum.z, current.minimum.z),
      },
    }),
    {
      maximum: { x: -Infinity, y: -Infinity, z: -Infinity },
      minimum: { x: Infinity, y: Infinity, z: Infinity },
    },
  );
}

export function buildPrimitiveMassElement(
  primitive: KartAssemblyDocument["primitiveInstances"][number],
): KartMassElement {
  const material = getApprovedConstructionMaterial(primitive.material);
  if (!material) throw new Error("Validated primitive material is unavailable.");
  const shape: Shape =
    primitive.shape === "box"
      ? { shape: "box", size: primitive.size }
      : {
          axis: primitive.axis,
          height: primitive.height,
          radius: primitive.radius,
          shape: "cylinder",
        };
  const properties =
    primitive.construction.mode === "solid"
      ? solidMassProperties(shape, material.density)
      : shellMassProperties(
          shape,
          material.density,
          primitive.construction.thickness,
        );
  const rotation = rotationMatrix(primitive.transform.rotationDegrees);
  return {
    bounds: rotatedBounds(primitive.transform.position, rotation, shape),
    center: primitive.transform.position,
    inertiaAtCenter: rotateInertia(properties.inertia, rotation),
    instanceId: primitive.id,
    mass: properties.mass,
  };
}

export function buildComponentMassElements(
  instance: KartAssemblyDocument["componentInstances"][number],
  definition: Readonly<ApprovedComponentDefinition>,
): KartMassElement[] {
  const raw = definition.construction.map((construction) => {
    const material = getApprovedConstructionMaterial(construction.material);
    if (!material) throw new Error("Validated component material is unavailable.");
    const shape: Shape =
      construction.shape === "box"
        ? { shape: "box", size: construction.size }
        : {
            axis: construction.axis,
            height: construction.height,
            radius: construction.radius,
            shape: "cylinder",
          };
    return {
      construction,
      properties: solidMassProperties(shape, material.density),
      shape,
    };
  });
  const rawMass = raw.reduce((sum, item) => sum + item.properties.mass, 0);
  const rawCenter = raw.reduce(
    (sum, item) =>
      addVector(
        sum,
        scaleVector(item.construction.transform.position, item.properties.mass),
      ),
    { x: 0, y: 0, z: 0 },
  );
  const normalizedRawCenter = scaleVector(rawCenter, 1 / rawMass);
  const centerCorrection = subtractVector(
    definition.massCenter,
    normalizedRawCenter,
  );
  const massScale = definition.mass / rawMass;
  const instanceRotation = rotationMatrix(instance.transform.rotationDegrees);

  return raw.map(({ construction, properties, shape }) => {
    const localCenter = addVector(
      construction.transform.position,
      centerCorrection,
    );
    const center = addVector(
      instance.transform.position,
      transformVector(instanceRotation, localCenter),
    );
    const localRotation = rotationMatrix(construction.transform.rotationDegrees);
    const rotation = multiplyMatrix(instanceRotation, localRotation);
    return {
      bounds: rotatedBounds(center, rotation, shape),
      center,
      inertiaAtCenter: rotateInertia(
        scaleMatrix(properties.inertia, massScale),
        rotation,
      ),
      instanceId: instance.id,
      mass: properties.mass * massScale,
    };
  });
}

export function deriveMassProperties(elements: readonly KartMassElement[]) {
  const totalMass = elements.reduce((sum, element) => sum + element.mass, 0);
  const centerOfMass = scaleVector(
    elements.reduce(
      (sum, element) =>
        addVector(sum, scaleVector(element.center, element.mass)),
      { x: 0, y: 0, z: 0 },
    ),
    1 / totalMass,
  );
  const inertia = elements.reduce<KartMatrix3>((sum, element) => {
    const offset = subtractVector(element.center, centerOfMass);
    const parallelAxis: KartMatrix3 = [
      element.mass * (offset.y ** 2 + offset.z ** 2),
      -element.mass * offset.x * offset.y,
      -element.mass * offset.x * offset.z,
      -element.mass * offset.y * offset.x,
      element.mass * (offset.x ** 2 + offset.z ** 2),
      -element.mass * offset.y * offset.z,
      -element.mass * offset.z * offset.x,
      -element.mass * offset.z * offset.y,
      element.mass * (offset.x ** 2 + offset.y ** 2),
    ];
    return addMatrix(sum, addMatrix(element.inertiaAtCenter, parallelAxis));
  }, scaleMatrix(identityMatrix, 0));

  return { centerOfMass, inertia, totalMass };
}

export function projectedRectangleUnionArea(bounds: readonly KartBounds[]) {
  const xCoordinates = [...new Set(bounds.flatMap(({ maximum, minimum }) => [
    minimum.x,
    maximum.x,
  ]))].sort((left, right) => left - right);
  let area = 0;
  for (let index = 0; index < xCoordinates.length - 1; index += 1) {
    const x0 = xCoordinates[index];
    const x1 = xCoordinates[index + 1];
    const middle = (x0 + x1) / 2;
    const intervals = bounds
      .filter(({ maximum, minimum }) => minimum.x <= middle && maximum.x >= middle)
      .map(({ maximum, minimum }) => [minimum.y, maximum.y] as const)
      .sort((left, right) => left[0] - right[0]);
    let coveredY = 0;
    let start: number | null = null;
    let end: number | null = null;
    for (const interval of intervals) {
      if (start === null || end === null) {
        [start, end] = interval;
      } else if (interval[0] <= end) {
        end = Math.max(end, interval[1]);
      } else {
        coveredY += end - start;
        [start, end] = interval;
      }
    }
    if (start !== null && end !== null) coveredY += end - start;
    area += (x1 - x0) * coveredY;
  }
  return area;
}
