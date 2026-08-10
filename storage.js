// Image storage with two backends:
//  - Cloudinary when CLOUDINARY_URL is set (production / persistent)
//  - Local ./uploads folder otherwise (local dev)
//
// uploadImage(buffer, originalName) -> { url, public_id }
// deleteImage({ url, public_id }) removes it from whichever backend.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const useCloudinary = !!process.env.CLOUDINARY_URL;

// Produce a heavily-blurred, downscaled JPEG for a public preview. The detail is
// destroyed (not just visually hidden), so the clear original can't be recovered.
async function blurBuffer(buffer) {
  const Jimp = require('jimp');
  const img = await Jimp.read(buffer);
  img.scaleToFit(720, 720).quality(60).blur(45);
  return img.getBufferAsync(Jimp.MIME_JPEG);
}

let cloudinary = null;
if (useCloudinary) {
  cloudinary = require('cloudinary').v2; // reads CLOUDINARY_URL from env automatically
}

function uploadImage(buffer, originalName) {
  if (useCloudinary) {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'store', resource_type: 'image' },
        (err, result) => {
          if (err) return reject(err);
          resolve({ url: result.secure_url, public_id: result.public_id });
        }
      );
      stream.end(buffer);
    });
  }
  // Local disk fallback.
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const ext = (path.extname(originalName) || '.jpg').toLowerCase().slice(0, 5);
  const filename = crypto.randomBytes(16).toString('hex') + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  return Promise.resolve({ url: '/uploads/' + filename, public_id: null });
}

// Create a blurred public preview + keep the clear original private, from a
// source that is either { buffer } or { url } (an existing image).
// PRODUCTION (Cloudinary): the blur is done on Cloudinary's servers via a signed
// transformation — no heavy image processing in this app (avoids out-of-memory).
// LOCAL (disk): uses jimp.
// Returns { preview: { url, public_id }, clear: { storage, ref, resource_type, original_name } }.
async function makeBlurredPreview(source, originalName) {
  const name = originalName || 'photo.jpg';
  if (useCloudinary) {
    // 1) store the clear image as an authenticated (private) asset — Cloudinary
    //    fetches it directly when given a URL, so we never load it into memory.
    const clearUp = await new Promise((resolve, reject) => {
      const opts = { folder: 'store_clear', type: 'authenticated', resource_type: 'image' };
      if (source.buffer) {
        const stream = cloudinary.uploader.upload_stream(opts, (e, r) => (e ? reject(e) : resolve(r)));
        stream.end(source.buffer);
      } else {
        cloudinary.uploader.upload(source.url, opts, (e, r) => (e ? reject(e) : resolve(r)));
      }
    });
    // 2) the public preview is a permanent SIGNED, blurred transformation URL.
    const blurUrl = cloudinary.url(clearUp.public_id, {
      type: 'authenticated',
      resource_type: 'image',
      secure: true,
      sign_url: true,
      transformation: [{ effect: 'blur:2000', quality: 'auto' }],
    });
    return {
      preview: { url: blurUrl, public_id: clearUp.public_id },
      clear: { storage: 'cloudinary', ref: clearUp.public_id, resource_type: 'image', original_name: name },
    };
  }
  // Local disk: blur with jimp (dev only, small scale).
  const bytes = source.buffer || fs.readFileSync(path.join(UPLOAD_DIR, path.basename(source.url)));
  const blurredBuf = await blurBuffer(bytes);
  const preview = await uploadImage(blurredBuf, 'preview.jpg');
  const clear = await uploadDeliverable(bytes, name);
  return { preview, clear };
}

// Restore a clear public preview from the tracked clear original, for un-blur.
// image needs { clear_ref, clear_storage, url, public_id }. Returns { url, public_id }.
async function restoreClearPreview(image) {
  if (image.clear_storage === 'cloudinary') {
    // The clear is the authenticated asset (public_id === clear_ref). Show it via a
    // permanent signed URL (blur is off, so the seller wants it visible).
    const url = cloudinary.url(image.clear_ref, {
      type: 'authenticated',
      resource_type: 'image',
      secure: true,
      sign_url: true,
    });
    return { url, public_id: image.clear_ref, sharedAsset: true };
  }
  // disk: the clear original lives in the deliverables dir — re-publish it.
  const bytes = fs.readFileSync(path.join(DELIVERABLES_DIR, image.clear_ref));
  const pub = await uploadImage(bytes, 'clear.jpg');
  return { url: pub.url, public_id: pub.public_id, sharedAsset: false };
}

// Read the raw bytes of a stored preview image (local file or remote URL).
async function fetchImageBytes(image) {
  if (image.url && image.url.startsWith('/uploads/')) {
    return fs.readFileSync(path.join(UPLOAD_DIR, path.basename(image.url)));
  }
  const res = await fetch(image.url);
  if (!res.ok) throw new Error('Could not fetch image: ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

async function deleteImage(image) {
  if (!image) return;
  if (useCloudinary) {
    if (image.public_id) {
      try {
        await cloudinary.uploader.destroy(image.public_id);
      } catch (_) {
        /* ignore */
      }
    }
    return;
  }
  // Local file: url looks like "/uploads/<name>"
  if (image.url && image.url.startsWith('/uploads/')) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(image.url)), () => {});
  }
}

// --- Deliverables (private files a buyer downloads AFTER paying) -------------
const DELIVERABLES_DIR = path.join(__dirname, 'deliverables');

// Upload a private deliverable. Returns a row for the `deliverables` table.
function uploadDeliverable(buffer, originalName) {
  if (useCloudinary) {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'deliverables', resource_type: 'auto', type: 'authenticated' },
        (err, result) => {
          if (err) return reject(err);
          resolve({
            storage: 'cloudinary',
            ref: result.public_id,
            resource_type: result.resource_type, // image | raw | video
            original_name: originalName || 'file',
          });
        }
      );
      stream.end(buffer);
    });
  }
  if (!fs.existsSync(DELIVERABLES_DIR)) fs.mkdirSync(DELIVERABLES_DIR, { recursive: true });
  const ext = (path.extname(originalName || '') || '').toLowerCase().slice(0, 10);
  const filename = crypto.randomBytes(16).toString('hex') + ext;
  fs.writeFileSync(path.join(DELIVERABLES_DIR, filename), buffer);
  return Promise.resolve({ storage: 'disk', ref: filename, resource_type: 'raw', original_name: originalName || 'file' });
}

// A short-lived signed URL (Cloudinary) the buyer can download from. Disk files
// are streamed by the route instead (returns null here).
function deliverableUrl(d) {
  if (d.storage === 'cloudinary') {
    return cloudinary.url(d.ref, {
      resource_type: d.resource_type || 'raw',
      type: 'authenticated',
      secure: true,
      sign_url: true,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 30, // 30 min
      attachment: true, // force download
    });
  }
  return null;
}

function deliverableDiskPath(d) {
  return path.join(DELIVERABLES_DIR, d.ref);
}

async function deleteDeliverable(d) {
  if (!d) return;
  if (d.storage === 'cloudinary') {
    try {
      await cloudinary.uploader.destroy(d.ref, { resource_type: d.resource_type || 'raw', type: 'authenticated' });
    } catch (_) {
      /* ignore */
    }
    return;
  }
  fs.unlink(path.join(DELIVERABLES_DIR, d.ref), () => {});
}

module.exports = {
  uploadImage,
  deleteImage,
  fetchImageBytes,
  blurBuffer,
  makeBlurredPreview,
  restoreClearPreview,
  uploadDeliverable,
  deliverableUrl,
  deliverableDiskPath,
  deleteDeliverable,
  UPLOAD_DIR,
  DELIVERABLES_DIR,
  useCloudinary,
};
