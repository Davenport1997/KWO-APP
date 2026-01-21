/**
 * 🛡️ KWO Production Backend (Integrated & Stabilized)
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { verifyToken, requireAdmin } from './middleware/auth.js';
import adminRoutes from './routes/admin.js';
import partnersRoutes from './routes/partners.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import chatRoutes from './routes/chat.js';
import checkinRoutes from './routes/checkin.js';
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3001;
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(cors({ origin: '*', credentials: true }));
// Rate Limiting
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));
// Public Routes
app.get('/health', (req, res) => res.json({ status: 'ok' }));
/**
 * 🛡️ Router Mapping
 */
app.use('/auth', authRoutes);
app.use('/user', userRoutes); // Handles /api/profile and /api/devices
app.use('/admin', verifyToken, requireAdmin, adminRoutes);
app.use('/api/partners', partnersRoutes);
app.use('/api/chat', chatRoutes);      // Handles /api/chat/messages and /api/chat/send
app.use('/api/check-ins', checkinRoutes); // Handles /api/check-ins/list and create
app.listen(PORT, () => console.log(`🚀 Production Backend Live`));
export default app;
