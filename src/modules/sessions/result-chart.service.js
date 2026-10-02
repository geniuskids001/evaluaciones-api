const zlib = require('zlib');

const FALLBACK_COLORS = ['#2563EB', '#F97316', '#22C55E', '#EAB308', '#8B5CF6', '#06B6D4'];

function safeChart(value) {
  return ['pie', 'bar', 'radar'].includes(value) ? value : 'pie';
}

function parseColor(value, fallback) {
  const match = String(value || '').match(/^#([0-9a-f]{6})$/i);
  const hex = match ? match[1] : fallback.replace('#', '');
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: 255
  };
}

function createRaster(width, height) {
  const pixels = Buffer.alloc(width * height * 4, 255);
  const setPixel = (x, y, color) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const index = (py * width + px) * 4;
    if (color.a === 255) {
      pixels[index] = color.r;
      pixels[index + 1] = color.g;
      pixels[index + 2] = color.b;
      pixels[index + 3] = 255;
      return;
    }
    const alpha = color.a / 255;
    pixels[index] = Math.round(color.r * alpha + pixels[index] * (1 - alpha));
    pixels[index + 1] = Math.round(color.g * alpha + pixels[index + 1] * (1 - alpha));
    pixels[index + 2] = Math.round(color.b * alpha + pixels[index + 2] * (1 - alpha));
    pixels[index + 3] = 255;
  };

  const fillRect = (x, y, w, h, color) => {
    for (let py = Math.max(0, Math.floor(y)); py < Math.min(height, Math.ceil(y + h)); py += 1) {
      for (let px = Math.max(0, Math.floor(x)); px < Math.min(width, Math.ceil(x + w)); px += 1) {
        setPixel(px, py, color);
      }
    }
  };

  const line = (x0, y0, x1, y1, color, thickness = 1) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let step = 0; step <= steps; step += 1) {
      const x = x0 + (dx * step) / steps;
      const y = y0 + (dy * step) / steps;
      const radius = Math.max(0, Math.floor(thickness / 2));
      for (let ox = -radius; ox <= radius; ox += 1) {
        for (let oy = -radius; oy <= radius; oy += 1) setPixel(x + ox, y + oy, color);
      }
    }
  };

  const fillCircle = (cx, cy, radius, color) => {
    const r2 = radius * radius;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) setPixel(x, y, color);
      }
    }
  };

  const fillPolygon = (points, color) => {
    if (points.length < 3) return;
    const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1]))));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(...points.map((p) => p[1]))));
    for (let y = minY; y <= maxY; y += 1) {
      const intersections = [];
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          const x = a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
          intersections.push(x);
        }
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        for (let x = Math.ceil(intersections[i]); x <= Math.floor(intersections[i + 1]); x += 1) {
          setPixel(x, y, color);
        }
      }
    }
  };

  return { pixels, setPixel, fillRect, line, fillCircle, fillPolygon };
}

function dimensionsForChart(dimensions) {
  return (Array.isArray(dimensions) ? dimensions : [])
    .map((dimension, index) => ({
      value: Math.max(0, Number(dimension.valor ?? dimension.porcentaje ?? 0)),
      percentage: Math.max(0, Number(dimension.porcentaje ?? 0)),
      color: parseColor(dimension.color, FALLBACK_COLORS[index % FALLBACK_COLORS.length])
    }))
    .filter((dimension) => Number.isFinite(dimension.value) && Number.isFinite(dimension.percentage));
}

function drawPie(raster, dimensions, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.38;
  const total = dimensions.reduce((sum, dimension) => sum + dimension.value, 0);
  if (total <= 0) return;

  const stops = [];
  let cumulative = 0;
  for (const dimension of dimensions) {
    cumulative += dimension.value / total;
    stops.push({ stop: cumulative * Math.PI * 2, color: dimension.color });
  }

  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      let angle = Math.atan2(dy, dx) + Math.PI / 2;
      if (angle < 0) angle += Math.PI * 2;
      const segment = stops.find((item) => angle <= item.stop) || stops[stops.length - 1];
      raster.setPixel(x, y, segment.color);
    }
  }
}

function drawBars(raster, dimensions, width, height) {
  const marginX = 56;
  const marginY = 42;
  const chartHeight = height - marginY * 2;
  const gap = 18;
  const count = Math.max(1, dimensions.length);
  const barWidth = Math.max(14, (width - marginX * 2 - gap * (count - 1)) / count);
  const maxValue = Math.max(1, ...dimensions.map((dimension) => dimension.value));

  raster.line(marginX, height - marginY, width - marginX, height - marginY, parseColor('#D7E3E8', '#D7E3E8'), 2);
  dimensions.forEach((dimension, index) => {
    const barHeight = (dimension.value / maxValue) * chartHeight;
    const x = marginX + index * (barWidth + gap);
    const y = height - marginY - barHeight;
    raster.fillRect(x, y, barWidth, barHeight, dimension.color);
  });
}

function drawRadar(raster, dimensions, width, height) {
  if (dimensions.length < 3) {
    drawBars(raster, dimensions, width, height);
    return;
  }
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.36;
  const maxValue = Math.max(1, ...dimensions.map((dimension) => dimension.value));
  const gridColor = parseColor('#D7E3E8', '#D7E3E8');
  const polygonColor = { r: 35, g: 138, b: 160, a: 70 };
  const lineColor = parseColor('#238AA0', '#238AA0');

  for (let level = 1; level <= 4; level += 1) {
    const levelRadius = (radius * level) / 4;
    const grid = dimensions.map((_, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / dimensions.length;
      return [cx + Math.cos(angle) * levelRadius, cy + Math.sin(angle) * levelRadius];
    });
    for (let i = 0; i < grid.length; i += 1) {
      const a = grid[i];
      const b = grid[(i + 1) % grid.length];
      raster.line(a[0], a[1], b[0], b[1], gridColor, 1);
    }
  }

  const points = dimensions.map((dimension, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / dimensions.length;
    const outerX = cx + Math.cos(angle) * radius;
    const outerY = cy + Math.sin(angle) * radius;
    raster.line(cx, cy, outerX, outerY, gridColor, 1);
    const valueRadius = radius * (dimension.value / maxValue);
    return [cx + Math.cos(angle) * valueRadius, cy + Math.sin(angle) * valueRadius];
  });

  raster.fillPolygon(points, polygonColor);
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    raster.line(a[0], a[1], b[0], b[1], lineColor, 3);
    raster.fillCircle(a[0], a[1], 6, dimensions[i].color);
  }
}

let crcTable;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
  }
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function renderResultChart(dimensions, chart = 'pie') {
  const normalized = dimensionsForChart(dimensions);
  if (!normalized.length) return null;

  const width = 600;
  const height = 360;
  const raster = createRaster(width, height);
  const type = safeChart(chart);
  if (type === 'bar') drawBars(raster, normalized, width, height);
  else if (type === 'radar') drawRadar(raster, normalized, width, height);
  else drawPie(raster, normalized, width, height);

  return encodePng(width, height, raster.pixels);
}

module.exports = { renderResultChart, safeChart };
