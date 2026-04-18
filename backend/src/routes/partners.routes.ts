import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import * as partnersController from '../controllers/partners.controller';

const router = Router();

router.use(authenticate);

router.get('/', requireRole('MEMBRE'), partnersController.list);
router.get('/:id', requireRole('MEMBRE'), partnersController.getById);
router.post('/', requireRole('POLE_LEAD'), partnersController.create);
router.patch('/:id', requireRole('POLE_LEAD'), partnersController.update);

export default router;
