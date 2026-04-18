import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import * as buvetteController from '../controllers/buvette.controller';

const router = Router();

router.use(authenticate);

router.get('/items', requireRole('MEMBRE'), buvetteController.listItems);
router.post('/sell', requireRole('MEMBRE'), buvetteController.sell);
router.get('/ventes', requireRole('POLE_LEAD'), buvetteController.listVentes);

export default router;
