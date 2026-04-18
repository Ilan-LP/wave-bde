import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import * as stockController from '../controllers/stock.controller';

const router = Router();

router.use(authenticate);

router.get('/', requireRole('MEMBRE'), stockController.list);
router.post('/', requireRole('POLE_LEAD'), stockController.create);
router.patch('/:id', requireRole('POLE_LEAD'), stockController.update);
router.delete('/:id', requireRole('ADMIN'), stockController.softDelete);
router.post('/:id/movements', requireRole('POLE_LEAD'), stockController.addMovement);
router.get('/:id/movements', requireRole('MEMBRE'), stockController.getMovements);

export default router;
