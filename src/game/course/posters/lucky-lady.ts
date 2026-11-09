// The Lucky Lady: the homebuilt sphere that carries a family out to
// homestead the asteroids in G. K. O'Neill's The High Frontier (1976), as a
// send-off print from Island Three. Drawn in a fixed A1 design space.
export function drawLuckyLadyPoster(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const ink = "#24383d";
  const paper = "#f1e6cb";
  const orange = "#d65e36";
  const blue = "#728e91";
  context.save();
  context.scale(width / 512, height / 724);
  context.fillStyle = paper;
  context.fillRect(0, 0, 512, 724);

  const line = (points: number[][], color = ink, thickness = 3) => {
    context.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = color;
    context.lineWidth = thickness;
    context.stroke();
  };
  const panel = (points: number[][], color: string, thickness = 3) => {
    context.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.fillStyle = color;
    context.fill();
    context.strokeStyle = ink;
    context.lineWidth = thickness;
    context.stroke();
  };
  // Heavy lettering, shrunk to `width` when given.
  const text = (
    value: string,
    x: number,
    y: number,
    size: number,
    color = ink,
    width = Infinity,
  ) => {
    context.fillStyle = color;
    context.font = `900 ${size}px Arial, Helvetica, sans-serif`;
    const measured = context.measureText(value).width;
    if (measured > width) {
      context.font = `900 ${Math.floor((size * width) / measured)}px Arial, Helvetica, sans-serif`;
    }
    context.fillText(value, x, y);
  };
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.lineJoin = "round";
  context.strokeStyle = ink;
  context.lineWidth = 2;
  context.strokeRect(17, 17, 478, 690);
  text("ISLAND THREE  /  EXPERIMENTAL SPACECRAFT ASSN.", 33, 44, 16, ink, 446);
  line([[33, 57], [479, 57]], ink, 2);
  text("THE", 36, 83, 18);
  text("LUCKY", 30, 153, 88, ink, 360);
  text("LADY", 30, 231, 88);
  // The maker's mark echoes the seedling in the ship's greenhouse.
  context.beginPath();
  context.arc(438, 119, 34, 0, Math.PI * 2);
  context.fillStyle = orange;
  context.fill();
  line([[438, 141], [438, 111], [423, 99]], paper, 4);
  line([[438, 124], [454, 108]], paper, 4);

  context.save();
  context.beginPath();
  context.rect(28, 244, 456, 309);
  context.clip();
  // A low sun, rising soil bands, and a single outward trajectory.
  context.beginPath();
  context.arc(288, 391, 143, 0, Math.PI * 2);
  context.fillStyle = orange;
  context.fill();
  line([[45, 515], [460, 279]], ink, 2);
  line([[47, 525], [460, 289]], ink, 1);
  for (let index = 0; index < 4; index += 1) {
    line([[28, 539 + index * 9], [174, 506 + index * 9], [484, 552 + index * 9]], ink, 3);
  }

  // Two small asteroids ahead on her line: where she is bound.
  for (const [x, y, r] of [
    [436, 291, 11],
    [407, 309, 6],
  ]) {
    panel(
      [0, 1, 2, 3, 4, 5, 6].map((corner) => {
        const angle = (corner / 7) * Math.PI * 2;
        const reach = r * (corner % 2 ? 0.78 : 1);
        return [x + Math.cos(angle) * reach, y + Math.sin(angle) * reach];
      }),
      ink,
      1,
    );
  }

  context.save();
  context.translate(262, 394);
  context.rotate(-0.22);
  // Her drive: a small engine on a stub, burning gently, since she never
  // has to lift her own weight.
  for (let puff = 0; puff < 4; puff += 1) {
    line([[-196 - puff * 16, 0], [-186 - puff * 16, 0]], ink, 3);
  }
  panel([[-168, -13], [-186, -21], [-186, 21], [-168, 13]], ink, 3);
  panel([[-168, -19], [-74, -19], [-74, 19], [-168, 19]], paper, 4);
  for (const x of [-146, -122, -98]) line([[x, -19], [x, 19]], ink, 3);
  // The sun-dish on its boom, ribbed like an umbrella, turned to the sun.
  line([[50, -58], [100, -86]], ink, 4);
  context.save();
  context.translate(112, -94);
  context.rotate(-0.95);
  context.beginPath();
  context.ellipse(0, 0, 16, 54, 0, 0, Math.PI * 2);
  context.fillStyle = blue;
  context.fill();
  context.strokeStyle = ink;
  context.lineWidth = 4;
  context.stroke();
  for (let rib = 0; rib < 8; rib += 1) {
    const angle = (rib / 8) * Math.PI * 2;
    line([[0, 0], [Math.cos(angle) * 16, Math.sin(angle) * 54]], paper, 2);
  }
  line([[0, 0], [30, 0]], ink, 2);
  context.restore();
  // The hull: one welded sphere, ten metres across, patched where she was
  // mended, her name painted on by hand.
  context.save();
  context.beginPath();
  context.arc(0, 0, 80, 0, Math.PI * 2);
  context.fillStyle = paper;
  context.fill();
  context.clip();
  for (const [x, y, w, h, color] of [
    [-70, -46, 34, 26, orange],
    [30, 34, 40, 22, blue],
    [-28, 52, 26, 18, orange],
  ] as const) {
    context.fillStyle = color;
    context.fillRect(x, y, w, h);
  }
  context.strokeStyle = ink;
  context.lineWidth = 2;
  for (const y of [-52, -18, 18, 52]) {
    context.beginPath();
    context.ellipse(0, y, 80, 14, 0, 0, Math.PI);
    context.stroke();
  }
  context.beginPath();
  context.ellipse(0, 0, 34, 80, 0, -Math.PI / 2, Math.PI / 2);
  context.stroke();
  context.restore();
  context.beginPath();
  context.arc(0, 0, 80, 0, Math.PI * 2);
  context.strokeStyle = ink;
  context.lineWidth = 4;
  context.stroke();
  context.save();
  context.rotate(-0.12);
  context.textAlign = "center";
  text("LUCKY", -6, -2, 26);
  text("LADY", -2, 24, 26);
  context.restore();
  context.textAlign = "left";
  // Portholes, an airlock below, and an antenna above.
  for (const [x, y] of [
    [42, -30],
    [56, 0],
    [-44, 36],
  ]) {
    context.beginPath();
    context.arc(x, y, 6, 0, Math.PI * 2);
    context.fillStyle = ink;
    context.fill();
  }
  panel([[-14, 78], [14, 78], [14, 96], [-14, 96]], paper, 3);
  line([[-18, -78], [-26, -108], [-6, -116]], ink, 3);
  context.beginPath();
  context.arc(-4, -117, 4, 0, Math.PI * 2);
  context.fillStyle = ink;
  context.fill();
  context.restore();
  context.restore();

  line([[33, 568], [479, 568]], ink, 3);
  text("HOME IS WHAT", 34, 603, 32);
  text("YOU TAKE WITH YOU.", 34, 637, 32);
  context.fillStyle = ink;
  context.font = "18px Arial, Helvetica, sans-serif";
  context.fillText("Built at home on Island Three, she carried one", 34, 666);
  context.fillText("family out to homestead the asteroids.", 34, 688);
  context.restore();
}
