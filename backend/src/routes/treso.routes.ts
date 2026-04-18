import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { uploadInvoice } from '../utils/upload';
import * as tresoController from '../controllers/treso.controller';

const router = Router();

router.use(authenticate);

router.get('/stats', requireRole('POLE_LEAD'), tresoController.getStats);
router.get('/transactions', requireRole('POLE_LEAD'), tresoController.listTransactions);
router.post('/transactions', requireRole('POLE_LEAD'), uploadInvoice.single('invoice'), tresoController.createTransaction);
router.patch('/transactions/:id', requireRole('POLE_LEAD'), tresoController.updateTransaction);
router.delete('/transactions/:id', requireRole('ADMIN'), tresoController.deleteTransaction);
router.post('/transactions/:id/invoice', requireRole('POLE_LEAD'), uploadInvoice.single('invoice'), tresoController.uploadInvoice);

export default router;
