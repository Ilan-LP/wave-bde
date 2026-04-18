import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import * as commController from '../controllers/communication.controller';

const router = Router();

router.use(authenticate);

router.get('/', requireRole('MEMBRE'), commController.list);
router.post('/', requireRole('POLE_LEAD'), commController.create);
router.patch('/:id', requireRole('POLE_LEAD'), commController.update);

export default router;
