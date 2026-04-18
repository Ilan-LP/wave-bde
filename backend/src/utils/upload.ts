import multer from 'multer';
import path from 'path';
import fs from 'fs';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/app/uploads';
const PHOTOS_DIR = path.join(UPLOAD_DIR, 'photos');
const INVOICES_DIR = path.join(UPLOAD_DIR, 'invoices');

for (const dir of [PHOTOS_DIR, INVOICES_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function makeStorage(subdir: string) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(UPLOAD_DIR, subdir)),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  });
}

export const uploadPhoto = multer({
  storage: makeStorage('photos'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Format non supporté (jpeg, png, webp, gif)'));
  },
});

export const uploadInvoice = multer({
  storage: makeStorage('invoices'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Format non supporté (jpeg, png, pdf)'));
  },
});
