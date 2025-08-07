const {
  sendWhatsAppMessage,
  processTwilioIncomingMessage,
  processMetaIncomingMessage,
  validateTwilioWebhook,
  validateMetaWebhook,
  formatPhoneNumber,
  checkWhatsAppStatus
} = require('../config/whatsapp');

const logger = require('../utils/logger');
const { DEFAULT_MESSAGES, EMOJIS } = require('../utils/constants');
const { ValidationError, ExternalServiceError } = require('../middleware/errorHandler');

// ============================================
// SERVICIO WHATSAPP
// ============================================

class WhatsAppService {

  /**
   * Envía un mensaje de WhatsApp a un cliente
   * @param {string} to - Número de teléfono destino
   * @param {string} message - Mensaje a enviar
   * @param {Object} options - Opciones adicionales
   * @returns {Promise<Object>} Resultado del envío
   */
  static async sendMessage(to, message, options = {}) {
    try {
      const formattedPhone = formatPhoneNumber(to);
      
      // Validar mensaje
      if (!message || message.trim().length === 0) {
        throw new ValidationError('Mensaje vacío');
      }

      // Procesar mensaje (agregar emojis, formatear, etc.)
      const processedMessage = this.processOutgoingMessage(message, options);

      // Enviar mensaje
      const result = await sendWhatsAppMessage(formattedPhone, processedMessage, options);

      logger.logWhatsApp('send', formattedPhone, result.provider, {
        success: result.success,
        messageId: result.messageId,
        messageLength: processedMessage.length
      });

      return result;

    } catch (error) {
      logger.error('Error enviando mensaje de WhatsApp:', error);
      throw new ExternalServiceError('WhatsApp', error.message);
    }
  }

  /**
   * Procesa un mensaje entrante de WhatsApp
   * @param {Object} webhookData - Datos del webhook
   * @param {string} provider - Proveedor (twilio/meta)
   * @returns {Object} Mensaje procesado
   */
  static processIncomingMessage(webhookData, provider) {
    try {
      let processedMessage;

      switch (provider.toLowerCase()) {
        case 'twilio':
          processedMessage = processTwilioIncomingMessage(webhookData);
          break;
        case 'meta':
          processedMessage = processMetaIncomingMessage(webhookData);
          break;
        default:
          throw new ValidationError('Proveedor de WhatsApp no soportado');
      }

      if (!processedMessage) {
        return null;
      }

      // Procesar mensaje entrante (limpiar, validar, etc.)
      processedMessage.body = this.processIncomingMessageText(processedMessage.body);

      logger.logWhatsApp('receive', processedMessage.from, provider, {
        messageId: processedMessage.messageId,
        messageLength: processedMessage.body.length,
        hasMedia: !!processedMessage.mediaUrl
      });

      return processedMessage;

    } catch (error) {
      logger.error('Error procesando mensaje entrante:', error);
      throw error;
    }
  }

  /**
   * Valida un webhook de WhatsApp
   * @param {Object} req - Request object
   * @param {string} provider - Proveedor (twilio/meta)
   * @returns {boolean|string} True/challenge si es válido, false si no
   */
  static validateWebhook(req, provider) {
    try {
      switch (provider.toLowerCase()) {
        case 'twilio':
          const signature = req.headers['x-twilio-signature'];
          const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
          return validateTwilioWebhook(signature, url, req.body);

        case 'meta':
          const mode = req.query['hub.mode'];
          const token = req.query['hub.verify_token'];
          const challenge = req.query['hub.challenge'];
          return validateMetaWebhook(mode, token, challenge);

        default:
          return false;
      }

    } catch (error) {
      logger.error('Error validando webhook:', error);
      return false;
    }
  }

  /**
   * Procesa mensaje saliente (agregar formato, emojis, etc.)
   * @param {string} message - Mensaje original
   * @param {Object} options - Opciones de procesamiento
   * @returns {string} Mensaje procesado
   */
  static processOutgoingMessage(message, options = {}) {
    try {
      let processedMessage = message;

      // Aplicar formato básico
      if (options.addGreeting && !this.hasGreeting(message)) {
        processedMessage = `¡Hola! 👋\n\n${processedMessage}`;
      }

      // Agregar emojis contextualmente
      if (options.addEmojis !== false) {
        processedMessage = this.addContextualEmojis(processedMessage);
      }

      // Formatear listas si las hay
      processedMessage = this.formatLists(processedMessage);

      // Formatear precios
      processedMessage = this.formatPrices(processedMessage);

      // Asegurar que no sea demasiado largo
      if (processedMessage.length > 1600) {
        processedMessage = processedMessage.substring(0, 1597) + '...';
      }

      return processedMessage;

    } catch (error) {
      logger.error('Error procesando mensaje saliente:', error);
      return message; // Retornar mensaje original si hay error
    }
  }

  /**
   * Procesa mensaje entrante (limpiar texto, etc.)
   * @param {string} messageText - Texto del mensaje
   * @returns {string} Texto procesado
   */
  static processIncomingMessageText(messageText) {
    if (!messageText) return '';

    try {
      let processed = messageText;

      // Limpiar espacios extra
      processed = processed.trim().replace(/\s+/g, ' ');

      // Normalizar caracteres especiales
      processed = processed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      // Convertir a minúscula para análisis (pero mantener original para respuesta)
      const normalized = processed.toLowerCase();

      // Expandir abreviaciones comunes
      const abbreviations = {
        'q': 'que',
        'x': 'por',
        'xq': 'porque',
        'pq': 'porque',
        'tmb': 'tambien',
        'tb': 'tambien',
        'bn': 'bien',
        'ok': 'esta bien',
        'si': 'sí'
      };

      Object.keys(abbreviations).forEach(abbrev => {
        const regex = new RegExp(`\\b${abbrev}\\b`, 'gi');
        processed = processed.replace(regex, abbreviations[abbrev]);
      });

      return processed;

    } catch (error) {
      logger.error('Error procesando texto entrante:', error);
      return messageText;
    }
  }

  /**
   * Verifica si el mensaje ya tiene saludo
   * @param {string} message - Mensaje a verificar
   * @returns {boolean} True si tiene saludo
   */
  static hasGreeting(message) {
    const greetings = ['hola', 'buenas', 'saludos', 'que tal', 'hello', 'hi'];
    const messageLower = message.toLowerCase();
    return greetings.some(greeting => messageLower.includes(greeting));
  }

  /**
   * Agrega emojis contextualmente al mensaje
   * @param {string} message - Mensaje original
   * @returns {string} Mensaje con emojis
   */
  static addContextualEmojis(message) {
    try {
      let processedMessage = message;
      const messageLower = message.toLowerCase();

      // Solo agregar si no tiene muchos emojis ya
      const emojiCount = (message.match(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/gu) || []).length;
      
      if (emojiCount > 3) {
        return processedMessage; // Ya tiene suficientes emojis
      }

      // Emojis por contexto
      if (messageLower.includes('gracias') || messageLower.includes('thank')) {
        processedMessage = processedMessage.replace(/gracias/gi, `gracias ${EMOJIS.GENERAL.THANKS}`);
      }

      if (messageLower.includes('pedido') && messageLower.includes('listo')) {
        processedMessage += ` ${EMOJIS.STATUS.SUCCESS}`;
      }

      if (messageLower.includes('error') || messageLower.includes('problema')) {
        processedMessage += ` ${EMOJIS.STATUS.ERROR}`;
      }

      if (messageLower.includes('dinero') || messageLower.includes('total') || messageLower.includes('$')) {
        processedMessage = processedMessage.replace(/total/gi, `total ${EMOJIS.STATUS.MONEY}`);
      }

      if (messageLower.includes('tiempo') || messageLower.includes('minutos')) {
        processedMessage = processedMessage.replace(/minutos/gi, `minutos ${EMOJIS.GENERAL.TIME}`);
      }

      if (messageLower.includes('dirección') || messageLower.includes('direccion') || messageLower.includes('entrega')) {
        processedMessage = processedMessage.replace(/(dirección|direccion|entrega)/gi, `$1 ${EMOJIS.GENERAL.LOCATION}`);
      }

      return processedMessage;

    } catch (error) {
      logger.error('Error agregando emojis contextuales:', error);
      return message;
    }
  }

  /**
   * Formatea listas en el mensaje
   * @param {string} message - Mensaje con listas
   * @returns {string} Mensaje con listas formateadas
   */
  static formatLists(message) {
    try {
      let processedMessage = message;

      // Detectar y formatear listas numericas
      const listPattern = /(\d+[\.\)]?\s*[^\n]+)/g;
      const matches = message.match(listPattern);

      if (matches && matches.length > 1) {
        matches.forEach(match => {
          const formatted = match.replace(/^(\d+)[\.\)]*\s*/, '$1️⃣ ');
          processedMessage = processedMessage.replace(match, formatted);
        });
      }

      // Formatear listas con guiones
      processedMessage = processedMessage.replace(/^-\s+/gm, '• ');
      
      return processedMessage;

    } catch (error) {
      logger.error('Error formateando listas:', error);
      return message;
    }
  }

  /**
   * Formatea precios en el mensaje
   * @param {string} message - Mensaje con precios
   * @returns {string} Mensaje con precios formateados
   */
  static formatPrices(message) {
    try {
      // Formatear precios ($XX.XX o $XX)
      let processedMessage = message.replace(/\$(\d+(?:\.\d{2})?)/g, '💰$$$1');
      
      // Pero no duplicar si ya tiene emoji
      processedMessage = processedMessage.replace(/💰💰/g, '💰');
      
      return processedMessage;

    } catch (error) {
      logger.error('Error formateando precios:', error);
      return message;
    }
  }

  /**
   * Genera mensaje de confirmación de pedido
   * @param {Object} orderData - Datos del pedido
   * @param {Object} restaurant - Datos del restaurante
   * @returns {string} Mensaje de confirmación
   */
  static generateOrderConfirmation(orderData, restaurant) {
    try {
      const items = orderData.items || [];
      const deliveryTime = orderData.estimated_delivery_time || restaurant.delivery_time_max || 35;

      let message = `${EMOJIS.STATUS.SUCCESS} *PEDIDO CONFIRMADO*\n\n`;
      
      message += `*Restaurante:* ${restaurant.name}\n`;
      message += `*Pedido:*\n`;

      items.forEach((item, index) => {
        message += `${index + 1}️⃣ ${item.name} (${item.quantity}x) - $${item.item_total}\n`;
        
        if (item.customizations && item.customizations.length > 0) {
          item.customizations.forEach(custom => {
            message += `   • ${custom.name}${custom.extra_cost > 0 ? ` (+$${custom.extra_cost})` : ''}\n`;
          });
        }
        
        if (item.notes) {
          message += `   📝 ${item.notes}\n`;
        }
      });

      message += `\n*Subtotal:* $${orderData.subtotal}`;
      
      if (orderData.delivery_fee > 0) {
        message += `\n*Envío:* $${orderData.delivery_fee}`;
      }
      
      message += `\n*TOTAL:* 💰$${orderData.total}`;

      message += `\n\n*Dirección de entrega:*\n`;
      message += `${EMOJIS.GENERAL.LOCATION} ${orderData.delivery_address?.street} ${orderData.delivery_address?.number}\n`;
      message += `${orderData.delivery_address?.neighborhood}`;
      
      if (orderData.delivery_address?.references) {
        message += `\n📍 *Referencias:* ${orderData.delivery_address.references}`;
      }

      message += `\n\n${EMOJIS.GENERAL.TIME} *Tiempo estimado:* ${deliveryTime} minutos`;
      
      if (restaurant.phone) {
        message += `\n${EMOJIS.GENERAL.PHONE} *Teléfono:* ${restaurant.phone}`;
      }

      message += `\n\n¡Gracias por tu preferencia! ${EMOJIS.GENERAL.THANKS}`;

      return message;

    } catch (error) {
      logger.error('Error generando confirmación de pedido:', error);
      return DEFAULT_MESSAGES.ORDER_CONFIRMED.replace('{delivery_time}', '30-35');
    }
  }

  /**
   * Genera mensaje de menú formateado
   * @param {Array} menuCategories - Categorías del menú
   * @param {Object} restaurant - Datos del restaurante
   * @returns {string} Mensaje del menú
   */
  static generateMenuMessage(menuCategories, restaurant) {
    try {
      let message = `🍽️ *MENÚ - ${restaurant.name.toUpperCase()}*\n\n`;

      menuCategories.forEach((category, categoryIndex) => {
        if (category.items.length === 0) return;

        const emoji = category.emoji || '🍽️';
        message += `${emoji} *${category.name.toUpperCase()}*\n`;
        
        if (category.description) {
          message += `_${category.description}_\n`;
        }

        category.items.forEach((item, itemIndex) => {
          message += `${itemIndex + 1}. *${item.name}* - $${item.price}\n`;
          
          if (item.description) {
            message += `   _${item.description}_\n`;
          }
        });

        message += '\n';
      });

      // Agregar información adicional
      if (restaurant.delivery_fee > 0) {
        message += `🚚 *Costo de envío:* $${restaurant.delivery_fee}\n`;
      }

      if (restaurant.minimum_order > 0) {
        message += `📦 *Pedido mínimo:* $${restaurant.minimum_order}\n`;
      }

      message += `${EMOJIS.GENERAL.TIME} *Tiempo de entrega:* ${restaurant.delivery_time_min}-${restaurant.delivery_time_max} min\n\n`;

      message += `¿Qué te gustaría ordenar? 😊`;

      return message;

    } catch (error) {
      logger.error('Error generando mensaje de menú:', error);
      return 'Error generando menú. Por favor intenta más tarde.';
    }
  }

  /**
   * Genera mensaje de estado del pedido
   * @param {Object} order - Datos del pedido
   * @returns {string} Mensaje de estado
   */
  static generateOrderStatusMessage(order) {
    try {
      const statusEmojis = {
        'confirmed': '✅',
        'preparing': '👨‍🍳',
        'ready': '🛵',
        'out_for_delivery': '🚗',
        'delivered': '✅',
        'cancelled': '❌'
      };

      const statusNames = {
        'confirmed': 'Confirmado',
        'preparing': 'En preparación',
        'ready': 'Listo para entregar',
        'out_for_delivery': 'En camino',
        'delivered': 'Entregado',
        'cancelled': 'Cancelado'
      };

      const emoji = statusEmojis[order.status] || '📋';
      const statusName = statusNames[order.status] || order.status;

      let message = `${emoji} *ESTADO DE TU PEDIDO*\n\n`;
      message += `*Estado:* ${statusName}\n`;
      message += `*Total:* $${order.total}\n`;

      if (order.estimated_delivery_time && order.status !== 'delivered') {
        message += `*Tiempo estimado:* ${order.estimated_delivery_time} min\n`;
      }

      if (order.delivered_at) {
        const deliveredDate = new Date(order.delivered_at);
        message += `*Entregado:* ${deliveredDate.toLocaleString('es-MX')}\n`;
      }

      return message;

    } catch (error) {
      logger.error('Error generando mensaje de estado:', error);
      return 'Error obteniendo estado del pedido.';
    }
  }

  /**
   * Envía mensaje con reintentos automáticos
   * @param {string} to - Número destino
   * @param {string} message - Mensaje a enviar
   * @param {Object} options - Opciones adicionales
   * @param {number} maxRetries - Número máximo de reintentos
   * @returns {Promise<Object>} Resultado del envío
   */
  static async sendMessageWithRetry(to, message, options = {}, maxRetries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.sendMessage(to, message, options);
        
        if (result.success) {
          if (attempt > 1) {
            logger.info('Mensaje enviado exitosamente después de reintentos', {
              phone: to.substring(0, 8) + '****',
              attempt,
              maxRetries
            });
          }
          return result;
        }

      } catch (error) {
        lastError = error;
        
        logger.warn(`Intento ${attempt}/${maxRetries} fallido enviando mensaje`, {
          phone: to.substring(0, 8) + '****',
          error: error.message,
          attempt
        });

        if (attempt < maxRetries) {
          // Esperar antes del siguiente intento (backoff exponencial)
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // Si todos los intentos fallaron
    logger.error('Todos los intentos de envío fallaron', {
      phone: to.substring(0, 8) + '****',
      maxRetries,
      finalError: lastError?.message
    });

    throw lastError || new Error('Envío fallido después de todos los reintentos');
  }

  /**
   * Verifica el estado de los servicios de WhatsApp
   * @returns {Promise<Object>} Estado de los servicios
   */
  static async checkServicesStatus() {
    try {
      const status = await checkWhatsAppStatus();
      
      logger.info('Estado de servicios WhatsApp verificado', status);
      
      return {
        ...status,
        timestamp: new Date().toISOString(),
        healthy: status.activeProvider !== null
      };

    } catch (error) {
      logger.error('Error verificando estado de servicios WhatsApp:', error);
      
      return {
        twilio: false,
        meta: false,
        activeProvider: null,
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Procesa mensajes multimedia (imágenes, documentos)
   * @param {Object} messageData - Datos del mensaje
   * @returns {Promise<Object>} Información del archivo procesado
   */
  static async processMediaMessage(messageData) {
    try {
      const { mediaUrl, mediaType } = messageData;
      
      if (!mediaUrl) {
        return null;
      }

      // Por ahora solo loggear, en el futuro se podría descargar y procesar
      logger.info('Mensaje multimedia recibido', {
        mediaType,
        mediaUrl: mediaUrl.substring(0, 100) + '...',
        from: messageData.from?.substring(0, 8) + '****'
      });

      return {
        type: mediaType,
        url: mediaUrl,
        processed: false,
        message: 'Los archivos multimedia no están soportados en este momento, pero hemos recibido tu mensaje. ¿Podrías escribir tu pedido por texto? 😊'
      };

    } catch (error) {
      logger.error('Error procesando mensaje multimedia:', error);
      return {
        processed: false,
        error: error.message,
        message: 'Hubo un problema procesando tu archivo. ¿Podrías enviar tu pedido por texto? 😊'
      };
    }
  }

  /**
   * Obtiene estadísticas de mensajes
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} dateRange - Rango de fechas
   * @returns {Promise<Object>} Estadísticas de mensajería
   */
  static async getMessagingStats(restaurantId, dateRange = {}) {
    try {
      // Esta función requeriría una tabla de logs de mensajes
      // Por ahora retornamos un placeholder
      return {
        total_sent: 0,
        total_received: 0,
        success_rate: 100,
        avg_response_time: 0,
        failed_messages: 0
      };

    } catch (error) {
      logger.error('Error obteniendo estadísticas de mensajería:', error);
      throw error;
    }
  }
}

module.exports = WhatsAppService;