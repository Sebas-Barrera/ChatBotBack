const express = require('express');
const AuthController = require('../controllers/authController');
const AuthMiddleware = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// ============================================
// RUTAS PÚBLICAS DE AUTENTICACIÓN
// ============================================

/**
 * Login de usuario
 * URL: POST /api/auth/login
 * Body: { email, password }
 */
router.post('/login', AuthController.login);

/**
 * Refresh token
 * URL: POST /api/auth/refresh
 * Body: { refresh_token }
 */
router.post('/refresh', AuthMiddleware.refreshToken, AuthController.refreshToken);

// ============================================
// RUTAS PROTEGIDAS
// ============================================

/**
 * Obtiene información del usuario actual
 * URL: GET /api/auth/me
 * Headers: Authorization: Bearer <token>
 */
router.get('/me', 
  AuthMiddleware.authenticateToken, 
  AuthController.getCurrentUser
);

/**
 * Logout (invalidar token - opcional)
 * URL: POST /api/auth/logout
 */
router.post('/logout', 
  AuthMiddleware.authenticateToken, 
  (req, res) => {
    // En una implementación real, aquí invalidarías el token en una blacklist
    logger.info('Usuario cerró sesión', { userId: req.user.id });
    
    res.json({
      success: true,
      message: 'Sesión cerrada exitosamente'
    });
  }
);

module.exports = router;