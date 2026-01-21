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
// Security middleware
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
// CORS
app.use(cors({
  origin: '*', 
  credentials: true
}));
// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: 'Too many requests, please try again later.' }
});
app.use(limiter);
// Health Check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
// Routers
app.use('/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/admin', verifyToken, requireAdmin, adminRoutes);
app.use('/api/partners', partnersRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/check-ins', checkinRoutes);
app.listen(PORT, () => console.log(`🚀 Production Backend Live on port ${PORT}`));
export default app;
