import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import * as lockController from '../controllers/lock.controller';

const router = Router();

router.use(authenticate);

router.get('/code', requireRole('MEMBRE'), lockController.getCode);
router.put('/code', requireRole('ADMIN'), lockController.updateCode);
router.get('/history', requireRole('ADMIN'), lockController.getHistory);

export default router;
