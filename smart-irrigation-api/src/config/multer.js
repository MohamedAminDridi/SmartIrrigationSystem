const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const dir    = 'uploads/firmware';
fs.mkdirSync(dir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, dir),
  filename:    (_, file, cb) => {
    const safe = file.originalname.replace(/[^a-z0-9.-_]/gi, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const fileFilter = (_, file, cb) => {
  const ok = ['.bin','.hex','.elf'].includes(path.extname(file.originalname).toLowerCase());
  cb(ok ? null : new Error('Only .bin/.hex/.elf files allowed'), ok);
};

module.exports = multer({ storage, fileFilter, limits: { fileSize: 2*1024*1024 } });
