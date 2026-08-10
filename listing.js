// Shared helpers for saving a listing's preview images + delivery files.
const db = require('./db');
const { uploadImage, uploadDeliverable, blurBuffer, fetchImageBytes, deleteImage } = require('./storage');

// Save preview images. When `blur` is on, each photo is stored blurred as the
// public preview AND its clear original is added as a paywalled deliverable.
// Returns the next free position for deliverables (so extra files append after).
async function saveImages(files, productId, blur, imgStart = 0, delStart = 0) {
  let ipos = imgStart;
  let dpos = delStart;
  for (const f of files || []) {
    if (blur) {
      const blurred = await blurBuffer(f.buffer);
      const img = await uploadImage(blurred, 'preview.jpg');
      await db.run(
        'INSERT INTO product_images (product_id, url, public_id, blurred, position) VALUES (?, ?, ?, 1, ?)',
        productId,
        img.url,
        img.public_id,
        ipos++
      );
      const d = await uploadDeliverable(f.buffer, f.originalname);
      await db.run(
        'INSERT INTO deliverables (product_id, storage, ref, resource_type, original_name, position) VALUES (?, ?, ?, ?, ?, ?)',
        productId,
        d.storage,
        d.ref,
        d.resource_type,
        d.original_name,
        dpos++
      );
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
    await db.run(
      'INSERT INTO deliverables (product_id, storage, ref, resource_type, original_name, position) VALUES (?, ?, ?, ?, ?, ?)',
      productId,
      d.storage,
      d.ref,
      d.resource_type,
      d.original_name,
      pos++
    );
  }
  return pos;
}

// Blur any EXISTING clear preview photos (blurred=0): replace each public preview
// with a blurred version and move its clear original into the paywalled delivery.
// Returns how many were converted.
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
    let bytes;
    try {
      bytes = await fetchImageBytes(im); // the clear original (this preview is still clear)
    } catch (e) {
      continue; // can't fetch — leave it as-is
    }
    const blurredBuf = await blurBuffer(bytes);
    const newImg = await uploadImage(blurredBuf, 'preview.jpg');
    const d = await uploadDeliverable(bytes, 'photo.jpg');
    await db.run(
      'INSERT INTO deliverables (product_id, storage, ref, resource_type, original_name, position) VALUES (?, ?, ?, ?, ?, ?)',
      productId,
      d.storage,
      d.ref,
      d.resource_type,
      d.original_name,
      dpos++
    );
    const old = { url: im.url, public_id: im.public_id };
    await db.run('UPDATE product_images SET url = ?, public_id = ?, blurred = 1 WHERE id = ?', newImg.url, newImg.public_id, im.id);
    await deleteImage(old);
    done++;
  }
  return done;
}

module.exports = { saveImages, saveDeliverables, applyBlurToExisting };
