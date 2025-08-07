const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');

// ============================================
// CONFIGURACIÓN DE CLAUDE
// ============================================

const claudeConfig = {
  apiKey: process.env.CLAUDE_API_KEY,
  model: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022',
  maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS) || 500,
  temperature: parseFloat(process.env.CLAUDE_TEMPERATURE) || 0.7,
};

// Validar configuración
if (!claudeConfig.apiKey) {
  logger.error('❌ CLAUDE_API_KEY no está configurada en las variables de entorno');
  process.exit(1);
}

// Inicializar cliente de Anthropic
const anthropic = new Anthropic({
  apiKey: claudeConfig.apiKey,
});

// ============================================
// PROMPTS BASE DEL SISTEMA
// ============================================

const SYSTEM_PROMPTS = {
  BASE: `Eres un asistente virtual profesional y amigable de un restaurante. Tu objetivo es ayudar a los clientes a realizar pedidos de comida de manera eficiente y natural.

CARACTERÍSTICAS DE TU PERSONALIDAD:
- Amigable, paciente y servicial
- Usas emojis moderadamente para hacer la conversación más cálida
- Eres claro y conciso en tus respuestas
- Siempre confirmas los detalles importantes
- Ofreces sugerencias útiles sin ser invasivo

REGLAS IMPORTANTES:
1. SIEMPRE valida las restricciones de productos (aderezos, extras, etc.)
2. Confirma cada modificación al pedido antes de aplicarla
3. Calcula correctamente los totales incluyendo extras
4. Al final, solicita dirección completa: calle, número, colonia, referencias
5. Mantén el contexto de toda la conversación
6. Si no entiendes algo, pide aclaración amablemente
7. Ofrece alternativas cuando algo no esté disponible`,

  GREETING: `Saluda al cliente de manera cálida y presenta el menú disponible de forma organizada por categorías.`,
  
  ORDERING: `Ayuda al cliente a construir su pedido paso a paso, validando restricciones y calculando totales correctamente.`,
  
  CONFIRMING: `Confirma todos los detalles del pedido y solicita la dirección de entrega completa.`,
  
  ERROR_HANDLING: `Si ocurre un error o no entiendes algo, pide amablemente al cliente que repita o aclare su solicitud.`
};

// ============================================
// FUNCIONES PRINCIPALES
// ============================================

/**
 * Construye el contexto completo para Claude
 * @param {Object} restaurant - Datos del restaurante
 * @param {Object} orderState - Estado actual del pedido
 * @param {Array} conversationHistory - Historial de la conversación
 * @param {string} currentStep - Paso actual de la conversación
 * @returns {string} Contexto formateado para Claude
 */
const buildContext = (restaurant, orderState = null, conversationHistory = [], currentStep = 'greeting') => {
  const context = `${SYSTEM_PROMPTS.BASE}

INFORMACIÓN DEL RESTAURANTE:
Nombre: ${restaurant.name}
Horarios: ${restaurant.opens_at} - ${restaurant.closes_at}
Tiempo de entrega: ${restaurant.delivery_time_min}-${restaurant.delivery_time_max} minutos
${restaurant.delivery_fee > 0 ? `Costo de envío: $${restaurant.delivery_fee}` : 'Envío gratuito'}
${restaurant.minimum_order > 0 ? `Pedido mínimo: $${restaurant.minimum_order}` : ''}

MENÚ DISPONIBLE:
${formatMenu(restaurant.menu || [])}

${restaurant.business_rules && restaurant.business_rules.length > 0 ? 
`REGLAS IMPORTANTES:
${formatBusinessRules(restaurant.business_rules)}` : ''}

ESTADO ACTUAL DEL PEDIDO:
${orderState ? formatOrderState(orderState) : 'Carrito vacío - El cliente aún no ha pedido nada'}

${conversationHistory.length > 0 ? 
`HISTORIAL DE CONVERSACIÓN RECIENTE:
${formatConversationHistory(conversationHistory)}` : ''}

PASO ACTUAL: ${currentStep.toUpperCase()}
${SYSTEM_PROMPTS[currentStep.toUpperCase()] || SYSTEM_PROMPTS.BASE}

INSTRUCCIONES FINALES:
- Responde en español mexicano
- Máximo 3 párrafos por respuesta
- Usa emojis con moderación (1-2 por mensaje)
- Siempre incluye el total actualizado cuando hay cambios en el pedido
- Si el pedido está completo, solicita: calle, número, colonia y referencias`;

  return context;
};

/**
 * Formatea el menú para el contexto de Claude
 * @param {Array} menuItems - Items del menú
 * @returns {string} Menú formateado
 */
const formatMenu = (menuItems) => {
  if (!menuItems || menuItems.length === 0) {
    return 'No hay productos disponibles en este momento.';
  }

  const categorizedMenu = {};
  
  menuItems.forEach(item => {
    const category = item.category_name || 'Otros';
    if (!categorizedMenu[category]) {
      categorizedMenu[category] = [];
    }
    categorizedMenu[category].push(item);
  });

  let formattedMenu = '';
  
  Object.keys(categorizedMenu).forEach(category => {
    formattedMenu += `\n${category.toUpperCase()}:\n`;
    categorizedMenu[category].forEach(item => {
      formattedMenu += `• ${item.name} - $${item.price}`;
      if (item.description) {
        formattedMenu += ` (${item.description})`;
      }
      formattedMenu += '\n';
    });
  });

  return formattedMenu;
};

/**
 * Formatea las reglas de negocio para el contexto
 * @param {Array} businessRules - Reglas de negocio
 * @returns {string} Reglas formateadas
 */
const formatBusinessRules = (businessRules) => {
  if (!businessRules || businessRules.length === 0) {
    return '';
  }

  return businessRules.map(rule => {
    return `• ${rule.rule_name}: ${rule.ai_message_template || JSON.stringify(rule.rule_config)}`;
  }).join('\n');
};

/**
 * Formatea el estado actual del pedido
 * @param {Object} orderState - Estado del pedido
 * @returns {string} Estado formateado
 */
const formatOrderState = (orderState) => {
  if (!orderState || !orderState.items || orderState.items.length === 0) {
    return 'Carrito vacío';
  }

  let formatted = 'Pedido actual:\n';
  
  orderState.items.forEach((item, index) => {
    formatted += `${index + 1}. ${item.name} (${item.quantity}x) - $${item.item_total}\n`;
    
    if (item.customizations && item.customizations.length > 0) {
      item.customizations.forEach(custom => {
        formatted += `   - ${custom.name}${custom.extra_cost > 0 ? ` (+$${custom.extra_cost})` : ''}\n`;
      });
    }
    
    if (item.notes) {
      formatted += `   Notas: ${item.notes}\n`;
    }
  });
  
  formatted += `\nSubtotal: $${orderState.subtotal || 0}`;
  if (orderState.delivery_fee > 0) {
    formatted += `\nEnvío: $${orderState.delivery_fee}`;
  }
  formatted += `\nTOTAL: $${orderState.total || 0}`;
  
  return formatted;
};

/**
 * Formatea el historial de conversación
 * @param {Array} history - Historial de mensajes
 * @returns {string} Historial formateado
 */
const formatConversationHistory = (history) => {
  return history.slice(-6).map(msg => {
    return `${msg.role === 'user' ? 'Cliente' : 'Asistente'}: ${msg.content}`;
  }).join('\n');
};

// ============================================
// FUNCIÓN PRINCIPAL PARA LLAMAR A CLAUDE
// ============================================

/**
 * Obtiene respuesta de Claude AI
 * @param {Object} contextData - Datos para construir el contexto
 * @param {string} userMessage - Mensaje del usuario
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<string>} Respuesta de Claude
 */
const getClaude3Response = async (contextData, userMessage, options = {}) => {
  const startTime = Date.now();
  
  try {
    const {
      restaurant,
      orderState,
      conversationHistory,
      currentStep = 'greeting'
    } = contextData;

    // Construir contexto
    const systemContext = buildContext(restaurant, orderState, conversationHistory, currentStep);
    
    // Preparar mensajes
    const messages = [
      {
        role: 'user',
        content: userMessage
      }
    ];

    // Configuración de la llamada
    const requestConfig = {
      model: options.model || claudeConfig.model,
      max_tokens: options.maxTokens || claudeConfig.maxTokens,
      temperature: options.temperature || claudeConfig.temperature,
      system: systemContext,
      messages: messages
    };

    logger.debug('Llamando a Claude API', {
      model: requestConfig.model,
      maxTokens: requestConfig.max_tokens,
      temperature: requestConfig.temperature,
      userMessageLength: userMessage.length,
      contextLength: systemContext.length
    });

    // Llamar a Claude
    const response = await anthropic.messages.create(requestConfig);
    
    const duration = Date.now() - startTime;
    const responseText = response.content[0].text;

    logger.info('Respuesta de Claude recibida', {
      duration: `${duration}ms`,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      responseLength: responseText.length
    });

    return {
      response: responseText,
      usage: response.usage,
      model: response.model,
      duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error('Error al llamar a Claude API', {
      duration: `${duration}ms`,
      error: error.message,
      userMessage: userMessage.substring(0, 100),
      errorType: error.constructor.name
    });

    // Retornar respuesta de fallback
    return {
      response: getFallbackResponse(userMessage),
      usage: null,
      model: 'fallback',
      duration,
      error: error.message
    };
  }
};

/**
 * Respuesta de fallback cuando Claude no está disponible
 * @param {string} userMessage - Mensaje del usuario
 * @returns {string} Respuesta de fallback
 */
const getFallbackResponse = (userMessage) => {
  const fallbackResponses = [
    'Disculpa, estoy teniendo problemas técnicos en este momento. ¿Podrías repetir tu mensaje?',
    'Lo siento, no pude procesar tu solicitud. ¿Puedes intentar de nuevo?',
    'Estoy experimentando dificultades técnicas. Por favor, intenta nuevamente en unos momentos.',
    'Disculpa la inconveniencia. ¿Podrías volver a enviar tu mensaje?'
  ];
  
  return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
};

/**
 * Verifica si Claude está disponible
 * @returns {Promise<boolean>} True si Claude responde
 */
const testClaudeConnection = async () => {
  try {
    const response = await anthropic.messages.create({
      model: claudeConfig.model,
      max_tokens: 50,
      temperature: 0,
      system: 'Responde solo con "OK" para confirmar que funciona.',
      messages: [{ role: 'user', content: 'Test' }]
    });

    const isWorking = response.content[0].text.trim().toUpperCase() === 'OK';
    
    logger.info('Test de Claude completado', { 
      isWorking,
      model: response.model,
      usage: response.usage
    });
    
    return isWorking;
    
  } catch (error) {
    logger.error('Error en test de Claude:', error);
    return false;
  }
};

// ============================================
// EXPORTS
// ============================================

module.exports = {
  anthropic,
  claudeConfig,
  getClaude3Response,
  buildContext,
  testClaudeConnection,
  SYSTEM_PROMPTS
};