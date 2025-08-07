const { query, transaction } = require('../connection');
const logger = require('../../src/utils/logger');
const { CONVERSATION_STATUS, CONVERSATION_STEPS } = require('../../src/utils/constants');

// ============================================
// CONSULTAS OPTIMIZADAS PARA CONVERSACIONES
// ============================================

/**
 * Obtiene conversación activa por restaurante y teléfono
 * @param {string} restaurantId - ID del restaurante
 * @param {string} customerPhone - Teléfono del cliente
 * @returns {Promise<Object|null>} Conversación activa
 */
const getActiveConversation = async (restaurantId, customerPhone) => {
  try {
    const result = await query(
      `SELECT 
        c.*,
        EXTRACT(EPOCH FROM (NOW() - c.last_interaction_at)) as seconds_since_last_interaction
      FROM conversations c 
      WHERE c.restaurant_id = $1 
        AND c.customer_phone = $2 
        AND c.status = $3
        AND c.last_interaction_at > NOW() - INTERVAL '30 minutes'
      ORDER BY c.last_interaction_at DESC
      LIMIT 1`,
      [restaurantId, customerPhone, CONVERSATION_STATUS.ACTIVE],
      'get_active_conversation'
    );

    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error obteniendo conversación activa:', error);
    throw error;
  }
};

/**
 * Crea nueva conversación
 * @param {Object} conversationData - Datos de la conversación
 * @returns {Promise<Object>} Conversación creada
 */
const createConversation = async (conversationData) => {
  const {
    restaurantId,
    customerPhone,
    status = CONVERSATION_STATUS.ACTIVE,
    currentStep = CONVERSATION_STEPS.GREETING,
    orderData = {},
    aiContext = []
  } = conversationData;

  try {
    const result = await query(
      `INSERT INTO conversations (
        restaurant_id, customer_phone, status, current_step, 
        order_data, ai_context, created_at, last_interaction_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW(), NOW())
      RETURNING *`,
      [
        restaurantId,
        customerPhone,
        status,
        currentStep,
        JSON.stringify(orderData),
        JSON.stringify(aiContext)
      ],
      'create_conversation'
    );

    logger.info('Nueva conversación creada', {
      conversationId: result.rows[0].id,
      restaurantId,
      customerPhone: customerPhone.substring(0, 8) + '****'
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error creando conversación:', error);
    throw error;
  }
};

/**
 * Actualiza conversación existente
 * @param {string} conversationId - ID de la conversación
 * @param {Object} updateData - Datos a actualizar
 * @returns {Promise<Object>} Conversación actualizada
 */
const updateConversation = async (conversationId, updateData) => {
  const allowedFields = [
    'status', 'current_step', 'order_data', 'ai_context', 
    'conversation_summary', 'last_interaction_at'
  ];

  const fields = [];
  const values = [];
  let paramCount = 1;

  Object.keys(updateData).forEach(key => {
    if (allowedFields.includes(key) && updateData[key] !== undefined) {
      let value = updateData[key];
      
      // Serializar objetos/arrays a JSON
      if (['order_data', 'ai_context'].includes(key)) {
        value = JSON.stringify(value);
        fields.push(`${key} = $${paramCount}::jsonb`);
      } else if (key === 'last_interaction_at') {
        fields.push(`${key} = NOW()`);
        return; // No agregar a values ya que usamos NOW()
      } else {
        fields.push(`${key} = $${paramCount}`);
      }
      
      values.push(value);
      paramCount++;
    }
  });

  if (fields.length === 0) {
    throw new Error('No hay campos válidos para actualizar');
  }

  try {
    const result = await query(
      `UPDATE conversations 
       SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${paramCount}
       RETURNING *`,
      [...values, conversationId],
      'update_conversation'
    );

    if (result.rows.length === 0) {
      throw new Error('Conversación no encontrada');
    }

    return result.rows[0];
  } catch (error) {
    logger.error('Error actualizando conversación:', error);
    throw error;
  }
};

/**
 * Agrega mensaje al contexto de IA
 * @param {string} conversationId - ID de la conversación
 * @param {string} role - Rol del mensaje (user, assistant, system)
 * @param {string} content - Contenido del mensaje
 * @returns {Promise<Object>} Conversación actualizada
 */
const addToAiContext = async (conversationId, role, content) => {
  try {
    const result = await query(
      `UPDATE conversations 
       SET ai_context = COALESCE(ai_context, '[]'::jsonb) || $1::jsonb,
           last_interaction_at = NOW(),
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [
        JSON.stringify([{ role, content, timestamp: new Date().toISOString() }]),
        conversationId
      ],
      'add_to_ai_context'
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error agregando al contexto de IA:', error);
    throw error;
  }
};

/**
 * Obtiene conversaciones con paginación y filtros
 * @param {string} restaurantId - ID del restaurante
 * @param {Object} options - Opciones de consulta
 * @returns {Promise<Object>} Lista paginada de conversaciones
 */
const getConversationsPaginated = async (restaurantId, options = {}) => {
  const {
    page = 1,
    limit = 20,
    status = null,
    step = null,
    customerPhone = null,
    sortBy = 'last_interaction_at',
    sortOrder = 'DESC',
    dateFrom = null,
    dateTo = null
  } = options;

  const offset = (page - 1) * limit;
  const conditions = ['c.restaurant_id = $1'];
  const values = [restaurantId];
  let paramCount = 2;

  // Agregar filtros
  if (status) {
    conditions.push(`c.status = $${paramCount}`);
    values.push(status);
    paramCount++;
  }

  if (step) {
    conditions.push(`c.current_step = $${paramCount}`);
    values.push(step);
    paramCount++;
  }

  if (customerPhone) {
    conditions.push(`c.customer_phone = $${paramCount}`);
    values.push(customerPhone);
    paramCount++;
  }

  if (dateFrom) {
    conditions.push(`c.created_at >= $${paramCount}`);
    values.push(dateFrom);
    paramCount++;
  }

  if (dateTo) {
    conditions.push(`c.created_at <= $${paramCount}`);
    values.push(dateTo);
    paramCount++;
  }

  const whereClause = conditions.join(' AND ');
  const orderBy = `ORDER BY c.${sortBy} ${sortOrder}`;

  try {
    // Consulta principal
    const conversationsResult = await query(
      `SELECT 
        c.*,
        CASE 
          WHEN c.order_data::text != '{}' THEN 
            (c.order_data->>'total')::numeric 
          ELSE 0 
        END as order_total,
        EXTRACT(EPOCH FROM (NOW() - c.last_interaction_at))/60 as minutes_since_last_interaction,
        jsonb_array_length(COALESCE(c.ai_context, '[]'::jsonb)) as message_count
      FROM conversations c 
      WHERE ${whereClause}
      ${orderBy}
      LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...values, limit, offset],
      'get_conversations_paginated'
    );

    // Contar total
    const countResult = await query(
      `SELECT COUNT(*) as total FROM conversations c WHERE ${whereClause}`,
      values.slice(0, -2), // Remover limit y offset
      'count_conversations'
    );

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    return {
      conversations: conversationsResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    };
  } catch (error) {
    logger.error('Error obteniendo conversaciones paginadas:', error);
    throw error;
  }
};

/**
 * Obtiene estadísticas de conversaciones para un restaurante
 * @param {string} restaurantId - ID del restaurante
 * @param {Object} dateRange - Rango de fechas
 * @returns {Promise<Object>} Estadísticas
 */
const getConversationStats = async (restaurantId, dateRange = {}) => {
  const { startDate, endDate } = dateRange;
  const conditions = ['restaurant_id = $1'];
  const values = [restaurantId];
  
  if (startDate && endDate) {
    conditions.push('created_at BETWEEN $2 AND $3');
    values.push(startDate, endDate);
  }

  const whereClause = conditions.join(' AND ');

  try {
    const result = await query(
      `SELECT 
        COUNT(*) as total_conversations,
        COUNT(CASE WHEN status = '${CONVERSATION_STATUS.ACTIVE}' THEN 1 END) as active_conversations,
        COUNT(CASE WHEN status = '${CONVERSATION_STATUS.COMPLETED}' THEN 1 END) as completed_conversations,
        COUNT(CASE WHEN status = '${CONVERSATION_STATUS.ABANDONED}' THEN 1 END) as abandoned_conversations,
        
        -- Por pasos
        COUNT(CASE WHEN current_step = '${CONVERSATION_STEPS.GREETING}' THEN 1 END) as greeting_step,
        COUNT(CASE WHEN current_step = '${CONVERSATION_STEPS.ORDERING}' THEN 1 END) as ordering_step,
        COUNT(CASE WHEN current_step = '${CONVERSATION_STEPS.ADDRESS}' THEN 1 END) as address_step,
        COUNT(CASE WHEN current_step = '${CONVERSATION_STEPS.CONFIRMING}' THEN 1 END) as confirming_step,
        
        -- Métricas de tiempo
        AVG(EXTRACT(EPOCH FROM (
          COALESCE(updated_at, NOW()) - created_at
        ))/60) as avg_duration_minutes,
        
        -- Conversiones
        ROUND(
          (COUNT(CASE WHEN status = '${CONVERSATION_STATUS.COMPLETED}' THEN 1 END)::numeric / 
           NULLIF(COUNT(*), 0)) * 100, 2
        ) as conversion_rate,
        
        -- Abandono
        ROUND(
          (COUNT(CASE WHEN status = '${CONVERSATION_STATUS.ABANDONED}' THEN 1 END)::numeric / 
           NULLIF(COUNT(*), 0)) * 100, 2
        ) as abandonment_rate
        
      FROM conversations 
      WHERE ${whereClause}`,
      values,
      'get_conversation_stats'
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error obteniendo estadísticas de conversaciones:', error);
    throw error;
  }
};

/**
 * Limpia conversaciones inactivas
 * @param {number} hoursInactive - Horas de inactividad para considerar abandono
 * @returns {Promise<number>} Número de conversaciones limpiadas
 */
const cleanInactiveConversations = async (hoursInactive = 2) => {
  try {
    const result = await query(
      `UPDATE conversations 
       SET status = $1, 
           conversation_summary = 'Conversación abandonada por inactividad',
           updated_at = NOW()
       WHERE status = $2 
         AND last_interaction_at < NOW() - INTERVAL '${hoursInactive} hours'
       RETURNING id`,
      [CONVERSATION_STATUS.ABANDONED, CONVERSATION_STATUS.ACTIVE],
      'clean_inactive_conversations'
    );

    const cleanedCount = result.rows.length;
    
    if (cleanedCount > 0) {
      logger.info(`Conversaciones inactivas limpiadas: ${cleanedCount}`);
    }

    return cleanedCount;
  } catch (error) {
    logger.error('Error limpiando conversaciones inactivas:', error);
    throw error;
  }
};

/**
 * Busca conversaciones por texto
 * @param {string} restaurantId - ID del restaurante
 * @param {string} searchTerm - Término de búsqueda
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Array>} Conversaciones encontradas
 */
const searchConversations = async (restaurantId, searchTerm, options = {}) => {
  const { limit = 50 } = options;

  try {
    const result = await query(
      `SELECT 
        c.*,
        ts_rank(
          to_tsvector('spanish', 
            COALESCE(c.conversation_summary, '') || ' ' ||
            COALESCE(c.ai_context::text, '')
          ),
          plainto_tsquery('spanish', $2)
        ) as relevance
      FROM conversations c
      WHERE c.restaurant_id = $1
        AND (
          c.customer_phone ILIKE $3
          OR c.conversation_summary ILIKE $3
          OR c.ai_context::text ILIKE $3
        )
      ORDER BY relevance DESC, c.last_interaction_at DESC
      LIMIT $4`,
      [
        restaurantId,
        searchTerm,
        `%${searchTerm}%`,
        limit
      ],
      'search_conversations'
    );

    return result.rows;
  } catch (error) {
    logger.error('Error buscando conversaciones:', error);
    throw error;
  }
};

/**
 * Obtiene conversaciones por cliente
 * @param {string} customerPhone - Teléfono del cliente
 * @param {string} restaurantId - ID del restaurante (opcional)
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Array>} Historial del cliente
 */
const getCustomerConversationHistory = async (customerPhone, restaurantId = null, options = {}) => {
  const { limit = 10, includeActive = true } = options;
  
  const conditions = ['customer_phone = $1'];
  const values = [customerPhone];
  let paramCount = 2;

  if (restaurantId) {
    conditions.push(`restaurant_id = $${paramCount}`);
    values.push(restaurantId);
    paramCount++;
  }

  if (!includeActive) {
    conditions.push(`status != $${paramCount}`);
    values.push(CONVERSATION_STATUS.ACTIVE);
    paramCount++;
  }

  try {
    const result = await query(
      `SELECT 
        c.*,
        r.name as restaurant_name,
        r.slug as restaurant_slug,
        CASE 
          WHEN c.order_data::text != '{}' THEN 
            (c.order_data->>'total')::numeric 
          ELSE 0 
        END as order_total
      FROM conversations c
      JOIN restaurants r ON c.restaurant_id = r.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.created_at DESC
      LIMIT $${paramCount}`,
      [...values, limit],
      'get_customer_conversation_history'
    );

    return result.rows;
  } catch (error) {
    logger.error('Error obteniendo historial de conversaciones del cliente:', error);
    throw error;
  }
};

module.exports = {
  getActiveConversation,
  createConversation,
  updateConversation,
  addToAiContext,
  getConversationsPaginated,
  getConversationStats,
  cleanInactiveConversations,
  searchConversations,
  getCustomerConversationHistory
};