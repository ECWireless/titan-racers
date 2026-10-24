import billboards from "./tree-textures/tree-billboards.json";

/**
 * The baked tree species, one atlas row each, by index: three broadleaves
 * and a fir. `span` is the billboard's side as a share of the tree's height.
 * The atlases load from `tree-images.ts`.
 */
export const TREE_SPECIES = billboards.species;
export const CONIFER_SPECIES = TREE_SPECIES.findIndex(({ id }) => id.startsWith("fir"));
/** Height of each tree's foot in its cell, as a share of the cell. */
export const TREE_FOOT = billboards.foot;
/** Directions each species was baked from, evenly around it. */
export const TREE_VIEWS = billboards.views;
/** Mean linear albedo of the baked foliage and bark. */
export const TREE_MEAN_ALBEDO = billboards.meanAlbedo;
/**
 * A crown shades most of its own leaves, which the bake of single leaves
 * leaves out: the share of their albedo a crown shows.
 */
export const TREE_CROWN_SHADE = 0.6;
