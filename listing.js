// Shared helpers for saving a listing's preview images + delivery files.
const db = require('./db');
const {
  uploadImage,
  uploadDeliverable,
  deleteImage,
  deleteDeliverable,
  makeBlurredPreview,
  restoreClearPreview,
} = require('./storage');

async function insertDeliverable(productId, clear, pos) {
  await db.run(
    'INSERT INTO deliverables (product_id, storage, ref, resource_type, original_name, position) VALUES (?, ?, ?, ?, ?, ?)',
    productId,
    clear.storage,
    clear.ref,
    clear.resource_type,
    clear.original_name,
    pos
  );
}

// Save preview images. When `blur` is on, each photo is stored blurred as the
// public preview AND its clear original is added as a paywalled deliverable.
async function saveImages(files, productId, blur, imgStart = 0, delStart = 0) {
  let ipos = imgStart;
  let dpos = delStart;
  for (const f of files || []) {
    if (blur) {
      const { preview, clear } = await makeBlurredPreview({ buffer: f.buffer }, f.originalname);
      await db.run(
        'INSERT INTO product_images (product_id, url, public_id, blurred, clear_ref, clear_storage, position) VALUES (?, ?, ?, 1, ?, ?, ?)',
        productId,
        preview.url,
        preview.public_id,
        clear.ref,
        clear.storage,
        ipos++
      );
      await insertDeliverable(productId, clear, dpos++);
    } else {
      const img = await uploadImage(f.buffer, f.originalname);
      await db.run(
        'INSERT INTO product_images (product_id, url, public_id, blurred, position) VALUES (?, ?, ?, 0, ?)',
        productId,
        img.url,
        img.public_id,
        ipos++
      );
    }
  }
  return { nextImg: ipos, nextDel: dpos };
}

// Save extra (manually added) delivery files.
async function saveDeliverables(files, productId, startPos = 0) {
  let pos = startPos;
  for (const f of files || []) {
    const d = await uploadDeliverable(f.buffer, f.originalname);
    await insertDeliverable(productId, d, pos++);
  }
  return pos;
}

// Turn blur ON for existing clear previews (blurred=0): blur each and move its
// clear original into the paywalled delivery. Returns how many were converted.
async function applyBlurToExisting(productId) {
  const imgs = await db.all(
    'SELECT * FROM product_images WHERE product_id = ? AND blurred = 0 ORDER BY position, id',
    productId
  );
  if (!imgs.length) return 0;
  let dpos =
    Number((await db.get('SELECT COALESCE(MAX(position), -1) AS m FROM deliverables WHERE product_id = ?', productId)).m) + 1;
  let done = 0;
  for (const im of imgs) {
    let result;
    try {
      result = await makeBlurredPreview({ url: im.url }, 'photo.jpg');
    } catch (e) {
      continue;
    }
    await insertDeliverable(productId, result.clear, dpos++);
    const old = { url: im.url, public_id: im.public_id };
    await db.run(
      'UPDATE product_images SET url = ?, public_id = ?, blurred = 1, clear_ref = ?, clear_storage = ? WHERE id = ?',
      result.preview.url,
      result.preview.public_id,
      result.clear.ref,
      result.clear.storage,
      im.id
    );
    await deleteImage(old);
    done++;
  }
  return done;
}

// Turn blur OFF: restore blurred previews (blurred=1) back to the clear original,
// and remove the auto-added clear deliverable. Returns how many were restored.
async function applyUnblur(productId) {
  const imgs = await db.all('SELECT * FROM product_images WHERE product_id = ? AND blurred = 1', productId);
  let done = 0;
  for (const im of imgs) {
    // Fallback for images blurred before clear-tracking existed: on Cloudinary the
    // blurred preview's public_id already IS the clear authenticated asset.
    let clearRef = im.clear_ref;
    let clearStorage = im.clear_storage;
    if (!clearRef && im.public_id) {
      clearRef = im.public_id;
      clearStorage = 'cloudinary';
    }
    if (!clearRef) continue; // nothing to restore from (disk, untracked)
    const imLike = { ...im, clear_ref: clearRef, clear_storage: clearStorage };
    let restored;
    try {
      restored = await restoreClearPreview(imLike);
    } catch (e) {
      continue;
    }
    const old = { url: im.url, public_id: im.public_id };
    await db.run(
      'UPDATE product_images SET url = ?, public_id = ?, blurred = 0, clear_ref = NULL, clear_storage = NULL WHERE id = ?',
      restored.url,
      restored.public_id,
      im.id
    );
    // Remove the auto-added clear deliverable (blur is off — no paywall needed).
    const del = await db.get(
      'SELECT * FROM deliverables WHERE product_id = ? AND storage = ? AND ref = ?',
      productId,
      clearStorage,
      clearRef
    );
    if (del) {
      await db.run('DELETE FROM deliverables WHERE id = ?', del.id);
      if (clearStorage === 'disk') await deleteDeliverable(del); // disk: delete the file too
      // cloudinary: keep the asset — the (now clear) preview still uses it.
    }
    // Remove the old blurred preview asset only if it's a separate asset (disk).
    if (!restored.sharedAsset) await deleteImage(old);
    done++;
  }
  return done;
}

module.exports = { saveImages, saveDeliverables, applyBlurToExisting, applyUnblur };
