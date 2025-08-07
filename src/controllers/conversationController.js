const Conversation = require('../models/Conversation');
const ConversationService = require('../services/conversationService');
const ValidationService = require('../services/validationService');
const WhatsAppService = require('../services/whatsappService');
const logger = require('../utils/logger');
const { CONVERSATION_STATUS, CONVERSATION_STEPS } = require('../utils/constants');
const { asyncHandler } = require('../middleware/errorHandler');

// ============================================
// CONTROLADOR DE CONVERSACIONES
// ============================================

class ConversationController {

  /**
   * Obtiene conversaciones de un restaurante
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getConversations = asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant?.id || req.params.restaurantId;
      
      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      if (!ValidationService.isValidUUID(restaurantId)) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante inválido'
        });
      }

      // Validar parámetros de paginación
      const paginationValidation = ValidationService.validatePaginationParams(req.query);
      if (!paginationValidation.isValid) {
        return res.status(400).json({
          success: false,
          error: paginationValidation.error
        });
      }

      const { page, limit } = paginationValidation.data;

      const options = {
        page,
        limit,
        status: req.query.status,
        customerPhone: req.query.customer_phone
      };

      // Obtener conversaciones
      const result = await Conversation.getRecent(restaurantId, options);

      logger.info('Conversaciones obtenidas', {
        restaurantId,
        page,
        limit,
        totalItems: result.pagination.total_items
      });

      res.json({
        success: true,
        data: result.conversations,
        pagination: result.pagination
      });

    } catch (error) {
      logger.error('Error obteniendo conversaciones:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo conversaciones'
      });
    }
  });

  /**
   * Obtiene una conversación específica por ID
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getConversationById = asyncHandler(async (req, res) => {
    try {
      const { conversationId } = req.params;

      if (!ValidationService.isValidUUID(conversationId)) {
        return res.status(400).json({
          success: false,
          error: 'ID de conversación inválido'
        });
      }

      const conversation = await Conversation.findById(conversationId);

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: 'Conversación no encontrada'
        });
      }

      // Verificar que la conversación pertenece al restaurante si está especificado
      if (req.restaurant && conversation.restaurant_id !== req.restaurant.id) {
        return res.status(404).json({
          success: false,
          error: 'Conversación no encontrada'
        });
      }

      // Parsear datos JSON para la respuesta
      let orderData = {};
      let aiContext = [];

      try {
        orderData = JSON.parse(conversation.order_data || '{}');
        aiContext = JSON.parse(conversation.ai_context || '[]');
      } catch (e) {
        logger.warn('Error parseando datos de conversación:', e);
      }

      const response = {
        ...conversation,
        order_data: orderData,
        ai_context: aiContext
      };

      logger.info('Conversación obtenida por ID', {
        conversationId,
        status: conversation.status,
        customerPhone: conversation.customer_phone?.substring(0, 8) + '****'
      });

      res.json({
        success: true,
        data: response
      });

    } catch (error) {
      logger.error('Error obteniendo conversación por ID:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo conversación'
      });
    }
  });

  /**
   * Obtiene conversación activa de un cliente
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getActiveConversation = asyncHandler(async (req, res) => {
    try {
      const { customerPhone } = req.params;
      const restaurantId = req.restaurant?.id || req.params.restaurantId;

      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      if (!customerPhone) {
        return res.status(400).json({
          success: false,
          error: 'Teléfono del cliente requerido'
        });
      }

      if (!ValidationService.isValidMexicanPhone(customerPhone)) {
        return res.status(400).json({
          success: false,
          error: 'Formato de teléfono inválido'
        });
      }

      const conversation = await Conversation.getActive(restaurantId, customerPhone);

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: 'No hay conversación activa'
        });
      }

      // Parsear datos JSON
      let orderData = {};
      let aiContext = [];

      try {
        orderData = JSON.parse(conversation.order_data || '{}');
        aiContext = JSON.parse(conversation.ai_context || '[]');
      } catch (e) {
        logger.warn('Error parseando datos de conversación activa:', e);
      }

      const response = {
        ...conversation,
        order_data: orderData,
        ai_context: aiContext
      };

      res.json({
        success: true,
        data: response
      });

    } catch (error) {
      logger.error('Error obteniendo conversación activa:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo conversación activa'
      });
    }
  });

  /**
   * Obtiene el estado de una conversación
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getConversationStatus = asyncHandler(async (req, res) => {
    try {
      const { customerPhone } = req.params;
      const restaurantId = req.restaurant?.id || req.params.restaurantId;

      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      if (!ValidationService.isValidMexicanPhone(customerPhone)) {
        return res.status(400).json({
          success: false,
          error: 'Formato de teléfono inválido'
        });
      }

      const status = await ConversationService.getConversationStatus(restaurantId, customerPhone);

      if (!status) {
        return res.status(404).json({
          success: false,
          error: 'No hay conversación activa'
        });
      }

      res.json({
        success: true,
        data: status
      });

    } catch (error) {
      logger.error('Error obteniendo estado de conversación:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo estado'
      });
    }
  });

  /**
   * Inicia una nueva conversación
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static startConversation = asyncHandler(async (req, res) => {
    try {
      const { customerPhone } = req.body;
      const restaurant = req.restaurant;

      if (!restaurant) {
        return res.status(400).json({
          success: false,
          error: 'Restaurante no identificado'
        });
      }

      if (!customerPhone) {
        return res.status(400).json({
          success: false,
          error: 'Teléfono del cliente requerido'
        });
      }

      if (!ValidationService.isValidMexicanPhone(customerPhone)) {
        return res.status(400).json({
          success: false,
          error: 'Formato de teléfono inválido'
        });
      }

      // Iniciar conversación usando el servicio
      const result = await ConversationService.startConversation(restaurant, customerPhone);

      logger.info('Conversación iniciada manualmente', {
        restaurantId: restaurant.id,
        customerPhone: customerPhone.substring(0, 8) + '****',
        conversationId: result.conversation.id
      });

      res.status(201).json({
        success: true,
        message: 'Conversación iniciada exitosamente',
        data: {
          conversation: result.conversation,
          customer: result.customer,
          send_result: result.sendResult
        }
      });

    } catch (error) {
      logger.error('Error iniciando conversación:', error);
      res.status(500).json({
        success: false,
        error: 'Error iniciando conversación'
      });
    }
  });

  /**
   * Reinicia una conversación
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static restartConversation = asyncHandler(async (req, res) => {
    try {
      const { customerPhone } = req.params;
      const restaurantId = req.restaurant?.id || req.params.restaurantId;

      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      if (!ValidationService.isValidMexicanPhone(customerPhone)) {
        return res.status(400).json({
          success: false,
          error: 'Formato de teléfono inválido'
        });
      }

      // Reiniciar conversación usando el servicio
      const result = await ConversationService.restartConversation(restaurantId, customerPhone);

      logger.info('Conversación reiniciada', {
        restaurantId,
        customerPhone: customerPhone.substring(0, 8) + '****',
        newConversationId: result.conversation.id
      });

      res.json({
        success: true,
        message: 'Conversación reiniciada exitosamente',
        data: result
      });

    } catch (error) {
      logger.error('Error reiniciando conversación:', error);
      res.status(500).json({
        success: false,
        error: 'Error reiniciando conversación'
      });
    }
  });

  /**
   * Actualiza una conversación
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static updateConversation = asyncHandler(async (req, res) => {
    try {
      const { conversationId } = req.params;

      if (!ValidationService.isValidUUID(conversationId)) {
        return res.status(400).json({
          success: false,
          error: 'ID de conversación inválido'
        });
      }

      const allowedFields = ['status', 'current_step', 'conversation_summary'];
      const updateData = {};

      Object.keys(req.body).forEach(key => {
        if (allowedFields.includes(key)) {
          updateData[key] = req.body[key];
        }
      });

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No hay campos válidos para actualizar'
        });
      }

      // Validar valores específicos
      if (updateData.status && !Object.values(CONVERSATION_STATUS).includes(updateData.status)) {
        return res.status(400).json({
          success: false,
          error: 'Estado de conversación inválido'
        });
      }

      if (updateData.current_step && !Object.values(CONVERSATION_STEPS).includes(updateData.current_step)) {
        return res.status(400).json({
          success: false,
          error: 'Paso de conversación inválido'
        });
      }

      // Actualizar conversación
      const updatedConversation = await Conversation.update(conversationId, updateData);

      logger.info('Conversación actualizada', {
        conversationId,
        updatedFields: Object.keys(updateData)
      });

      res.json({
        success: true,
        message: 'Conversación actualizada exitosamente',
        data: updatedConversation
      });

    } catch (error) {
      logger.error('Error actualizando conversación:', error);
      
      if (error.message.includes('no encontrado')) {
        res.status(404).json({
          success: false,
          error: 'Conversación no encontrada'
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Error actualizando conversación'
        });
      }
    }
  });

  /**
   * Marca una conversación como abandonada
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static abandonConversation = asyncHandler(async (req, res) => {
    try {
      const { conversationId } = req.params;

      if (!ValidationService.isValidUUID(conversationId)) {
        return res.status(400).json({
          success: false,
          error: 'ID de conversación inválido'
        });
      }

      // Abandonar conversación
      const abandonedConversation = await Conversation.abandon(conversationId);

      logger.info('Conversación marcada como abandonada', { conversationId });

      res.json({
        success: true,
        message: 'Conversación marcada como abandonada',
        data: abandonedConversation
      });

    } catch (error) {
      logger.error('Error marcando conversación como abandonada:', error);
      
      if (error.message.includes('no encontrado')) {
        res.status(404).json({
          success: false,
          error: 'Conversación no encontrada'
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Error abandonando conversación'
        });
      }
    }
  });

  /**
   * Simula un mensaje en una conversación (para testing)
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static simulateMessage = asyncHandler(async (req, res) => {
    try {
      const { conversationId } = req.params;
      const { message, role = 'user' } = req.body;

      if (!ValidationService.isValidUUID(conversationId)) {
        return res.status(400).json({
          success: false,
          error: 'ID de conversación inválido'
        });
      }

      if (!message || !message.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Mensaje es requerido'
        });
      }

      if (!['user', 'assistant'].includes(role)) {
        return res.status(400).json({
          success: false,
          error: 'Role debe ser "user" o "assistant"'
        });
      }

      // Solo permitir en desarrollo
      if (process.env.NODE_ENV !== 'development') {
        return res.status(403).json({
          success: false,
          error: 'Función solo disponible en desarrollo'
        });
      }

      // Agregar mensaje al contexto
      const updatedConversation = await Conversation.addToContext(conversationId, role, message);

      logger.info('Mensaje simulado agregado', {
        conversationId,
        role,
        messageLength: message.length
      });

      res.json({
        success: true,
        message: 'Mensaje simulado agregado exitosamente',
        data: updatedConversation
      });

    } catch (error) {
      logger.error('Error simulando mensaje:', error);
      res.status(500).json({
        success: false,
        error: 'Error simulando mensaje'
      });
    }
  });

  /**
   * Obtiene estadísticas de conversaciones
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getConversationStatistics = asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant?.id || req.params.restaurantId;
      
      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      // Validar parámetros de fecha
      const dateValidation = ValidationService.validateDateRangeParams(req.query);
      if (!dateValidation.isValid) {
        return res.status(400).json({
          success: false,
          error: dateValidation.error
        });
      }

      const { start_date, end_date } = dateValidation.data;

      const dateRange = {};
      if (start_date) dateRange.startDate = start_date;
      if (end_date) dateRange.endDate = end_date;

      // Obtener estadísticas usando el servicio
      const statistics = await ConversationService.getConversationStats(restaurantId, dateRange);

      logger.info('Estadísticas de conversaciones obtenidas', {
        restaurantId,
        dateRange,
        totalConversations: statistics.total_conversations
      });

      res.json({
        success: true,
        data: statistics
      });

    } catch (error) {
      logger.error('Error obteniendo estadísticas de conversaciones:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo estadísticas'
      });
    }
  });

  /**
   * Limpia conversaciones inactivas
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static cleanupInactiveConversations = asyncHandler(async (req, res) => {
    try {
      const { max_inactive_hours = 2 } = req.query;
      const maxHours = parseInt(max_inactive_hours);

      if (maxHours < 1 || maxHours > 24) {
        return res.status(400).json({
          success: false,
          error: 'max_inactive_hours debe estar entre 1 y 24'
        });
      }

      // Limpiar conversaciones usando el servicio
      const cleanedCount = await ConversationService.cleanupInactiveConversations(maxHours);

      logger.info('Limpieza manual de conversaciones ejecutada', {
        maxInactiveHours: maxHours,
        cleanedCount
      });

      res.json({
        success: true,
        message: `Limpieza completada: ${cleanedCount} conversaciones marcadas como abandonadas`,
        data: {
          cleaned_count: cleanedCount,
          max_inactive_hours: maxHours
        }
      });

    } catch (error) {
      logger.error('Error limpiando conversaciones inactivas:', error);
      res.status(500).json({
        success: false,
        error: 'Error limpiando conversaciones'
      });
    }
  });

  /**
   * Envía mensaje manual en una conversación
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static sendManualMessage = asyncHandler(async (req, res) => {
    try {
      const { conversationId } = req.params;
      const { message } = req.body;

      if (!ValidationService.isValidUUID(conversationId)) {
        return res.status(400).json({
          success: false,
          error: 'ID de conversación inválido'
        });
      }

      if (!message || !message.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Mensaje es requerido'
        });
      }

      // Validar mensaje
      const validation = ValidationService.validateIncomingMessage(message, null);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: validation.error
        });
      }

      // Obtener conversación para el teléfono del cliente
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: 'Conversación no encontrada'
        });
      }

      // Enviar mensaje
      const sendResult = await WhatsAppService.sendMessage(
        conversation.customer_phone,
        message,
        { addEmojis: true }
      );

      // Agregar mensaje al contexto
      await Conversation.addToContext(conversationId, 'assistant', message);

      logger.info('Mensaje manual enviado en conversación', {
        conversationId,
        customerPhone: conversation.customer_phone?.substring(0, 8) + '****',
        messageLength: message.length,
        success: sendResult.success
      });

      res.json({
        success: true,
        message: 'Mensaje enviado exitosamente',
        data: {
          conversation_id: conversationId,
          send_result: sendResult
        }
      });

    } catch (error) {
      logger.error('Error enviando mensaje manual:', error);
      res.status(500).json({
        success: false,
        error: 'Error enviando mensaje'
      });
    }
  });

  /**
   * Exporta conversaciones a CSV/JSON
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static exportConversations = asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant?.id || req.params.restaurantId;
      
      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      const { format = 'json', limit = 1000 } = req.query;

      if (!['json', 'csv'].includes(format)) {
        return res.status(400).json({
          success: false,
          error: 'Formato debe ser "json" o "csv"'
        });
      }

      const limitNumber = parseInt(limit);
      if (limitNumber < 1 || limitNumber > 10000) {
        return res.status(400).json({
          success: false,
          error: 'Límite debe estar entre 1 y 10000'
        });
      }

      // Obtener conversaciones
      const result = await Conversation.getRecent(restaurantId, {
        page: 1,
        limit: limitNumber
      });

      const conversations = result.conversations;

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="conversations-${restaurantId}-${Date.now()}.json"`);
        
        res.json({
          restaurant_id: restaurantId,
          exported_at: new Date().toISOString(),
          total_conversations: conversations.length,
          conversations: conversations
        });
      } else {
        // CSV format (implementación básica)
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="conversations-${restaurantId}-${Date.now()}.csv"`);
        
        let csv = 'id,customer_phone,status,current_step,created_at,last_interaction_at,order_total\n';
        
        conversations.forEach(conv => {
          csv += `${conv.id},${conv.customer_phone},${conv.status},${conv.current_step},${conv.created_at},${conv.last_interaction_at},${conv.order_total || 0}\n`;
        });
        
        res.send(csv);
      }

      logger.info('Conversaciones exportadas', {
        restaurantId,
        format,
        count: conversations.length
      });

    } catch (error) {
      logger.error('Error exportando conversaciones:', error);
      res.status(500).json({
        success: false,
        error: 'Error exportando conversaciones'
      });
    }
  });
}

module.exports = ConversationController;