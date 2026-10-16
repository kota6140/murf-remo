import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 8080;

// Configure CORS
// Browsers on other websites may not call this API. Same-site pages and server-to-server
// calls (Plivo, ElevenLabs) don't send a cross-site Origin, so they are not affected.
const ALLOWED_ORIGINS = new Set([
    'https://takeremo.com',
    'https://www.takeremo.com',
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`
]);
app.use(cors({
    origin: (origin, callback) => callback(null, !origin || ALLOWED_ORIGINS.has(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// The project root is served statically, so keep private files (user data, uploads, source) out of it
const safeDecode = (p) => { try { return decodeURIComponent(p); } catch { return p; } };
const PRIVATE_PATH = /^\/(data|routes|services|middleware|docs|node_modules|\.git)(\/|$)|^\/[^/]+\.(mjs|cjs|json|md|db|wav)$|^\/(server|users_store|proposals_store|demo_store)\.js$/i;
app.use((req, res, next) => (PRIVATE_PATH.test(safeDecode(req.path).replace(/\\/g, '/')) ? res.status(404).end() : next()));

// Serve static files from root
app.use(express.static(__dirname));

import authRoutes from './routes/auth.js';
import adminRoutes, {
    handleExotelWebhook,
    handlePlivoAnswer,
    handlePlivoStatus,
    handlePlivoHangup,
    handleElevenLabsWebhook
} from './routes/admin.js';
import userRoutes from './routes/user.js';
import ownerRoutes from './routes/owner.js';
import demoRoutes from './routes/demo.js';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './middleware/auth.js';
import { findUserById } from './users_store.js';

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/demo', demoRoutes);

// Health Check Endpoint
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() }));

// Dedicated Full-Page Routes
// Owner admin panel (login is handled inside the page; all data lives behind /api/owner)
app.get(['/admin', '/admin/'], (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/signin', (req, res) => res.sendFile(path.join(__dirname, 'signin.html')));
app.get('/login', (req, res) => res.redirect(301, '/signin'));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'signup.html')));
app.get('/forgot-password', (req, res) => res.sendFile(path.join(__dirname, 'forgot-password.html')));
// Password reset now uses an emailed 6-digit code on the forgot-password page
app.get('/reset-password', (req, res) => res.redirect(302, '/forgot-password'));
app.get('/onboarding', (req, res) => res.sendFile(path.join(__dirname, 'onboarding.html')));

app.get('/dashboard', (req, res) => {
    // Protected Admin Dashboard Route
    let token = req.cookies.agent_hari_token;
    if (!token) {
        const authHeader = req.headers.authorization || '';
        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }
    }

    if (!token && !process.env.TESTING) {
        return res.redirect(302, '/signin');
    }

    // Role restriction: Non-admin users cannot access the admin dashboard
    if (token && !process.env.TESTING) {
        try {
            const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
            const user = findUserById(decoded.id);
            if (!user) {
                return res.redirect(302, '/signin');
            }
            const isAdmin = (user.role || '').toLowerCase() === 'admin';
            if (!isAdmin) {
                return res.redirect(302, '/user-dashboard');
            }
        } catch (e) {
            return res.redirect(302, '/signin');
        }
    }

    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// User Dashboard Route (for non-admin users)
app.get('/user-dashboard', (req, res) => {
    let token = req.cookies.agent_hari_token;
    if (!token) {
        const authHeader = req.headers.authorization || '';
        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }
    }
    if (!token && !process.env.TESTING) {
        return res.redirect(302, '/signin');
    }
    res.sendFile(path.join(__dirname, 'user-dashboard.html'));
});

app.get('/account', (req, res) => res.redirect(302, '/dashboard'));

// Phone Preview Routes
app.get('/phone-preview', (req, res) => res.sendFile(path.join(__dirname, 'phone-designs-preview.html')));
app.get('/phone-designs-preview', (req, res) => res.sendFile(path.join(__dirname, 'phone-designs-preview.html')));

// Service pages: /service/<slug>  (not /services/..., which is blocked above as a private source folder)
const SERVICE_PAGES = {
    'recruitment': 'service-recruitment.html',
    'sales': 'service-sales.html',
    'customer-support': 'service-support.html',
    'appointment-setting': 'service-appointment.html',
    'receptionist': 'service-receptionist.html'
};
app.get('/service/:slug', (req, res, next) => {
    const file = SERVICE_PAGES[req.params.slug];
    if (!file) return next();
    res.sendFile(path.join(__dirname, file));
});

app.get('/overview', (req, res) => res.sendFile(path.join(__dirname, 'overview.html')));
app.get('/enterprise', (req, res) => res.sendFile(path.join(__dirname, 'enterprise.html')));
app.get(['/security-compliance', '/security', '/security-privacy'], (req, res) => res.sendFile(path.join(__dirname, 'security.html')));
app.get('/how-it-works', (req, res) => res.sendFile(path.join(__dirname, 'how-it-works.html')));
// (not /services: that path is blocked above as a private source folder)
const INDUSTRY_SLUGS = ['healthcare', 'recruitment', 'sales', 'education', 'realestate', 'support', 'finance', 'automotive'];
app.get('/industry/:slug', (req, res, next) => (INDUSTRY_SLUGS.includes(req.params.slug) ? res.sendFile(path.join(__dirname, 'industry.html')) : next()));
app.get('/industries', (req, res) => res.sendFile(path.join(__dirname, 'industries.html')));
app.get('/our-services', (req, res) => res.sendFile(path.join(__dirname, 'our-services.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(__dirname, 'contact.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Webhooks for Plivo Telephony
app.all('/api/plivo/answer', handlePlivoAnswer);
app.all('/api/plivo/status', handlePlivoStatus);
app.all('/api/plivo/hangup', handlePlivoHangup);

// Webhook for ElevenLabs Voice AI
app.post('/api/webhooks/elevenlabs', handleElevenLabsWebhook);

// Webhook for Exotel (Legacy fallback)
app.all('/api/exotel/callback', handleExotelWebhook);
app.all('/api/exotel/webhook', handleExotelWebhook);

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'An unexpected error occurred.'
    });
});

import { handleVoicebotWebsocket } from './services/voicebot_stream_service.js';

// Configure WebSockets
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    let pathname = '/';
    try {
        pathname = new URL(request.url, 'http://localhost').pathname;
    } catch (e) {
        pathname = (request.url || '').split('?')[0];
    }

    console.log('[WebSocket Upgrade Request] Incoming connection on:', pathname);
    if (
        pathname === '/voicebot' ||
        pathname === '/voicebot/' ||
        pathname.startsWith('/voicebot') ||
        pathname.startsWith('/api/plivo/stream')
    ) {
        wss.handleUpgrade(request, socket, head, (ws) => {
            handleVoicebotWebsocket(ws, request);
        });
    } else {
        socket.destroy();
    }
});

server.listen(PORT, () => {
    console.log("===============================================");
    console.log(`  Agent Hari Node.js Server running on http://localhost:${PORT}`);
    console.log(`  Plivo & ElevenLabs Audio Stream Active on /voicebot`);
    console.log("===============================================");
});
