const Conversation = require('../models/Conversation');
const Customer = require('../models/Customer');
const Menu = require('../models/Menu');
const ClaudeService = require('./claudeService');
const WhatsAppService = require('./whatsappService');
const ValidationService = require('./validationService');
const logger = require('../utils/logger');
const { 
  CONVERSATION_STATUS, 
  CONVERSATION_STEPS, 
  TIME_LIMITS,
  DEFAULT_MESSAGES 
} = require('../utils/constants');
const { ValidationError, DatabaseError } = require('../middleware/errorHandler');

// ============================================
// SERVICIO DE CONVERSACIONES
// ============================================

class ConversationService {

  /**
   * Procesa un mensaje entrante y genera respuesta
   * @param {Object} params - Parámetros del procesamiento
   * @returns {Promise<Object>} Resultado del procesamiento
   */
  static async processIncomingMessage(params) {
    const {
      restaurant,
      customerPhone,
      messageText,
      messageData = null
    } = params;

    try {
      // 1. Obtener o crear conversación
      const conversation = await Conversation.getOrCreate(restaurant.id, customerPhone);
      
      // 2. Obtener datos del cliente
      const customer = await Customer.findOrCreate(customerPhone);
      
      // 3. Validar mensaje
      const validationResult = ValidationService.validateIncomingMessage(messageText, conversation);
      if (!validationResult.isValid) {
        return await this.handleInvalidMessage(conversation, restaurant, validationResult.error);
      }

      // 4. Agregar mensaje del usuario al contexto
      await Conversation.addToContext(conversation.id, 'user', messageText);

      // 5. Verificar si es mensaje multimedia
      if (messageData?.mediaUrl) {
        const mediaResult = await WhatsAppService.processMediaMessage(messageData);
        if (mediaResult && mediaResult.message) {
          return await this.sendResponse(customerPhone, mediaResult.message, restaurant);
        }
      }

      // 6. Procesar con Claude AI
      const claudeResult = await ClaudeService.processMessage({
        restaurant,
        conversation,
        userMessage: messageText,
        customerData: customer
      });

      // 7. Procesar acciones detectadas por la IA
      const updatedConversation = await this.processDetectedActions(
        conversation,
        claudeResult.analysis,
        messageText,
        restaurant
      );

      // 8. Agregar respuesta de la IA al contexto
      await Conversation.addToContext(updatedConversation.id, 'assistant', claudeResult.response);

      // 9. Enviar respuesta al cliente
      const sendResult = await this.sendResponse(customerPhone, claudeResult.response, restaurant);

      return {
        success: true,
        conversation: updatedConversation,
        claudeResult,
        sendResult,
        actions_processed: claudeResult.analysis.actions || []
      };

    } catch (error) {
      logger.error('Error procesando mensaje entrante:', error);
      
      // Enviar mensaje de error al cliente
      try {
        await this.sendResponse(
          customerPhone, 
          restaurant.error_message || DEFAULT_MESSAGES.ERROR, 
          restaurant
        );
      } catch (sendError) {
        logger.error('Error enviando mensaje de error:', sendError);
      }

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Procesa las acciones detectadas por Claude AI
   * @param {Object} conversation - Conversación actual
   * @param {Object} analysis - Análisis de Claude
   * @param {string} messageText - Texto del mensaje
   * @param {Object} restaurant - Datos del restaurante
   * @returns {Promise<Object>} Conversación actualizada
   */
  static async processDetectedActions(conversation, analysis, messageText, restaurant) {
    try {
      let updatedConversation = conversation;
      const actions = analysis.actions || [];

      for (const action of actions) {
        switch (action) {
          case 'add_items':
            updatedConversation = await this.processAddItems(
              updatedConversation, 
              analysis.extracted_data.items || [],
              restaurant
            );
            break;

          case 'modify_order':
            updatedConversation = await this.processModifyOrder(
              updatedConversation,
              messageText,
              restaurant
            );
            break;

          case 'save_address':
            updatedConversation = await this.processSaveAddress(
              updatedConversation,
              analysis.extracted_data.address
            );
            break;

          case 'confirm_order':
            updatedConversation = await this.processConfirmOrder(
              updatedConversation,
              restaurant
            );
            break;

          default:
            logger.debug('Acción no reconocida:', action);
        }
      }

      // Actualizar paso de la conversación si cambió
      if (analysis.next_step && analysis.next_step !== conversation.current_step) {
        updatedConversation = await Conversation.update(updatedConversation.id, {
          current_step: analysis.next_step
        });
      }

      return updatedConversation;

    } catch (error) {
      logger.error('Error procesando acciones detectadas:', error);
      return conversation; // Retornar conversación original si hay error
    }
  }

  /**
   * Procesa la adición de items al pedido
   * @param {Object} conversation - Conversación actual
   * @param {Array} detectedItems - Items detectados por la IA
   * @param {Object} restaurant - Datos del restaurante
   * @returns {Promise<Object>} Conversación actualizada
   */
  static async processAddItems(conversation, detectedItems, restaurant) {
    try {
      if (!detectedItems || detectedItems.length === 0) {
        return conversation;
      }

      // Obtener menú del restaurante
      const menuData = await Menu.getFullMenu(restaurant.id, true);
      const flatMenu = this.flattenMenuItems(menuData.categories);

      let updatedConversation = conversation;

      for (const detectedItem of detectedItems) {
        // Buscar item en el menú por nombre
        const menuItem = this.findMenuItemByName(detectedItem.name, flatMenu);
        
        if (menuItem) {
          const orderItem = {
            menu_item_id: menuItem.id,
            name: menuItem.name,
            base_price: menuItem.price,
            quantity: detectedItem.quantity || 1,
            customizations: [],
            customizations_cost: 0,
            notes: null
          };

          // Calcular total del item
          orderItem.item_total = orderItem.base_price * orderItem.quantity;

          // Agregar item al pedido
          updatedConversation = await Conversation.addItemToOrder(updatedConversation.id, orderItem);

          logger.info('Item agregado al pedido', {
            conversationId: conversation.id,
            itemName: menuItem.name,
            quantity: orderItem.quantity,
            total: orderItem.item_total
          });
        } else {
          logger.warn('Item no encontrado en menú', {
            conversationId: conversation.id,
            searchedItem: detectedItem.name
          });
        }
      }

      return updatedConversation;

    } catch (error) {
      logger.error('Error procesando adición de items:', error);
      return conversation;
    }
  }

  /**
   * Procesa modificaciones al pedido
   * @param {Object} conversation - Conversación actual
   * @param {string} messageText - Texto del mensaje
   * @param {Object} restaurant - Datos del restaurante
   * @returns {Promise<Object>} Conversación actualizada
   */
  static async processModifyOrder(conversation, messageText, restaurant) {
    try {
      const messageLower = messageText.toLowerCase();
      
      // Detectar tipo de modificación
      if (messageLower.includes('quitar') || messageLower.includes('eliminar') || messageLower.includes('cancelar')) {
        return await this.processRemoveItems(conversation, messageText);
      }

      if (messageLower.includes('cambiar') || messageLower.includes('modificar')) {
        return await this.processChangeItems(conversation, messageText, restaurant);
      }

      return conversation;

    } catch (error) {
      logger.error('Error procesando modificación de pedido:', error);
      return conversation;
    }
  }

  /**
   * Procesa la eliminación de items del pedido
   * @param {Object} conversation - Conversación actual
   * @param {string} messageText - Texto del mensaje
   * @returns {Promise<Object>} Conversación actualizada
   */
  static async processRemoveItems(conversation, messageText) {
    try {
      let orderData = JSON.parse(conversation.order_data || '{}');
      
      if (!orderData.items || orderData.items.length === 0) {
        return conversation;
      }

      // Buscar índices de items a remover
      const itemsToRemove = [];
      const messageLower = messageText.toLowerCase();

      orderData.items.forEach((item, index) => {
        if (messageLower.includes(item.name.toLowerCase())) {
          itemsToRemove.push(index);
        }
      });

      // Si no se encuentra específicamente, y hay indicación numérica
      const numberMatch = messageText.match(/(\d+)/);
      if (itemsToRemove.length === 0 && numberMatch) {
        const itemIndex = parseInt(numberMatch[1]) - 1; // Convertir a índice base 0
        if (itemIndex >= 0 && itemIndex < orderData.items.length) {
          itemsToRemove.push(itemIndex);
        }
      }

      // Remover items (en orden descendente para no afectar índices)
      let updatedConversation = conversation;
      for (const index of itemsToRemove.sort((a, b) => b - a)) {
        updatedConversation = await Conversation.removeItemFromOrder(updatedConversation.id, index);
      }

      return updatedConversation;

    } catch (error) {
      logger.error('Error procesando eliminación de items:', error);
      return conversation;
    }
  }

  /**
   * Procesa el guardado de dirección
   * @param {Object} conversation - Conversación actual
   * @param {Object} addressData - Datos de dirección extraídos
   * @returns {Promise<Object>} Conversación actualizada
   */
  static async processSaveAddress(conversation, addressData) {
    try {
      if (!addressData || Object.keys(addressData).length === 0) {
        return conversation;
      }

      let orderData = JSON.parse(conversation.order_data || '{}');
      
      if (!orderData.delivery_address) {
        orderData.delivery_address = {};
      }

      // Fusionar datos de dirección
      Object.assign(orderData.delivery_address, addressData);

      const updatedConversation = await Conversation.updateOrderData(conversation.id, orderData);

      logger.info('Dirección guardada en pedido', {
        conversationId: conversation.id,
        addressFields: Object.keys(addressData)
      });

      return updatedConversation;

    } catch (error) {
      logger.error('Error procesando guardado de dirección:', error);
      return conversation;
    }
  }

  /**
   * Maneja mensajes inválidos
   * @param {Object} conversation - Conversación actual
   * @param {Object} restaurant - Datos del restaurante
   * @param {string} errorMessage - Mensaje de error
   * @returns {Promise<Object>} Resultado del manejo
   */
  static async handleInvalidMessage(conversation, restaurant, errorMessage) {
    try {
      const response = `${DEFAULT_MESSAGES.INVALID_INPUT}\n\n${errorMessage}`;
      
      const sendResult = await this.sendResponse(
        conversation.customer_phone, 
        response, 
        restaurant
      );

      return {
        success: false,
        error: errorMessage,
        sendResult
      };

    } catch (error) {
      logger.error('Error manejando mensaje inválido:', error);
      throw error;
    }
  }

  /**
   * Envía respuesta al cliente
   * @param {string} customerPhone - Teléfono del cliente
   * @param {string} message - Mensaje a enviar
   * @param {Object} restaurant - Datos del restaurante
   * @returns {Promise<Object>} Resultado del envío
   */
  static async sendResponse(customerPhone, message, restaurant) {
    try {
      return await WhatsAppService.sendMessageWithRetry(
        customerPhone,
        message,
        { 
          addEmojis: true,
          restaurantName: restaurant.name 
        },
        2 // máximo 2 reintentos
      );

    } catch (error) {
      logger.error('Error enviando respuesta:', error);
      throw error;
    }
  }

  /**
   * Inicia una nueva conversación con mensaje de bienvenida
   * @param {Object} restaurant - Datos del restaurante
   * @param {string} customerPhone - Teléfono del cliente
   * @returns {Promise<Object>} Resultado de la iniciación
   */
  static async startConversation(restaurant, customerPhone) {
    try {
      // Obtener o crear cliente
      const customer = await Customer.findOrCreate(customerPhone);
      
      // Crear nueva conversación
      const conversation = await Conversation.getOrCreate(restaurant.id, customerPhone);
      
      // Generar mensaje de bienvenida personalizado
      const welcomeMessage = await ClaudeService.generateWelcomeMessage(restaurant, customer);
      
      // Obtener menú para incluir en bienvenida si es cliente nuevo
      let fullMessage = welcomeMessage;
      
      if (customer.total_orders === 0) {
        const menuData = await Menu.getFullMenu(restaurant.id, true);
        const menuMessage = WhatsAppService.generateMenuMessage(menuData.categories, restaurant);
        fullMessage = `${welcomeMessage}\n\n${menuMessage}`;
      }

      // Agregar mensaje de bienvenida al contexto
      await Conversation.addToContext(conversation.id, 'assistant', fullMessage);
      
      // Enviar mensaje
      const sendResult = await this.sendResponse(customerPhone, fullMessage, restaurant);

      return {
        success: true,
        conversation,
        customer,
        sendResult
      };

    } catch (error) {
      logger.error('Error iniciando conversación:', error);
      throw error;
    }
  }

  /**
   * Limpia conversaciones inactivas
   * @param {number} maxInactiveHours - Horas máximas de inactividad
   * @returns {Promise<number>} Número de conversaciones limpiadas
   */
  static async cleanupInactiveConversations(maxInactiveHours = 2) {
    try {
      const cleanedCount = await Conversation.cleanupInactive(maxInactiveHours);
      
      if (cleanedCount > 0) {
        logger.info('Conversaciones inactivas limpiadas', {
          count: cleanedCount,
          maxInactiveHours
        });
      }

      return cleanedCount;

    } catch (error) {
      logger.error('Error limpiando conversaciones inactivas:', error);
      throw error;
    }
  }

  /**
   * Obtiene el estado actual de una conversación
   * @param {string} restaurantId - ID del restaurante
   * @param {string} customerPhone - Teléfono del cliente
   * @returns {Promise<Object|null>} Estado de la conversación
   */
  static async getConversationStatus(restaurantId, customerPhone) {
    try {
      const conversation = await Conversation.getActive(restaurantId, customerPhone);
      
      if (!conversation) {
        return null;
      }

      let orderData = {};
      let aiContext = [];

      try {
        orderData = JSON.parse(conversation.order_data || '{}');
        aiContext = JSON.parse(conversation.ai_context || '[]');
      } catch (e) {
        logger.warn('Error parseando datos de conversación para status:', e);
      }

      return {
        id: conversation.id,
        status: conversation.status,
        current_step: conversation.current_step,
        last_interaction: conversation.last_interaction_at,
        items_count: orderData.items ? orderData.items.length : 0,
        total: orderData.total || 0,
        messages_count: aiContext.length,
        created_at: conversation.created_at
      };

    } catch (error) {
      logger.error('Error obteniendo estado de conversación:', error);
      throw error;
    }
  }

  /**
   * Reinicia una conversación abandonada
   * @param {string} restaurantId - ID del restaurante
   * @param {string} customerPhone - Teléfono del cliente
   * @returns {Promise<Object>} Nueva conversación iniciada
   */
  static async restartConversation(restaurantId, customerPhone) {
    try {
      // Marcar conversación actual como abandonada si existe
      const existingConversation = await Conversation.getActive(restaurantId, customerPhone);
      if (existingConversation) {
        await Conversation.abandon(existingConversation.id);
      }

      // Obtener datos del restaurante
      const Restaurant = require('../models/Restaurant');
      const restaurant = await Restaurant.findById(restaurantId);
      
      if (!restaurant) {
        throw new ValidationError('Restaurante no encontrado');
      }

      // Iniciar nueva conversación
      return await this.startConversation(restaurant, customerPhone);

    } catch (error) {
      logger.error('Error reiniciando conversación:', error);
      throw error;
    }
  }

  /**
   * Obtiene estadísticas de conversaciones
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} dateRange - Rango de fechas
   * @returns {Promise<Object>} Estadísticas
   */
  static async getConversationStats(restaurantId, dateRange = {}) {
    try {
      const stats = await Conversation.getStats(restaurantId, dateRange);
      
      // Agregar métricas adicionales
      const additionalStats = await this.calculateAdditionalStats(restaurantId, dateRange);
      
      return {
        ...stats,
        ...additionalStats
      };

    } catch (error) {
      logger.error('Error obteniendo estadísticas de conversaciones:', error);
      throw error;
    }
  }

  /**
   * Calcula estadísticas adicionales
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} dateRange - Rango de fechas
   * @returns {Promise<Object>} Estadísticas adicionales
   */
  static async calculateAdditionalStats(restaurantId, dateRange) {
    try {
      // Aquí se podrían calcular más métricas específicas
      return {
        peak_hours: [],
        avg_items_per_order: 0,
        most_common_step: CONVERSATION_STEPS.GREETING,
        customer_satisfaction: 0
      };

    } catch (error) {
      logger.error('Error calculando estadísticas adicionales:', error);
      return {};
    }
  }

  // ============================================
  // MÉTODOS AUXILIARES
  // ============================================

  /**
   * Aplana los items del menú para búsqueda
   * @param {Array} categories - Categorías del menú
   * @returns {Array} Items aplanados
   */
  static flattenMenuItems(categories) {
    const flatItems = [];
    
    categories.forEach(category => {
      category.items.forEach(item => {
        flatItems.push({
          ...item,
          category_name: category.name
        });
      });
    });

    return flatItems;
  }

  /**
   * Busca un item del menú por nombre
   * @param {string} searchName - Nombre a buscar
   * @param {Array} menuItems - Items del menú
   * @returns {Object|null} Item encontrado
   */
  static findMenuItemByName(searchName, menuItems) {
    const searchLower = searchName.toLowerCase();
    
    // Búsqueda exacta primero
    let found = menuItems.find(item => 
      item.name.toLowerCase() === searchLower
    );

    // Búsqueda parcial si no se encuentra exacta
    if (!found) {
      found = menuItems.find(item => 
        item.name.toLowerCase().includes(searchLower) ||
        searchLower.includes(item.name.toLowerCase())
      );
    }

    // Búsqueda por palabras clave
    if (!found) {
      const keywords = searchLower.split(' ');
      found = menuItems.find(item => {
        const itemWords = item.name.toLowerCase().split(' ');
        return keywords.some(keyword => 
          itemWords.some(word => word.includes(keyword))
        );
      });
    }

    return found || null;
  }

  /**
   * Valida si una conversación puede proceder al siguiente paso
   * @param {Object} conversation - Conversación a validar
   * @param {string} nextStep - Siguiente paso propuesto
   * @returns {boolean} True si puede proceder
   */
  static canProceedToStep(conversation, nextStep) {
    try {
      const currentStep = conversation.current_step;
      let orderData = {};

      try {
        orderData = JSON.parse(conversation.order_data || '{}');
      } catch (e) {
        orderData = { items: [] };
      }

      switch (nextStep) {
        case CONVERSATION_STEPS.ORDERING:
          return true; // Siempre se puede empezar a ordenar

        case CONVERSATION_STEPS.ADDRESS:
          return orderData.items && orderData.items.length > 0;

        case CONVERSATION_STEPS.CONFIRMING:
          return orderData.items && 
                 orderData.items.length > 0 && 
                 orderData.delivery_address &&
                 orderData.delivery_address.street &&
                 orderData.delivery_address.number &&
                 orderData.delivery_address.neighborhood;

        case CONVERSATION_STEPS.COMPLETED:
          return currentStep === CONVERSATION_STEPS.CONFIRMING;

        default:
          return true;
      }

    } catch (error) {
      logger.error('Error validando paso de conversación:', error);
      return false;
    }
  }
}

module.exports = ConversationService;