const router  = require('express').Router();
const ctrl    = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate');
const { registerSchema, loginSchema } = require('../validators/auth.validator');

router.post('/register',        validate(registerSchema), ctrl.register);
router.post('/login',           validate(loginSchema),    ctrl.login);
router.post('/logout',          protect, ctrl.logout);
router.get ('/me',              protect, ctrl.getProfile);
router.put ('/me',              protect, ctrl.updateProfile);
router.post('/refresh',         ctrl.refresh);
router.post('/reset-password',  ctrl.resetPassword);

module.exports = router;
