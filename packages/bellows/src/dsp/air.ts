/*
 * Air, in the CGS units the airway works in (cm, g, s; pressure in
 * dyn/cm^2, flow in cm^3/s). The values are CHIMERA's (Jameson Hodge, MIT,
 * https://github.com/jamesondh/chimera-vocal-synth at 1d3ea49,
 * crates/chimera/src/physics.rs:5-35): warm humid air in the airway.
 */

/** Density, g/cm^3. */
export const AIR_DENSITY = 1.14e-3;
/** Speed of sound, cm/s. */
export const SOUND_SPEED = 35000;
/** Dynamic viscosity, g/(cm s). */
export const AIR_DYNAMIC_VISCOSITY = 1.86e-4;
/** Kinematic viscosity, cm^2/s. */
export const AIR_VISCOSITY = AIR_DYNAMIC_VISCOSITY / AIR_DENSITY;
/** One centimetre of water, dyn/cm^2. */
export const CM_H2O = 980.665;

/** A yielding wall per unit area: mass g/cm^2, resistance dyn s/cm^3, stiffness dyn/cm^3. */
export interface WallTissue {
  m: number;
  r: number;
  k: number;
}

/**
 * Soft tissue of the pharynx and mouth: Birkholz and Zhang (Interspeech 2025) fitted six speakers'
 * voice bars with M = 2.0 g/cm^2 for all, K 65,000 to 100,000 dyn/cm^3 and B 800 to 2000 dyn s/cm^3,
 * uniform over the tract. K and B are chosen here by the voice bar's duration and level
 * (docs/VOICE-2.md, "Noise sources, walls and velum"). CHIMERA's WALL_SOFT was m 1.5, r 1600, k 3e5.
 * The mass stays CHIMERA's 1.5, under their 2.0: with the six-stage articulators and the retuned
 * noise, 2.0 put five of the comparison renders 0.2 to 0.27 dB further from CHIMERA (DTW), the
 * vowels line most (docs/VOICE-2.md, "Integration 4").
 */
export const WALL_TRACT: WallTissue = { m: 1.5, r: 2000, k: 1e5 };
/** The trachea's cartilage-ringed wall (physics.rs WALL_TRACHEA). */
export const WALL_TRACHEA: WallTissue = { m: 0.6, r: 1000, k: 1e6 };
/** The nasal cavity's mucosa over bone (physics.rs WALL_NASAL). */
export const WALL_NASAL: WallTissue = { m: 1.0, r: 3000, k: 1e6 };
