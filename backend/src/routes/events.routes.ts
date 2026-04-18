import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import * as eventsController from '../controllers/events.controller';

const router = Router();

router.use(authenticate);

router.get('/', requireRole('MEMBRE'), eventsController.list);
router.get('/:id', requireRole('MEMBRE'), eventsController.getById);
router.post('/', requireRole('POLE_LEAD'), eventsController.create);
router.patch('/:id', requireRole('POLE_LEAD'), eventsController.update);

export default router;
