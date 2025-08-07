const User = require('../models/User');
const AuthMiddleware = require('../middleware/auth');
const logger = require('../utils/logger');
const { AuthenticationError, ValidationError } = require('../middleware/errorHandler');

// ============================================
// CONTROLADOR DE AUTENTICACIÓN
// ============================================

class AuthController {
  /**
   * Login de usuario
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static async login(req, res, next) {
    try {
      const { email, password } = req.body;

      // Validación básica
      if (!email || !password) {
        throw new ValidationError('Email y contraseña son requeridos');
      }

      // Validar formato de email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new ValidationError('Formato de email inválido');
      }

      // Buscar usuario
      const user = await User.findByEmailWithProfile(email.toLowerCase().trim());
      
      if (!user) {
        logger.warn('Intento de login con email inexistente', { 
          email: email.substring(0, 5) + '****',
          ip: req.ip 
        });
        throw new AuthenticationError('Credenciales inválidas');
      }

      // Verificar si el usuario está activo
      if (!user.is_active) {
        logger.warn('Intento de login con usuario inactivo', { 
          userId: user.id,
          ip: req.ip 
        });
        throw new AuthenticationError('Cuenta desactivada');
      }

      // Verificar contraseña
      const isPasswordValid = await User.verifyPassword(password, user.password_hash);
      
      if (!isPasswordValid) {
        logger.warn('Intento de login con contraseña incorrecta', { 
          userId: user.id,
          ip: req.ip 
        });
        throw new AuthenticationError('Credenciales inválidas');
      }

      // Generar tokens
      const tokenPayload = {
        sub: user.id,
        email: user.email,
        role: user.profile.role.name,
        restaurantId: user.profile.restaurant_id,
        permissions: user.profile.role.permissions || []
      };

      const tokens = AuthMiddleware.generateTokenPair(tokenPayload);

      // Actualizar último login
      await User.updateLastLogin(user.id);

      // Respuesta exitosa
      const responseData = {
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          profile: {
            role: user.profile.role.name,
            role_display_name: user.profile.role.display_name,
            permissions: user.profile.role.permissions,
            restaurant: user.profile.restaurant,
            phone: user.profile.phone,
            avatar_url: user.profile.avatar_url
          }
        },
        tokens
      };

      logger.info('Login exitoso', { 
        userId: user.id,
        role: user.profile.role.name,
        restaurant: user.profile.restaurant?.name || 'Sistema',
        ip: req.ip 
      });

      res.json({
        success: true,
        message: 'Login exitoso',
        data: responseData
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Refresh token
   * @param {Object} req - Request object  
   * @param {Object} res - Response object
   */
  static async refreshToken(req, res, next) {
    try {
      // El middleware ya procesó el refresh token y generó uno nuevo
      const newTokens = {
        access_token: req.newToken,
        refresh_token: req.body.refresh_token, // Mantener el mismo refresh token
        token_type: 'Bearer',
        expires_in: 3600
      };

      logger.info('Token refrescado exitosamente', { 
        userId: req.user.id 
      });

      res.json({
        success: true,
        message: 'Token refrescado exitosamente',
        data: { tokens: newTokens }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Obtiene información del usuario actual
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static async getCurrentUser(req, res, next) {
    try {
      const user = await User.findByEmailWithProfile(req.user.email);
      
      if (!user) {
        throw new AuthenticationError('Usuario no encontrado');
      }

      const userData = {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        profile: {
          role: user.profile.role.name,
          role_display_name: user.profile.role.display_name,
          permissions: user.profile.role.permissions,
          restaurant: user.profile.restaurant,
          phone: user.profile.phone,
          avatar_url: user.profile.avatar_url,
          settings: user.profile.settings
        }
      };

      res.json({
        success: true,
        data: { user: userData }
      });

    } catch (error) {
      next(error);
    }
  }
}

module.exports = AuthController;