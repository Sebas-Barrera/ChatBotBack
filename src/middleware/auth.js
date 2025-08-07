const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const logger = require("../utils/logger");
const { AuthenticationError, AuthorizationError } = require("./errorHandler");

// ============================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================

class AuthMiddleware {
  /**
   * Genera un JWT token
   * @param {Object} payload - Datos a incluir en el token
   * @param {Object} options - Opciones del token
   * @returns {string} JWT token
   */
  static generateToken(payload, options = {}) {
    const defaultOptions = {
      expiresIn: process.env.JWT_EXPIRES_IN || "24h",
      issuer: "ChatBot-Chingon",
      audience: "restaurant-api",
    };

    const tokenOptions = { ...defaultOptions, ...options };

    try {
      return jwt.sign(payload, process.env.JWT_SECRET, tokenOptions);
    } catch (error) {
      logger.error("Error generando JWT token:", error);
      throw new Error("Error generando token de autenticación");
    }
  }

  /**
   * Verifica un JWT token
   * @param {string} token - Token a verificar
   * @returns {Object} Payload decodificado
   */
  static verifyToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        throw new AuthenticationError("Token expirado");
      } else if (error.name === "JsonWebTokenError") {
        throw new AuthenticationError("Token inválido");
      } else {
        logger.error("Error verificando JWT token:", error);
        throw new AuthenticationError("Error de autenticación");
      }
    }
  }

  /**
   * Hash de contraseña usando bcrypt
   * @param {string} password - Contraseña a hashear
   * @returns {Promise<string>} Hash de la contraseña
   */
  static async hashPassword(password) {
    try {
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 10;
      return await bcrypt.hash(password, saltRounds);
    } catch (error) {
      logger.error("Error hasheando contraseña:", error);
      throw new Error("Error procesando contraseña");
    }
  }

  /**
   * Compara contraseña con hash
   * @param {string} password - Contraseña en texto plano
   * @param {string} hash - Hash almacenado
   * @returns {Promise<boolean>} True si coinciden
   */
  static async comparePassword(password, hash) {
    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      logger.error("Error comparando contraseña:", error);
      return false;
    }
  }

  /**
   * Extrae token del header Authorization
   * @param {Object} req - Request object
   * @returns {string|null} Token extraído
   */
  static extractTokenFromHeader(req) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return null;
    }

    // Formato esperado: "Bearer <token>"
    const parts = authHeader.split(" ");

    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return null;
    }

    return parts[1];
  }

  /**
   * Middleware principal de autenticación JWT
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   * @param {Function} next - Next function
   */
  static authenticateToken = (req, res, next) => {
    try {
      const token = AuthMiddleware.extractTokenFromHeader(req); // Cambiar this por AuthMiddleware

      if (!token) {
        logger.warn("Intento de acceso sin token", {
          ip: req.ip,
          path: req.path,
          userAgent: req.get("User-Agent"),
        });
        throw new AuthenticationError("Token de acceso requerido");
      }

      // Verificar token
      const decoded = AuthMiddleware.verifyToken(token); // Cambiar this por AuthMiddleware

      // Agregar información del usuario al request
      req.user = {
        id: decoded.sub || decoded.userId,
        email: decoded.email,
        role: decoded.role || "user",
        restaurantId: decoded.restaurantId,
        permissions: decoded.permissions || [],
      };

      // Log de acceso exitoso
      logger.debug("Autenticación exitosa", {
        userId: req.user.id,
        role: req.user.role,
        path: req.path,
      });

      next();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        logger.warn("Error de autenticación", {
          error: error.message,
          ip: req.ip,
          path: req.path,
        });
      } else {
        logger.error("Error inesperado en autenticación:", error);
      }

      next(error);
    }
  };

  /**
   * Middleware de autenticación opcional
   * No falla si no hay token, pero lo procesa si existe
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   * @param {Function} next - Next function
   */
  static optionalAuth = (req, res, next) => {
    try {
      const token = AuthMiddleware.extractTokenFromHeader(req);

      if (!token) {
        // No hay token, continuar sin autenticación
        req.user = null;
        return next();
      }

      // Hay token, intentar verificarlo
      try {
        const decoded = AuthMiddleware.verifyToken(token);

        req.user = {
          id: decoded.sub || decoded.userId,
          email: decoded.email,
          role: decoded.role || "user",
          restaurantId: decoded.restaurantId,
          permissions: decoded.permissions || [],
        };

        logger.debug("Autenticación opcional exitosa", {
          userId: req.user.id,
          path: req.path,
        });
      } catch (authError) {
        // Token inválido, continuar sin autenticación
        logger.warn("Token inválido en autenticación opcional", {
          error: authError.message,
          path: req.path,
        });
        req.user = null;
      }

      next();
    } catch (error) {
      logger.error("Error en autenticación opcional:", error);
      // En caso de error, continuar sin autenticación
      req.user = null;
      next();
    }
  };

  /**
   * Middleware para verificar roles específicos
   * @param {Array|string} allowedRoles - Roles permitidos
   * @returns {Function} Middleware function
   */
  static requireRole = (allowedRoles) => {
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

    return (req, res, next) => {
      try {
        if (!req.user) {
          throw new AuthenticationError("Autenticación requerida");
        }

        const userRole = req.user.role;

        if (!roles.includes(userRole)) {
          logger.warn("Acceso denegado por rol insuficiente", {
            userId: req.user.id,
            userRole,
            requiredRoles: roles,
            path: req.path,
          });
          throw new AuthorizationError(
            `Acceso denegado. Roles requeridos: ${roles.join(", ")}`
          );
        }

        logger.debug("Verificación de rol exitosa", {
          userId: req.user.id,
          userRole,
          path: req.path,
        });

        next();
      } catch (error) {
        next(error);
      }
    };
  };

  /**
   * Middleware para verificar permisos específicos
   * @param {Array|string} requiredPermissions - Permisos requeridos
   * @returns {Function} Middleware function
   */
  static requirePermission = (requiredPermissions) => {
    const permissions = Array.isArray(requiredPermissions)
      ? requiredPermissions
      : [requiredPermissions];

    return (req, res, next) => {
      try {
        if (!req.user) {
          throw new AuthenticationError("Autenticación requerida");
        }

        const userPermissions = req.user.permissions || [];

        // Verificar si el usuario tiene todos los permisos requeridos
        const hasAllPermissions = permissions.every((permission) =>
          userPermissions.includes(permission)
        );

        if (!hasAllPermissions) {
          logger.warn("Acceso denegado por permisos insuficientes", {
            userId: req.user.id,
            userPermissions,
            requiredPermissions: permissions,
            path: req.path,
          });
          throw new AuthorizationError("Permisos insuficientes");
        }

        logger.debug("Verificación de permisos exitosa", {
          userId: req.user.id,
          permissions,
          path: req.path,
        });

        next();
      } catch (error) {
        next(error);
      }
    };
  };

  /**
   * Middleware para verificar acceso al restaurante
   * Verifica que el usuario tenga acceso al restaurante especificado
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   * @param {Function} next - Next function
   */
  static requireRestaurantAccess = (req, res, next) => {
    try {
      if (!req.user) {
        throw new AuthenticationError("Autenticación requerida");
      }

      // Super admin puede acceder a cualquier restaurante
      if (req.user.role === "super_admin") {
        return next();
      }

      // Obtener ID del restaurante de diferentes fuentes
      const restaurantId =
        req.restaurant?.id ||
        req.params.restaurantId ||
        req.body.restaurant_id ||
        req.user.restaurantId;

      if (!restaurantId) {
        throw new AuthorizationError("ID de restaurante no especificado");
      }

      // Verificar que el usuario pertenece al restaurante
      if (req.user.restaurantId !== restaurantId) {
        logger.warn("Intento de acceso a restaurante no autorizado", {
          userId: req.user.id,
          userRestaurantId: req.user.restaurantId,
          requestedRestaurantId: restaurantId,
          path: req.path,
        });
        throw new AuthorizationError("Acceso denegado al restaurante");
      }

      logger.debug("Acceso al restaurante autorizado", {
        userId: req.user.id,
        restaurantId,
        path: req.path,
      });

      next();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Middleware para API keys (para integraciones)
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   * @param {Function} next - Next function
   */
  static authenticateApiKey = (req, res, next) => {
    try {
      const apiKey = req.headers["x-api-key"] || req.query.api_key;

      if (!apiKey) {
        throw new AuthenticationError("API Key requerida");
      }

      // Verificar API key (en una implementación real, esto estaría en la BD)
      // Por ahora usamos una verificación simple con variable de entorno
      const validApiKeys = (process.env.VALID_API_KEYS || "")
        .split(",")
        .filter(Boolean);

      if (!validApiKeys.includes(apiKey)) {
        logger.warn("API Key inválida utilizada", {
          apiKey: apiKey.substring(0, 8) + "****",
          ip: req.ip,
          path: req.path,
        });
        throw new AuthenticationError("API Key inválida");
      }

      // Establecer información básica del "usuario" API
      req.user = {
        id: "api-user",
        role: "api",
        type: "api_key",
        permissions: ["read", "write"], // Permisos básicos para API
      };

      logger.debug("Autenticación con API Key exitosa", {
        apiKey: apiKey.substring(0, 8) + "****",
        path: req.path,
      });

      next();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Middleware que permite autenticación con JWT o API Key
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   * @param {Function} next - Next function
   */
  static authenticateJwtOrApiKey = (req, res, next) => {
    const hasJwtToken = !!AuthMiddleware.extractTokenFromHeader(req);
    const hasApiKey = !!(req.headers["x-api-key"] || req.query.api_key);

    if (hasJwtToken) {
      // Usar autenticación JWT
      return AuthMiddleware.authenticateToken(req, res, next);
    } else if (hasApiKey) {
      // Usar autenticación API Key
      return AuthMiddleware.authenticateApiKey(req, res, next);
    } else {
      // Ningún método de autenticación proporcionado
      throw new AuthenticationError("Token JWT o API Key requerido");
    }
  };

  /**
   * Middleware para refrescar tokens
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   * @param {Function} next - Next function
   */
  static refreshToken = (req, res, next) => {
    try {
      const { refresh_token } = req.body;

      if (!refresh_token) {
        throw new AuthenticationError("Refresh token requerido");
      }

      // Verificar refresh token
      const decoded = AuthMiddleware.verifyToken(refresh_token); // Cambiar this por AuthMiddleware

      if (decoded.type !== "refresh") {
        throw new AuthenticationError("Token de refresco inválido");
      }

      // Generar nuevo access token
      const newToken = AuthMiddleware.generateToken({
        sub: decoded.sub,
        email: decoded.email,
        role: decoded.role,
        restaurantId: decoded.restaurantId,
        permissions: decoded.permissions,
      });

      req.newToken = newToken;
      req.user = {
        id: decoded.sub,
        email: decoded.email,
        role: decoded.role,
        restaurantId: decoded.restaurantId,
        permissions: decoded.permissions,
      };

      logger.info("Token refrescado exitosamente", {
        userId: req.user.id,
      });

      next();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Genera tokens de acceso y refresco
   * @param {Object} payload - Datos del usuario
   * @returns {Object} Tokens generados
   */
  static generateTokenPair(payload) {
    const accessToken = AuthMiddleware.generateToken(payload, {
      expiresIn: "1h",
    });
    const refreshToken = AuthMiddleware.generateToken(
      { ...payload, type: "refresh" },
      { expiresIn: "7d" }
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: 3600, // 1 hora en segundos
    };
  }

  /**
   * Middleware de logging de autenticación
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   * @param {Function} next - Next function
   */
  static logAuthAttempt = (req, res, next) => {
    const hasAuth = !!(
      AuthMiddleware.extractTokenFromHeader(req) || req.headers["x-api-key"]
    );

    if (hasAuth) {
      logger.debug("Intento de autenticación detectado", {
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
      });
    }

    next();
  };
}

module.exports = AuthMiddleware;
