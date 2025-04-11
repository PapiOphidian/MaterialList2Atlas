const Canvas = require("canvas");

const normalDefaultRGB = [128, 128, 255];

/** @typedef {"R" | "G" | "B" | "A"} Channel */

/**
 * Copy channel data to other channels.
 * @param {import("canvas").ImageData} data Image data.
 * @param {Record<Channel, Channel>} options Swizzle options to swap channels.
 * @returns {void}
 *
 * @example
 * // Swaps the Red and Blue channel
 * swizzle(imageData, { R: "B", B: "R" });
 */
function swizzle(data, options) {
	for (let i = 0; i < data.data.length; i += 4) swizzleFrame(data, options, i);
}

/**
 * Function that actually swizzles a frame of the image data (copy channel data to other channels).
 *
 * This function is just for optimization when you are running your own passes on the image data and applying your own processing on top of this effect.
 * @param {import("canvas").ImageData} data Image data.
 * @param {Record<Channel, Channel>} options Swizzle options to swap channels.
 * @param {number} i Index of data to start swizzling at. Applies at i, i+1, i+2, and i+3.
 * @returns {void}
 *
 * @example
 * // Swaps the Red and Blue channel starting at index 12 (will go to index 15)
 * swizzleFrame(imageData, { R: "B", B: "R" }, 12);
 *
 * @example
 * // Goes through the whole image data swapping the Red and Blue channel. This is how it should be used.
 * // The swizzle function does this for you.
 * for (let i = 0; i < imageData.data.length; i += 4) {
 * 	swizzleFrame(imageData, { R: "B", B: "R" }, i);
 * }
 */
function swizzleFrame(data, options, i) {
	const R = data.data[i];
	const G = data.data[i + 1];
	const B = data.data[i + 2];
	const A = data.data[i + 3];
	const swizzleMap = { R, G, B, A };

	for (const [source, dest] of Object.entries(options)) {
		switch (dest) { // The left side is going into the right side of the swizzle def: {G:R} means G -> R
			case "R": data.data[i] = swizzleMap[source]; break;
			case "G": data.data[i + 1] = swizzleMap[source]; break;
			case "B": data.data[i + 2] = swizzleMap[source]; break;
			case "A": data.data[i + 3] = swizzleMap[source]; break;
			default: throw new Error("Oh, so we're doing other data channels now");
		}
	}
}

/**
 * Bakes a scale value into a normal map image.
 * @param {import("canvas").ImageData} data Image data.
 * @param {number} scale float value to lerp between default normal value RGB(128, 128, 255) and the current RGB value. Default value of 1.0 for no transformation.
 * @returns {void}
 *
 * @example
 * // Scales a normal map by 2
 * bumpScale(imageData, 2);
 */
function bumpScale(data, scale) {
	for (let i = 0; i < data.data.length; i += 4) bumpScaleFrame(data, scale, i);
}

/**
 * Function that actually scales the normal map image.
 *
 * This function is just for optimization when you are running your own passes on the image data and applying your own processing on top of this effect.
 * @param {import("canvas").ImageData} data Image data.
 * @param {number} scale float value to lerp between default normal value RGB(128, 128, 255) and the current RGB value. Default value of 1.0 for no transformation.
 * @param {number} i Index of data to start scaling at. Applies at i and i+1.
 * @returns {void}
 *
 * @example
 * // Scales a normal map by 2 starting at index 12 (will go to index 15)
 * bumpScaleFrame(imageData, 2, 12);
 *
 * @example
 * // Goes through the whole image data scaling the normal map by 2. This is how it should be used.
 * // The bumpScale function does this for you.
 * for (let i = 0; i < imageData.data.length; i += 4) {
 * 	bumpScaleFrame(imageData, 2, i);
 * }
 */
function bumpScaleFrame(data, scale, i) {
	data.data[i] = clamp(0, 255, lerp(normalDefaultRGB[0], data.data[i], scale));
	data.data[i + 1] = clamp(0, 255, lerp(normalDefaultRGB[1], data.data[i + 1], scale));
	// leave the blue and alpha channel alone for _BumpScale
}

/**
 * Takes an RGB value and multiplies the base image by that RGB value.
 *
 * RGB provided should be in the range of 0-255. Internally, the RGB's channel values are converted into the range of 0-1 where 255 equals 1
 * and then the image's channels are directly multiplied by that channel's respective multiplier float.
 * @param {import("canvas").ImageData} data Image data.
 * @param {number} r int 0-255 to multiply the R channel by.
 * @param {number} g int 0-255 to multiply the G channel by.
 * @param {number} b int 0-255 to multiply the B channel by.
 * @param {number} [int] float intensity. Default value should be 1 for no HDR transformation.
 * @returns {void}
 *
 * @example
 * // Tints the image by half
 * tint(imageData, 128, 128, 128);
 */
function tint(data, r, g, b, int = 1) {
	for (let i = 0; i < data.data.length; i += 4) tintFrame(data, r, g, b, int, i);
}

/**
 * Function that actually tints the image
 *
 * This function is just for optimization when you are running your own passes on the image data and applying your own processing on top of this effect.
 * @param {import("canvas").ImageData} data Image data.
 * @param {number} r int 0-255 to multiply the R channel by.
 * @param {number} g int 0-255 to multiply the G channel by.
 * @param {number} b int 0-255 to multiply the B channel by.
 * @param {number} int float intensity. Default value should be 1 for no HDR transformation.
 * @param {number} i Index of data to start applying the tinting at. Applies at i, i+1, and i+2. Doesn't touch Alpha (i+3).
 * @returns {void}
 *
 * @example
 * // Tints the image by half starting at index 12 (will go to index 15)
 * tintFrame(imageData, 128, 128, 128, 1, 12);
 *
 * @example
 * // Goes through the whole image data tinting the image by half. This is how it should be used.
 * // The tint function does this for you.
 * for (let i = 0; i < imageData.data.length; i += 4) {
 * 	tintFrame(imageData, 128, 128, 1, i);
 * }
 */
function tintFrame(data, r, g, b, int, i) {
	if (r < 0) data.data[i] = clamp(0, 255, lerp(data.data[i], 255 - data.data[i], tint2Mult(-r)));
	else data.data[i] = clamp(0, 255, Math.round(data.data[i] * tint2Mult(r)));

	if (g < 0) data.data[i + 1] = clamp(0, 255, lerp(data.data[i + 1], 255 - data.data[i + 1], tint2Mult(-g)));
	else data.data[i + 1] = clamp(0, 255, Math.round(data.data[i + 1] * tint2Mult(g)));

	if (b < 0) data.data[i + 2] = clamp(0, 255, lerp(data.data[i + 2], 255 - data.data[i + 2], tint2Mult(-b)));
	else data.data[i + 2] = clamp(0, 255, Math.round(data.data[i + 2] * tint2Mult(b)));

	// HDR color
	if (int !== 1) {
		const hdrColor = hdrToSdr(data.data[i], data.data[i + 1], data.data[i + 2], int);
		data.data[i] = hdrColor[0];
		data.data[i + 1] = hdrColor[1];
		data.data[i + 2] = hdrColor[2];
	}
}

/**
 * Repeat an image a certain number of times in the x and y directions. Can be done independently of each other. Allows setting a target final image size.
 * @param {import("canvas").CanvasRenderingContext2D} ctx The context containing the image data that will be tiled.
 * @param {number} tileX How many times the image is repeated in the x direction.
 * @param {number} tileY How many times the image is repeated in the y direction.
 * @param {number} size The target size of the image in the x direction. Also applies to the y direction if one isn't supplied.
 * @param {number} [sizeY] The target size of the image in the y direction.
 * @returns {void} The ctx param is resized to the new size and the tiles are written directly to it.
 *
 * @example
 * // Makes an image repeat twice in the x direction, but leave the y alone. Make the image now twice the width.
 * tile(context, 2, 1, context.canvas.width * 2, context.canvas.height);
 */
function tile(ctx, tileX, tileY, size, sizeY = size) {
	const sectionSizeX = Math.floor(size / tileX); // How many times the x and y can fit into the size in pixels
	const sectionSizeY = Math.floor(sizeY / tileY); // Will be either on point or a little under. Resize after to fit

	resize(ctx, sectionSizeX, sectionSizeY);
	const part = Canvas.createCanvas(sectionSizeX * tileX, sectionSizeY * tileY).getContext("2d"); // this is to resize to size later
	const data2 = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height); // get the data to put into the part
	for (let y = 0; y < tileY; y++) {
		for (let x = 0; x < tileX; x++) {
			part.putImageData(data2, x * sectionSizeX, y * sectionSizeY);
		}
	}

	ctx.canvas.width = size;
	ctx.canvas.height = sizeY;
	ctx.drawImage(part.canvas, 0, 0, size, sizeY);
}

/**
 * Move the whole image in any direction where any parts that would spill over are moved to the other side of the image.
 * @param {import("canvas").CanvasRenderingContext2D} ctx The context containing the image data that will be offset.
 * @param {number} offsetX The amount of pixels to shift the image right. Can be negative to shift left.
 * @param {number} offsetY The amount of pixels to shift the image down. Can be negative to shift up.
 * @returns {void} The ctx param has the data written directly to it.
 *
 * @example
 * // Move an image to the right 50 pixels and up 50 pixels.
 * offset(context, 50, -50);
 */
function offset(ctx, offsetX, offsetY) {
	const sizeX = ctx.canvas.width;
	const sizeY = ctx.canvas.height;
	const normalizedX = offsetX % 1;
	const normalizedY = offsetY % 1;
	const xIsNeg = normalizedX < 0;
	const yIsNeg = normalizedY < 0;
	const shiftAmountX = normalizedX ? Math.round(sizeX * ((xIsNeg ? 1 + normalizedX : normalizedX))) : 0;
	const shiftAmountY = normalizedY ? Math.round(sizeY * ((yIsNeg ? 1 + normalizedY : normalizedY))) : 0;

	if (normalizedX !== 0 && normalizedY === 0) {
		const right = ctx.getImageData(sizeX - shiftAmountX, 0, shiftAmountX, sizeY); // to left
		const left = ctx.getImageData(0, 0, sizeX - shiftAmountX, sizeY); // to right

		ctx.putImageData(left, shiftAmountX, 0);
		ctx.putImageData(right, 0, 0);
	} else if (normalizedX === 0 && normalizedY !== 0) {
		const bottom = ctx.getImageData(0, sizeY - shiftAmountY, sizeX, shiftAmountY); // to top
		const top = ctx.getImageData(0, 0, sizeX, sizeY - shiftAmountY); // to bottom

		ctx.putImageData(top, 0, shiftAmountY);
		ctx.putImageData(bottom, 0, 0);
	} else if (normalizedX !== 0 && normalizedY !== 0) {
		const bottomRight = ctx.getImageData(sizeX - shiftAmountX, sizeY - shiftAmountY, shiftAmountX, shiftAmountY); // to top left
		const bottomLeft = ctx.getImageData(0, sizeY - shiftAmountY, sizeX - shiftAmountX, sizeY - shiftAmountY); // to top right
		const topRight = ctx.getImageData(sizeX - shiftAmountX, 0, shiftAmountX, sizeY - shiftAmountY); // to bottom left
		const topLeft = ctx.getImageData(0, 0, sizeX - shiftAmountX, sizeY - shiftAmountY); // to bottom right

		ctx.putImageData(topLeft, shiftAmountX, shiftAmountY);
		ctx.putImageData(topRight, 0, shiftAmountY);
		ctx.putImageData(bottomLeft, shiftAmountX, 0);
		ctx.putImageData(bottomRight, 0, 0);
	}
}

/**
 * Resizes an image without losing the image data.
 * @param {import("canvas").CanvasRenderingContext2D} ctx The context containing the image data that will be resized.
 * @param {number} newX The new width in pixels the image will be resized to.
 * @param {number} [newY] The new height in pixels the image will be resized to. Can be ommited to do automatic resizing based on aspect ratio.
 * @returns {void} The ctx param data is copied, resized and then directly written back to it.
 *
 * @example
 * // Resizes an image to 1024 pixels in both directions.
 * resize(context, 1024, 1024);
 */
function resize(ctx, newX, newY) {
	if (!newY) {
		const difference = newX / ctx.canvas.width;
		newY = Math.round(ctx.canvas.height * difference);
	}

	const oldX = ctx.canvas.width;
	const oldY = ctx.canvas.height;
	const data = ctx.getImageData(0, 0, oldX, oldY);

	const absX = Math.abs(newX);
	const absY = Math.abs(newY);

	const newCanvas = Canvas.createCanvas(oldX, oldY).getContext("2d");
	newCanvas.putImageData(data, 0, 0);
	ctx.canvas.width = absX;
	ctx.canvas.height = absY;
	ctx.drawImage(newCanvas.canvas, 0, 0, absX, absY);
}

/**
 * Flips the image in either the horizontal or vertical planes.
 * @param {import("canvas").CanvasRenderingContext2D} ctx The context containing the image data that will be flipped.
 * @param {"horizontal" | "vertical"} direction What plane the image will be flipped over.
 * @returns {void} The ctx param has the data written directly to it.
 *
 * @example
 * // Flips an image horizontally.
 * flip(context, "horizontal");
 */
function flip(ctx, direction) {
	const x = direction === "horizontal" ? -1 : 1;
	const y = direction === "vertical" ? -1 : 1;
	ctx.translate(direction === "horizontal" ? ctx.canvas.width : 0, direction === "vertical" ? ctx.canvas.height : 0);
	ctx.scale(x, y);
}


/**
 * Helper function that converts a Canvas Image to a context for quick editing.
 * @param {Canvas.Image} img The image loaded by Canvas.
 * @returns {Canvas.CanvasRenderingContext2D}
 *
 * @example
 * const ctx = await Canvas.loadImage(pathToImage).then(image2Context);
 */
function image2Context(img) {
	const ctx = Canvas.createCanvas(img.width, img.height).getContext("2d");
	ctx.drawImage(img, 0, 0);
	return ctx;
}

/**
 * Takes an RGB value in the range of 0-255 and converts it to 0-1 where 255 will output 1.
 * @param {number} tint int color value in the range of 0-255.
 * @returns {number}
 *
 * @example
 * const converted = tint2Mult(128);
 */
function tint2Mult(tint) {
	return tint > 0 ? tint / 255 : 0;
}

/**
 * Linearly interpolate (lerp for short) between two values over another value.
 * @param {number} a Min value.
 * @param {number} b Max value.
 * @param {number} t float typically in the range of 0-1. Can be higher or lower to over shoot the min or max.
 * @returns {number}
 *
 * @example
 * // The result of this call would return 31.25 which is 25% of the way between 0 and 125.
 * lerp(0, 125, 0.25);
 */
function lerp(a, b, t) {
	return a + (b - a) * t;
}

/**
 * Keep a value within a range of numbers.
 * @param {number} min Min value.
 * @param {number} max Max value.
 * @param {number} val Current value.
 * @returns {number}
 *
 * @example
 * // The result of this call would return 255.
 * clamp(0, 255, 1000);
 */
function clamp(min, max, val) {
	if (val < min) return min;
	if (val > max) return max;
	return val;
}


// HDR


/**
 * Converts an HDR R, G, or B component to standard RGB color space.
 * @param {number} x Either the R, G, or B component.
 * @returns {number}
 */
function linearToSRGB(x) {
	if (x <= 0.0031308) return x * 12.92;
	return 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/**
 * Converts a standard R, G, or B component into HDR linear space.
 * @param {number} x Either the R, G, or B component
 */
function sRGBToLinear(x) {
	if (x <= 0.04045) return x / 12.92;
	return Math.pow((x + 0.055) / 1.055, 2.4);
}


const exposure = 1.0;
const contrast = 1.0;
const saturation = 1.0;
const highlightCompression = 1.0;
const shadowLifting = 0.0;

/**
 * Converts an sRGB Color + an intensity value to HDR, applies the intensity, and then returns back the Color in sRGB space.
 * @param {number} r sRGB R component.
 * @param {number} g sRGB G component.
 * @param {number} b sRGB B component.
 * @param {number} intensity HDR intensity.
 * @returns {[number, number, number]} The RGB color.
 */
function hdrToSdr(r, g, b, intensity) {
	// Convert to linear space
	r = sRGBToLinear(r / 255);
	g = sRGBToLinear(g / 255);
	b = sRGBToLinear(b / 255);

	// Apply intensity and exposure
	r *= intensity * exposure;
	g *= intensity * exposure;
	b *= intensity * exposure;

	// Apply contrast
	r = Math.pow(r, contrast);
	g = Math.pow(g, contrast);
	b = Math.pow(b, contrast);

	// Apply ACES-inspired tone mapping
	r = tonemap(r * highlightCompression) + shadowLifting;
	g = tonemap(g * highlightCompression) + shadowLifting;
	b = tonemap(b * highlightCompression) + shadowLifting;

	// Apply saturation
	const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	r = luminance + saturation * (r - luminance);
	g = luminance + saturation * (g - luminance);
	b = luminance + saturation * (b - luminance);

	// Clamp values
	r = clamp(0, 1, r);
	g = clamp(0, 1, g);
	b = clamp(0, 1, b);

	// Convert back to sRGB space
	r = linearToSRGB(r);
	g = linearToSRGB(g);
	b = linearToSRGB(b);

	// Convert to 0-255 range
	r = Math.round(r * 255);
	g = Math.round(g * 255);
	b = Math.round(b * 255);

	return [r, g, b];
}


const toneA = 2.51;
const toneB = 0.03;
const toneC = 2.43;
const toneD = 0.59;
const toneE = 0.14;

/**
 * @param {number} x
 * @returns {number}
 */
function tonemap(x) {
	return (x * (toneA * x + toneB)) / (x * (toneC * x + toneD) + toneE);
}

module.exports = {
	normalDefaultRGB,
	swizzle,
	swizzleFrame,
	bumpScale,
	bumpScaleFrame,
	tint,
	tintFrame,
	tile,
	offset,
	resize,
	flip,
	image2Context,
	lerp,
	clamp,
	linearToSRGB,
	sRGBToLinear,
	hdrToSdr
}
