import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { uploadPhoto } from '../utils/upload';
import * as usersController from '../controllers/users.controller';

const router = Router();

router.use(authenticate);

router.get('/', requireRole('MEMBRE'), usersController.list);
router.get('/:id', requireRole('MEMBRE'), usersController.getById);
router.post('/', requireRole('ADMIN'), usersController.create);
router.patch('/:id', requireRole('POLE_LEAD'), usersController.update);
router.delete('/:id', requireRole('ADMIN'), usersController.softDelete);
router.post('/:id/photo', requireRole('MEMBRE'), uploadPhoto.single('photo'), usersController.uploadPhoto);

export default router;
