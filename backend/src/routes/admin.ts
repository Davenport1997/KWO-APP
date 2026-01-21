import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth.js';
const router = Router();
export const requireAdmin = (req: Request, res: Response, next: any) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};
router.get('/cache-stats', verifyToken, requireAdmin, (req: Request, res: Response) => {
  res.json({ success: true, data: { status: 'healthy', memory: process.memoryUsage() } });
});
export default router;
