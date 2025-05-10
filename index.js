const fs = require("fs");
const path = require("path");

const Canvas = require("canvas");

const lib = require("./lib");

/** @type {import("./types").AtlasDescriptor} */
// @ts-ignore File will be there or else
const atlasDesc = require("./atlas-description.json");

/** @type {import("./types").MaterialList} */
// @ts-ignore File will be there or else
const materials = require("./material-list.json");

/** @type {{ [material: string]: import("./types").Material }} */
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

const rgbiOrBumpScaleR = new RegExp(`\\((${floatRS}),? ?(${intRS})?,? ?(${intRS})?,? ?(${floatRS})?\\)`); // first is shared with getting the normal scale
const tileOffsetR = new RegExp(`\\[(${floatRS}), ?(${floatRS}), ?(${floatRS}), ?(${floatRS})\\]`);
const swizzleR = /{([RGBA]{1,4}):([RGBA]{1,4})}/;
const rgbiOrBumpScaleRS = rgbiOrBumpScaleR.toString().slice(1, -1);
const tileOffsetRS = tileOffsetR.toString().slice(1, -1);
const swizzleRS = swizzleR.toString().slice(1, -1);

const pathAndOptionsRegex = new RegExp(`^(${pathRS}) ?(?:${rgbiOrBumpScaleRS})? ?(?:${tileOffsetRS})? ?(?:${swizzleRS})?$`); // Also includes /None
const referenceAndOptionsRegex = new RegExp(`^([\\w ]+) ?> ?([\\w ]+) ?> ?([\\w ]+) ?(?:${rgbiOrBumpScaleRS})? ?(?:${tileOffsetRS})? ?(?:${swizzleRS})?$`);
const maskRegex = /^(\w+)Mask$/;

// console.log(pathAndOptionsRegex.toString() + "\n", referenceAndOptionsRegex.toString());

/** @type {Array<string>} */
const allPossibleSlots = Object.keys(materials.sets).reduce((acc, cur) => {
	for (const mat of Object.values(materials.sets[cur])) {
		// @ts-expect-error Complaining about how acc is Array<never>
		acc.push(...Object.keys(mat).filter(k => acc.indexOf(k) === -1));
	}
	return acc;
}, []);
for (const mat of Object.values(shared)) {
	allPossibleSlots.push(...Object.keys(mat).filter(k => allPossibleSlots.indexOf(k) === -1));
}
/** @type {Array<[string, string]>} */
const toMask = [];
for (const slot of allPossibleSlots) {
	const match = maskRegex.exec(slot);
	if (!match) continue;
	if (allPossibleSlots.includes(match[1])) toMask.push([slot, match[1]]);
}


// Main
;(async () => {
	if (!fs.existsSync(outputDir)) await fs.promises.mkdir(outputDir);
	const children = await fs.promises.readdir(outputDir);
	await Promise.all(children.map(c => fs.promises.rm(path.join(outputDir, c), { recursive: true })));

	for (const slot of allPossibleSlots) { // pre process shared materials
		for (const sharedMat of Object.keys(shared)) {
			if (!atlasDesc.objects[sharedMat]) continue;
			if (!shared[sharedMat][slot]) continue;
			const processed = await processSlot("Shared", sharedMat, slot);
			cache.set(`${sharedMat}-${slot}`, processed);
		}
	}

	for (const set of Object.keys(materials.sets)) {
		for (const slot of allPossibleSlots) { // get all of same slots of each material per set processed before moving on to next slot type
			const atlas = Canvas.createCanvas(atlasDesc.size, atlasDesc.size).getContext("2d");

			if (atlasDesc.normals.includes(slot)) { // Fill in the normal map with the default normal RGB and then composite additional maps on top
				const oldFillStyle = atlas.fillStyle;
				atlas.fillStyle = `rgb(${lib.normalDefaultRGB.join(",")})`;
				atlas.fillRect(0, 0, atlas.canvas.width, atlas.canvas.height);
				atlas.fillStyle = oldFillStyle;
			}

			for (const sharedMat of Object.keys(shared)) { // draw shared slots to the set atlas first
				const atlasMatDef = atlasDesc.objects[sharedMat];
				if (!atlasMatDef) continue;
				if (!shared[sharedMat][slot]) continue;

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
				if (!materials.sets[set][material]?.[slot]) continue;

				const result = await processSlot(set, material, slot);
				atlas.drawImage(result.canvas, atlasMatDef.x, atlasMatDef.y);
			}

			await fs.promises.writeFile(path.join(outputDir, `${set}-${slot.toLowerCase()}.png`), atlas.canvas.toBuffer("image/png"));
		}

		for (const [mask, base] of toMask) {
			const [maskI, baseI] = await Promise.all([
				Canvas.loadImage(path.join(outputDir, `${set}-${mask.toLowerCase()}.png`)).then(lib.image2Context).catch(() => void 0),
				Canvas.loadImage(path.join(outputDir, `${set}-${base.toLowerCase()}.png`)).then(lib.image2Context).catch(() => void 0)
			]);

			if (maskI && baseI) {
				const rgb = baseI.getImageData(0, 0, baseI.canvas.width, baseI.canvas.height);
				const a = maskI.getImageData(0, 0, maskI.canvas.width, maskI.canvas.height);

				for (let i = 0; i < rgb.data.length; i += 4) {
					rgb.data[i + 3] = a.data[i]; // From Mask R
				}

				baseI.putImageData(rgb, 0, 0);
				await fs.promises.writeFile(path.join(outputDir, `${set}-${base.toLowerCase()}-masked.png`), baseI.canvas.toBuffer("image/png"));
			}
		}


		// post processing for packing maps
		const [packR, packG, packA] = await Promise.all([
			Canvas.loadImage(path.join(outputDir, `${set}-met.png`)).then(lib.image2Context).catch(() => void 0),
			Canvas.loadImage(path.join(outputDir, `${set}-ao.png`)).then(lib.image2Context).catch(() => void 0),
			Canvas.loadImage(path.join(outputDir, `${set}-spec.png`)).then(lib.image2Context).catch(() => void 0)
		]);

		if (packR && packG && packA) {
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
	}
})();
// End Main


/**
 *
 * @param {string} set
 * @param {string} material
 * @param {string} slot
 * @returns {Promise<Canvas.CanvasRenderingContext2D>}
 */
async function processSlot(set, material, slot) {
	const { imagePath, tint, tileOffset, swizzle } = resolveOptions(set, material, slot);

	/** @type {Canvas.CanvasRenderingContext2D} */
	let ctx;

	// Image loading
	if (imagePath !== "/None") {
		const absolute = path.join(materials.assets, imagePath);
		ctx = await Canvas.loadImage(absolute).then(lib.image2Context);
	} else {
		ctx = Canvas.createCanvas(1, 1).getContext("2d");
		ctx.putImageData(new Canvas.ImageData(atlasDesc.normals.includes(slot) ? new Uint8ClampedArray([...lib.normalDefaultRGB, 255]) : new Uint8ClampedArray([255, 255, 255, 255]), 1, 1), 0, 0);
	}

	// Tinting / BumpScale / Swizzle
	if ((atlasDesc.normals.includes(slot) && tint[0] !== 1) || (!atlasDesc.normals.includes(slot) && (tint[0] !== 255 || tint[1] !== 255 || tint[2] !== 255 || tint[3] !== 1)) || (swizzle["R"] !== "R" || swizzle["G"] !== "G" || swizzle["B"] !== "B" || swizzle["A"] !== "A")) {
		const data = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);

		for (let i = 0; i < data.data.length; i += 4) {
			// Swizzle
			lib.swizzleFrame(data, swizzle, i);

			if (atlasDesc.normals.includes(slot)) lib.bumpScaleFrame(data, tint[0], i);
			else lib.tintFrame(data, tint[0], tint[1], tint[2], tint[3], i);
		}

		ctx.putImageData(data, 0, 0);
	}

	// Tiling
	const sizeInAtlas = atlasDesc.objects[material].size;
	if (tileOffset[0] !== 1 || tileOffset[1] !== 0) lib.tile(ctx, tileOffset[0], tileOffset[1], sizeInAtlas);
	else lib.resize(ctx, sizeInAtlas, sizeInAtlas);

	// Offset
	lib.offset(ctx, tileOffset[2], tileOffset[3])

	console.log(`Done with drawing ${slot} from ${set} > ${material}`);

	return ctx;
}

/**
 * @param {string} set
 * @param {string} material
 * @param {string} slot
 * @returns {{ imagePath: string; tint: [number, number, number, number], tileOffset: [number, number, number, number], swizzle: Record<lib.Channel, lib.Channel> }}
 */
function resolveOptions(set, material, slot) {
	const mats = set === "Shared" ? shared : materials.sets[set];
	const mat = mats[material];
	const reference = mat[slot];

	/** @type {string | undefined} */
	let imagePath,
	/** @type {[number, number, number, number] | undefined} */
	tint,
	/** @type {[number, number, number, number] | undefined} */
	tileOffset,
	/** @type {Record<lib.Channel, lib.Channel> | undefined} */
	swizzle;

	/** @param {string} pt */
	const resolvePath = (pt) => {
		const match = pathAndOptionsRegex.exec(pt);
		if (!match) throw new Error(`Reference didn't match path regex even though the first char was a /\n${pt}`);
		imagePath = match[1].trim();
		tint = match[2] ? [Number(match[2]), 255, 255, 1] : [atlasDesc.normals.includes(slot) ? 1 : 255, 255, 255, 1];
		if (match[3]) tint[1] = Number(match[3]);
		if (match[4]) tint[2] = Number(match[4]);
		if (match[5]) tint[3] = Number(match[5]);

		tileOffset = match[6] ? [Number(match[6]), Number(match[7]), Number(match[8]), Number(match[9])] : [1, 1, 0, 0];
		swizzle = { R: "R", B: "B", G: "G", A: "A" }
		if (match[10]) {
			if (match[10].length !== match[11].length) throw new Error(`Swizzle lengths don't match for ${set} > ${material} > ${slot}`);
			const leftSplit = match[10].split("");
			const rightSplit = match[11].split("");
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

		/** @type {[number, number, number, number] | undefined} */
		const overrideTint = match[4] ? [Number(match[4]), 255, 255, 1] : undefined;
		if (overrideTint) {
			tint = overrideTint;
			if (match[5]) tint[1] = Number(match[5]);
			if (match[6]) tint[2] = Number(match[6]);
			if (match[7]) tint[3] = Number(match[7]);
		}

		/** @type {[number, number, number, number] | undefined} */
		const overrideTileOffset = match[8] ? [Number(match[8]), 1, 0, 0] : undefined;
		if (overrideTileOffset) {
			tileOffset = overrideTileOffset;
			if (match[9]) tileOffset[1] = Number(match[9]);
			if (match[10]) tileOffset[2] = Number(match[10]);
			if (match[11]) tileOffset[3] = Number(match[11]);
		}

		/** @type {Record<lib.Channel, lib.Channel> | undefined} */
		const overrideSwizzle = match[12] && match[13] ? { R: "R", B: "B", G: "G", A: "A" } : undefined;
		if (overrideSwizzle) {
			if (match[12].length !== match[13].length) throw new Error(`Override swizzle lengths defined in ${set} > ${material} > ${slot} are not the same`);
			swizzle = overrideSwizzle;
			const leftSplit = match[12].split("");
			const rightSplit = match[13].split("");
			for (let i = 0; i < leftSplit.length; i++) {
				swizzle[leftSplit[i]] = rightSplit[i];
			}
		}
	}

	if (!imagePath || !tint || !tileOffset ||!swizzle) throw new Error(`PANIC! The image path, tint, swizzle, and/or tileOffset wasn't defined for ${set} > ${material} > ${slot}`);

	return { imagePath, tint, tileOffset, swizzle }
}
