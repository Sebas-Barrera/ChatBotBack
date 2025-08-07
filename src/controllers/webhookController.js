const WhatsAppService = require('../services/whatsappService');
const ConversationService = require('../services/conversationService');
const ValidationService = require('../services/validationService');
const logger = require('../utils/logger');
const { asyncHandler } = require('../middleware/errorHandler');

// ============================================
// CONTROLADOR DE WEBHOOKS
// ============================================

class WebhookController {

  /**
   * Maneja webhooks de WhatsApp (Twilio y Meta)
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static handleWhatsAppWebhook = asyncHandler(async (req, res) => {
    try {
      const provider = req.query.provider || 'twilio';
      
      logger.debug('Webhook recibido', {
        provider,
        headers: req.headers,
        body: req.body,
        query: req.query
      });

      // Validar webhook según el proveedor
      const validationResult = WhatsAppService.validateWebhook(req, provider);
      
      if (!validationResult) {
        logger.warn('Webhook inválido recibido', {
          provider,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });
        
        return res.status(403).json({
          success: false,
          error: 'Webhook no autorizado'
        });
      }

      // Para Meta WhatsApp, manejar verificación de webhook
      if (provider === 'meta' && req.method === 'GET') {
        logger.info('Verificación de webhook de Meta WhatsApp exitosa');
        return res.status(200).send(validationResult);
      }

      // Validar datos del webhook
      const webhookValidation = ValidationService.validateWhatsAppWebhook(req.body, provider);
      if (!webhookValidation.isValid) {
        logger.warn('Datos de webhook inválidos', {
          provider,
          error: webhookValidation.error
        });
        
        return res.status(400).json({
          success: false,
          error: 'Datos de webhook inválidos'
        });
      }

      // Procesar mensaje entrante
      const messageData = WhatsAppService.processIncomingMessage(req.body, provider);
      
      if (!messageData) {
        logger.debug('Webhook sin mensaje procesable (posible notificación de estado)');
        return res.status(200).json({ success: true, message: 'Webhook procesado' });
      }

      // Verificar que hay un restaurante asociado
      if (!req.restaurant) {
        logger.warn('Mensaje recibido sin restaurante asociado', {
          provider,
          from: messageData.from?.substring(0, 8) + '****',
          to: messageData.to
        });
        
        return res.status(200).json({
          success: false,
          message: 'Restaurante no encontrado'
        });
      }

      // Procesar mensaje de forma asíncrona para responder rápido al webhook
      setImmediate(async () => {
        try {
          await WebhookController.processIncomingMessage(req.restaurant, messageData);
        } catch (error) {
          logger.error('Error procesando mensaje de forma asíncrona:', error);
        }
      });

      // Responder inmediatamente al webhook
      res.status(200).json({
        success: true,
        message: 'Mensaje recibido y procesándose'
      });

    } catch (error) {
      logger.error('Error manejando webhook de WhatsApp:', error);
      
      // Siempre responder 200 para evitar reintentos innecesarios
      res.status(200).json({
        success: false,
        error: 'Error interno procesando webhook'
      });
    }
  });

  /**
   * Verifica webhook de Meta WhatsApp (método GET)
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static verifyMetaWebhook = asyncHandler(async (req, res) => {
    try {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      logger.info('Verificación de webhook Meta WhatsApp solicitada', {
        mode,
        token: token ? token.substring(0, 10) + '...' : 'none'
      });

      const validationResult = WhatsAppService.validateWebhook(req, 'meta');
      
      if (validationResult && validationResult === challenge) {
        logger.info('Verificación de webhook exitosa');
        return res.status(200).send(challenge);
      } else {
        logger.warn('Verificación de webhook fallida');
        return res.status(403).send('Error de verificación');
      }

    } catch (error) {
      logger.error('Error verificando webhook de Meta:', error);
      res.status(500).send('Error interno');
    }
  });

  /**
   * Webhook específico para Twilio
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static handleTwilioWebhook = asyncHandler(async (req, res) => {
    req.query.provider = 'twilio';
    return WebhookController.handleWhatsAppWebhook(req, res);
  });

  /**
   * Webhook específico para Meta WhatsApp
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static handleMetaWebhook = asyncHandler(async (req, res) => {
    // Manejar verificación GET
    if (req.method === 'GET') {
      return WebhookController.verifyMetaWebhook(req, res);
    }
    
    // Manejar mensajes POST
    req.query.provider = 'meta';
    return WebhookController.handleWhatsAppWebhook(req, res);
  });

  /**
   * Procesa mensaje entrante
   * @param {Object} restaurant - Datos del restaurante
   * @param {Object} messageData - Datos del mensaje
   */
  static async processIncomingMessage(restaurant, messageData) {
    try {
      const startTime = Date.now();

      logger.info('Procesando mensaje entrante', {
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        customerPhone: messageData.from?.substring(0, 8) + '****',
        messageLength: messageData.body?.length || 0,
        hasMedia: !!messageData.mediaUrl
      });

      // Verificar que el restaurante esté activo
      if (!restaurant.is_active) {
        logger.warn('Mensaje recibido para restaurante inactivo', {
          restaurantId: restaurant.id
        });
        return;
      }

      // Verificar horarios de operación
      if (!this.isRestaurantOpen(restaurant)) {
        await this.sendClosedMessage(messageData.from, restaurant);
        return;
      }

      // Procesar mensaje con el servicio de conversaciones
      const result = await ConversationService.processIncomingMessage({
        restaurant,
        customerPhone: messageData.from,
        messageText: messageData.body || '',
        messageData
      });

      const processingTime = Date.now() - startTime;

      if (result.success) {
        logger.info('Mensaje procesado exitosamente', {
          restaurantId: restaurant.id,
          customerPhone: messageData.from?.substring(0, 8) + '****',
          processingTime: `${processingTime}ms`,
          conversationId: result.conversation?.id,
          actionsProcessed: result.actions_processed?.length || 0,
          claudeUsage: result.claudeResult?.usage
        });
      } else {
        logger.error('Error procesando mensaje', {
          restaurantId: restaurant.id,
          customerPhone: messageData.from?.substring(0, 8) + '****',
          processingTime: `${processingTime}ms`,
          error: result.error
        });
      }

    } catch (error) {
      logger.error('Error en procesamiento de mensaje:', error);
      
      // Intentar enviar mensaje de error al cliente
      try {
        await WhatsAppService.sendMessage(
          messageData.from,
          restaurant.error_message || 'Lo siento, tuve un problema técnico. ¿Podrías repetir tu mensaje?'
        );
      } catch (sendError) {
        logger.error('Error enviando mensaje de error:', sendError);
      }
    }
  }

  /**
   * Verifica si el restaurante está abierto
   * @param {Object} restaurant - Datos del restaurante
   * @returns {boolean} True si está abierto
   */
  static isRestaurantOpen(restaurant) {
    try {
      if (!restaurant.opens_at || !restaurant.closes_at) {
        return true; // Si no hay horarios definidos, asumir abierto
      }

      const now = new Date();
      const currentTime = now.toTimeString().slice(0, 8); // HH:mm:ss

      const opensAt = restaurant.opens_at;
      const closesAt = restaurant.closes_at;

      // Manejar caso donde cierra después de medianoche
      if (closesAt < opensAt) {
        return currentTime >= opensAt || currentTime <= closesAt;
      }

      return currentTime >= opensAt && currentTime <= closesAt;

    } catch (error) {
      logger.error('Error verificando horarios de restaurante:', error);
      return true; // En caso de error, asumir abierto
    }
  }

  /**
   * Envía mensaje de restaurante cerrado
   * @param {string} customerPhone - Teléfono del cliente
   * @param {Object} restaurant - Datos del restaurante
   */
  static async sendClosedMessage(customerPhone, restaurant) {
    try {
      const message = `🕐 Lo siento, ${restaurant.name} está cerrado en este momento.\n\n` +
                     `⏰ Nuestros horarios son: ${restaurant.opens_at} - ${restaurant.closes_at}\n\n` +
                     `¡Te esperamos durante nuestro horario de atención! 😊`;

      await WhatsAppService.sendMessage(customerPhone, message);

      logger.info('Mensaje de restaurante cerrado enviado', {
        restaurantId: restaurant.id,
        customerPhone: customerPhone?.substring(0, 8) + '****'
      });

    } catch (error) {
      logger.error('Error enviando mensaje de restaurante cerrado:', error);
    }
  }

  /**
   * Maneja webhooks de prueba/desarrollo
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static handleTestWebhook = asyncHandler(async (req, res) => {
    try {
      logger.info('Webhook de prueba recibido', {
        method: req.method,
        headers: req.headers,
        body: req.body,
        query: req.query
      });

      // En desarrollo, simular procesamiento
      if (process.env.NODE_ENV === 'development') {
        const testMessage = {
          messageId: 'test-' + Date.now(),
          from: req.body.from || '+525512345678',
          to: req.body.to || '+525587654321',
          body: req.body.message || 'Mensaje de prueba',
          timestamp: new Date(),
          provider: 'test'
        };

        if (req.restaurant) {
          setImmediate(async () => {
            try {
              await WebhookController.processIncomingMessage(req.restaurant, testMessage);
            } catch (error) {
              logger.error('Error procesando mensaje de prueba:', error);
            }
          });
        }

        return res.status(200).json({
          success: true,
          message: 'Webhook de prueba procesado',
          data: testMessage
        });
      }

      res.status(200).json({
        success: true,
        message: 'Webhook de prueba recibido'
      });

    } catch (error) {
      logger.error('Error manejando webhook de prueba:', error);
      res.status(500).json({
        success: false,
        error: 'Error procesando webhook de prueba'
      });
    }
  });

  /**
   * Obtiene estadísticas de webhooks
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getWebhookStats = asyncHandler(async (req, res) => {
    try {
      // Esta función requeriría una tabla de logs de webhooks
      // Por ahora retornamos estadísticas básicas
      const stats = {
        total_webhooks_received: 0,
        successful_processing: 0,
        failed_processing: 0,
        avg_processing_time: 0,
        providers: {
          twilio: 0,
          meta: 0,
          test: 0
        },
        last_24h: {
          total: 0,
          successful: 0,
          failed: 0
        }
      };

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      logger.error('Error obteniendo estadísticas de webhooks:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo estadísticas'
      });
    }
  });

  /**
   * Reinicia una conversación específica
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static restartConversation = asyncHandler(async (req, res) => {
    try {
      const { customerPhone } = req.body;
      
      if (!customerPhone) {
        return res.status(400).json({
          success: false,
          error: 'Teléfono del cliente es requerido'
        });
      }

      if (!req.restaurant) {
        return res.status(400).json({
          success: false,
          error: 'Restaurante no identificado'
        });
      }

      // Reiniciar conversación
      const result = await ConversationService.restartConversation(
        req.restaurant.id,
        customerPhone
      );

      logger.info('Conversación reiniciada manualmente', {
        restaurantId: req.restaurant.id,
        customerPhone: customerPhone?.substring(0, 8) + '****',
        newConversationId: result.conversation?.id
      });

      res.json({
        success: true,
        message: 'Conversación reiniciada exitosamente',
        data: {
          conversation_id: result.conversation?.id,
          customer_id: result.customer?.id
        }
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
   * Envía mensaje manual desde el dashboard
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static sendManualMessage = asyncHandler(async (req, res) => {
    try {
      const { customerPhone, message } = req.body;

      if (!customerPhone || !message) {
        return res.status(400).json({
          success: false,
          error: 'Teléfono del cliente y mensaje son requeridos'
        });
      }

      if (!req.restaurant) {
        return res.status(400).json({
          success: false,
          error: 'Restaurante no identificado'
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

      // Enviar mensaje
      const result = await WhatsAppService.sendMessage(customerPhone, message, {
        addEmojis: true,
        restaurantName: req.restaurant.name
      });

      logger.info('Mensaje manual enviado', {
        restaurantId: req.restaurant.id,
        customerPhone: customerPhone?.substring(0, 8) + '****',
        messageLength: message.length,
        success: result.success
      });

      res.json({
        success: true,
        message: 'Mensaje enviado exitosamente',
        data: {
          message_id: result.messageId,
          provider: result.provider
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
}

module.exports = WebhookController;