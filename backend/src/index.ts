import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';

import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth.routes';
import usersRoutes from './routes/users.routes';
import shiftsRoutes from './routes/shifts.routes';
import avoirsRoutes from './routes/avoirs.routes';
import stockRoutes from './routes/stock.routes';
import eventsRoutes from './routes/events.routes';
import partnersRoutes from './routes/partners.routes';
import communicationRoutes from './routes/communication.routes';
import lockRoutes from './routes/lock.routes';
import buvetteRoutes from './routes/buvette.routes';
import tresoRoutes from './routes/treso.routes';

const app = express();

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json());
app.use(cookieParser());

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/app/uploads';
app.use('/uploads', express.static(path.resolve(UPLOAD_DIR)));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/shifts', shiftsRoutes);
app.use('/api/v1/avoirs', avoirsRoutes);
app.use('/api/v1/stock', stockRoutes);
app.use('/api/v1/events', eventsRoutes);
app.use('/api/v1/partners', partnersRoutes);
app.use('/api/v1/communication', communicationRoutes);
app.use('/api/v1/lock', lockRoutes);
app.use('/api/v1/buvette', buvetteRoutes);
app.use('/api/v1/treso', tresoRoutes);

app.use(errorHandler);

const PORT = process.env.PORT ?? 4000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});

export default app;
