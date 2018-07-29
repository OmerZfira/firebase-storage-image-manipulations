const _ = require('lodash');
const path = require('path');
const sharp = require('sharp');

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const gcs = require('@google-cloud/storage')();
const { ORIGINAL_IMAGE_IDENTIFIER, IMAGE_SIZES } = require('./common/constants.json');

/**
 * upload resized images params - resizes image and uploads to bucket
 * @typedef uploadParams
 * @property  {*} bucket - destination gcs bucket instance
 * @property  {*} sharpPipelineClone - A read stream clone from the original image
 * @property  {String} contentType - image MIME type
 * @property  {String} resizedFilePath 
 * @property  {{ width: Number, height: Number }} sizeObject 
 */

admin.initializeApp(functions.config().firebase);

/** 
 * generateResizedImages - listens to uploads to gcs storage, and creates resized copies if eliglible image was uploaded
 * 
 * Relies on the image being of MIME 'image/..' AND file name to end with the string '_xoriginal' from constants.json
 * 
 * @return {Promise} Promise
 */
exports.generateResizedImages = functions.storage.object().onFinalize((object) => {
	const fileBucket = object.bucket; // The Storage bucket that contains the file.
	const contentType = object.contentType; // File content type.
	const filePath = object.name; // File path in the bucket.
	const { name, ext, dir } = path.parse(filePath);

	// Exit if this is triggered on a file that is not an image.
	if (!contentType.startsWith('image/')) {
		console.log('This is not an image.');
		return null;
	}

	// Exit if the image is already a resized version.
	if (!_.endsWith(name, ORIGINAL_IMAGE_IDENTIFIER)) {
		console.log(`Not an original image - ${name}${ext}`);
		return null;
	}

	const sharpPipeline = sharp();
	const bucket = gcs.bucket(fileBucket);
	const baseUploadParams = {
		bucket,
		contentType,
	};

	// Create read stream for original image and pipe into sharp
	bucket
		.file(filePath)
		.createReadStream()
		.pipe(sharpPipeline);

	const uploadPromises = _.transform(IMAGE_SIZES, (acc, sizeObject, sizeName) => {
		const resizedFileName = _.replace(name, ORIGINAL_IMAGE_IDENTIFIER, `_${sizeName}${ext}`)
		const resizedFilePath = path.join(dir, resizedFileName);
		const sharpPipelineClone = sharpPipeline.clone();

		/** @type {uploadParams} */
		const uploadParams = _.assign({}, baseUploadParams, { sizeObject, resizedFilePath, sharpPipelineClone });

		acc.push(uploadResizedImage(uploadParams));
	}, []);

	return Promise.all(uploadPromises)
		.then(() => {
			console.log(`Resized image ${name} successfully`);
			return;
		})
		.catch(console.error);
});

/**
 * uploadResizedImage - resizes image and uploads to bucket
 * @param {uploadParams} params
 * @return {Promise} Promise
 */
function uploadResizedImage(params) {
	const {
		bucket,
		contentType,
		sizeObject,
		resizedFilePath,
		sharpPipelineClone,
	} = params;
	const metadata = { contentType };

	// Create write stream for uploading resized image
	const resizedImgUploadStream = bucket
		.file(resizedFilePath)
		.createWriteStream({ metadata, 'resumable': false });

	// Use Sharp pipeline clone for resizing the image and pipe to bucket write stream
	sharpPipelineClone
		.resize(sizeObject.width, sizeObject.height)
		.pipe(resizedImgUploadStream);

	const streamAsPromise = new Promise((resolve, reject) =>
		resizedImgUploadStream.on('finish', resolve).on('error', reject));

	return streamAsPromise
		.then(() => {
			console.log(`Resized image to w: ${sizeObject.width}, h: ${sizeObject.height} successfully`);
			return;
		})
		.catch(console.error);
}