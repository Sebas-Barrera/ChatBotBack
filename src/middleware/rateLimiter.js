const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const { RATE_LIMITS, SECURITY_EVENTS } = require('../utils/constants');
const { RateLimitError } = require('./errorHandler');

// ============================================
// CONFIGURACIÓN BASE DE RATE LIMITING
// ============================================

/**
 * Configuración base para todos los rate limiters
 */
const baseConfig = {
  standardHeaders: true, // Retorna rate limit info en headers `RateLimit-*`
  legacyHeaders: false, // Deshabilita headers `X-RateLimit-*`
  
  // Función personalizada para generar key
  keyGenerator: (req) => {
    // Usar IP + User-Agent para mejor identificación
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent') || 'unknown';
    return `${ip}:${Buffer.from(userAgent).toString('base64').substring(0, 20)}`;
  },

  // Handler cuando se excede el límite
  handler: (req, res, next) => {
    const clientInfo = {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.originalUrl,
      method: req.method
    };

    logger.logSecurity(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, 'medium', {
      ...clientInfo,
      limit: req.rateLimit.limit,
      remaining: req.rateLimit.remaining,
      resetTime: new Date(req.rateLimit.resetTime)
    });

    const error = new RateLimitError(
      process.env.RATE_LIMIT_MESSAGE || 'Demasiadas solicitudes, intenta en unos minutos'
    );
    
    next(error);
  },

  // Función para omitir ciertos requests
  skip: (req) => {
    // No aplicar rate limiting en desarrollo si está configurado
    if (process.env.NODE_ENV === 'development' && process.env.SKIP_RATE_LIMIT === 'true') {
      return true;
    }

    // No aplicar a health checks
    if (req.path === '/health') {
      return true;
    }

    return false;
  }
};

// ============================================
// RATE LIMITERS ESPECÍFICOS
// ============================================

/**
 * Rate limiter general para API
 */
const apiLimiter = rateLimit({
  ...baseConfig,
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutos
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || RATE_LIMITS.API_PER_MINUTE,
  message: {
    success: false,
    error: {
      type: 'rate_limit',
      message: 'Demasiadas solicitudes desde esta IP, intenta de nuevo en 15 minutos',
      retryAfter: 15 * 60
    }
  }
});

/**
 * Rate limiter estricto para webhooks
 */
const webhookLimiter = rateLimit({
  ...baseConfig,
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: RATE_LIMITS.WEBHOOK_PER_MINUTE,
  message: {
    success: false,
    error: {
      type: 'rate_limit',
      message: 'Demasiadas solicitudes al webhook',
      retryAfter: 60
    }
  },
  
  // Key específica para webhooks (por proveedor)
  keyGenerator: (req) => {
    const ip = req.ip;
    const provider = req.headers['user-agent']?.includes('Twilio') ? 'twilio' : 
                    req.headers['user-agent']?.includes('facebookexternalhit') ? 'meta' : 'unknown';
    return `webhook:${provider}:${ip}`;
  }
});

/**
 * Rate limiter para operaciones con Claude AI
 */
const claudeLimiter = rateLimit({
  ...baseConfig,
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: RATE_LIMITS.CLAUDE_PER_MINUTE,
  message: {
    success: false,
    error: {
      type: 'rate_limit',
      message: 'Demasiadas solicitudes a la IA, intenta en un momento',
      retryAfter: 60
    }
  },
  
  // Solo aplicar a rutas que usen Claude
  skip: (req) => {
    if (baseConfig.skip(req)) return true;
    
    // Solo aplicar a rutas específicas
    const claudeRoutes = ['/webhook', '/api/chat'];
    return !claudeRoutes.some(route => req.path.startsWith(route));
  }
});

/**
 * Rate limiter para WhatsApp
 */
const whatsappLimiter = rateLimit({
  ...baseConfig,
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: RATE_LIMITS.WHATSAPP_PER_MINUTE,
  message: {
    success: false,
    error: {
      type: 'rate_limit',
      message: 'Demasiados mensajes de WhatsApp',
      retryAfter: 60
    }
  }
});

/**
 * Rate limiter muy estricto para autenticación
 */
const authLimiter = rateLimit({
  ...baseConfig,
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // Solo 5 intentos cada 15 minutos
  skipSuccessfulRequests: true, // No contar requests exitosos
  message: {
    success: false,
    error: {
      type: 'rate_limit',
      message: 'Demasiados intentos de autenticación, intenta en 15 minutos',
      retryAfter: 15 * 60
    }
  },

  // Key específica para auth (incluir endpoint)
  keyGenerator: (req) => {
    const ip = req.ip;
    const endpoint = req.path;
    return `auth:${endpoint}:${ip}`;
  }
});

/**
 * Rate limiter para operaciones de administración
 */
const adminLimiter = rateLimit({
  ...baseConfig,
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 30, // 30 requests cada 5 minutos
  message: {
    success: false,
    error: {
      type: 'rate_limit',
      message: 'Demasiadas operaciones administrativas',
      retryAfter: 5 * 60
    }
  }
});

// ============================================
// RATE LIMITER DINÁMICO
// ============================================

/**
 * Rate limiter que se ajusta basado en el endpoint
 * @param {Object} options - Configuración específica
 * @returns {Function} Middleware de rate limiting
 */
const createDynamicLimiter = (options = {}) => {
  const config = {
    ...baseConfig,
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: options.max || 100,
    message: options.message || {
      success: false,
      error: {
        type: 'rate_limit',
        message: 'Demasiadas solicitudes',
        retryAfter: Math.floor((options.windowMs || 15 * 60 * 1000) / 1000)
      }
    },
    ...options
  };

  return rateLimit(config);
};

// ============================================
// MIDDLEWARE DE LOGGING
// ============================================

/**
 * Middleware que loggea información de rate limiting
 */
const rateLimitLogger = (req, res, next) => {
  // Solo loggear si hay información de rate limit
  if (req.rateLimit) {
    const { limit, remaining, resetTime } = req.rateLimit;
    
    // Loggear cuando quedan pocos requests
    if (remaining <= Math.floor(limit * 0.1)) { // 10% o menos
      logger.warn('Rate limit casi alcanzado', {
        ip: req.ip,
        path: req.path,
        method: req.method,
        limit,
        remaining,
        resetTime: new Date(resetTime),
        userAgent: req.get('User-Agent')
      });
    }

    // Agregar headers informativos
    res.set({
      'X-RateLimit-Limit': limit,
      'X-RateLimit-Remaining': remaining,
      'X-RateLimit-Reset': Math.ceil(resetTime / 1000)
    });
  }

  next();
};

// ============================================
// FUNCIÓN DE BYPASS PARA TESTING
// ============================================

/**
 * Middleware que permite bypass de rate limiting para testing
 */
const testBypass = (req, res, next) => {
  // Solo en modo test
  if (process.env.NODE_ENV === 'test') {
    // Verificar header especial
    if (req.headers['x-test-bypass-rate-limit'] === process.env.TEST_BYPASS_TOKEN) {
      logger.debug('Rate limit bypass activado para testing');
      return next();
    }
  }

  next();
};

// ============================================
// UTILIDADES DE RATE LIMITING
// ============================================

/**
 * Obtiene información actual de rate limiting para una key
 * @param {string} key - Key del rate limit
 * @param {Object} store - Store del rate limiter
 * @returns {Promise<Object>} Información de rate limit
 */
const getRateLimitInfo = async (key, store) => {
  try {
    const record = await store.get(key);
    
    if (!record) {
      return {
        key,
        requests: 0,
        remaining: 'unlimited',
        resetTime: null
      };
    }

    return {
      key,
      requests: record.count || 0,
      remaining: Math.max(0, record.limit - record.count),
      resetTime: record.resetTime,
      limit: record.limit
    };
  } catch (error) {
    logger.error('Error obteniendo información de rate limit:', error);
    return null;
  }
};

/**
 * Limpia manualmente una key del rate limiter
 * @param {string} key - Key a limpiar
 * @param {Object} store - Store del rate limiter
 * @returns {Promise<boolean>} True si se limpió correctamente
 */
const clearRateLimit = async (key, store) => {
  try {
    await store.delete(key);
    logger.info('Rate limit limpiado manualmente', { key });
    return true;
  } catch (error) {
    logger.error('Error limpiando rate limit:', error);
    return false;
  }
};

/**
 * Middleware que permite resetear rate limit para IPs específicas
 */
const createResetMiddleware = (allowedIPs = []) => {
  return (req, res, next) => {
    const clientIP = req.ip;
    
    // Solo permitir desde IPs específicas
    if (allowedIPs.includes(clientIP) || allowedIPs.includes('*')) {
      if (req.query.resetRateLimit === 'true') {
        // Aquí se podría implementar la lógica de reset
        logger.info('Rate limit reset solicitado', {
          ip: clientIP,
          path: req.path
        });
        
        res.json({
          success: true,
          message: 'Rate limit reset solicitado',
          ip: clientIP
        });
        return;
      }
    }

    next();
  };
};

// ============================================
// CONFIGURACIÓN GLOBAL
// ============================================

/**
 * Aplica rate limiting global basado en el entorno
 */
const applyGlobalRateLimit = (app) => {
  // En producción, aplicar rate limiting más estricto
  if (process.env.NODE_ENV === 'production') {
    app.use(rateLimitLogger);
    
    // Rate limiting global menos estricto
    app.use(createDynamicLimiter({
      windowMs: 15 * 60 * 1000, // 15 minutos
      max: 1000, // 1000 requests por IP cada 15 minutos
      message: {
        success: false,
        error: {
          type: 'rate_limit',
          message: 'Demasiadas solicitudes, intenta más tarde',
          retryAfter: 15 * 60
        }
      }
    }));
  } else {
    // En desarrollo, solo logging
    app.use(rateLimitLogger);
  }
};

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Rate limiters específicos
  apiLimiter,
  webhookLimiter,
  claudeLimiter,
  whatsappLimiter,
  authLimiter,
  adminLimiter,
  
  // Funciones
  createDynamicLimiter,
  rateLimitLogger,
  testBypass,
  applyGlobalRateLimit,
  
  // Utilidades
  getRateLimitInfo,
  clearRateLimit,
  createResetMiddleware,
  
  // Configuración base
  baseConfig
};