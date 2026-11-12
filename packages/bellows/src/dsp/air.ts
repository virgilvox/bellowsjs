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
/** The Reynolds number where a jet turns turbulent (network.rs:1097-1130). */
export const CRITICAL_REYNOLDS = 1800;
/** Where turbulence amplitude stops growing as Re^2 (network.rs:1100). */
export const SATURATION_REYNOLDS = 12000;

/** A yielding wall per unit area: mass g/cm^2, resistance dyn s/cm^3, stiffness dyn/cm^3. */
export interface WallTissue {
  m: number;
  r: number;
  k: number;
}

/** Soft tissue of the pharynx and mouth (physics.rs WALL_SOFT). */
export const WALL_SOFT: WallTissue = { m: 1.5, r: 1600, k: 3e5 };
/** The trachea's cartilage-ringed wall (physics.rs WALL_TRACHEA). */
export const WALL_TRACHEA: WallTissue = { m: 0.6, r: 1000, k: 1e6 };
/** The nasal cavity's mucosa over bone (physics.rs WALL_NASAL). */
export const WALL_NASAL: WallTissue = { m: 1.0, r: 3000, k: 1e6 };
