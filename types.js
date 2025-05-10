/**
 * @typedef {{ fileID: number, guid?: string, type?: number }} SerializedFileObject
 */

/**
 * @typedef {{ x: number, y: number }} SerializedVector2
 */

/**
 * @typedef {{ r: number, g: number, b: number, a: number }} SerializedColor
 */

/**
 * @typedef {{ m_Texture: SerializedFileObject, m_Scale: SerializedVector2, m_Offset: SerializedVector2 }} SerializedTexEnv
 */

/**
 * @typedef {{
 * 	serializedVersion: number,
 * 	m_ObjectHideFlags: number,
 * 	m_CorrespondingSourceObject: SerializedFileObject,
 * 	m_Name: string,
 * 	m_Shader: SerializedFileObject,
 * 	m_Parent: SerializedFileObject,
 * 	m_ModifiedSerializedProperties: number,
 * 	m_ValidKeywords: Array<string>,
 * 	m_InvalidKeywords: Array<string>,
 * 	m_LightmapFlags: number,
 * 	m_EnabledInstancingVariants: number,
 * 	m_DoubleSidedGI: 0 | 1,
 * 	m_CustomRenderQueue: number,
 * 	stringTagMap: { [tag: string]: string },
 * 	disabledShaderPasses: Array<string>,
 * 	m_LockedProperties: null,
 * 	m_SavedProperties: {
 * 		serializedVersion: number,
 * 		m_TexEnvs: Array<Record<string, SerializedTexEnv>>,
 * 		m_Ints: Array<Record<string, number>>,
 * 		m_Floats: Array<Record<string, number>>,
 * 		m_Colors: Array<Record<string, SerializedColor>>
 * 	}
 * }} SerializedMaterial
 */

/**
 * @typedef {{
 * 	type: "image"
 * 	imagePath: string,
 * 	tint: { r: number, g: number, b: number },
 * 	tile: SerializedVector2,
 * 	offset: SerializedVector2,
 * 	label: string
 * } | {
 * 	type: "normal",
 * 	imagePath: string,
 * 	bumpScale: number,
 * 	tile: SerializedVector2,
 * 	offset: SerializedVector2,
 * 	label: string
 * } | {
 * 	type: "ramp",
 * 	color1: SerializedColor,
 * 	color1Length: number,
 * 	color2: SerializedColor,
 * 	color2Length: number,
 * 	color3: SerializedColor,
 * 	border: SerializedColor,
 * 	borderLength: number
 * }} ConverterReturnType
 */

/**
 * @typedef {{
 * 	"assets": string;
 * 	"sets": {
 * 		[set: string]: {
 * 			[material: string]: Material;
 * 		};
 * 	};
 * }} MaterialList
 */

/**
 * @typedef {{
 * 	[slot: string]: string;
 * }} Material
 *
 * Albedo: path (R, G, B)? [TileX, TileY, OffsetX, OffsetY]? OR Set > Material > Slot (R, G, B)? [TileX, TileY, OffsetX, OffsetY]?
 *
 * Normal: path (scale)? [TileX, TileY, OffsetX, OffsetY]? OR Set > Material > Slot (Scale)? [TileX, TileY, OffsetX, OffsetY]?
 *
 * AO: path [TileX, TileY, OffsetX, OffsetY]? OR Set > Material > Slot [TileX, TileY, OffsetX, OffsetY]?
 *
 * Met: path [TileX, TileY, OffsetX, OffsetY]? OR Set > Material > Slot [TileX, TileY, OffsetX, OffsetY]?
 *
 * Spec: path [TileX, TileY, OffsetX, OffsetY]? OR Set > Material > Slot [TileX, TileY, OffsetX, OffsetY]?
 */

/**
 * @typedef {{
 * 	"size": number;
 * 	"normals": Array<string>;
 * 	"objects": {
 * 		[material: string]: MaterialAtlasInfo
 * 	}
 * }} AtlasDescriptor
 */

/**
 * @typedef {{
 * 	"size": number;
 * 	"x": number;
 * 	"y": number;
 * }} MaterialAtlasInfo
 */

module.exports = {}
