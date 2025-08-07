const winston = require('winston');
const path = require('path');

// ============================================
// CONFIGURACIÓN DEL LOGGER
// ============================================

const logLevel = process.env.LOG_LEVEL || 'info';
const logFile = process.env.LOG_FILE || 'logs/app.log';
const errorLogFile = process.env.ERROR_LOG_FILE || 'logs/error.log';

// Crear directorio de logs si no existe
const fs = require('fs');
const logDir = path.dirname(logFile);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// ============================================
// FORMATOS PERSONALIZADOS
// ============================================

// Formato para consola (desarrollo)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let logMessage = `${timestamp} [${level}]: ${message}`;
    
    // Agregar metadata si existe
    if (Object.keys(meta).length > 0) {
      logMessage += ` ${JSON.stringify(meta, null, 2)}`;
    }
    
    return logMessage;
  })
);

// Formato para archivos (producción)
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// ============================================
// TRANSPORTES
// ============================================

const transports = [];

// Transporte de consola (siempre activo en desarrollo)
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      level: logLevel,
      format: consoleFormat,
      handleExceptions: true,
      handleRejections: true
    })
  );
}

// Transporte de archivo general
transports.push(
  new winston.transports.File({
    filename: logFile,
    level: logLevel,
    format: fileFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    handleExceptions: true
  })
);

// Transporte de archivo solo para errores
transports.push(
  new winston.transports.File({
    filename: errorLogFile,
    level: 'error',
    format: fileFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    handleExceptions: true,
    handleRejections: true
  })
);

// ============================================
// CREAR LOGGER
// ============================================

const logger = winston.createLogger({
  level: logLevel,
  format: fileFormat,
  transports,
  exitOnError: false,
  
  // Manejo de excepciones no capturadas
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: 'logs/exceptions.log',
      format: fileFormat
    })
  ],
  
  // Manejo de promesas rechazadas
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: 'logs/rejections.log',
      format: fileFormat
    })
  ]
});

// ============================================
// FUNCIONES DE UTILIDAD
// ============================================

/**
 * Log específico para requests HTTP
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {number} duration - Duración en ms
 */
logger.logRequest = (req, res, duration) => {
  const logData = {
    method: req.method,
    url: req.originalUrl,
    statusCode: res.statusCode,
    duration: `${duration}ms`,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentLength: res.get('Content-Length') || 0
  };

  if (res.statusCode >= 400) {
    logger.warn('HTTP Request - Error', logData);
  } else {
    logger.info('HTTP Request', logData);
  }
};

/**
 * Log específico para operaciones de base de datos
 * @param {string} operation - Tipo de operación
 * @param {string} table - Tabla afectada
 * @param {number} duration - Duración en ms
 * @param {number} rowCount - Número de filas afectadas
 * @param {Object} metadata - Datos adicionales
 */
logger.logDatabase = (operation, table, duration, rowCount = 0, metadata = {}) => {
  logger.debug('Database Operation', {
    operation,
    table,
    duration: `${duration}ms`,
    rowCount,
    ...metadata
  });
};

/**
 * Log específico para interacciones con Claude AI
 * @param {string} operation - Tipo de operación
 * @param {number} duration - Duración en ms
 * @param {Object} usage - Información de tokens
 * @param {Object} metadata - Datos adicionales
 */
logger.logClaude = (operation, duration, usage = {}, metadata = {}) => {
  logger.info('Claude AI Operation', {
    operation,
    duration: `${duration}ms`,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
    ...metadata
  });
};

/**
 * Log específico para WhatsApp
 * @param {string} operation - Tipo de operación (send, receive, etc.)
 * @param {string} phone - Número de teléfono
 * @param {string} provider - Proveedor (twilio, meta)
 * @param {Object} metadata - Datos adicionales
 */
logger.logWhatsApp = (operation, phone, provider, metadata = {}) => {
  logger.info('WhatsApp Operation', {
    operation,
    phone: phone ? phone.substring(0, 8) + '****' : 'unknown', // Enmascarar número
    provider,
    ...metadata
  });
};

/**
 * Log específico para errores de negocio
 * @param {string} context - Contexto del error
 * @param {Error} error - Error object
 * @param {Object} metadata - Datos adicionales
 */
logger.logBusinessError = (context, error, metadata = {}) => {
  logger.error('Business Logic Error', {
    context,
    error: error.message,
    stack: error.stack,
    ...metadata
  });
};

/**
 * Log específico para métricas de rendimiento
 * @param {string} metric - Nombre de la métrica
 * @param {number} value - Valor de la métrica
 * @param {string} unit - Unidad de medida
 * @param {Object} metadata - Datos adicionales
 */
logger.logMetric = (metric, value, unit = '', metadata = {}) => {
  logger.info('Performance Metric', {
    metric,
    value,
    unit,
    timestamp: new Date().toISOString(),
    ...metadata
  });
};

/**
 * Log específico para eventos de seguridad
 * @param {string} event - Tipo de evento
 * @param {string} severity - Severidad (low, medium, high, critical)
 * @param {Object} metadata - Datos adicionales
 */
logger.logSecurity = (event, severity = 'medium', metadata = {}) => {
  const logLevel = {
    low: 'info',
    medium: 'warn',
    high: 'error',
    critical: 'error'
  }[severity] || 'warn';

  logger[logLevel]('Security Event', {
    event,
    severity,
    timestamp: new Date().toISOString(),
    ...metadata
  });
};

// ============================================
// MIDDLEWARE PARA EXPRESS
// ============================================

/**
 * Middleware para logging automático de requests
 */
logger.requestMiddleware = () => {
  return (req, res, next) => {
    const start = Date.now();
    
    // Interceptar el final de la respuesta
    const originalSend = res.send;
    res.send = function(body) {
      const duration = Date.now() - start;
      logger.logRequest(req, res, duration);
      
      // Llamar al método original
      originalSend.call(this, body);
    };
    
    next();
  };
};

// ============================================
// FUNCIONES DE UTILIDAD ADICIONALES
// ============================================

/**
 * Crea un logger hijo con contexto específico
 * @param {Object} context - Contexto para el logger hijo
 * @returns {Object} Logger hijo
 */
logger.child = (context) => {
  return logger.child(context);
};

/**
 * Obtiene estadísticas de logs
 * @returns {Object} Estadísticas
 */
logger.getStats = () => {
  // Esta función podría expandirse para leer archivos de log
  // y proporcionar estadísticas útiles
  return {
    level: logger.level,
    transports: logger.transports.length,
    logFile,
    errorLogFile
  };
};

/**
 * Cambia el nivel de log dinámicamente
 * @param {string} newLevel - Nuevo nivel de log
 */
logger.setLevel = (newLevel) => {
  logger.level = newLevel;
  logger.transports.forEach(transport => {
    transport.level = newLevel;
  });
  logger.info(`Nivel de log cambiado a: ${newLevel}`);
};

// ============================================
// MANEJO ESPECIAL PARA DESARROLLO
// ============================================

if (process.env.NODE_ENV === 'development') {
  // En desarrollo, también logear a consola con colores
  logger.add(new winston.transports.Console({
    level: 'debug',
    format: consoleFormat
  }));
  
  logger.info('🚀 Logger configurado para desarrollo');
  logger.debug('Debug logging habilitado');
}

// ============================================
// EXPORT
// ============================================

module.exports = logger;