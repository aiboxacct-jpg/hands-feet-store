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
  uploadDeliverable,
  deliverableUrl,
  deliverableDiskPath,
  deleteDeliverable,
  UPLOAD_DIR,
  DELIVERABLES_DIR,
  useCloudinary,
};
