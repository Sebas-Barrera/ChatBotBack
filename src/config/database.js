const { Pool } = require('pg');
const logger = require('../utils/logger');

// ============================================
// CONFIGURACIÓN DEL POOL DE CONEXIONES
// ============================================

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'ChatBotProject',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  
  // Configuración del pool
  min: parseInt(process.env.DB_POOL_MIN) || 2,
  max: parseInt(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 10000,
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000,
  
  // SSL configuración
  ssl: process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: false
  } : false,
  
  // Configuración adicional
  statement_timeout: 30000, // 30 segundos
  query_timeout: 30000,
  application_name: 'ChatBot_Chingon',
};

// Crear pool de conexiones
const pool = new Pool(dbConfig);

// ============================================
// EVENTOS DEL POOL
// ============================================

pool.on('connect', (client) => {
  logger.debug('Nueva conexión establecida con la base de datos');
});

pool.on('acquire', (client) => {
  logger.debug('Cliente adquirido del pool');
});

pool.on('remove', (client) => {
  logger.debug('Cliente removido del pool');
});

pool.on('error', (err, client) => {
  logger.error('Error inesperado en cliente del pool:', err);
});

// ============================================
// FUNCIÓN PARA EJECUTAR QUERIES
// ============================================

/**
 * Ejecuta una query SQL con parámetros
 * @param {string} text - Query SQL
 * @param {Array} params - Parámetros de la query
 * @param {string} description - Descripción para logging
 * @returns {Promise<Object>} Resultado de la query
 */
const query = async (text, params = [], description = '') => {
  const start = Date.now();
  
  try {
    logger.debug('Ejecutando query', { 
      description, 
      query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
      paramsCount: params.length 
    });
    
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    
    logger.debug('Query ejecutada exitosamente', {
      description,
      duration: `${duration}ms`,
      rowCount: result.rowCount
    });
    
    return result;
    
  } catch (error) {
    const duration = Date.now() - start;
    
    logger.error('Error en query SQL', {
      description,
      duration: `${duration}ms`,
      error: error.message,
      query: text,
      params: params
    });
    
    throw error;
  }
};

// ============================================
// TRANSACCIONES
// ============================================

/**
 * Ejecuta múltiples queries en una transacción
 * @param {Function} callback - Función que recibe el cliente y ejecuta queries
 * @returns {Promise<any>} Resultado de la transacción
 */
const transaction = async (callback) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    logger.debug('Transacción iniciada');
    
    const result = await callback(client);
    
    await client.query('COMMIT');
    logger.debug('Transacción completada exitosamente');
    
    return result;
    
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Transacción revertida debido a error:', error);
    throw error;
    
  } finally {
    client.release();
  }
};

// ============================================
// FUNCIONES DE UTILIDAD
// ============================================

/**
 * Obtiene información del estado del pool
 * @returns {Object} Estadísticas del pool
 */
const getPoolInfo = () => {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    config: {
      max: pool.options.max,
      min: pool.options.min,
      idleTimeoutMillis: pool.options.idleTimeoutMillis
    }
  };
};

/**
 * Prueba la conexión a la base de datos
 * @returns {Promise<boolean>} True si la conexión es exitosa
 */
const testConnection = async () => {
  try {
    const result = await query('SELECT NOW() as current_time, version() as version', [], 'test_connection');
    
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
 * Ejecuta el script de migración inicial
 * @returns {Promise<void>}
 */
const runMigrations = async () => {
  const fs = require('fs');
  const path = require('path');
  
  try {
    const migrationFile = path.join(__dirname, '../../database/migrations/001_initial_schema.sql');
    
    if (!fs.existsSync(migrationFile)) {
      logger.warn('Archivo de migración no encontrado:', migrationFile);
      return;
    }
    
    const migrationSQL = fs.readFileSync(migrationFile, 'utf8');
    
    await transaction(async (client) => {
      logger.info('Ejecutando migraciones...');
      await client.query(migrationSQL);
      logger.info('✅ Migraciones ejecutadas exitosamente');
    });
    
  } catch (error) {
    logger.error('❌ Error al ejecutar migraciones:', error);
    throw error;
  }
};

/**
 * Función para limpiar conversaciones inactivas
 * @returns {Promise<number>} Número de conversaciones limpiadas
 */
const cleanInactiveConversations = async () => {
  try {
    const result = await query(
      `UPDATE conversations 
       SET status = 'abandoned',
           updated_at = CURRENT_TIMESTAMP
       WHERE status = 'active' 
       AND last_interaction_at < CURRENT_TIMESTAMP - INTERVAL '2 hours'`,
      [],
      'clean_inactive_conversations'
    );
    
    return result.rowCount;
    
  } catch (error) {
    logger.error('Error al limpiar conversaciones inactivas:', error);
    throw error;
  }
};

/**
 * Cierra todas las conexiones del pool
 * @returns {Promise<void>}
 */
const closePool = async () => {
  try {
    await pool.end();
    logger.info('Pool de conexiones cerrado exitosamente');
  } catch (error) {
    logger.error('Error al cerrar pool de conexiones:', error);
    throw error;
  }
};

// ============================================
// EXPORTS
// ============================================

module.exports = {
  pool,
  query,
  transaction,
  getPoolInfo,
  testDatabaseConnection: testConnection,
  tableExists,
  runMigrations,
  cleanInactiveConversations,
  closePool
};