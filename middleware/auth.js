import jwt from 'jsonwebtoken';
import { findUserById } from '../users_store.js';

export function getJwtSecret() {
    return process.env.JWT_SECRET || 'agent_hari_secure_jwt_production_secret_key_2026_x89a3f';
}

export function authenticateJwt(req, res, next) {
    let token = null;

    // 1. Check HTTP-only cookie
    if (req.cookies && req.cookies.agent_hari_token) {
        token = req.cookies.agent_hari_token;
    } 
    // 2. Fallback to Bearer token
    else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required. Please sign in.'
        });
    }

    try {
        const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
        const user = findUserById(decoded.id);
        
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'The account associated with this session no longer exists.'
            });
        }

        if (user.disabled) {
            return res.status(403).json({
                success: false,
                message: 'This account has been suspended. Please contact support.'
            });
        }

        const userRole = (user.role || 'user').trim().toLowerCase();

        req.user = {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone || '',
            companyName: user.companyName || '',
            jobTitle: user.jobTitle || '',
            companySize: user.companySize || '',
            industry: user.industry || '',
            profileCompleted: !!user.profileCompleted,
            role: userRole
        };
        
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Your session has expired. Please sign in again.'
            });
        }
        return res.status(401).json({
            success: false,
            message: 'Invalid authentication token. Please sign in again.'
        });
    }
}

export function requireAdmin(req, res, next) {
    authenticateJwt(req, res, () => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required. Please sign in.'
            });
        }

        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Admin access required. Access denied.'
            });
        }

        // Admin rights are granted/revoked by the owner from the /admin panel (role field).
        next();
    });
}
