const fs = require("fs");
const path = require("path");
const util = require("util");

const Canvas = require("canvas");
const yaml = require("yaml");

const lib = require("./lib");

const foldersToAddToDB = ["Assets", "Packages"];
const notActuallyFolders = [".gitignore"];

const mats = require("./materials.json");

/** @type {Map<string, string>} */
const db = new Map();

// Main
(async () => {
	console.log("Starting AssetDB scan.");

	const start = Date.now();

	for (const folder of foldersToAddToDB) {
		await buildAssetDatabaseRecursively(path.join(mats.project, folder));
	}

	console.log(`Done with scan. Took ${Date.now() - start}ms. DB size is ${db.size}`);

	for (const mat of mats.materials) {
		const matData = await fs.promises.readFile(path.join(mats.project, mat.path), { encoding: "utf-8" });
		let parsed;
		try {
			parsed = yaml.parse(matData.replace("%YAML 1.1\n", "").replace("%TAG !u! tag:unity3d.com,2011:\n", "").replace("--- !u!21 &2100000\n", ""));
		} catch {
			console.error(`Error with parsing file ${mat.path}. Likely a duplicate key`);
			continue;
		}

		/** @type {Array<import("./types").ConverterReturnType>} */
		let tasks;

		switch (mat.preset) {
			case "poiyomi":
			case "poi":
				tasks = poiConverter(parsed.Material, mat.label);
				break;
			case "standard":
			default:
				tasks = defaultConverter(parsed.Material, mat.label);
		}
	}
})();

/**
 * @param {string} pt
 */
async function buildAssetDatabaseRecursively(pt) {
	const read = await fs.promises.readdir(pt).then(children => children.filter(c => !c.endsWith(".meta") && !notActuallyFolders.includes(c)));
	const stats = await Promise.all(read.map(rel => fs.promises.stat(path.join(pt, rel))));
	for (let i = 0; i < stats.length; i++) {
		const abs = path.join(pt, read[i]);
		if (stats[i].isDirectory()) await buildAssetDatabaseRecursively(abs);
		else {
			// const isInPackagesFolder = path.dirname(abs) === path.join(toScan, "./Packages");
			if (!fs.existsSync(abs + ".meta")) console.warn(`File ${abs} doesn't have an associating .meta file. Open this unity project to generate guids.`);
			else {
				const data = await fs.promises.readFile(abs + ".meta", { encoding: "utf-8" });
				let parsed;
				try {
					parsed = yaml.parse(data);
				} catch {
					console.error(`Error with parsing file ${abs}.meta. Likely a duplicate key`);
					continue;
				}
				if (!parsed.guid) throw new Error(`File ${abs}.meta doesn't have a guid property\n${util.inspect(parsed)}`);
				if (db.has(parsed.guid)) console.warn(`${parsed.guid} already exists in the db. Not overriding. Open this unity project to regenerate any overlapping guids.`);
				else db.set(parsed.guid, abs);
			}
		}
	}
}

/**
 * @param {string | undefined} [guid]
 * @returns {string} path to texture or /None
 */
function getTexturePath(guid) {
	if (!guid || !db.has(guid)) {
		if (guid) console.warn(`Asset DB doesn't contain ${guid}, but is referenced in a texture slot`);
		return "/None";
	}
	return db.get(guid) ?? "/None";
}

const poiUVsToNames = ["0", "1", "2", "3", "panosphere", "worldpos", "localpos", "polaruv", "distorteduv"];
const poiLightModesToNames = ["textureramp", "multilayermath", "wrapped", "skin", "shademap", "flat", "realistic", "cloth", "sdf"];
/**
 * @param {import("./types").SerializedMaterial} mat
 * @param {string} slot
 * @returns {Array<import("./types").ConverterReturnType>}
 */
function poiConverter(mat, slot) {
	const textures = new Map(mat.m_SavedProperties.m_TexEnvs.map(i => Object.entries(i)[0]));
	const floats = new Map(mat.m_SavedProperties.m_Floats.map(i => Object.entries(i)[0]));
	const colors = new Map(mat.m_SavedProperties.m_Colors.map(i => Object.entries(i)[0]));
	// const ints = new Map(mat.m_SavedProperties.m_Ints.map(i => Object.entries(i)[0]));

	/**
	 * @param {string} name
	 * @param {string | { r: number, g: number, b: number } | undefined} tint
	 * @param {string} label
	 * @returns {import("./types").ConverterReturnType}
	 */
	const createTextureEntry = (name, tint, label) => {
		const tex = textures.get(name);
		return {
			type: "image",
			imagePath: getTexturePath(tex?.m_Texture.guid),
			tint: (typeof tint === "string" ? colors.get(tint) : tint) ?? { r: 1, g: 1, b: 1 },
			tile: tex?.m_Scale ?? { x: 1, y: 1 },
			offset: tex?.m_Offset ?? { x: 0, y: 0 },
			label
		}
	}

	/**
	 * @param {string} name
	 * @param {string} scale
	 * @param {string} label
	 * @returns {import("./types").ConverterReturnType}
	 */
	const createNormalEntry = (name, scale, label) => {
		const tex = textures.get(name);
		return {
			type: "normal",
			imagePath: getTexturePath(tex?.m_Texture.guid),
			bumpScale: floats.get(scale) ?? 1,
			tile: tex?.m_Scale ?? { x: 1, y: 1 },
			offset: tex?.m_Offset ?? { x: 0, y: 0 },
			label
		}
	}

	/** @param {string} name */
	const warnAboutUVs = (name) => console.warn(`${name} of ${slot} isn't using UV0. Not adding to tasks as you wouldn't be able to make use of it in any built in Unity shaders`);

	/** @type {Array<import("./types").ConverterReturnType>} */
	const rt = [];

	if ((floats.get("_MainTexUV") ?? 0) === 0) rt.push(createTextureEntry("_MainTex", "_Color", `${slot}-albedo`));
	else warnAboutUVs("_MainTex");
	if ((floats.get("_BumpMapUV") ?? 0) === 0) rt.push(createNormalEntry("_BumpMap", "_BumpScale", `${slot}-normal`));
	else warnAboutUVs("_BumpMap");

	const detailMaskUV = floats.get("_DetailMaskUV") ?? 0;
	const detailMaskExists = textures.has("_DetailMask");
	const detailTexUV = floats.get("_DetailTexUV") ?? 0;
	const detailTexExists = textures.has("_DetailTex");
	const detailTint = colors.get("_DetailTint");
	const detailNormalUV = floats.get("_DetailNormalMapUV") ?? 0;
	const detailNormalExists = textures.has("_DetailNormalMap");
	const allowedDetailNormalUVs = [0, 1];
	/** @param {Array<number>} uvs */
	const checkUVvalidity = (uvs) => uvs.every(u => allowedDetailNormalUVs.includes(u)) && uvs.every(u => u === uvs[0]);
	if (
		(detailMaskExists && detailTexExists && detailNormalExists && checkUVvalidity([detailMaskUV, detailTexUV, detailNormalUV])) ||
		(detailMaskExists && detailTexExists && checkUVvalidity([detailMaskUV, detailTexUV])) ||
		(detailMaskExists && detailNormalExists && checkUVvalidity([detailMaskUV, detailNormalUV])) ||
		(detailTexExists && detailNormalExists && checkUVvalidity([detailTexUV, detailNormalUV])) ||
		(detailTexExists && allowedDetailNormalUVs.includes(detailTexUV)) ||
		(detailNormalExists && allowedDetailNormalUVs.includes(detailNormalUV)) ||
		(detailMaskExists && detailTint && (detailTint.r !== 1 || detailTint.g !== 1 || detailTint.b !== 1) && allowedDetailNormalUVs.includes(detailTexUV))
	) {
		rt.push(createTextureEntry("_DetailMask", undefined, `${slot}-detailmask`));
		rt.push(createTextureEntry("_DetailTex", "_DetailTint", `${slot}-detail`));
		rt.push(createNormalEntry("_DetailNormalMap", "_DetailNormalMapScale", `${slot}-detailnormal`));
	} else console.warn(`The details of ${slot} either didn't share the same UV, were on a UV other than 0-1, or only the detail mask slot was used which would make no sense.`);

	if ((floats.get("_LightingAOMapsUV") ?? 0) === 0) rt.push(createTextureEntry("_LightingAOMaps", { r: 0, g: 1, b: 0 }, `${slot}-ao`));
	else warnAboutUVs("_LightingAOMaps");

	const lightMode = floats.get("_LightingMode") ?? 0;
	switch (lightMode) {
		case 0: {
			const rampOffset = floats.get("_ShadowOffset") ?? 0;
			if (rampOffset === 0) break;
			const amount = Math.abs(rampOffset);
			rt.push({
				type: "image",
				imagePath: getTexturePath(textures.get("_ToonRamp")?.m_Texture.guid),
				tint: { r: 1, g: 1, b: 1 },
				tile: { x: 1 / amount, y: 1 },
				offset: { x: rampOffset, y: 0 },
				label: `${slot}-lightramp`
			});
			break;
		}
		case 1: {
			// multilayer math
			break;
		}
		default: break;
	}

	return rt;
}

/**
 * @param {import("./types").SerializedMaterial} mat
 * @param {string} slot
 * @returns {Array<import("./types").ConverterReturnType>}
 */
function defaultConverter(mat, slot) {
	const textures = new Map(mat.m_SavedProperties.m_TexEnvs.map(i => Object.entries(i)[0]));
	const floats = new Map(mat.m_SavedProperties.m_Floats.map(i => Object.entries(i)[0]));
	const colors = new Map(mat.m_SavedProperties.m_Colors.map(i => Object.entries(i)[0]));

	return [];
}
