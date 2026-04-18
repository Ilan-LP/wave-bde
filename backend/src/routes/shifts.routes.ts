import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import * as shiftsController from '../controllers/shifts.controller';

const router = Router();

router.use(authenticate);

router.get('/', requireRole('MEMBRE'), shiftsController.list);
router.post('/', requireRole('POLE_LEAD'), shiftsController.create);
router.patch('/:id', requireRole('POLE_LEAD'), shiftsController.update);
router.post('/:id/claim', requireRole('MEMBRE'), shiftsController.claim);
router.post('/exchange', requireRole('MEMBRE'), shiftsController.requestExchange);

export default router;
