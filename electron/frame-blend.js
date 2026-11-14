'use strict';

/**
 * Vegas-style frame blending ("resample") for high frame rate footage.
 *
 * Model — the one Sony / MAGIX Vegas applies when it resamples a clip onto a slower timeline:
 * every source frame lasts one source-frame period centred on its timestamp, and every output
 * frame is the average of the source over one output-frame period centred on the output
 * timestamp. A source frame's weight is its temporal overlap with that window:
 *
 *   240 -> 60 fps : 1 2 2 2 1   (even ratio: the two edge frames are shared half / half)
 *   180 -> 60 fps : 1 1 1       (odd ratio: whole frames only)
 *   120 -> 60 fps : 1 2 1
 *   144 -> 60 fps : 2.4 source frames per output frame, weights change frame by frame
 *
 * Implementation — the stream is conformed to a constant grid of "slots" in which a source frame
 * occupies P slots and an output frame spans Q slots (grid rate = Q x output rate). Any rational
 * ratio Q/P then becomes a plain decimation by Q with fixed integer weights, and the conform step
 * is timestamp driven, so variable frame rate recordings blend correctly too.
 *
 * Blending runs on the decoder's native pixel format. Averaging is linear and Y'CbCr <-> R'G'B'
 * is affine, so this equals the gamma-space RGB blend of an 8-bit Vegas project.
 */

const OUTPUT_FPS = 60;
/** Below this there is not enough temporal information to blend into 60 fps. */
const MIN_SOURCE_FPS = 90;
/** At or above this the decode load is no longer reasonable; the option is refused. */
const MAX_SOURCE_FPS = 360;

const MAX_SLOTS_PER_SOURCE_FRAME = 12;
const MAX_SLOTS_PER_OUTPUT_FRAME = 32;
/** Rates within this relative distance of a grid ratio are considered an exact match. */
const EXACT_RATIO_TOLERANCE = 0.002;

const ENGINE_POLYPHASE = 'polyphase';
const ENGINE_TMIX = 'tmix';

function parseFrameRate(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0;
  if (typeof value !== 'string') return 0;
  const [num, den = 1] = value.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return 0;
  return num / den;
}

/**
 * Picks the frame rate the footage was shot at from ffprobe's two estimates. `r_frame_rate` is the
 * timestamp grid (what we want for recordings that drop the odd frame) but degenerates to values
 * like 1000 on some variable frame rate files, in which case the measured average is used.
 */
function resolveSourceFps(rFrameRate, avgFrameRate) {
  const r = parseFrameRate(rFrameRate);
  const avg = parseFrameRate(avgFrameRate);
  if (!r) return avg;
  if (!avg) return r <= 1000 ? r : 0;
  const plausible = r <= 1000 && r >= avg * 0.98 && r <= avg * 2.5;
  return plausible ? r : avg;
}

function formatFps(fps) {
  return String(Math.round(fps * 100) / 100);
}

function getBlendEligibility(sourceFps) {
  if (!Number.isFinite(sourceFps) || sourceFps <= 0) {
    return { eligible: false, code: 'unknown', reason: 'The frame rate of this clip could not be determined.' };
  }
  // Compare on a rounded value so 89.99 or 359.997 land on the side their nominal rate belongs to.
  const fps = Math.round(sourceFps * 100) / 100;
  if (fps < MIN_SOURCE_FPS) {
    return {
      eligible: false,
      code: 'too-low',
      reason: `Needs a source of at least ${MIN_SOURCE_FPS} fps — this clip is ${formatFps(fps)} fps, so there are no extra frames to blend.`,
    };
  }
  if (fps >= MAX_SOURCE_FPS) {
    return {
      eligible: false,
      code: 'too-high',
      reason: `Sources at ${MAX_SOURCE_FPS} fps or above are not supported — this clip is ${formatFps(fps)} fps.`,
    };
  }
  return { eligible: true, code: 'ok', reason: '' };
}

/** 119.88 / 239.76 ... : integer rates scaled by 1000/1001. They blend onto 59.94 instead of 60. */
function isNtscRate(fps) {
  const scaled = fps * 1.001;
  return Math.abs(scaled - Math.round(scaled)) < 0.002 && Math.abs(fps - Math.round(fps)) > 0.02;
}

/** Best Q/P approximation of `ratio` (source frames per output frame) that keeps the graph small. */
function resolveGrid(ratio) {
  let best = null;
  for (let p = 1; p <= MAX_SLOTS_PER_SOURCE_FRAME; p++) {
    const q = Math.max(1, Math.round(ratio * p));
    if (q > MAX_SLOTS_PER_OUTPUT_FRAME) break;
    const error = Math.abs(q / p - ratio);
    if (!best || error < best.error - 1e-9) best = { p, q, error };
  }
  return best;
}

/**
 * Slot window of one output frame, as taps over Q (or Q + 1) consecutive slots.
 * When Q - P is odd the centred window ends on half slots, which is expressed by doubling every
 * weight and letting the two edge slots count once.
 */
function computeTaps(p, q) {
  const span = q - p;
  const halfSlotEdges = span % 2 !== 0;
  return {
    padStart: halfSlotEdges ? (span + 1) / 2 : span / 2,
    weights: halfSlotEdges
      ? Array.from({ length: q + 1 }, (_, i) => (i === 0 || i === q ? 1 : 2))
      : new Array(q).fill(1),
  };
}

/**
 * Builds the blending plan for a clip.
 * @param {{ sourceFps: number, speed?: number }} params `speed` is the playback rate applied
 *   before blending (2 = twice as fast, i.e. twice as many source frames per output frame).
 */
function planFrameBlend({ sourceFps, speed = 1 }) {
  const eligibility = getBlendEligibility(sourceFps);
  if (!eligibility.eligible) return { ok: false, ...eligibility };

  const playbackRate = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const ntsc = isNtscRate(sourceFps);
  const nominalFps = ntsc ? sourceFps * 1.001 : sourceFps;
  const ratio = (nominalFps * playbackRate) / OUTPUT_FPS;
  const grid = resolveGrid(ratio);

  const rate = (multiplier) => (ntsc ? `${OUTPUT_FPS * 1000 * multiplier}/1001` : String(OUTPUT_FPS * multiplier));
  const plan = {
    ok: true,
    sourceFps,
    speed: playbackRate,
    outputFps: ntsc ? (OUTPUT_FPS * 1000) / 1001 : OUTPUT_FPS,
    outputRate: rate(1),
  };

  // At or below one source frame per output frame there is nothing to merge: conform only.
  if (grid.q <= grid.p) {
    return { ...plan, blend: false, framesPerOutput: 1, exact: true, weights: [1] };
  }

  return {
    ...plan,
    blend: true,
    slotsPerSourceFrame: grid.p,
    slotsPerOutputFrame: grid.q,
    gridRate: rate(grid.q),
    framesPerOutput: grid.q / grid.p,
    exact: grid.error / ratio < EXACT_RATIO_TOLERANCE,
    ...computeTaps(grid.p, grid.q),
  };
}

/**
 * Fast engine: one branch per tap picks its slot out of every block of Q, and a single `mix`
 * produces only the frames that are kept. Roughly 2x (integer ratios) to 8x (fractional ratios)
 * faster than the tmix engine, which has to compute a blend for every slot and discard most.
 */
function buildPolyphaseGraph(plan, input) {
  const { slotsPerOutputFrame: q, padStart, weights, gridRate, outputRate } = plan;
  const taps = weights.length;
  const reachesNextBlock = taps > q;
  const label = (prefix) => weights.map((_, i) => `[${prefix}${i}]`).join('');

  const chains = [
    `${input}fps=${gridRate},tpad=start=${padStart}:start_mode=clone:stop=${2 * q}:stop_mode=clone,split=${taps}${label('fbs')}`,
  ];
  weights.forEach((_, i) => {
    // Taps inside the block are stamped one output frame late so the single tap that belongs to
    // the following block (always the last one) lines up with them without a negative timestamp.
    const pts = reachesNextBlock && i < q ? `(N+1)*${q}` : `N*${q}`;
    chains.push(`[fbs${i}]select='eq(mod(n,${q}),${i % q})',setpts=${pts}[fbt${i}]`);
  });
  chains.push(
    `${label('fbt')}mix=inputs=${taps}:weights='${weights.join(' ')}':duration=shortest,setpts=PTS-STARTPTS,fps=${outputRate}`
  );
  return chains.join(';');
}

/** Reference engine: a plain linear chain every FFmpeg build handles. Same output, more CPU. */
function buildTmixGraph(plan, input) {
  const { slotsPerOutputFrame: q, padStart, weights, gridRate, outputRate } = plan;
  const taps = weights.length;
  // tmix emits, for slot m, the blend of slots m-taps+1..m; output j needs the window that
  // starts at slot q*j - padStart.
  const phase = (taps - 1 - padStart) % q;
  return (
    `${input}fps=${gridRate},tpad=stop=${2 * q}:stop_mode=clone,` +
    `tmix=frames=${taps}:weights='${weights.join(' ')}',` +
    `select='eq(mod(n,${q}),${phase})',setpts=N*${q},fps=${outputRate}`
  );
}

/**
 * Video filtergraph for a plan. The result has a single unlabeled output, so further filters can
 * be appended with a comma and FFmpeg maps it to the output file by itself.
 */
function buildBlendGraph(plan, { engine = ENGINE_POLYPHASE, input = '[0:v:0]' } = {}) {
  if (!plan.blend) return `${input}fps=${plan.outputRate}`;
  return engine === ENGINE_TMIX ? buildTmixGraph(plan, input) : buildPolyphaseGraph(plan, input);
}

/** "1-2-2-2-1" for whole-frame ratios, "2.4 frames" otherwise. */
function describeBlend(plan) {
  if (!plan.blend) return 'no blending needed';
  if (plan.slotsPerSourceFrame === 1) return `weights ${plan.weights.join('-')}`;
  return `${Math.round(plan.framesPerOutput * 100) / 100} source frames per output frame`;
}

/**
 * Expected value of one output sample given the source frames, straight from the slot model.
 * Used by the engine self-test and the test suite to check FFmpeg's output numerically.
 * @param {(frameIndex: number) => number} sourceSample
 */
function referenceSample(plan, sourceFrameCount, outputIndex, sourceSample) {
  const { slotsPerSourceFrame: p, slotsPerOutputFrame: q, padStart, weights } = plan;
  let sum = 0;
  let total = 0;
  weights.forEach((weight, i) => {
    const slot = q * outputIndex - padStart + i;
    const frame = Math.min(Math.max(Math.floor(slot / p), 0), sourceFrameCount - 1);
    sum += weight * sourceSample(frame);
    total += weight;
  });
  return sum / total;
}

/**
 * Lavfi source for checking a graph numerically: a still pattern scanned by a moving crop window,
 * so every frame differs and every sample is an exact copy (no filter that needs a GPL build).
 */
function buildTestSource({ fps, frames, width, height }) {
  return (
    `testsrc2=size=320x180:rate=${fps},` +
    `crop=${width}:${height}:'mod(n*13,${320 - width})':'mod(n*7,${180 - height})',` +
    `format=gray16le,trim=end_frame=${frames}`
  );
}

/**
 * Compares FFmpeg's blended frames with the model.
 * @param {Buffer} original raw gray16le source frames
 * @param {Buffer} blended raw gray16le output frames of the graph under test
 */
function compareWithReference(plan, original, blended, frameBytes) {
  const sourceCount = Math.floor(original.length / frameBytes);
  const outputCount = Math.floor(blended.length / frameBytes);
  const expectedCount = Math.ceil(sourceCount / plan.framesPerOutput);
  let maxError = 0;
  for (let j = 0; j < Math.min(outputCount, expectedCount); j++) {
    for (let offset = 0; offset < frameBytes; offset += 2) {
      const expected = referenceSample(plan, sourceCount, j, (frame) => original.readUInt16LE(frame * frameBytes + offset));
      maxError = Math.max(maxError, Math.abs(blended.readUInt16LE(j * frameBytes + offset) - expected));
    }
  }
  return { sourceCount, outputCount, expectedCount, maxError };
}

module.exports = {
  OUTPUT_FPS,
  MIN_SOURCE_FPS,
  MAX_SOURCE_FPS,
  ENGINE_POLYPHASE,
  ENGINE_TMIX,
  parseFrameRate,
  resolveSourceFps,
  getBlendEligibility,
  planFrameBlend,
  buildBlendGraph,
  describeBlend,
  referenceSample,
  buildTestSource,
  compareWithReference,
};
