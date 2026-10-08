// Free SFW showcase gallery: creators post teaser photos (bikinis, teases,
// feet). Not for sale — drives traffic to their store and listings.
const express = require('express');
const multer = require('multer');
const db = require('../db');
const storage = require('../storage');
const { requireLogin, requireRole } = require('../middleware');

const router = express.Router();
const sellerOnly = requireRole('seller', 'admin');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
}).single('photo');

// Public gallery, newest first.
router.get('/', async (req, res) => {
  const posts = await db.all(
    `SELECT sp.*, u.display_name AS seller_name, u.handle AS seller_handle
     FROM showcase_posts sp JOIN users u ON u.id = sp.seller_id
     ORDER BY sp.id DESC LIMIT 200`
  );
  res.render('showcase', { title: 'Showcase', posts });
});

// Upload form (sellers only).
router.get('/new', requireLogin, sellerOnly, (req, res) => {
  res.render('showcase-new', { title: 'Post to showcase', error: null });
});

// Handle upload.
router.post('/', requireLogin, sellerOnly, (req, res) => {
  upload(req, res, async (err) => {
    if (err) return res.render('showcase-new', { title: 'Post to showcase', error: 'Upload failed. Try a smaller image.' });
    if (!req.file) return res.render('showcase-new', { title: 'Post to showcase', error: 'Choose a photo to post.' });
    const caption = String(req.body.caption || '').trim().slice(0, 280);
    try {
      const { url, public_id } = await storage.uploadImage(req.file.buffer, req.file.originalname);
      await db.run(
        'INSERT INTO showcase_posts (seller_id, image_url, public_id, caption) VALUES (?, ?, ?, ?)',
        req.user.id,
        url,
        public_id,
        caption
      );
      req.session.flash = { type: 'success', msg: 'Showcase post is live!' };
      res.redirect('/showcase');
    } catch (e) {
      res.render('showcase-new', { title: 'Post to showcase', error: 'Upload failed. Please try again.' });
    }
  });
});

// Delete own post (or any, as admin).
router.post('/:id/delete', requireLogin, async (req, res) => {
  const post = await db.get('SELECT * FROM showcase_posts WHERE id = ?', req.params.id);
  if (!post) return res.redirect('/showcase');
  if (post.seller_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).render('error', { title: 'Not allowed', message: 'You can only delete your own posts.' });
  }
  try {
    await storage.deleteImage({ url: post.image_url, public_id: post.public_id });
  } catch (_) {
    /* best effort */
  }
  await db.run('DELETE FROM showcase_posts WHERE id = ?', post.id);
  req.session.flash = { type: 'success', msg: 'Showcase post deleted.' };
  res.redirect('/showcase');
});

module.exports = router;
