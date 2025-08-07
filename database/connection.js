const { Pool } = require('pg');
const logger = require('../src/utils/logger');

// ============================================
// CONFIGURACIÓN DE CONEXIÓN A POSTGRESQL
// ============================================

// Configuración del pool de conexiones
// En database/connection.js, actualiza la configuración del pool:

const poolConfig = {
  user: process.env.DB_USER || 'neondb_owner',
  host: process.env.DB_HOST || 'ep-dawn-waterfall-aeee70v1-pooler.c-2.us-east-2.aws.neon.tech',
  database: process.env.DB_NAME || 'neondb',
  password: process.env.DB_PASSWORD || 'npg_YkBK7W2MvSaQ',
  port: parseInt(process.env.DB_PORT) || 5432,
  
  // Configuración específica para Neon
  ssl: {
    require: true,
    rejectUnauthorized: false
  },
  
  // Pool optimizado para Neon
  max: parseInt(process.env.DB_POOL_MAX) || 5,
  min: parseInt(process.env.DB_POOL_MIN) || 1,
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 5000,
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT) || 60000,
  
  // Configuraciones específicas para Neon
  application_name: 'ChatBot_Chingon',
  statement_timeout: 60000,
  idle_in_transaction_session_timeout: 60000
};
// Crear el pool de conexiones
const pool = new Pool(poolConfig);

// ============================================
// EVENTOS DEL POOL
// ============================================

pool.on('connect', (client) => {
  logger.debug('Nueva conexión a PostgreSQL establecida', {
    processId: client.processID,
    database: poolConfig.database
  });
});

pool.on('acquire', (client) => {
  logger.debug('Conexión adquirida del pool', {
    processId: client.processID,
    poolSize: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount
  });
});

pool.on('remove', (client) => {
  logger.debug('Conexión removida del pool', {
    processId: client.processID,
    poolSize: pool.totalCount
  });
});

pool.on('error', (err, client) => {
  logger.error('Error inesperado en cliente del pool:', {
    error: err.message,
    processId: client?.processID,
    poolSize: pool.totalCount
  });
});

// ============================================
// FUNCIÓN PRINCIPAL DE CONSULTA
// ============================================

/**
 * Ejecuta una consulta SQL con logging y manejo de errores
 * @param {string} text - Query SQL
 * @param {Array} params - Parámetros de la consulta
 * @param {string} operationName - Nombre de la operación para logging
 * @returns {Promise<Object>} Resultado de la consulta
 */
const query = async (text, params = [], operationName = 'unknown') => {
  const start = Date.now();
  const client = await pool.connect();
  
  try {
    // Log de debug para desarrollo
    if (process.env.NODE_ENV === 'development' && process.env.LOG_SQL === 'true') {
      logger.debug('Ejecutando consulta SQL', {
        operation: operationName,
        query: text.replace(/\s+/g, ' ').trim(),
        params: params.length > 0 ? params : 'sin parámetros'
      });
    }

    const result = await client.query(text, params);
    const duration = Date.now() - start;

    // Log de métricas de rendimiento
    logger.logDatabase('info', operationName, duration, result.rowCount, {
      affectedRows: result.rowCount,
      command: result.command
    });

    // Alertar sobre consultas lentas
    if (duration > 5000) { // 5 segundos
      logger.warn('Consulta lenta detectada', {
        operation: operationName,
        duration: `${duration}ms`,
        rowCount: result.rowCount
      });
    }

    return result;

  } catch (error) {
    const duration = Date.now() - start;
    
    // Log detallado del error
    logger.logDatabase('error', operationName, duration, 0, {
      error: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      position: error.position,
      query: text.replace(/\s+/g, ' ').trim().substring(0, 200),
      params: params.length > 0 ? JSON.stringify(params).substring(0, 200) : null
    });

    // Re-lanzar el error para que sea manejado por los controladores
    throw error;

  } finally {
    client.release();
  }
};

// ============================================
// FUNCIÓN DE TRANSACCIÓN
// ============================================

/**
 * Ejecuta múltiples consultas en una transacción
 * @param {Function} callback - Función que contiene las operaciones de la transacción
 * @returns {Promise<any>} Resultado de la transacción
 */
const transaction = async (callback) => {
  const client = await pool.connect();
  const start = Date.now();
  
  try {
    await client.query('BEGIN');
    logger.debug('Transacción iniciada');

    const result = await callback(client);
    
    await client.query('COMMIT');
    const duration = Date.now() - start;
    
    logger.info('Transacción completada exitosamente', {
      duration: `${duration}ms`
    });

    return result;

  } catch (error) {
    await client.query('ROLLBACK');
    const duration = Date.now() - start;
    
    logger.error('Transacción revertida debido a error', {
      error: error.message,
      duration: `${duration}ms`,
      code: error.code
    });

    throw error;

  } finally {
    client.release();
  }
};

// ============================================
// FUNCIONES DE UTILIDAD
// ============================================

/**
 * Verifica la conexión a la base de datos
 * @returns {Promise<boolean>} True si la conexión es exitosa
 */
const testConnection = async () => {
  try {
    const result = await query(
      'SELECT NOW() as current_time, version() as version', 
      [], 
      'test_connection'
    );
    
    logger.info('Conexión a base de datos verificada', {
      timestamp: result.rows[0].current_time,
      version: result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1]
    });
    
    return true;
    
  } catch (error) {
    logger.error('Error al probar conexión a base de datos:', error);
    throw error;
  }
};

/**
 * Verifica si existe una tabla
 * @param {string} tableName - Nombre de la tabla
 * @returns {Promise<boolean>} True si la tabla existe
 */
const tableExists = async (tableName) => {
  try {
    const result = await query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      )`,
      [tableName],
      `check_table_exists_${tableName}`
    );
    
    return result.rows[0].exists;
    
  } catch (error) {
    logger.error(`Error al verificar existencia de tabla ${tableName}:`, error);
    return false;
  }
};

/**
 * Ejecuta migraciones desde archivo SQL
 * @param {string} migrationPath - Ruta del archivo de migración
 * @returns {Promise<void>}
 */
const runMigration = async (migrationPath) => {
  const fs = require('fs');
  const path = require('path');
  
  try {
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Archivo de migración no encontrado: ${migrationPath}`);
    }
    
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    await transaction(async (client) => {
      logger.info('Ejecutando migración:', migrationPath);
      
      // Dividir el SQL en statements individuales (simplificado)
      const statements = migrationSQL.split(';').filter(stmt => stmt.trim());
      
      for (const statement of statements) {
        if (statement.trim()) {
          await client.query(statement.trim());
        }
      }
      
      logger.info('✅ Migración ejecutada exitosamente');
    });
    
  } catch (error) {
    logger.error('❌ Error al ejecutar migración:', error);
    throw error;
  }
};

/**
 * Limpia conexiones inactivas y resetea el pool si es necesario
 * @returns {Promise<void>}
 */
const cleanupConnections = async () => {
  try {
    logger.info('Limpiando conexiones inactivas', {
      totalConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingClients: pool.waitingCount
    });

    // PostgreSQL automáticamente maneja las conexiones idle
    // Solo loggeamos el estado actual
    
    if (pool.waitingCount > 0) {
      logger.warn('Clientes esperando conexiones disponibles', {
        waitingCount: pool.waitingCount
      });
    }

  } catch (error) {
    logger.error('Error durante limpieza de conexiones:', error);
  }
};

/**
 * Obtiene estadísticas del pool de conexiones
 * @returns {Object} Estadísticas del pool
 */
const getPoolStats = () => {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    maxConnections: poolConfig.max,
    minConnections: poolConfig.min,
    database: poolConfig.database,
    host: poolConfig.host,
    port: poolConfig.port
  };
};

/**
 * Ejecuta una consulta preparada con cache
 * @param {string} name - Nombre único para la consulta preparada
 * @param {string} text - Query SQL
 * @param {Array} params - Parámetros
 * @returns {Promise<Object>} Resultado de la consulta
 */
const preparedQuery = async (name, text, params = []) => {
  const start = Date.now();
  const client = await pool.connect();
  
  try {
    // Preparar la consulta si no existe
    const result = await client.query({
      name: name,
      text: text,
      values: params
    });

    const duration = Date.now() - start;
    
    logger.logDatabase('info', `prepared_${name}`, duration, result.rowCount, {
      cached: true,
      affectedRows: result.rowCount
    });

    return result;

  } catch (error) {
    const duration = Date.now() - start;
    
    logger.logDatabase('error', `prepared_${name}`, duration, 0, {
      error: error.message,
      code: error.code
    });

    throw error;

  } finally {
    client.release();
  }
};

/**
 * Cierra todas las conexiones del pool de manera elegante
 * @returns {Promise<void>}
 */
const closePool = async () => {
  try {
    logger.info('Cerrando pool de conexiones...');
    await pool.end();
    logger.info('Pool de conexiones cerrado exitosamente');
  } catch (error) {
    logger.error('Error al cerrar pool de conexiones:', error);
    throw error;
  }
};

// ============================================
// MANEJO DE EVENTOS DE CIERRE
// ============================================

process.on('SIGINT', async () => {
  logger.info('Señal SIGINT recibida, cerrando pool de conexiones...');
  await closePool();
});

process.on('SIGTERM', async () => {
  logger.info('Señal SIGTERM recibida, cerrando pool de conexiones...');
  await closePool();
});

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Funciones principales
  query,
  transaction,
  
  // Utilidades
  testConnection,
  tableExists,
  runMigration,
  cleanupConnections,
  getPoolStats,
  preparedQuery,
  closePool,
  
  // Pool para acceso directo si es necesario
  pool
};