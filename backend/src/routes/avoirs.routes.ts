import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import * as avoirsController from '../controllers/avoirs.controller';

const router = Router();

router.use(authenticate);

router.get('/', requireRole('MEMBRE'), avoirsController.list);
router.post('/consume', requireRole('MEMBRE'), avoirsController.consume);
router.get('/:code/qr', requireRole('MEMBRE'), avoirsController.getQRCode);
router.get('/:code', requireRole('MEMBRE'), avoirsController.getByCode);
router.post('/', requireRole('ADMIN'), avoirsController.create);

export default router;
