const logger = require('../utils/logger');
const { DEFAULT_MESSAGES } = require('../utils/constants');

// ============================================
// CLASES DE ERROR PERSONALIZADAS
// ============================================

/**
 * Error base para errores de negocio
 */
class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error de validación
 */
class ValidationError extends AppError {
  constructor(message, field = null) {
    super(message, 400);
    this.field = field;
    this.type = 'validation';
  }
}

/**
 * Error de base de datos
 */
class DatabaseError extends AppError {
  constructor(message, originalError = null) {
    super(message, 500);
    this.originalError = originalError;
    this.type = 'database';
  }
}

/**
 * Error de servicio externo (Claude, WhatsApp)
 */
class ExternalServiceError extends AppError {
  constructor(service, message, statusCode = 503) {
    super(`${service}: ${message}`, statusCode);
    this.service = service;
    this.type = 'external_service';
  }
}

/**
 * Error de autenticación
 */
class AuthenticationError extends AppError {
  constructor(message = 'No autorizado') {
    super(message, 401);
    this.type = 'authentication';
  }
}

/**
 * Error de autorización
 */
class AuthorizationError extends AppError {
  constructor(message = 'Acceso denegado') {
    super(message, 403);
    this.type = 'authorization';
  }
}

/**
 * Error de recurso no encontrado
 */
class NotFoundError extends AppError {
  constructor(resource = 'Recurso') {
    super(`${resource} no encontrado`, 404);
    this.type = 'not_found';
  }
}

/**
 * Error de conflicto (recurso ya existe)
 */
class ConflictError extends AppError {
  constructor(message = 'Conflicto con recurso existente') {
    super(message, 409);
    this.type = 'conflict';
  }
}

/**
 * Error de rate limiting
 */
class RateLimitError extends AppError {
  constructor(message = 'Demasiadas solicitudes') {
    super(message, 429);
    this.type = 'rate_limit';
  }
}

// ============================================
// FUNCIONES DE UTILIDAD
// ============================================

/**
 * Determina si un error es operacional (esperado) o de programación
 * @param {Error} error 
 * @returns {boolean}
 */
const isOperationalError = (error) => {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  
  // Errores comunes que consideramos operacionales
  const operationalErrors = [
    'ValidationError',
    'CastError',
    'MongoError',
    'SequelizeValidationError',
    'SequelizeUniqueConstraintError'
  ];
  
  return operationalErrors.includes(error.name);
};

/**
 * Extrae información útil del error
 * @param {Error} error 
 * @returns {Object}
 */
const getErrorInfo = (error) => {
  const info = {
    name: error.name,
    message: error.message,
    timestamp: new Date().toISOString(),
  };

  // Información específica por tipo de error
  if (error instanceof AppError) {
    info.type = error.type;
    info.statusCode = error.statusCode;
    info.isOperational = error.isOperational;
  }

  // Errores de base de datos PostgreSQL
  if (error.code) {
    info.code = error.code;
    
    switch (error.code) {
      case '23505': // unique_violation
        info.type = 'unique_constraint';
        info.constraint = error.constraint;
        break;
      case '23503': // foreign_key_violation
        info.type = 'foreign_key_violation';
        info.constraint = error.constraint;
        break;
      case '23502': // not_null_violation
        info.type = 'not_null_violation';
        info.column = error.column;
        break;
      case '22001': // string_data_right_truncation
        info.type = 'string_too_long';
        break;
      case '08006': // connection_failure
        info.type = 'connection_failure';
        break;
    }
  }

  // Errores de validación de Joi
  if (error.isJoi) {
    info.type = 'joi_validation';
    info.details = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
      value: detail.context?.value
    }));
  }

  return info;
};

/**
 * Genera una respuesta de error consistente
 * @param {Error} error 
 * @param {Object} req 
 * @returns {Object}
 */
const generateErrorResponse = (error, req) => {
  const errorInfo = getErrorInfo(error);
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  // Respuesta base
  const response = {
    success: false,
    error: {
      message: errorInfo.message,
      type: errorInfo.type || 'unknown',
      timestamp: errorInfo.timestamp,
      requestId: req.id || req.headers['x-request-id']
    }
  };

  // En desarrollo, incluir más detalles
  if (isDevelopment) {
    response.error.stack = error.stack;
    response.error.details = errorInfo;
    
    if (req.body && Object.keys(req.body).length > 0) {
      response.error.requestBody = req.body;
    }
    
    if (req.params && Object.keys(req.params).length > 0) {
      response.error.requestParams = req.params;
    }
  }

  // Mensajes amigables para usuarios finales
  const userFriendlyMessages = {
    validation: 'Los datos proporcionados no son válidos',
    database: 'Error interno del servidor',
    external_service: 'Servicio temporalmente no disponible',
    authentication: 'Credenciales inválidas',
    authorization: 'No tienes permisos para realizar esta acción',
    not_found: 'El recurso solicitado no existe',
    conflict: 'El recurso ya existe',
    rate_limit: 'Demasiadas solicitudes, intenta más tarde',
    unique_constraint: 'Ya existe un registro con esos datos',
    foreign_key_violation: 'Referencia inválida',
    not_null_violation: 'Campo requerido faltante'
  };

  // Si no es desarrollo, usar mensaje amigable
  if (!isDevelopment && userFriendlyMessages[errorInfo.type]) {
    response.error.message = userFriendlyMessages[errorInfo.type];
  }

  return response;
};

// ============================================
// MIDDLEWARE PRINCIPAL DE MANEJO DE ERRORES
// ============================================

/**
 * Middleware de manejo de errores para Express
 * Este debe ser el ÚLTIMO middleware en la aplicación
 */
const errorHandler = (error, req, res, next) => {
  const errorInfo = getErrorInfo(error);
  const isOperational = isOperationalError(error);
  
  // Log del error
  if (isOperational) {
    logger.warn('Error operacional capturado', {
      ...errorInfo,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
  } else {
    logger.error('Error no esperado capturado', {
      ...errorInfo,
      stack: error.stack,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      body: req.body,
      params: req.params,
      query: req.query
    });
  }

  // Determinar código de estado HTTP
  let statusCode = 500;
  
  if (error instanceof AppError) {
    statusCode = error.statusCode;
  } else if (error.status) {
    statusCode = error.status;
  } else if (error.statusCode) {
    statusCode = error.statusCode;
  }

  // Generar respuesta
  const response = generateErrorResponse(error, req);
  
  // Enviar respuesta
  res.status(statusCode).json(response);
};

// ============================================
// MIDDLEWARE PARA 404
// ============================================

/**
 * Middleware para rutas no encontradas
 */
const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(`Ruta ${req.originalUrl}`);
  next(error);
};

// ============================================
// WRAPPER PARA FUNCIONES ASYNC
// ============================================

/**
 * Wrapper para capturar errores en funciones async
 * Evita tener que usar try/catch en cada controlador
 * 
 * @param {Function} fn - Función async a envolver
 * @returns {Function} Función envuelta
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// ============================================
// MANEJADORES ESPECÍFICOS
// ============================================

/**
 * Maneja errores específicos de PostgreSQL
 * @param {Error} error 
 * @returns {AppError}
 */
const handleDatabaseError = (error) => {
  let message = 'Error de base de datos';
  let statusCode = 500;

  switch (error.code) {
    case '23505': // unique_violation
      message = 'Ya existe un registro con esos datos';
      statusCode = 409;
      break;
    case '23503': // foreign_key_violation
      message = 'Referencia inválida a otro registro';
      statusCode = 400;
      break;
    case '23502': // not_null_violation
      message = `El campo ${error.column} es requerido`;
      statusCode = 400;
      break;
    case '22001': // string_data_right_truncation
      message = 'Uno de los campos es demasiado largo';
      statusCode = 400;
      break;
    case '08006': // connection_failure
      message = 'Error de conexión a la base de datos';
      statusCode = 503;
      break;
  }

  return new DatabaseError(message, error);
};

/**
 * Maneja errores de validación de Joi
 * @param {Error} error 
 * @returns {ValidationError}
 */
const handleJoiValidationError = (error) => {
  const messages = error.details.map(detail => detail.message);
  return new ValidationError(messages.join(', '));
};

// ============================================
// MIDDLEWARE DE LOGGING DE ERRORES
// ============================================

/**
 * Middleware que loggea todos los errores que pasan por el sistema
 */
const errorLogger = (error, req, res, next) => {
  // Log específico para diferentes tipos de error
  if (error.code && error.code.startsWith('23')) {
    logger.logDatabase('error', 'unknown', 0, 0, { error: error.message, code: error.code });
  } else if (error.service) {
    logger.error(`Error en servicio ${error.service}`, {
      service: error.service,
      message: error.message,
      statusCode: error.statusCode
    });
  } else {
    logger.error('Error no categorizado', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
  }

  next(error);
};

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Clases de error
  AppError,
  ValidationError,
  DatabaseError,
  ExternalServiceError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  
  // Middleware
  errorHandler,
  notFoundHandler,
  errorLogger,
  asyncHandler,
  
  // Utilidades
  isOperationalError,
  getErrorInfo,
  generateErrorResponse,
  handleDatabaseError,
  handleJoiValidationError
};