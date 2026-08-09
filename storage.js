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

module.exports = { uploadImage, deleteImage, UPLOAD_DIR, useCloudinary };
