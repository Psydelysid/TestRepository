// Parser for plain-text point clouds exported by LiDAR / photogrammetry tools:
//   .xyz / .txt / .csv  ->  x y z [r g b] [extra...] per line
//   .pts                ->  first line is the point count, then x y z [intensity] [r g b]
// Separators may be spaces, tabs, commas or semicolons. Colors may be 0-255 or 0-1.

export function parsePointCloudText(text, { format = 'xyz' } = {}) {
  const lines = text.split(/\r?\n/);
  const positions = [];
  const colors = [];
  let colorCount = 0;
  let maxColor = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const parts = line.split(/[\s,;]+/);
    // Skip header rows (e.g. "X,Y,Z,R,G,B") and the .pts point-count line.
    if (format === 'pts' && parts.length === 1) continue;
    const nums = parts.map(Number);
    if (nums.length < 3 || !Number.isFinite(nums[0]) || !Number.isFinite(nums[1]) || !Number.isFinite(nums[2])) continue;

    positions.push(nums[0], nums[1], nums[2]);

    const rgb = pickColor(nums, format);
    if (rgb) {
      colors.push(rgb[0], rgb[1], rgb[2]);
      colorCount++;
      maxColor = Math.max(maxColor, rgb[0], rgb[1], rgb[2]);
    } else {
      colors.push(1, 1, 1);
    }
  }

  const count = positions.length / 3;
  const hasColors = count > 0 && colorCount === count;
  let colorArray = null;
  if (hasColors) {
    const scale = maxColor > 1 ? 1 / 255 : 1;
    colorArray = new Float32Array(colors.length);
    for (let i = 0; i < colors.length; i++) colorArray[i] = colors[i] * scale;
  }
  return { positions: new Float32Array(positions), colors: colorArray, count };
}

function pickColor(nums, format) {
  // .pts: x y z intensity r g b
  if (format === 'pts' && nums.length >= 7) return valid(nums.slice(4, 7));
  // x y z r g b
  if (nums.length >= 6) return valid(nums.slice(3, 6));
  return null;
}

function valid(rgb) {
  return rgb.every((v) => Number.isFinite(v) && v >= 0 && v <= 255) ? rgb : null;
}
