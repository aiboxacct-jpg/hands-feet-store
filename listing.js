// Shared helpers for saving a listing's preview images + delivery files.
const db = require('./db');
const { uploadImage, uploadDeliverable, blurBuffer } = require('./storage');

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
        'INSERT INTO product_images (product_id, url, public_id, position) VALUES (?, ?, ?, ?)',
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
        'INSERT INTO product_images (product_id, url, public_id, position) VALUES (?, ?, ?, ?)',
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

module.exports = { saveImages, saveDeliverables };
