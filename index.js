const fs = require("fs");
const path = require("path");

const Canvas = require("canvas");

/** @type {AtlasDescriptor} */
// @ts-ignore File will be there or else
const atlasDesc = require("./atlas-description.json");

/** @type {MaterialList} */
// @ts-ignore File will be there or else
const materials = require("./material-list.json");

/** @type {{ [material: string]: Material }} */
// @ts-ignore File will be there or else
const shared = require("./shared-materials.json");


/** @type {Map<string, Canvas.CanvasRenderingContext2D>} */
const cache = new Map(); // Used for shared materials instead of writing to disk

const outputDir = path.join(__dirname, "output");

const intR = /-?\d+/; // construct parts of the larger regular expressions for maintainability
const floatR = /(?:-?\d+\.\d+)|(?:-?\d+)/; // includes integer (Wanna play a game? Put the negative sign at the start of the regex instead of in the non capturing groups)
const pathR = /\/[\w./[\] ]+/; // This will 100% fail with special characters in the path name
const floatRS = floatR.toString().slice(1, -1); // RegExp.toString includes the /s at the front and end
const intRS = intR.toString().slice(1, -1);
const pathRS = pathR.toString().slice(1, -1);

const rgbOrBumpScaleR = new RegExp(`\\((${floatRS}),? ?(${intRS})?,? ?(${intRS})?\\)`); // first is shared with getting the normal scale
const tileOffsetR = new RegExp(`\\[(${floatRS}), ?(${floatRS}), ?(${floatRS}), ?(${floatRS})\\]`);
const swizzleR = /{([RGBA]{1,4}):([RGBA]{1,4})}/;
const rgbOrBumpScaleRS = rgbOrBumpScaleR.toString().slice(1, -1);
const tileOffsetRS = tileOffsetR.toString().slice(1, -1);
const swizzleRS = swizzleR.toString().slice(1, -1);

const pathAndOptionsRegex = new RegExp(`^(${pathRS}) ?(?:${rgbOrBumpScaleRS})? ?(?:${tileOffsetRS})? ?(?:${swizzleRS})?$`); // Also includes /None
const referenceAndOptionsRegex = new RegExp(`^([\\w ]+) ?> ?([\\w ]+) ?> ?([\\w ]+) ?(?:${rgbOrBumpScaleRS})? ?(?:${tileOffsetRS})? ?(?:${swizzleRS})?$`);

// console.log(pathAndOptionsRegex.toString() + "\n", referenceAndOptionsRegex.toString());

const normalDefaultRGB = [128, 128, 255];

/** @type {Array<keyof Material>} */
const allPossibleSlots = ["Albedo", "Normal", "DetailMask", "DetailAlbedo", "DetailNormal", "AO", "Met", "Spec"]; // I could accumulate this at runtime but like lmao why
const normalTypes = new Set(["Normal", "DetailNormal"]); // Used for distinguishing if the tint should go to bump scale mode and also how tint/bump scale path branches


// Main
;(async () => {
	for (const slot of allPossibleSlots) { // pre process shared materials
		for (const sharedMat of Object.keys(shared)) {
			if (!atlasDesc.objects[sharedMat]) continue;
			const processed = await processSlot("Shared", sharedMat, slot);
			cache.set(`${sharedMat}-${slot}`, processed);
		}
	}

	for (const set of Object.keys(materials.sets)) {
		for (const slot of allPossibleSlots) { // get all of same slots of each material per set processed before moving on to next slot type
			const atlas = Canvas.createCanvas(atlasDesc.size, atlasDesc.size).getContext("2d");

			for (const sharedMat of Object.keys(shared)) { // draw shared slots to the set atlas first
				const atlasMatDef = atlasDesc.objects[sharedMat];
				if (!atlasMatDef) continue;

				const result = cache.get(`${sharedMat}-${slot}`);
				if (!result) continue;

				atlas.drawImage(result.canvas, atlasMatDef.x, atlasMatDef.y);
			}

			for (const material of Object.keys(materials.sets[set])) { // process the slot of each set material
				const atlasMatDef = atlasDesc.objects[material];
				if (!atlasMatDef) {
					console.warn(`${material} isn't defined in the atlas descriptor. Skipping`);
					continue;
				}

				const result = await processSlot(set, material, slot);
				atlas.drawImage(result.canvas, atlasMatDef.x, atlasMatDef.y);
			}

			await fs.promises.writeFile(path.join(outputDir, `${set}-${slot.toLowerCase()}.png`), atlas.canvas.toBuffer("image/png"));
		}

		// post processing for packing maps
		const [packR, packG, packA] = await Promise.all([
			Canvas.loadImage(path.join(outputDir, `${set}-met.png`)).then(image2Context),
			Canvas.loadImage(path.join(outputDir, `${set}-ao.png`)).then(image2Context),
			Canvas.loadImage(path.join(outputDir, `${set}-spec.png`)).then(image2Context)
		])

		if (!packR || !packG || !packA) throw new Error(`A slot deferred for packing isn't available\nR: ${!!packR}, G: ${!!packG}, A: ${!!packA}`);
		if (packR.canvas.width !== packG.canvas.width || packR.canvas.width !== packA.canvas.width || packR.canvas.height !== packG.canvas.height || packR.canvas.height !== packA.canvas.height)
			throw new Error(`The packed map widths or heights didn't match???`); // Realistically should never happen unless someone was really fast at editing the maps but users will find creative ways to break code

		const Rdata = packR.getImageData(0, 0, packR.canvas.width, packR.canvas.height);
		const Gdata = packG.getImageData(0, 0, packG.canvas.width, packG.canvas.height);
		const Adata = packA.getImageData(0, 0, packA.canvas.width, packA.canvas.height);

		for (let i = 0; i < Rdata.data.length; i += 4) {
			// Metallic R is already there
			// R 0, G 1, B 2, A 3
			Rdata.data[i + 1] = Gdata.data[i + 1]; // From AO G
			Rdata.data[i + 2] = 0; // B is empty
			Rdata.data[i + 3] = Adata.data[i]; // From Alpha R
		}
		packR.putImageData(Rdata, 0, 0);
		await fs.promises.writeFile(path.join(outputDir, `${set}-packed.png`), packR.canvas.toBuffer("image/png"));
	}
})();
// End Main


/**
 *
 * @param {string} set
 * @param {string} material
 * @param {keyof Material} slot
 * @returns {Promise<Canvas.CanvasRenderingContext2D>}
 */
async function processSlot(set, material, slot) {
	const { imagePath, tint, tileOffset, swizzle } = resolveOptions(set, material, slot);

	/** @type {Canvas.CanvasRenderingContext2D} */
	let ctx;

	// Image loading
	if (imagePath !== "/None") {
		const absolute = path.join(materials.assets, imagePath);
		const imageData = await Canvas.loadImage(absolute);
		ctx = Canvas.createCanvas(imageData.width, imageData.height).getContext("2d");
		ctx.drawImage(imageData, 0, 0);
	} else {
		ctx = Canvas.createCanvas(1, 1).getContext("2d");
		ctx.putImageData(new Canvas.ImageData(normalTypes.has(slot) ? new Uint8ClampedArray([...normalDefaultRGB, 255]) : new Uint8ClampedArray([255, 255, 255, 255]), 1, 1), 0, 0);
	}

	// Tinting / BumpScale / Swizzle
	if ((normalTypes.has(slot) && tint[0] !== 1) || (!normalTypes.has(slot) && (tint[0] !== 255 || tint[1] !== 255 || tint[2] !== 255)) || Object.keys(swizzle).length) {
		const data = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);

		for (let i = 0; i < data.data.length; i += 4) {
			// Swizzle
			const R = data.data[i];
			const G = data.data[i + 1];
			const B = data.data[i + 2];
			const A = data.data[i + 3];
			const swizzleMap = { R, G, B, A };

			for (const [source, dest] of Object.entries(swizzle)) {
				switch (dest) { // The left side is going into the right side of the swizzle def: {G:R} means G -> R
					case "R": data.data[i] = swizzleMap[source]; break;
					case "G": data.data[i + 1] = swizzleMap[source]; break;
					case "B": data.data[i + 2] = swizzleMap[source]; break;
					case "A": data.data[i + 3] = swizzleMap[source]; break;
					default: throw new Error("Oh, so we're doing other data channels now");
				}
			}

			if (normalTypes.has(slot)) { // BumpScale
				data.data[i] = clamp(0, 255, lerp(normalDefaultRGB[0], data.data[i], tint[0]));
				data.data[i + 1] = clamp(0, 255, lerp(normalDefaultRGB[1], data.data[i + 1], tint[0]));
				// leave the blue channel alone for _BumpScale
			} else { // Tint
				if (tint[0] < 0) data.data[i] = clamp(0, 255, lerp(data.data[i], 255 - data.data[i], tint2Mult(-tint[0])));
				else data.data[i] = clamp(0, 255, Math.round(data.data[i] * tint2Mult(tint[0])));

				if (tint[1] < 0) data.data[i + 1] = clamp(0, 255, lerp(data.data[i + 1], 255 - data.data[i + 1], tint2Mult(-tint[1])));
				else data.data[i + 1] = clamp(0, 255, Math.round(data.data[i + 1] * tint2Mult(tint[1])));

				if (tint[2] < 0) data.data[i + 2] = clamp(0, 255, lerp(data.data[i + 2], 255 - data.data[i + 2], tint2Mult(-tint[2])));
				else data.data[i + 2] = clamp(0, 255, Math.round(data.data[i + 2] * tint2Mult(tint[2])));
			}
		}
		ctx.putImageData(data, 0, 0);
	}

	// Tiling
	const sizeInAtlas = atlasDesc.objects[material].size;
	if (tileOffset[0] !== 1 || tileOffset[1] !== 0) {
		const sectionSizeX = Math.floor(sizeInAtlas / tileOffset[0]); // How many times the x and y can fit into the size in atlas in pixels
		const sectionSizeY = Math.floor(sizeInAtlas / tileOffset[1]); // Will be either on point or a little under. Resize after to fit

		resize(ctx, sectionSizeX, sectionSizeY);
		const partInAtlas = Canvas.createCanvas(sectionSizeX * tileOffset[0], sectionSizeY * tileOffset[1]).getContext("2d"); // this is to resize to sizeInAtlas later
		const data2 = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height); // get the part to put into the partInAtlas
		for (let y = 0; y < tileOffset[1]; y++) {
			for (let x = 0; x < tileOffset[0]; x++) {
				partInAtlas.putImageData(data2, x * sectionSizeX, y * sectionSizeY);
			}
		}

		ctx.canvas.width = sizeInAtlas;
		ctx.canvas.height = sizeInAtlas;
		ctx.drawImage(partInAtlas.canvas, 0, 0, sizeInAtlas, sizeInAtlas);
	} else resize(ctx, sizeInAtlas, sizeInAtlas);

	// Offset
	const normalizedX = tileOffset[2] % 1;
	const normalizedY = tileOffset[3] % 1;
	const xIsNeg = normalizedX < 0;
	const yIsNeg = normalizedY < 0;
	const shiftAmountX = normalizedX ? Math.round(sizeInAtlas * ((xIsNeg ? 1 + normalizedX : normalizedX))) : 0;
	const shiftAmountY = normalizedY ? Math.round(sizeInAtlas * ((yIsNeg ? 1 + normalizedY : normalizedY))) : 0;

	if (normalizedX !== 0 && normalizedY === 0) {
		const right = ctx.getImageData(sizeInAtlas - shiftAmountX, 0, shiftAmountX, sizeInAtlas); // to left
		const left = ctx.getImageData(0, 0, sizeInAtlas - shiftAmountX, sizeInAtlas); // to right

		ctx.putImageData(left, shiftAmountX, 0);
		ctx.putImageData(right, 0, 0);
	} else if (normalizedX === 0 && normalizedY !== 0) {
		const bottom = ctx.getImageData(0, sizeInAtlas - shiftAmountY, sizeInAtlas, shiftAmountY); // to top
		const top = ctx.getImageData(0, 0, sizeInAtlas, sizeInAtlas - shiftAmountY); // to bottom

		ctx.putImageData(top, 0, shiftAmountY);
		ctx.putImageData(bottom, 0, 0);
	} else if (normalizedX !== 0 && normalizedY !== 0) {
		const bottomRight = ctx.getImageData(sizeInAtlas - shiftAmountX, sizeInAtlas - shiftAmountY, shiftAmountX, shiftAmountY); // to top left
		const bottomLeft = ctx.getImageData(0, sizeInAtlas - shiftAmountY, sizeInAtlas - shiftAmountX, sizeInAtlas - shiftAmountY); // to top right
		const topRight = ctx.getImageData(sizeInAtlas - shiftAmountX, 0, shiftAmountX, sizeInAtlas - shiftAmountY); // to bottom left
		const topLeft = ctx.getImageData(0, 0, sizeInAtlas - shiftAmountX, sizeInAtlas - shiftAmountY); // to bottom right

		ctx.putImageData(topLeft, shiftAmountX, shiftAmountY);
		ctx.putImageData(topRight, 0, shiftAmountY);
		ctx.putImageData(bottomLeft, shiftAmountX, 0);
		ctx.putImageData(bottomRight, 0, 0);
	}

	console.log(`Done with drawing ${slot} from ${set} > ${material}`);

	return ctx;
}

/**
 * @param {string} set
 * @param {string} material
 * @param {keyof Material} slot
 * @returns {{ imagePath: string; tint: [number, number, number], tileOffset: [number, number, number, number], swizzle: { [channel: "R" | "G" | "B" | "A"]: "R" | "G" | "B" | "A" } }}
 */
function resolveOptions(set, material, slot) {
	const mats = set === "Shared" ? shared : materials.sets[set];
	const mat = mats[material];
	const reference = mat[slot];

	/** @type {string | undefined} */
	let imagePath,
	/** @type {[number, number, number] | undefined} */
	tint,
	/** @type {[number, number, number, number] | undefined} */
	tileOffset,
	/** @type {{ [channel: string]: string } | undefined} */
	swizzle;

	/** @param {string} pt */
	const resolvePath = (pt) => {
		const match = pathAndOptionsRegex.exec(pt);
		if (!match) throw new Error(`Reference didn't match path regex even though the first char was a /\n${pt}`);
		imagePath = match[1].trim();
		tint = match[2] ? [Number(match[2]), 255, 255] : [normalTypes.has(slot) ? 1 : 255, 255, 255];
		if (match[3]) tint[1] = Number(match[3]);
		if (match[4]) tint[2] = Number(match[4]);
		tileOffset = match[5] ? [Number(match[5]), Number(match[6]), Number(match[7]), Number(match[8])] : [1, 1, 0, 0];
		swizzle = {}
		if (match[9]) {
			if (match[9].length !== match[10].length) throw new Error(`Swizzle lengths don't match for ${set} > ${material} > ${slot}`);
			const leftSplit = match[9].split("");
			const rightSplit = match[10].split("");
			for (let i = 0; i < leftSplit.length; i++) {
				swizzle[leftSplit[i]] = rightSplit[i];
			}
		}
	}

	if (reference.startsWith("/")) resolvePath(reference);
	else {
		const match = referenceAndOptionsRegex.exec(reference);
		if (!match) throw new Error(`Reference wasn't a path (any string that starts with /) and didn't match the reference regex (set > material > slot)\n${reference}`);
		const refSet = match[1].trim();
		const refMat = match[2].trim();
		const refSlot = match[3].trim();

		const foundSet = refSet === "Shared" ? shared : materials.sets[refSet];
		if (!foundSet) throw new Error(`Referenced set ${refSet} defined in ${set} > ${material} > ${slot} couldn't be found`);
		const foundMat = foundSet[refMat];
		if (!foundMat) throw new Error(`Referenced material ${refMat} defined in ${set} > ${material} > ${slot} couldn't be found`);
		/** @type {string} */
		const foundSlot = foundMat[refSlot];
		if (!foundSlot) throw new Error(`Referenced slot ${refSlot} defined in ${set} > ${material} > ${slot} couldn't be found`);

		if (!foundSlot.startsWith("/")) throw new Error(`References cannot contain references. They must be a path. Error originated from ${set} > ${material} > ${slot} which points to ${refSet} > ${refMat} > ${refSlot}`);
		resolvePath(foundSlot);

		/** @type {[number, number, number] | undefined} */
		const overrideTint = match[4] ? [Number(match[4]), 255, 255] : undefined;
		if (overrideTint) {
			tint = overrideTint;
			if (match[5]) tint[1] = Number(match[5]);
			if (match[6]) tint[2] = Number(match[6]);
		}

		/** @type {[number, number, number, number] | undefined} */
		const overrideTileOffset = match[7] ? [Number(match[7]), 1, 0, 0] : undefined;
		if (overrideTileOffset) {
			tileOffset = overrideTileOffset;
			if (match[8]) tileOffset[1] = Number(match[8]);
			if (match[9]) tileOffset[2] = Number(match[9]);
			if (match[10]) tileOffset[3] = Number(match[10]);
		}

		const overrideSwizzle = match[11] && match[12] ? {} : undefined;
		if (overrideSwizzle) {
			if (match[11].length !== match[12].length) throw new Error(`Override swizzle lengths defined in ${set} > ${material} > ${slot} are not the same`)
			swizzle = overrideSwizzle;
			const leftSplit = match[11].split("");
			const rightSplit = match[12].split("");
			for (let i = 0; i < leftSplit.length; i++) {
				swizzle[leftSplit[i]] = rightSplit[i];
			}
		}
	}

	if (!imagePath || !tint || !tileOffset ||!swizzle) throw new Error(`PANIC! The image path, tint, swizzle, and/or tileOffset wasn't defined for ${set} > ${material} > ${slot}`);

	return { imagePath, tint, tileOffset, swizzle }
}

/**
 * @param {number} tint
 */
function tint2Mult(tint) {
	return tint > 0 ? tint / 255 : 0;
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 */
function lerp(a, b, t) {
	return a + (b - a) * t;
}

/**
 * @param {number} min
 * @param {number} max
 * @param {number} val
 */
function clamp(min, max, val) {
	if (val < min) return min;
	if (val > max) return max;
	return val;
}

/**
 * @param {Canvas.CanvasRenderingContext2D} ctx
 * @param {number} newX
 * @param {number} newY
 */
function resize(ctx, newX, newY) {
	const oldX = ctx.canvas.width;
	const oldY = ctx.canvas.height;
	const data = ctx.getImageData(0, 0, oldX, oldY);

	const newCanvas = Canvas.createCanvas(oldX, oldY).getContext("2d");
	newCanvas.putImageData(data, 0, 0);
	ctx.canvas.width = newX;
	ctx.canvas.height = newY;
	ctx.drawImage(newCanvas.canvas, 0, 0, newX, newY);
}

/** @param {Canvas.Image} img */
function image2Context(img) {
	const ctx = Canvas.createCanvas(img.width, img.height).getContext("2d");
	ctx.drawImage(img, 0, 0);
	return ctx;
}

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
 * 	"Albedo": string;
 * 	"Normal": string;
 * 	"AO": string;
 * 	"Met": string;
 * 	"Spec": string;
 * 	"DetailAlbedo": string;
 * 	"DetailNormal": string;
 * 	"DetailMask": string;
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
