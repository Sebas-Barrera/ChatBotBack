const { getClaude3Response, buildContext } = require('../config/claude');
const logger = require('../utils/logger');
const { CONVERSATION_STEPS, DEFAULT_MESSAGES } = require('../utils/constants');
const Menu = require('../models/Menu');
const { query } = require('../config/database');

// ============================================
// SERVICIO CLAUDE AI
// ============================================

class ClaudeService {

  /**
   * Procesa un mensaje del usuario con Claude AI
   * @param {Object} params - Parámetros del procesamiento
   * @returns {Promise<Object>} Respuesta procesada
   */
  static async processMessage(params) {
    const {
      restaurant,
      conversation,
      userMessage,
      customerData = null
    } = params;

    try {
      // Preparar datos del contexto
      const contextData = await this.prepareContextData(restaurant, conversation, customerData);
      
      // Llamar a Claude
      const claudeResponse = await getClaude3Response(
        contextData,
        userMessage,
        {
          model: restaurant.claude_model,
          temperature: 0.7,
          maxTokens: 500
        }
      );

      // Analizar la respuesta para detectar intenciones
      const analysis = await this.analyzeResponse(claudeResponse.response, conversation);

      return {
        success: true,
        response: claudeResponse.response,
        analysis,
        usage: claudeResponse.usage,
        model: claudeResponse.model,
        duration: claudeResponse.duration
      };

    } catch (error) {
      logger.error('Error procesando mensaje con Claude:', error);
      
      // Retornar respuesta de fallback
      return {
        success: false,
        response: restaurant.error_message || DEFAULT_MESSAGES.ERROR,
        analysis: {
          intent: 'error',
          confidence: 0,
          next_step: conversation.current_step
        },
        error: error.message
      };
    }
  }

  /**
   * Prepara los datos de contexto para Claude
   * @param {Object} restaurant - Datos del restaurante
   * @param {Object} conversation - Conversación actual
   * @param {Object} customerData - Datos del cliente
   * @returns {Promise<Object>} Datos de contexto preparados
   */
  static async prepareContextData(restaurant, conversation, customerData = null) {
    try {
      // Obtener menú completo si no está en los datos del restaurante
      if (!restaurant.menu) {
        const menuData = await Menu.getFullMenu(restaurant.id, true);
        restaurant.menu = this.flattenMenuForContext(menuData.categories);
      }

      // Obtener reglas de negocio si no están incluidas
      if (!restaurant.business_rules) {
        const rulesResult = await query(
          'SELECT * FROM business_rules WHERE restaurant_id = $1 AND is_active = true',
          [restaurant.id],
          'get_business_rules_for_context'
        );
        restaurant.business_rules = rulesResult.rows;
      }

      // Parsear datos de la conversación
      let orderState = null;
      let conversationHistory = [];

      try {
        orderState = JSON.parse(conversation.order_data || '{}');
        conversationHistory = JSON.parse(conversation.ai_context || '[]');
      } catch (e) {
        logger.warn('Error parseando datos de conversación:', e);
        orderState = { items: [], subtotal: 0, delivery_fee: 0, total: 0 };
        conversationHistory = [];
      }

      // Agregar información del cliente si está disponible
      let customerContext = '';
      if (customerData && customerData.name) {
        customerContext = `\nCLIENTE: ${customerData.name}`;
        if (customerData.total_orders > 0) {
          customerContext += ` (${customerData.total_orders} pedidos anteriores)`;
        }
        if (customerData.favorite_item) {
          customerContext += `\nItem favorito: ${customerData.favorite_item}`;
        }
      }

      return {
        restaurant: {
          ...restaurant,
          customer_context: customerContext
        },
        orderState,
        conversationHistory,
        currentStep: conversation.current_step || CONVERSATION_STEPS.GREETING
      };

    } catch (error) {
      logger.error('Error preparando contexto para Claude:', error);
      throw error;
    }
  }

  /**
   * Aplana el menú para el contexto de Claude
   * @param {Array} categories - Categorías del menú
   * @returns {Array} Menú aplanado
   */
  static flattenMenuForContext(categories) {
    const flatMenu = [];
    
    categories.forEach(category => {
      category.items.forEach(item => {
        flatMenu.push({
          ...item,
          category_name: category.name,
          category_emoji: category.emoji
        });
      });
    });

    return flatMenu;
  }

  /**
   * Analiza la respuesta de Claude para detectar intenciones
   * @param {string} response - Respuesta de Claude
   * @param {Object} conversation - Conversación actual
   * @returns {Promise<Object>} Análisis de la respuesta
   */
  static async analyzeResponse(response, conversation) {
    try {
      const analysis = {
        intent: 'chat',
        confidence: 0.5,
        next_step: conversation.current_step,
        actions: [],
        extracted_data: {}
      };

      const responseLower = response.toLowerCase();

      // Detectar intenciones comunes
      if (this.containsOrderingKeywords(responseLower)) {
        analysis.intent = 'ordering';
        analysis.confidence = 0.8;
        analysis.next_step = CONVERSATION_STEPS.ORDERING;
      }

      if (this.containsAddressKeywords(responseLower)) {
        analysis.intent = 'address_request';
        analysis.confidence = 0.9;
        analysis.next_step = CONVERSATION_STEPS.ADDRESS;
      }

      if (this.containsConfirmationKeywords(responseLower)) {
        analysis.intent = 'confirmation';
        analysis.confidence = 0.8;
        analysis.next_step = CONVERSATION_STEPS.CONFIRMING;
      }

      if (this.containsModificationKeywords(responseLower)) {
        analysis.intent = 'modify_order';
        analysis.confidence = 0.7;
        analysis.actions.push('modify_order');
      }

      // Extraer información específica
      const extractedAddress = this.extractAddressInfo(response);
      if (extractedAddress) {
        analysis.extracted_data.address = extractedAddress;
        analysis.actions.push('save_address');
      }

      const extractedItems = this.extractOrderItems(response);
      if (extractedItems.length > 0) {
        analysis.extracted_data.items = extractedItems;
        analysis.actions.push('add_items');
      }

      return analysis;

    } catch (error) {
      logger.error('Error analizando respuesta de Claude:', error);
      
      return {
        intent: 'unknown',
        confidence: 0,
        next_step: conversation.current_step,
        actions: [],
        extracted_data: {}
      };
    }
  }

  /**
   * Detecta palabras clave relacionadas con pedidos
   * @param {string} text - Texto a analizar
   * @returns {boolean} True si contiene palabras clave de pedido
   */
  static containsOrderingKeywords(text) {
    const orderKeywords = [
      'quiero', 'pedir', 'ordenar', 'llevar', 'agregar',
      'menu', 'menú', 'carta', 'disponible', 'precio',
      'cuanto cuesta', 'alitas', 'hamburguesa', 'bebida'
    ];

    return orderKeywords.some(keyword => text.includes(keyword));
  }

  /**
   * Detecta palabras clave relacionadas con dirección
   * @param {string} text - Texto a analizar
   * @returns {boolean} True si contiene palabras clave de dirección
   */
  static containsAddressKeywords(text) {
    const addressKeywords = [
      'dirección', 'direccion', 'domicilio', 'entregar',
      'calle', 'colonia', 'número', 'numero', 'referencias'
    ];

    return addressKeywords.some(keyword => text.includes(keyword));
  }

  /**
   * Detecta palabras clave de confirmación
   * @param {string} text - Texto a analizar
   * @returns {boolean} True si contiene palabras clave de confirmación
   */
  static containsConfirmationKeywords(text) {
    const confirmKeywords = [
      'confirmar', 'pedido listo', 'es todo', 'sería todo',
      'así está bien', 'perfecto', 'proceder'
    ];

    return confirmKeywords.some(keyword => text.includes(keyword));
  }

  /**
   * Detecta palabras clave de modificación
   * @param {string} text - Texto a analizar
   * @returns {boolean} True si contiene palabras clave de modificación
   */
  static containsModificationKeywords(text) {
    const modifyKeywords = [
      'cambiar', 'quitar', 'eliminar', 'modificar',
      'en lugar de', 'mejor', 'cancelar', 'ya no'
    ];

    return modifyKeywords.some(keyword => text.includes(keyword));
  }

  /**
   * Extrae información de dirección del texto
   * @param {string} text - Texto a analizar
   * @returns {Object|null} Información de dirección extraída
   */
  static extractAddressInfo(text) {
    try {
      const addressInfo = {};

      // Patrones para extraer información
      const streetPattern = /(?:calle|avenida|av\.?|blvd\.?)\s+([^,\n]+)/i;
      const numberPattern = /(?:número|numero|#|num\.?)\s*(\d+)/i;
      const neighborhoodPattern = /(?:colonia|col\.?)\s+([^,\n]+)/i;
      const referencesPattern = /(?:referencias?|entre|cerca de|enfrente de)\s+([^,\n]+)/i;

      const streetMatch = text.match(streetPattern);
      if (streetMatch) {
        addressInfo.street = streetMatch[1].trim();
      }

      const numberMatch = text.match(numberPattern);
      if (numberMatch) {
        addressInfo.number = numberMatch[1].trim();
      }

      const neighborhoodMatch = text.match(neighborhoodPattern);
      if (neighborhoodMatch) {
        addressInfo.neighborhood = neighborhoodMatch[1].trim();
      }

      const referencesMatch = text.match(referencesPattern);
      if (referencesMatch) {
        addressInfo.references = referencesMatch[1].trim();
      }

      // Retornar solo si se encontró al menos un campo
      return Object.keys(addressInfo).length > 0 ? addressInfo : null;

    } catch (error) {
      logger.error('Error extrayendo información de dirección:', error);
      return null;
    }
  }

  /**
   * Extrae items del pedido del texto
   * @param {string} text - Texto a analizar
   * @returns {Array} Items extraídos
   */
  static extractOrderItems(text) {
    try {
      const items = [];
      const textLower = text.toLowerCase();

      // Patrones comunes para items
      const itemPatterns = [
        /(\d+)\s*(?:media orden|orden|pieza|piezas|pedazo|pedazos)\s+(?:de\s+)?([^,\n]+)/gi,
        /(?:quiero|pedir|llevar)\s+(?:una|un|dos|tres|cuatro|cinco)?\s*([^,\n]+)/gi,
        /(\d+)\s*([^,\n]*(?:alitas|hamburguesa|hotdog|bebida|refresco)[^,\n]*)/gi
      ];

      itemPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(textLower)) !== null) {
          const quantity = match[1] ? parseInt(match[1]) : 1;
          const itemName = (match[2] || match[1]).trim();
          
          if (itemName && itemName.length > 2) {
            items.push({
              name: itemName,
              quantity: quantity || 1,
              confidence: 0.6
            });
          }
        }
      });

      return items;

    } catch (error) {
      logger.error('Error extrayendo items del pedido:', error);
      return [];
    }
  }

  /**
   * Genera respuesta de bienvenida personalizada
   * @param {Object} restaurant - Datos del restaurante
   * @param {Object} customerData - Datos del cliente
   * @returns {Promise<string>} Mensaje de bienvenida
   */
  static async generateWelcomeMessage(restaurant, customerData = null) {
    try {
      let welcomeMessage = restaurant.welcome_message || DEFAULT_MESSAGES.WELCOME;

      // Personalizar si es cliente recurrente
      if (customerData && customerData.total_orders > 0) {
        const personalizedMessages = [
          `¡Hola de nuevo${customerData.name ? `, ${customerData.name}` : ''}! 👋 Es un placer verte otra vez.`,
          `¡Bienvenido de vuelta${customerData.name ? `, ${customerData.name}` : ''}! 😊 ¿Lo de siempre o algo diferente hoy?`,
          `¡Hey${customerData.name ? `, ${customerData.name}` : ''}! 🎉 Gracias por elegirnos nuevamente.`
        ];

        welcomeMessage = personalizedMessages[Math.floor(Math.random() * personalizedMessages.length)];

        // Agregar sugerencia del item favorito
        if (customerData.favorite_item) {
          welcomeMessage += `\n\n¿Te gustaría tu favorito: ${customerData.favorite_item}? 🍗`;
        }
      }

      return welcomeMessage;

    } catch (error) {
      logger.error('Error generando mensaje de bienvenida:', error);
      return restaurant.welcome_message || DEFAULT_MESSAGES.WELCOME;
    }
  }

  /**
   * Valida la respuesta de Claude antes de enviarla
   * @param {string} response - Respuesta a validar
   * @param {Object} context - Contexto de la conversación
   * @returns {Object} Respuesta validada
   */
  static validateResponse(response, context = {}) {
    try {
      let validatedResponse = response;
      const issues = [];

      // Verificar longitud
      if (response.length > 1000) {
        validatedResponse = response.substring(0, 997) + '...';
        issues.push('response_truncated');
      }

      // Verificar que no contenga información sensible
      const sensitivePatterns = [
        /api[_-]?key/i,
        /password/i,
        /secret/i,
        /token/i
      ];

      sensitivePatterns.forEach(pattern => {
        if (pattern.test(response)) {
          issues.push('sensitive_data_detected');
        }
      });

      // Verificar que la respuesta sea apropiada
      if (response.length < 10) {
        issues.push('response_too_short');
      }

      return {
        response: validatedResponse,
        isValid: issues.length === 0,
        issues
      };

    } catch (error) {
      logger.error('Error validando respuesta de Claude:', error);
      
      return {
        response: DEFAULT_MESSAGES.ERROR,
        isValid: false,
        issues: ['validation_error']
      };
    }
  }

  /**
   * Genera resumen de conversación para logging
   * @param {Object} conversation - Conversación a resumir
   * @returns {Promise<string>} Resumen generado
   */
  static async generateConversationSummary(conversation) {
    try {
      let aiContext = [];
      try {
        aiContext = JSON.parse(conversation.ai_context || '[]');
      } catch (e) {
        return 'Error parseando contexto de conversación';
      }

      if (aiContext.length === 0) {
        return 'Conversación sin mensajes';
      }

      const messageCount = aiContext.length;
      const userMessages = aiContext.filter(msg => msg.role === 'user').length;
      const assistantMessages = aiContext.filter(msg => msg.role === 'assistant').length;

      let orderData = {};
      try {
        orderData = JSON.parse(conversation.order_data || '{}');
      } catch (e) {
        orderData = {};
      }

      const summary = [
        `Conversación con ${messageCount} mensajes (${userMessages} del cliente, ${assistantMessages} del asistente)`,
        `Estado: ${conversation.status}`,
        `Paso actual: ${conversation.current_step}`
      ];

      if (orderData.items && orderData.items.length > 0) {
        summary.push(`Pedido: ${orderData.items.length} items, total: $${orderData.total || 0}`);
      }

      return summary.join(' | ');

    } catch (error) {
      logger.error('Error generando resumen de conversación:', error);
      return 'Error generando resumen';
    }
  }

  /**
   * Obtiene estadísticas de uso de Claude
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} dateRange - Rango de fechas
   * @returns {Promise<Object>} Estadísticas de uso
   */
  static async getUsageStats(restaurantId, dateRange = {}) {
    try {
      // Esta función requeriría una tabla de logs de Claude
      // Por ahora retornamos un placeholder
      return {
        total_requests: 0,
        total_tokens: 0,
        avg_response_time: 0,
        error_rate: 0,
        cost_estimate: 0
      };

    } catch (error) {
      logger.error('Error obteniendo estadísticas de Claude:', error);
      throw error;
    }
  }
}

module.exports = ClaudeService;