export type KartInertiaTensor = {
  xx: number;
  xy: number;
  xz: number;
  yx: number;
  yy: number;
  yz: number;
  zx: number;
  zy: number;
  zz: number;
};

export type KartInertiaVector = {
  x: number;
  y: number;
  z: number;
};

export type KartQuaternion = {
  w: number;
  x: number;
  y: number;
  z: number;
};

type Matrix3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

const AXIS_PERMUTATIONS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
] as const;
const MAXIMUM_JACOBI_ITERATIONS = 32;

function isFiniteTensor(tensor: KartInertiaTensor) {
  return Object.values(tensor).every(Number.isFinite);
}

function getSymmetricMatrix(tensor: KartInertiaTensor): Matrix3 {
  if (!isFiniteTensor(tensor)) {
    throw new Error("Kart inertia tensor must contain only finite values.");
  }

  const scale = Math.max(
    1,
    ...Object.values(tensor).map((value) => Math.abs(value)),
  );
  const symmetryTolerance = scale * 1e-9;
  if (
    Math.abs(tensor.xy - tensor.yx) > symmetryTolerance ||
    Math.abs(tensor.xz - tensor.zx) > symmetryTolerance ||
    Math.abs(tensor.yz - tensor.zy) > symmetryTolerance
  ) {
    throw new Error("Kart inertia tensor must be symmetric.");
  }

  return [
    [tensor.xx, (tensor.xy + tensor.yx) / 2, (tensor.xz + tensor.zx) / 2],
    [(tensor.xy + tensor.yx) / 2, tensor.yy, (tensor.yz + tensor.zy) / 2],
    [(tensor.xz + tensor.zx) / 2, (tensor.yz + tensor.zy) / 2, tensor.zz],
  ];
}

function identityMatrix(): Matrix3 {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
}

function diagonalizeSymmetricMatrix(input: Matrix3) {
  const matrix = input.map((row) => [...row]) as Matrix3;
  const eigenvectors = identityMatrix();
  const scale = Math.max(
    1,
    Math.abs(matrix[0][0]),
    Math.abs(matrix[1][1]),
    Math.abs(matrix[2][2]),
  );
  const convergenceTolerance = scale * 1e-12;

  for (let iteration = 0; iteration < MAXIMUM_JACOBI_ITERATIONS; iteration += 1) {
    const candidates = [
      { magnitude: Math.abs(matrix[0][1]), p: 0, q: 1 },
      { magnitude: Math.abs(matrix[0][2]), p: 0, q: 2 },
      { magnitude: Math.abs(matrix[1][2]), p: 1, q: 2 },
    ];
    const { magnitude, p, q } = candidates.reduce((largest, candidate) =>
      candidate.magnitude > largest.magnitude ? candidate : largest,
    );
    if (magnitude <= convergenceTolerance) {
      return {
        eigenvalues: [matrix[0][0], matrix[1][1], matrix[2][2]] as const,
        eigenvectors,
      };
    }

    const offDiagonal = matrix[p][q];
    const theta = (matrix[q][q] - matrix[p][p]) / (2 * offDiagonal);
    const tangent =
      (theta >= 0 ? 1 : -1) /
      (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const cosine = 1 / Math.sqrt(tangent * tangent + 1);
    const sine = tangent * cosine;
    const tau = sine / (1 + cosine);
    const diagonalShift = tangent * offDiagonal;

    matrix[p][p] -= diagonalShift;
    matrix[q][q] += diagonalShift;
    matrix[p][q] = 0;
    matrix[q][p] = 0;

    for (let axis = 0; axis < 3; axis += 1) {
      if (axis !== p && axis !== q) {
        const axisP = matrix[axis][p];
        const axisQ = matrix[axis][q];
        matrix[axis][p] = axisP - sine * (axisQ + axisP * tau);
        matrix[p][axis] = matrix[axis][p];
        matrix[axis][q] = axisQ + sine * (axisP - axisQ * tau);
        matrix[q][axis] = matrix[axis][q];
      }

      const vectorP = eigenvectors[axis][p];
      const vectorQ = eigenvectors[axis][q];
      eigenvectors[axis][p] =
        vectorP - sine * (vectorQ + vectorP * tau);
      eigenvectors[axis][q] =
        vectorQ + sine * (vectorP - vectorQ * tau);
    }
  }

  throw new Error("Kart inertia principal-axis solver did not converge.");
}

function determinant(matrix: Matrix3) {
  return (
    matrix[0][0] *
      (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
    matrix[0][1] *
      (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
    matrix[0][2] *
      (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
  );
}

function matrixToQuaternion(matrix: Matrix3): KartQuaternion {
  const trace = matrix[0][0] + matrix[1][1] + matrix[2][2];
  let quaternion: KartQuaternion;

  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    quaternion = {
      w: scale / 4,
      x: (matrix[2][1] - matrix[1][2]) / scale,
      y: (matrix[0][2] - matrix[2][0]) / scale,
      z: (matrix[1][0] - matrix[0][1]) / scale,
    };
  } else if (
    matrix[0][0] > matrix[1][1] &&
    matrix[0][0] > matrix[2][2]
  ) {
    const scale = Math.sqrt(1 + matrix[0][0] - matrix[1][1] - matrix[2][2]) * 2;
    quaternion = {
      w: (matrix[2][1] - matrix[1][2]) / scale,
      x: scale / 4,
      y: (matrix[0][1] + matrix[1][0]) / scale,
      z: (matrix[0][2] + matrix[2][0]) / scale,
    };
  } else if (matrix[1][1] > matrix[2][2]) {
    const scale = Math.sqrt(1 + matrix[1][1] - matrix[0][0] - matrix[2][2]) * 2;
    quaternion = {
      w: (matrix[0][2] - matrix[2][0]) / scale,
      x: (matrix[0][1] + matrix[1][0]) / scale,
      y: scale / 4,
      z: (matrix[1][2] + matrix[2][1]) / scale,
    };
  } else {
    const scale = Math.sqrt(1 + matrix[2][2] - matrix[0][0] - matrix[1][1]) * 2;
    quaternion = {
      w: (matrix[1][0] - matrix[0][1]) / scale,
      x: (matrix[0][2] + matrix[2][0]) / scale,
      y: (matrix[1][2] + matrix[2][1]) / scale,
      z: scale / 4,
    };
  }

  const length = Math.hypot(
    quaternion.x,
    quaternion.y,
    quaternion.z,
    quaternion.w,
  );
  const sign =
    quaternion.w < 0 ||
    (Math.abs(quaternion.w) <= 1e-12 &&
      (quaternion.x < 0 ||
        (Math.abs(quaternion.x) <= 1e-12 &&
          (quaternion.y < 0 ||
            (Math.abs(quaternion.y) <= 1e-12 && quaternion.z < 0)))))
      ? -1
      : 1;

  return {
    w: (quaternion.w / length) * sign,
    x: (quaternion.x / length) * sign,
    y: (quaternion.y / length) * sign,
    z: (quaternion.z / length) * sign,
  };
}

export function multiplyKartInertiaTensor(
  tensor: KartInertiaTensor,
  vector: KartInertiaVector,
): KartInertiaVector {
  return {
    x: tensor.xx * vector.x + tensor.xy * vector.y + tensor.xz * vector.z,
    y: tensor.yx * vector.x + tensor.yy * vector.y + tensor.yz * vector.z,
    z: tensor.zx * vector.x + tensor.zy * vector.y + tensor.zz * vector.z,
  };
}

export function getKartAxisMomentOfInertia(
  tensor: KartInertiaTensor,
  axis: KartInertiaVector,
) {
  const length = Math.hypot(axis.x, axis.y, axis.z);
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error("Kart inertia axis must be finite and non-zero.");
  }
  const normalized = {
    x: axis.x / length,
    y: axis.y / length,
    z: axis.z / length,
  };
  const transformed = multiplyKartInertiaTensor(tensor, normalized);
  return (
    normalized.x * transformed.x +
    normalized.y * transformed.y +
    normalized.z * transformed.z
  );
}

export function deriveKartPrincipalAxes(tensor: KartInertiaTensor) {
  const { eigenvalues, eigenvectors } = diagonalizeSymmetricMatrix(
    getSymmetricMatrix(tensor),
  );
  let selectedPermutation: (typeof AXIS_PERMUTATIONS)[number] =
    AXIS_PERMUTATIONS[0];
  let selectedScore = Number.NEGATIVE_INFINITY;

  for (const permutation of AXIS_PERMUTATIONS) {
    const score =
      Math.abs(eigenvectors[0][permutation[0]]) +
      Math.abs(eigenvectors[1][permutation[1]]) +
      Math.abs(eigenvectors[2][permutation[2]]);
    if (score > selectedScore + 1e-12) {
      selectedPermutation = permutation;
      selectedScore = score;
    }
  }

  const principalToAssembly = identityMatrix();
  const principalMoments = [0, 0, 0];
  for (let principalAxis = 0; principalAxis < 3; principalAxis += 1) {
    const sourceAxis = selectedPermutation[principalAxis];
    const sign = eigenvectors[principalAxis][sourceAxis] < 0 ? -1 : 1;
    principalMoments[principalAxis] = eigenvalues[sourceAxis];
    for (let assemblyAxis = 0; assemblyAxis < 3; assemblyAxis += 1) {
      principalToAssembly[assemblyAxis][principalAxis] =
        eigenvectors[assemblyAxis][sourceAxis] * sign;
    }
  }

  if (determinant(principalToAssembly) < 0) {
    const weakestAxis = [0, 1, 2].reduce((weakest, axis) =>
      Math.abs(principalToAssembly[axis][axis]) <
      Math.abs(principalToAssembly[weakest][weakest])
        ? axis
        : weakest,
    );
    for (let assemblyAxis = 0; assemblyAxis < 3; assemblyAxis += 1) {
      principalToAssembly[assemblyAxis][weakestAxis] *= -1;
    }
  }

  if (principalMoments.some((moment) => !Number.isFinite(moment) || moment <= 0)) {
    throw new Error("Kart inertia tensor must be positive definite.");
  }

  return {
    principalMoments: {
      x: principalMoments[0],
      y: principalMoments[1],
      z: principalMoments[2],
    },
    principalToAssemblyRotation: matrixToQuaternion(principalToAssembly),
  };
}
