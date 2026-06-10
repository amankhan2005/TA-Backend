const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function makeStorage(folder, formats, transform) {
  return new CloudinaryStorage({ cloudinary, params: {
    folder, allowed_formats: formats, transformation: [transform],
  }});
}

function makeUpload(storage, sizeMB) {
  return multer({
    storage,
    limits: { fileSize: sizeMB * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files allowed.'));
      cb(null, true);
    },
  });
}

const uploadLogo         = makeUpload(makeStorage('teacherattendance/logos',    ['jpg','jpeg','png','webp'], { width:400, height:400, crop:'limit'         }), 5);
const uploadSelfie       = makeUpload(makeStorage('teacherattendance/selfies',  ['jpg','jpeg','png'],        { width:800, height:800, crop:'limit'         }), 10);
const uploadProfilePhoto = makeUpload(makeStorage('teacherattendance/profiles', ['jpg','jpeg','png','webp'], { width:400, height:400, crop:'fill', gravity:'face' }), 5);

module.exports = { cloudinary, uploadLogo, uploadSelfie, uploadProfilePhoto };
