const { query, transaction } = require('../config/database');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const { ValidationError, DatabaseError, NotFoundError } = require('../middleware/errorHandler');
const { CONVERSATION_STATUS, CONVERSATION_STEPS, TIME_LIMITS } = require('../utils/constants');

// ============================================
// MODELO CONVERSATION
// ============================================

class Conversation {

  /**
   * Crea o obtiene una conversación activa
   * @param {string} restaurantId - ID del restaurante
   * @param {string} customerPhone - Teléfono del cliente
   * @returns {Promise<Object>} Conversación activa
   */
  static async getOrCreate(restaurantId, customerPhone) {
    if (!restaurantId || !customerPhone) {
      throw new ValidationError('ID del restaurante y teléfono del cliente son requeridos');
    }

    try {
      // Primero intentar obtener conversación activa
      let conversation = await this.getActive(restaurantId, customerPhone);

      if (conversation) {
        // Verificar si no ha expirado
        const timeLimit = conversation.max_conversation_time || TIME_LIMITS.MAX_CONVERSATION_TIME;
        const timeSinceLastInteraction = Date.now() - new Date(conversation.last_interaction_at).getTime();

        if (timeSinceLastInteraction > timeLimit * 1000) {
          // Marcar como abandonada y crear nueva
          await this.abandon(conversation.id);
          conversation = null;
        } else {
          // Actualizar timestamp de última interacción
          await this.updateLastInteraction(conversation.id);
          return conversation;
        }
      }

      // Crear nueva conversación
      if (!conversation) {
        const result = await query(
          `INSERT INTO conversations (
            id, restaurant_id, customer_phone, status, current_step,
            order_data, ai_context, last_interaction_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
          RETURNING *`,
          [
            uuidv4(),
            restaurantId,
            customerPhone,
            CONVERSATION_STATUS.ACTIVE,
            CONVERSATION_STEPS.GREETING,
            JSON.stringify({
              items: [],
              subtotal: 0,
              delivery_fee: 0,
              total: 0
            }),
            JSON.stringify([])
          ],
          'create_conversation'
        );

        conversation = result.rows[0];

        logger.info('Nueva conversación creada', {
          conversationId: conversation.id,
          restaurantId,
          customerPhone: customerPhone.substring(0, 8) + '****'
        });
      }

      return conversation;

    } catch (error) {
      logger.error('Error creando/obteniendo conversación:', error);
      throw new DatabaseError('Error al gestionar conversación', error);
    }
  }

  /**
   * Obtiene conversación activa
   * @param {string} restaurantId - ID del restaurante
   * @param {string} customerPhone - Teléfono del cliente
   * @returns {Promise<Object|null>} Conversación activa
   */
  static async getActive(restaurantId, customerPhone) {
    try {
      const result = await query(
        `SELECT * FROM conversations 
         WHERE restaurant_id = $1 AND customer_phone = $2 AND status = $3
         ORDER BY last_interaction_at DESC
         LIMIT 1`,
        [restaurantId, customerPhone, CONVERSATION_STATUS.ACTIVE],
        'get_active_conversation'
      );

      return result.rows[0] || null;

    } catch (error) {
      logger.error('Error obteniendo conversación activa:', error);
      throw new DatabaseError('Error al obtener conversación', error);
    }
  }

  /**
   * Obtiene conversación por ID
   * @param {string} conversationId - ID de la conversación
   * @returns {Promise<Object|null>} Conversación
   */
  static async findById(conversationId) {
    try {
      const result = await query(
        'SELECT * FROM conversations WHERE id = $1',
        [conversationId],
        'find_conversation_by_id'
      );

      return result.rows[0] || null;

    } catch (error) {
      logger.error('Error obteniendo conversación por ID:', error);
      throw new DatabaseError('Error al obtener conversación', error);
    }
  }

  /**
   * Actualiza el estado de la conversación
   * @param {string} conversationId - ID de la conversación
   * @param {Object} updateData - Datos a actualizar
   * @returns {Promise<Object>} Conversación actualizada
   */
  static async update(conversationId, updateData) {
    const allowedFields = [
      'status', 'current_step', 'order_data', 'ai_context', 'conversation_summary'
    ];

    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key) && updateData[key] !== undefined) {
        let value = updateData[key];
        
        // Serializar objetos/arrays a JSON
        if (key === 'order_data' || key === 'ai_context') {
          value = JSON.stringify(value);
        }
        
        fields.push(`${key} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    });

    if (fields.length === 0) {
      throw new ValidationError('No hay campos válidos para actualizar');
    }

    // Siempre actualizar timestamp de última interacción
    fields.push(`last_interaction_at = CURRENT_TIMESTAMP`);
    values.push(conversationId);

    try {
      const result = await query(
        `UPDATE conversations 
         SET ${fields.join(', ')}
         WHERE id = $${paramCount}
         RETURNING *`,
        values,
        'update_conversation'
      );

      if (result.rows.length === 0) {
        throw new NotFoundError('Conversación');
      }

      return result.rows[0];

    } catch (error) {
      logger.error('Error actualizando conversación:', error);
      throw new DatabaseError('Error al actualizar conversación', error);
    }
  }

  /**
   * Actualiza solo el timestamp de última interacción
   * @param {string} conversationId - ID de la conversación
   * @returns {Promise<boolean>} True si se actualizó
   */
  static async updateLastInteraction(conversationId) {
    try {
      const result = await query(
        'UPDATE conversations SET last_interaction_at = CURRENT_TIMESTAMP WHERE id = $1',
        [conversationId],
        'update_last_interaction'
      );

      return result.rowCount > 0;

    } catch (error) {
      logger.error('Error actualizando última interacción:', error);
      throw new DatabaseError('Error al actualizar interacción', error);
    }
  }

  /**
   * Agrega un mensaje al contexto de IA
   * @param {string} conversationId - ID de la conversación
   * @param {string} role - 'user' o 'assistant'
   * @param {string} content - Contenido del mensaje
   * @returns {Promise<Object>} Conversación actualizada
   */
  static async addToContext(conversationId, role, content) {
    if (!['user', 'assistant'].includes(role)) {
      throw new ValidationError('Role debe ser "user" o "assistant"');
    }

    try {
      // Obtener conversación actual
      const conversation = await this.findById(conversationId);
      if (!conversation) {
        throw new NotFoundError('Conversación');
      }

      // Obtener contexto actual
      let aiContext = [];
      try {
        aiContext = JSON.parse(conversation.ai_context || '[]');
      } catch (e) {
        logger.warn('Error parseando contexto de IA, reiniciando:', e);
        aiContext = [];
      }

      // Agregar nuevo mensaje
      const newMessage = {
        role,
        content,
        timestamp: new Date().toISOString()
      };

      aiContext.push(newMessage);

      // Mantener solo los últimos 12 mensajes (6 intercambios)
      if (aiContext.length > 12) {
        aiContext = aiContext.slice(-12);
      }

      // Actualizar conversación
      return await this.update(conversationId, {
        ai_context: aiContext
      });

    } catch (error) {
      logger.error('Error agregando mensaje al contexto:', error);
      throw new DatabaseError('Error al actualizar contexto', error);
    }
  }

  /**
   * Actualiza los datos del pedido en la conversación
   * @param {string} conversationId - ID de la conversación
   * @param {Object} orderData - Datos del pedido
   * @returns {Promise<Object>} Conversación actualizada
   */
  static async updateOrderData(conversationId, orderData) {
    try {
      // Obtener conversación actual
      const conversation = await this.findById(conversationId);
      if (!conversation) {
        throw new NotFoundError('Conversación');
      }

      // Obtener datos actuales del pedido
      let currentOrderData = {};
      try {
        currentOrderData = JSON.parse(conversation.order_data || '{}');
      } catch (e) {
        logger.warn('Error parseando datos del pedido, reiniciando:', e);
        currentOrderData = { items: [], subtotal: 0, delivery_fee: 0, total: 0 };
      }

      // Fusionar con nuevos datos
      const updatedOrderData = {
        ...currentOrderData,
        ...orderData
      };

      // Recalcular totales si hay items
      if (updatedOrderData.items && updatedOrderData.items.length > 0) {
        updatedOrderData.subtotal = updatedOrderData.items.reduce(
          (sum, item) => sum + (item.item_total || 0), 0
        );
        updatedOrderData.total = updatedOrderData.subtotal + (updatedOrderData.delivery_fee || 0);
      }

      return await this.update(conversationId, {
        order_data: updatedOrderData
      });

    } catch (error) {
      logger.error('Error actualizando datos del pedido:', error);
      throw new DatabaseError('Error al actualizar pedido', error);
    }
  }

  /**
   * Agrega un item al pedido
   * @param {string} conversationId - ID de la conversación
   * @param {Object} item - Item a agregar
   * @returns {Promise<Object>} Conversación actualizada
   */
  static async addItemToOrder(conversationId, item) {
    try {
      const conversation = await this.findById(conversationId);
      if (!conversation) {
        throw new NotFoundError('Conversación');
      }

      let orderData = {};
      try {
        orderData = JSON.parse(conversation.order_data || '{}');
      } catch (e) {
        orderData = { items: [], subtotal: 0, delivery_fee: 0, total: 0 };
      }

      if (!orderData.items) {
        orderData.items = [];
      }

      // Validar item
      if (!item.menu_item_id || !item.name || !item.base_price || !item.quantity) {
        throw new ValidationError('Item incompleto: faltan campos requeridos');
      }

      // Calcular total del item
      const customizationsCost = (item.customizations || [])
        .reduce((sum, custom) => sum + (custom.extra_cost || 0), 0);
      
      item.item_total = (item.base_price + customizationsCost) * item.quantity;
      item.added_at = new Date().toISOString();

      // Agregar item
      orderData.items.push(item);

      return await this.updateOrderData(conversationId, orderData);

    } catch (error) {
      logger.error('Error agregando item al pedido:', error);
      throw new DatabaseError('Error al agregar item', error);
    }
  }

  /**
   * Remueve un item del pedido
   * @param {string} conversationId - ID de la conversación
   * @param {number} itemIndex - Índice del item a remover
   * @returns {Promise<Object>} Conversación actualizada
   */
  static async removeItemFromOrder(conversationId, itemIndex) {
    try {
      const conversation = await this.findById(conversationId);
      if (!conversation) {
        throw new NotFoundError('Conversación');
      }

      let orderData = {};
      try {
        orderData = JSON.parse(conversation.order_data || '{}');
      } catch (e) {
        throw new ValidationError('Error al procesar datos del pedido');
      }

      if (!orderData.items || itemIndex < 0 || itemIndex >= orderData.items.length) {
        throw new ValidationError('Índice de item inválido');
      }

      // Remover item
      const removedItem = orderData.items.splice(itemIndex, 1)[0];

      logger.info('Item removido del pedido', {
        conversationId,
        removedItem: removedItem.name,
        remainingItems: orderData.items.length
      });

      return await this.updateOrderData(conversationId, orderData);

    } catch (error) {
      logger.error('Error removiendo item del pedido:', error);
      throw new DatabaseError('Error al remover item', error);
    }
  }

  /**
   * Marca conversación como completada
   * @param {string} conversationId - ID de la conversación
   * @param {string} orderId - ID del pedido creado (opcional)
   * @returns {Promise<Object>} Conversación actualizada
   */
  static async complete(conversationId, orderId = null) {
    try {
      const updateData = {
        status: CONVERSATION_STATUS.COMPLETED,
        current_step: CONVERSATION_STEPS.COMPLETED
      };

      if (orderId) {
        // Agregar referencia al pedido en los datos
        const conversation = await this.findById(conversationId);
        if (conversation) {
          let orderData = JSON.parse(conversation.order_data || '{}');
          orderData.order_id = orderId;
          updateData.order_data = orderData;
        }
      }

      const result = await this.update(conversationId, updateData);

      logger.info('Conversación completada', {
        conversationId,
        orderId
      });

      return result;

    } catch (error) {
      logger.error('Error completando conversación:', error);
      throw new DatabaseError('Error al completar conversación', error);
    }
  }

  /**
   * Marca conversación como abandonada
   * @param {string} conversationId - ID de la conversación
   * @returns {Promise<Object>} Conversación actualizada
   */
  static async abandon(conversationId) {
    try {
      const result = await this.update(conversationId, {
        status: CONVERSATION_STATUS.ABANDONED
      });

      logger.info('Conversación marcada como abandonada', { conversationId });
      return result;

    } catch (error) {
      logger.error('Error marcando conversación como abandonada:', error);
      throw new DatabaseError('Error al abandonar conversación', error);
    }
  }

  /**
   * Limpia conversaciones inactivas
   * @param {number} maxInactiveHours - Horas máximas de inactividad
   * @returns {Promise<number>} Número de conversaciones limpiadas
   */
  static async cleanupInactive(maxInactiveHours = 2) {
    try {
      const result = await query(
        `UPDATE conversations 
         SET status = $1 
         WHERE status = $2 
         AND last_interaction_at < CURRENT_TIMESTAMP - INTERVAL '${maxInactiveHours} hours'`,
        [CONVERSATION_STATUS.ABANDONED, CONVERSATION_STATUS.ACTIVE],
        'cleanup_inactive_conversations'
      );

      const cleanedCount = result.rowCount;

      if (cleanedCount > 0) {
        logger.info('Conversaciones inactivas limpiadas', {
          count: cleanedCount,
          maxInactiveHours
        });
      }

      return cleanedCount;

    } catch (error) {
      logger.error('Error limpiando conversaciones inactivas:', error);
      throw new DatabaseError('Error en limpieza de conversaciones', error);
    }
  }

  /**
   * Obtiene estadísticas de conversaciones
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} dateRange - Rango de fechas
   * @returns {Promise<Object>} Estadísticas
   */
  static async getStats(restaurantId, dateRange = {}) {
    const { startDate, endDate } = dateRange;
    
    try {
      let dateCondition = '';
      const values = [restaurantId];

      if (startDate && endDate) {
        dateCondition = 'AND created_at BETWEEN $2 AND $3';
        values.push(startDate, endDate);
      }

      const result = await query(
        `SELECT 
          COUNT(*) as total_conversations,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_conversations,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_conversations,
          COUNT(CASE WHEN status = 'abandoned' THEN 1 END) as abandoned_conversations,
          COUNT(DISTINCT customer_phone) as unique_customers,
          AVG(EXTRACT(EPOCH FROM (last_interaction_at - created_at))/60) as avg_duration_minutes
        FROM conversations 
        WHERE restaurant_id = $1 ${dateCondition}`,
        values,
        'get_conversation_stats'
      );

      const stats = result.rows[0];

      // Calcular tasas
      const total = parseInt(stats.total_conversations);
      stats.completion_rate = total > 0 
        ? ((parseInt(stats.completed_conversations) / total) * 100).toFixed(2)
        : 0;

      stats.abandonment_rate = total > 0
        ? ((parseInt(stats.abandoned_conversations) / total) * 100).toFixed(2)
        : 0;

      stats.avg_duration_minutes = parseFloat(stats.avg_duration_minutes || 0).toFixed(2);

      return stats;

    } catch (error) {
      logger.error('Error obteniendo estadísticas de conversaciones:', error);
      throw new DatabaseError('Error al obtener estadísticas', error);
    }
  }

  /**
   * Obtiene conversaciones recientes de un restaurante
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} options - Opciones de consulta
   * @returns {Promise<Object>} Lista paginada de conversaciones
   */
  static async getRecent(restaurantId, options = {}) {
    const {
      page = 1,
      limit = 20,
      status = null,
      customerPhone = null
    } = options;

    const offset = (page - 1) * limit;

    try {
      const conditions = ['restaurant_id = $1'];
      const values = [restaurantId];
      let paramCount = 2;

      if (status) {
        conditions.push(`status = $${paramCount}`);
        values.push(status);
        paramCount++;
      }

      if (customerPhone) {
        conditions.push(`customer_phone = $${paramCount}`);
        values.push(customerPhone);
        paramCount++;
      }

      const whereClause = conditions.join(' AND ');

      // Consulta principal
      const conversationsResult = await query(
        `SELECT 
          id, customer_phone, status, current_step,
          last_interaction_at, created_at,
          CASE 
            WHEN order_data::text != '{}' THEN 
              (order_data->>'total')::numeric 
            ELSE 0 
          END as order_total
        FROM conversations 
        WHERE ${whereClause}
        ORDER BY last_interaction_at DESC
        LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
        [...values, limit, offset],
        'get_recent_conversations'
      );

      // Contar total
      const countResult = await query(
        `SELECT COUNT(*) as total FROM conversations WHERE ${whereClause}`,
        values.slice(0, -2),
        'count_conversations'
      );

      const total = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(total / limit);

      return {
        conversations: conversationsResult.rows,
        pagination: {
          current_page: page,
          total_pages: totalPages,
          total_items: total,
          items_per_page: limit,
          has_next: page < totalPages,
          has_prev: page > 1
        }
      };

    } catch (error) {
      logger.error('Error obteniendo conversaciones recientes:', error);
      throw new DatabaseError('Error al obtener conversaciones', error);
    }
  }
}

module.exports = Conversation;